// Lightweight supplier portal — magic-link sign-in, lists all audits for
// the supplier's email across all organisations.
import { Router } from "express";
import { db, supplierPortalSessionsTable, supplierAuditsTable, suppliersTable, organisationsTable } from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { sendSupplierPortalMagicLink } from "../lib/mailer.js";
import { logAudit } from "../lib/audit.js";

const router = Router();

const COOKIE_NAME = "eiq_supplier_session";
const SESSION_TTL_DAYS = 30;
const MAGIC_TTL_MIN = 30;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function appBase(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}/app`;
  return "http://localhost:5173";
}

const requestSchema = z.object({ email: z.string().email() });

// POST /portal/request-link — email the supplier a magic link
router.post("/request-link", async (req, res) => {
  try {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Email required" }); return; }
    const email = parsed.data.email.toLowerCase().trim();

    // Privacy: don't leak whether email exists in any audit.
    const exists = await db.query.supplierAuditsTable.findFirst({ where: eq(supplierAuditsTable.recipientEmail, email) });
    if (!exists) {
      // Audit the unknown-email attempt so probing the supplier portal is
      // visible in the audit log without leaking enumeration to the caller.
      await logAudit({
        req,
        action: "auth.supplier_portal_magic_link.request.unknown",
        outcome: "failure",
        userEmail: email,
        details: { email },
      });
      res.json({ ok: true, devMode: false });
      return;
    }
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + MAGIC_TTL_MIN * 60_000);
    await db.insert(supplierPortalSessionsTable).values({
      id, email, tokenHash: sha256(secret), expiresAt,
    });
    const url = `${appBase()}/portal/verify?token=${secret}&email=${encodeURIComponent(email)}`;
    // SECURITY: only return the URL in the response when the mailer itself
    // signals dev-mode (i.e. RESEND_API_KEY is missing AND NODE_ENV !== production).
    // We MUST NOT swallow real send failures and accidentally hand the secret
    // back to the caller. Real send errors should bubble as 500s.
    let devMode = false;
    let devUrl: string | undefined;
    try {
      const result = await sendSupplierPortalMagicLink(email, url);
      devMode = result.devMode;
      if (result.devMode) devUrl = url;
    } catch (err) {
      req.log.error({ err }, "Portal magic link send failed");
      await logAudit({
        req,
        action: "auth.supplier_portal_magic_link.request",
        outcome: "failure",
        userEmail: email,
        details: { reason: "mailer_failed" },
      });
      // Privacy: don't tell the caller anything is wrong. Don't leak the URL.
      res.status(500).json({ error: "Could not send link, please try again later" });
      return;
    }
    await logAudit({
      req,
      action: "auth.supplier_portal_magic_link.request",
      outcome: "success",
      userEmail: email,
      details: { devMode },
    });
    res.json({ ok: true, devMode, url: devUrl });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// GET /portal/verify?token=...&email=... — validate, set cookie, redirect to portal
router.get("/verify", async (req, res) => {
  const base = appBase();
  try {
    const token = String(req.query.token || "");
    const email = String(req.query.email || "").toLowerCase().trim();
    if (!token || !email) {
      await logAudit({
        req,
        action: "auth.supplier_portal_magic_link.verify",
        outcome: "failure",
        userEmail: email || undefined,
        details: { reason: "invalid_link" },
      });
      res.redirect(`${base}/portal/login?error=invalid_link`);
      return;
    }
    const session = await db.query.supplierPortalSessionsTable.findFirst({
      where: and(
        eq(supplierPortalSessionsTable.email, email),
        eq(supplierPortalSessionsTable.tokenHash, sha256(token)),
        gt(supplierPortalSessionsTable.expiresAt, new Date()),
      ),
    });
    if (!session) {
      await logAudit({
        req,
        action: "auth.supplier_portal_magic_link.verify",
        outcome: "failure",
        userEmail: email,
        details: { reason: "invalid_or_expired" },
      });
      res.redirect(`${base}/portal/login?error=expired`);
      return;
    }

    // Roll a long-lived cookie token so the magic-link token isn't reusable.
    const cookieSecret = randomBytes(32).toString("base64url");
    const cookieExpires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
    await db.insert(supplierPortalSessionsTable).values({
      id: randomUUID(),
      email,
      tokenHash: sha256(cookieSecret),
      expiresAt: cookieExpires,
    });
    // Burn the original magic-link session immediately.
    await db.delete(supplierPortalSessionsTable).where(eq(supplierPortalSessionsTable.id, session.id));

    res.cookie(COOKIE_NAME, `${email}.${cookieSecret}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.protocol === "https" || !!process.env.REPLIT_DOMAINS,
      maxAge: SESSION_TTL_DAYS * 86400_000,
      path: "/",
    });
    await logAudit({
      req,
      action: "auth.supplier_portal_magic_link.verify",
      outcome: "success",
      userEmail: email,
    });
    res.redirect(`${base}/portal`);
  } catch (err) {
    req.log.error({ err });
    res.redirect(`${base}/portal/login?error=server_error`);
  }
});

function parseSupplierCookie(raw: unknown): { email: string; token: string } | null {
  if (!raw || typeof raw !== "string") return null;
  // Email can contain dots in the domain, so split on the LAST dot — everything
  // before it is the email, everything after is the cookie secret.
  const idx = raw.lastIndexOf(".");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const email = raw.slice(0, idx);
  const token = raw.slice(idx + 1);
  if (!email || !token) return null;
  return { email, token };
}

async function requireSupplier(req: any, res: any, next: any) {
  const parsed = parseSupplierCookie(req.cookies?.[COOKIE_NAME]);
  if (!parsed) {
    res.status(401).json({ error: "Not signed in" }); return;
  }
  const { email, token } = parsed;
  const session = await db.query.supplierPortalSessionsTable.findFirst({
    where: and(
      eq(supplierPortalSessionsTable.email, email),
      eq(supplierPortalSessionsTable.tokenHash, sha256(token)),
      gt(supplierPortalSessionsTable.expiresAt, new Date()),
    ),
  });
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }
  (req as any).supplierEmail = email;
  next();
}

// GET /portal/me
router.get("/me", requireSupplier, async (req, res) => {
  res.json({ email: (req as any).supplierEmail });
});

// POST /portal/logout
router.post("/logout", async (req, res) => {
  const parsed = parseSupplierCookie(req.cookies?.[COOKIE_NAME]);
  if (parsed) {
    await db.delete(supplierPortalSessionsTable).where(and(
      eq(supplierPortalSessionsTable.email, parsed.email),
      eq(supplierPortalSessionsTable.tokenHash, sha256(parsed.token)),
    ));
  }
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

// GET /portal/audits — list audits scoped to this supplier email
router.get("/audits", requireSupplier, async (req, res) => {
  try {
    const email = (req as any).supplierEmail as string;
    const audits = await db.select().from(supplierAuditsTable)
      .where(eq(supplierAuditsTable.recipientEmail, email))
      .orderBy(desc(supplierAuditsTable.createdAt));
    // Enrich with supplier + org names
    const out = await Promise.all(audits.map(async (a) => {
      const sup = await db.query.suppliersTable.findFirst({ where: eq(suppliersTable.id, a.supplierId) });
      const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, a.organisationId) });
      return {
        id: a.id, status: a.status, dueAt: a.dueAt, sentAt: a.sentAt, submittedAt: a.submittedAt,
        esgScore: a.esgScore, riskLevel: a.riskLevel,
        organisationName: org?.name ?? "—",
        supplierName: sup?.legalName ?? "—",
      };
    }));
    res.json(out);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
