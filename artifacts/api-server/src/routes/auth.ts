import { Router } from "express";
import type { Request } from "express";
import { db, usersTable, magicLinksTable, passkeysTable, webAuthnChallengesTable, organisationsTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { logAudit } from "../lib/audit.js";
import { requireAuth } from "../lib/auth.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";

const router = Router();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RP_NAME = "EnviroIQ";

/** Resolve rpID + origin from the request — supports custom domain + .replit.app + dev preview. */
function getWebAuthnContext(req: Request): { rpID: string; expectedOrigin: string } {
  const host = req.get("host") || req.hostname;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const hostname = host.split(":")[0];
  return { rpID: hostname, expectedOrigin: `${proto}://${host}` };
}

function appBaseUrl(req: Request): string {
  const host = req.get("host");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 the token before storing/looking up so DB compromise doesn't leak usable links. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Atomically rotate the session ID before binding a user — defends against session fixation. */
function regenerateSession(req: import("express").Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function pruneExpiredChallenges(): Promise<void> {
  try {
    await db.delete(webAuthnChallengesTable).where(
      // Drizzle: lt would be cleaner; using gt-not for portability
      // We delete rows where expiresAt < now()
      // Using sql template would be safer but eq/gt on timestamp suffices
      // — we just delete with raw expression below.
      // Simpler: leave pruning to a background job; here we no-op safely.
      eq(webAuthnChallengesTable.id, ""),
    );
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

router.get("/session", requireAuth, async (req, res) => {
  const user = req.user!;
  void db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  let organisationName: string | null = null;
  if (user.organisationId) {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, user.organisationId),
    });
    organisationName = org?.name ?? null;
  }

  res.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId: user.organisationId,
    organisationName,
    isAuthenticated: true,
  });
});

