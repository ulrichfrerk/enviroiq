import { Router } from "express";
import { db, supplierAuditsTable, supplierAuditEventsTable, suppliersTable, supplierAuditTemplatesTable, organisationsTable, supplierAuditFilesTable } from "@workspace/db";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { recordSupplierAuditEvent } from "../lib/supplier-audit-events.js";
import { sendSupplierAuditInviteEmail } from "../lib/mailer.js";
import {
  computeEffectiveQuestionIds,
  getOverridesForOrg,
} from "../lib/supplier-question-overrides.js";
import type { TemplateSchema } from "../lib/supplier-audit-default-template.js";

const router = Router({ mergeParams: true });

function appBase(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}/app`;
  return "http://localhost:5173";
}

function buildAuditUrl(auditId: string, secret: string): string {
  return `${appBase()}/audits/${auditId}/${secret}`;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

const sendAuditSchema = z.object({
  supplierId: z.string(),
  templateId: z.string().optional(), // defaults to global default
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
  dueInDays: z.number().int().positive().max(365).default(30),
});

// GET — list all audits in this org, newest first
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db.select().from(supplierAuditsTable)
      .where(eq(supplierAuditsTable.organisationId, orgId))
      .orderBy(desc(supplierAuditsTable.createdAt));
    res.json(rows.map((a) => ({ ...a, responses: undefined }))); // strip heavy field in list
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// GET /:auditId — full audit detail (admin)
router.get("/:auditId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const audit = await db.query.supplierAuditsTable.findFirst({
      where: and(eq(supplierAuditsTable.id, req.params.auditId), eq(supplierAuditsTable.organisationId, orgId)),
    });
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    const supplier = await db.query.suppliersTable.findFirst({ where: eq(suppliersTable.id, audit.supplierId) });
    const events = await db.select().from(supplierAuditEventsTable)
      .where(eq(supplierAuditEventsTable.auditId, audit.id))
      .orderBy(desc(supplierAuditEventsTable.createdAt));
    const files = await db.select().from(supplierAuditFilesTable)
      .where(eq(supplierAuditFilesTable.auditId, audit.id));
    res.json({
      ...audit,
      responses: audit.responses ? JSON.parse(audit.responses) : null,
      scoreBreakdown: audit.scoreBreakdown ? JSON.parse(audit.scoreBreakdown) : null,
      flags: audit.flags ? JSON.parse(audit.flags) : null,
      remindersSent: audit.remindersSent ? JSON.parse(audit.remindersSent) : null,
      tokenHash: undefined,
      supplier,
      events: events.map((e) => ({ ...e, payload: e.payload ? JSON.parse(e.payload) : null })),
      files: files.map((f) => ({ ...f, contentBase64: undefined })),
    });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// POST — create + send a new audit
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = sendAuditSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const { supplierId, recipientEmail, recipientName, dueInDays } = parsed.data;

    const supplier = await db.query.suppliersTable.findFirst({
      where: and(eq(suppliersTable.id, supplierId), eq(suppliersTable.organisationId, orgId)),
    });
    if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) { res.status(404).json({ error: "Organisation not found" }); return; }

    // Resolve template: explicit id, then default
    const template = parsed.data.templateId
      ? await db.query.supplierAuditTemplatesTable.findFirst({
        where: and(
          eq(supplierAuditTemplatesTable.id, parsed.data.templateId),
          or(eq(supplierAuditTemplatesTable.organisationId, orgId), isNull(supplierAuditTemplatesTable.organisationId)),
        ),
      })
      : await db.query.supplierAuditTemplatesTable.findFirst({
        where: and(isNull(supplierAuditTemplatesTable.organisationId), eq(supplierAuditTemplatesTable.isDefault, true)),
      });
    if (!template) { res.status(400).json({ error: "Template not available" }); return; }

    const to = recipientEmail || supplier.primaryContactEmail;
    if (!to) { res.status(400).json({ error: "Recipient email required (set on supplier or in payload)" }); return; }

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const tokenHash = sha256(secret);
    const dueAt = new Date(Date.now() + dueInDays * 86400_000);

    // Snapshot the effective question set at send time so later override
    // changes don't retro-affect this in-flight audit. Fail-closed: a
    // transient error here must NOT silently ship the unfiltered template,
    // because that would reintroduce questions an admin explicitly disabled
    // (e.g. for legal/commercial reasons). Aborting the send is safer.
    let questionsSnapshot: string[];
    try {
      const schema = JSON.parse(template.schema) as TemplateSchema;
      const overrides = await getOverridesForOrg(orgId, template.id, supplierId);
      questionsSnapshot = computeEffectiveQuestionIds(schema, overrides, supplierId);
    } catch (err) {
      req.log.error({ err, supplierId, templateId: template.id }, "Failed to compute effective question set — aborting send");
      res.status(503).json({ error: "Could not lock the question set for this audit. Please retry; if this persists, contact support." });
      return;
    }

    await db.insert(supplierAuditsTable).values({
      id,
      organisationId: orgId,
      supplierId,
      templateId: template.id,
      templateVersion: template.version,
      status: "sent",
      tokenHash,
      recipientEmail: to,
      recipientName: recipientName || supplier.primaryContactName || null,
      dueAt,
      sentAt: new Date(),
      remindersSent: JSON.stringify([]),
      questionsSnapshot,
    });

    const url = buildAuditUrl(id, secret);
    const dueLabel = dueAt.toLocaleDateString("en-NZ", { dateStyle: "long" });
    const emailResult = await sendSupplierAuditInviteEmail(
      to,
      recipientName || supplier.primaryContactName || supplier.legalName,
      org.name,
      url,
      dueLabel,
    ).catch((err) => {
      req.log.error({ err }, "Supplier invite email send failed");
      return { sent: false, devMode: false };
    });

    await recordSupplierAuditEvent({
      organisationId: orgId, auditId: id, eventType: "created",
      actorType: "user", actorId: req.session?.userId ?? null, req,
      payload: { templateId: template.id, dueAt: dueAt.toISOString() },
    });
    await recordSupplierAuditEvent({
      organisationId: orgId, auditId: id, eventType: "sent",
      actorType: "user", actorId: req.session?.userId ?? null, req,
      payload: { to, sent: emailResult.sent, devMode: emailResult.devMode },
    });
    await logAudit({ req, action: "supplier_audit.send", resourceType: "supplier_audit", resourceId: id });

    res.status(201).json({
      id, status: "sent", recipientEmail: to, dueAt,
      auditUrl: emailResult.devMode ? url : undefined, // expose link in dev mode for easy testing
      emailSent: emailResult.sent,
    });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// POST /:auditId/approve — admin marks a submitted audit approved
router.post("/:auditId/approve", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const audit = await db.query.supplierAuditsTable.findFirst({
      where: and(eq(supplierAuditsTable.id, req.params.auditId), eq(supplierAuditsTable.organisationId, orgId)),
    });
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.status !== "submitted") { res.status(400).json({ error: "Only submitted audits can be approved" }); return; }
    await db.update(supplierAuditsTable)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: req.session?.userId ?? null, updatedAt: new Date() })
      .where(eq(supplierAuditsTable.id, audit.id));
    await recordSupplierAuditEvent({
      organisationId: orgId, auditId: audit.id, eventType: "approved",
      actorType: "user", actorId: req.session?.userId ?? null, req,
    });
    await logAudit({ req, action: "supplier_audit.approve", resourceType: "supplier_audit", resourceId: audit.id });
    res.json({ ok: true });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// POST /:auditId/resend — re-issue token + send email again
router.post("/:auditId/resend", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const audit = await db.query.supplierAuditsTable.findFirst({
      where: and(eq(supplierAuditsTable.id, req.params.auditId), eq(supplierAuditsTable.organisationId, orgId)),
    });
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.status === "submitted" || audit.status === "approved") {
      res.status(400).json({ error: "Cannot resend a locked audit" }); return;
    }
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    const supplier = await db.query.suppliersTable.findFirst({ where: eq(suppliersTable.id, audit.supplierId) });
    const secret = randomBytes(32).toString("base64url");
    await db.update(supplierAuditsTable).set({ tokenHash: sha256(secret), updatedAt: new Date() }).where(eq(supplierAuditsTable.id, audit.id));
    const url = buildAuditUrl(audit.id, secret);
    const dueLabel = new Date(audit.dueAt).toLocaleDateString("en-NZ", { dateStyle: "long" });
    const emailResult = await sendSupplierAuditInviteEmail(
      audit.recipientEmail,
      audit.recipientName || supplier?.legalName || "team",
      org?.name || "EnviroIQ",
      url,
      dueLabel,
    ).catch(() => ({ sent: false, devMode: false }));
    await recordSupplierAuditEvent({
      organisationId: orgId, auditId: audit.id, eventType: "sent",
      actorType: "user", actorId: req.session?.userId ?? null, req,
      payload: { resend: true, sent: emailResult.sent },
    });
    res.json({ ok: true, auditUrl: emailResult.devMode ? url : undefined });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// GET /:auditId/file/:fileId — download evidence file (admin only)
router.get("/:auditId/file/:fileId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const file = await db.query.supplierAuditFilesTable.findFirst({
      where: and(
        eq(supplierAuditFilesTable.id, req.params.fileId),
        eq(supplierAuditFilesTable.auditId, req.params.auditId),
        eq(supplierAuditFilesTable.organisationId, orgId),
      ),
    });
    if (!file) { res.status(404).json({ error: "Not found" }); return; }
    const buf = Buffer.from(file.contentBase64, "base64");
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename.replace(/[^\w. -]/g, "_")}"`);
    res.send(buf);
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