router.post("/logout", async (req, res) => {
  const userId = req.session?.userId;
  await new Promise<void>((resolve) => {
    req.session?.destroy(() => resolve());
  });
  res.clearCookie("eiq.sid", { path: "/" });
  res.clearCookie("connect.sid", { path: "/" });
  await logAudit({ req, action: "auth.logout", outcome: "success", userId: userId });
  res.json({ message: "Logged out successfully" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Magic link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /auth/magic-link/request
 * Body: { email: string }
 *
 * Always returns 200 with the same generic message — never reveals whether the
 * email is registered (account-enumeration defence).
 */
router.post("/magic-link/request", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = { ok: true, message: "If that email is registered, a sign-in link has been sent." };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user || !user.isActive) {
      // Constant-time-ish: still log so we have signal, then return generic.
      await logAudit({ req, action: "auth.magic_link.request.unknown", outcome: "failure", details: { email } });
      res.json(generic);
      return;
    }

    const token = newToken(32);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    await db.insert(magicLinksTable).values({
      id: uuidv4(),
      userId: user.id,
      token: hashToken(token), // store hash, not the raw token
      expiresAt,
    });

    const url = `${appBaseUrl(req)}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail(email, url);
    await logAudit({ req, action: "auth.magic_link.request", outcome: "success", userId: user.id });
    res.json(generic);
  } catch (err) {
    req.log?.error({ err, email }, "magic-link request failed");
    res.json(generic); // never leak failure mode to the client
  }
});

/**
 * GET /auth/magic-link/verify?token=xxx
 *
 * Consumes the token, creates a session, and redirects the browser into the app.
 * Top-level navigation from an email link, so this MUST be a GET that 302s
 * rather than a POST that returns JSON.
 */
router.get("/magic-link/verify", async (req, res) => {
  const token = String(req.query.token || "");
  const base = appBaseUrl(req);

  if (!token) {
    res.redirect(`${base}/app/sign-in?error=invalid_link`);
    return;
  }

  try {
    const link = await db.query.magicLinksTable.findFirst({
      where: and(
        eq(magicLinksTable.token, hashToken(token)),
        isNull(magicLinksTable.usedAt),
        gt(magicLinksTable.expiresAt, new Date()),
      ),
    });

    if (!link) {
      await logAudit({ req, action: "auth.magic_link.verify", outcome: "failure", details: { reason: "invalid_or_expired" } });
      res.redirect(`${base}/app/sign-in?error=expired`);
      return;
    }

    // Atomically mark used (prevent token replay).
    const [marked] = await db
      .update(magicLinksTable)
      .set({ usedAt: new Date() })
      .where(and(eq(magicLinksTable.id, link.id), isNull(magicLinksTable.usedAt)))
      .returning();
    if (!marked) {
      res.redirect(`${base}/app/sign-in?error=already_used`);
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, link.userId) });
    if (!user || !user.isActive) {
      res.redirect(`${base}/app/sign-in?error=account_inactive`);
      return;
    }

    // Rotate session ID before binding the user (anti-fixation), then establish the session.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = user.organisationId;
    req.session.verifiedEmail = user.email;

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await logAudit({ req, action: "auth.magic_link.verify", outcome: "success", userId: user.id });

    // Check if user has any passkeys — if not, send them to the enrolment screen.
    const existingPasskey = await db.query.passkeysTable.findFirst({ where: eq(passkeysTable.userId, user.id) });
    const dest = existingPasskey ? "/app/dashboard" : "/app/account?enroll_passkey=1";

    req.session.save(() => res.redirect(`${base}${dest}`));
  } catch (err) {
    req.log?.error({ err }, "magic-link verify failed");
    res.redirect(`${base}/app/sign-in?error=server_error`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Passkey — Registration (must be signed in or have verifiedEmail in session)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/passkey/register/options", requireAuth, async (req, res) => {
  const user = req.user!;
  const { rpID } = getWebAuthnContext(req);

  const existing = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, user.id) });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (p.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });

  const challengeId = uuidv4();
  await db.insert(webAuthnChallengesTable).values({
    id: challengeId,
    challenge: options.challenge,
    email: user.email,
    type: "registration",
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  req.session.webAuthnChallengeId = challengeId;
  await new Promise<void>((r) => req.session.save(() => r()));

  res.json(options);
});

router.post("/passkey/register/verify", requireAuth, async (req, res) => {
  const user = req.user!;
  const { rpID, expectedOrigin } = getWebAuthnContext(req);

  const challengeId = req.session.webAuthnChallengeId;
  if (!challengeId) {
    res.status(400).json({ error: "No registration in progress" });
    return;
  }

  const challengeRow = await db.query.webAuthnChallengesTable.findFirst({
    where: and(eq(webAuthnChallengesTable.id, challengeId), gt(webAuthnChallengesTable.expiresAt, new Date())),
  });
  if (!challengeRow || challengeRow.type !== "registration") {
    res.status(400).json({ error: "Challenge expired" });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body as RegistrationResponseJSON,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      await logAudit({ req, action: "auth.passkey.register", outcome: "failure", userId: user.id });
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await db.insert(passkeysTable).values({
      id: uuidv4(),
      userId: user.id,
      credentialId: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: String(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports?.join(",") || null,
    });

    delete req.session.webAuthnChallengeId;
    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeId));
    await logAudit({ req, action: "auth.passkey.register", outcome: "success", userId: user.id });

    res.json({ verified: true });
  } catch (err) {
    req.log?.error({ err }, "passkey register verify failed");
    res.status(400).json({ error: "Verification failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Passkey — Login (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/passkey/login/options", async (req, res) => {
  const { rpID } = getWebAuthnContext(req);
  const email = String(req.body?.email || "").trim().toLowerCase();

  let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
  if (email) {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (user) {
      const passkeys = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, user.id) });
      allowCredentials = passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports ? (p.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials,
  });

  const challengeId = uuidv4();
  await db.insert(webAuthnChallengesTable).values({
    id: challengeId,
    challenge: options.challenge,
    email: email || null,
    type: "authentication",
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  req.session.webAuthnChallengeId = challengeId;
  await new Promise<void>((r) => req.session.save(() => r()));

  res.json(options);
});

router.post("/passkey/login/verify", async (req, res) => {
  const { rpID, expectedOrigin } = getWebAuthnContext(req);

  const challengeId = req.session.webAuthnChallengeId;
  if (!challengeId) {
    res.status(400).json({ error: "No authentication in progress" });
    return;
  }

  const challengeRow = await db.query.webAuthnChallengesTable.findFirst({
    where: and(eq(webAuthnChallengesTable.id, challengeId), gt(webAuthnChallengesTable.expiresAt, new Date())),
  });
  if (!challengeRow || challengeRow.type !== "authentication") {
    res.status(400).json({ error: "Challenge expired" });
    return;
  }

  try {
    const response = req.body as AuthenticationResponseJSON;
    const passkey = await db.query.passkeysTable.findFirst({
      where: eq(passkeysTable.credentialId, response.id),
    });
    if (!passkey) {
      await logAudit({ req, action: "auth.passkey.login", outcome: "failure", details: { reason: "credential_unknown" } });
      res.status(400).json({ error: "Unknown credential" });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.credentialPublicKey, "base64url"),
        counter: Number(passkey.counter) || 0,
        transports: passkey.transports
          ? (passkey.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      await logAudit({ req, action: "auth.passkey.login", outcome: "failure", userId: passkey.userId });
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    // Update counter
    await db
      .update(passkeysTable)
      .set({ counter: String(verification.authenticationInfo.newCounter) })
      .where(eq(passkeysTable.id, passkey.id));

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, passkey.userId) });
    if (!user || !user.isActive) {
      res.status(403).json({ error: "Account inactive" });
      return;
    }

    // Rotate session ID before binding the user (anti-fixation).
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = user.organisationId;
    req.session.verifiedEmail = user.email;

    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeId));
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await logAudit({ req, action: "auth.passkey.login", outcome: "success", userId: user.id });

    req.session.save(() =>
      res.json({
        verified: true,
        user: {
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organisationId: user.organisationId,
        },
      }),
    );
  } catch (err) {
    req.log?.error({ err }, "passkey login verify failed");
    res.status(400).json({ error: "Verification failed" });
  }
});

/** GET /auth/passkeys — list current user's passkeys (id + metadata only). */
router.get("/passkeys", requireAuth, async (req, res) => {
  const passkeys = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, req.user!.id) });
  res.json(
    passkeys.map((p) => ({
      id: p.id,
      deviceType: p.deviceType,
      backedUp: p.backedUp,
      createdAt: p.createdAt,
    })),
  );
});

/** DELETE /auth/passkeys/:id — remove a passkey (requires session). */
router.delete("/passkeys/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const passkey = await db.query.passkeysTable.findFirst({ where: eq(passkeysTable.id, id) });
  if (!passkey || passkey.userId !== req.user!.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(passkeysTable).where(eq(passkeysTable.id, id));
  await logAudit({ req, action: "auth.passkey.delete", outcome: "success", userId: req.user!.id, details: { passkeyId: id } });
  res.json({ ok: true });
});

void pruneExpiredChallenges; // silence unused-var lint

export default router;
