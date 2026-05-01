// Public, token-based supplier audit routes — NO auth.
// Mounted at /public/audits.
import { Router } from "express";
import { db, supplierAuditsTable, suppliersTable, organisationsTable, supplierAuditTemplatesTable, supplierAuditFilesTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { recordSupplierAuditEvent } from "../lib/supplier-audit-events.js";
import { scoreSupplierAudit, type Responses, type FilePresence } from "../lib/supplier-audit-scoring.js";
import type { TemplateSchema } from "../lib/supplier-audit-default-template.js";
import { filterSchemaToEffective } from "../lib/supplier-question-overrides.js";

const router = Router();

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function loadAuditByToken(auditId: string, secret: string) {
  const audit = await db.query.supplierAuditsTable.findFirst({
    where: eq(supplierAuditsTable.id, auditId),
  });
  if (!audit) return null;
  if (audit.tokenHash !== sha256(secret)) return null;
  return audit;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// GET /public/audits/:auditId/:token — fetch the questionnaire + current responses
router.get("/:auditId/:token", async (req, res) => {
  try {
    const audit = await loadAuditByToken(req.params.auditId, req.params.token);
    if (!audit) { res.status(404).json({ error: "Audit not found or link invalid" }); return; }

    const supplier = await db.query.suppliersTable.findFirst({ where: eq(suppliersTable.id, audit.supplierId) });
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, audit.organisationId) });
    const template = await db.query.supplierAuditTemplatesTable.findFirst({ where: eq(supplierAuditTemplatesTable.id, audit.templateId) });
    if (!template) { res.status(500).json({ error: "Template missing" }); return; }

    // Mark opened on first GET only
    if (!audit.openedAt) {
      await db.update(supplierAuditsTable)
        .set({ openedAt: new Date(), status: audit.status === "sent" ? "in_progress" : audit.status, updatedAt: new Date() })
        .where(eq(supplierAuditsTable.id, audit.id));
      await recordSupplierAuditEvent({
        organisationId: audit.organisationId, auditId: audit.id,
        eventType: "opened", actorType: "supplier", actorId: audit.recipientEmail, req,
      });
    }

    const files = await db.select().from(supplierAuditFilesTable)
      .where(eq(supplierAuditFilesTable.auditId, audit.id));

    const fullSchema = JSON.parse(template.schema) as TemplateSchema;
    const snapshot = (audit.questionsSnapshot as string[] | null) ?? null;
    const effectiveSchema = filterSchemaToEffective(fullSchema, snapshot);
    let totalQuestions = 0;
    for (const s of fullSchema.sections) totalQuestions += s.questions.length;
    const effectiveQuestions = snapshot ? snapshot.length : totalQuestions;
    const disabledCount = Math.max(0, totalQuestions - effectiveQuestions);
    const customised = !!snapshot && disabledCount > 0;

    res.json({
      audit: {
        id: audit.id,
        status: audit.openedAt || audit.status === "in_progress" ? (audit.lockedAt ? audit.status : "in_progress") : audit.status,
        recipientName: audit.recipientName,
        recipientEmail: audit.recipientEmail,
        dueAt: audit.dueAt,
        submittedAt: audit.submittedAt,
        lockedAt: audit.lockedAt,
        responses: audit.responses ? JSON.parse(audit.responses) : {},
        declarationName: audit.declarationName,
        declarationRole: audit.declarationRole,
        declarationConfirmed: audit.declarationConfirmed,
      },
      organisation: { name: org?.name, logoUrl: org?.logoUrl },
      supplier: { id: supplier?.id, legalName: supplier?.legalName, tradingName: supplier?.tradingName },
      template: {
        id: template.id, name: template.name, version: template.version,
        weights: {
          environmental: template.weightEnvironmental,
          social: template.weightSocial,
          governance: template.weightGovernance,
          supplyChain: template.weightSupplyChain,
        },
        schema: effectiveSchema,
        customised,
        totalQuestions,
        effectiveQuestions,
        disabledCount,
      },
      files: files.map((f) => ({ id: f.id, questionId: f.questionId, filename: f.filename, sizeBytes: f.sizeBytes, mimeType: f.mimeType })),
    });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

const saveSchema = z.object({
  responses: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  declarationName: z.string().optional(),
  declarationRole: z.string().optional(),
  topRiskAnswer: z.string().optional(),
  supportNeededAnswer: z.string().optional(),
  willingToAlignAnswer: z.string().optional(),
});

// POST /public/audits/:auditId/:token/save — save draft
router.post("/:auditId/:token/save", async (req, res) => {
  try {
    const audit = await loadAuditByToken(req.params.auditId, req.params.token);
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.lockedAt) { res.status(400).json({ error: "Audit is locked" }); return; }
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }

    await db.update(supplierAuditsTable).set({
      responses: JSON.stringify(parsed.data.responses),
      declarationName: parsed.data.declarationName ?? audit.declarationName,
      declarationRole: parsed.data.declarationRole ?? audit.declarationRole,
      topRiskAnswer: parsed.data.topRiskAnswer ?? audit.topRiskAnswer,
      supportNeededAnswer: parsed.data.supportNeededAnswer ?? audit.supportNeededAnswer,
      willingToAlignAnswer: parsed.data.willingToAlignAnswer ?? audit.willingToAlignAnswer,
      status: audit.status === "sent" ? "in_progress" : audit.status,
      updatedAt: new Date(),
    }).where(eq(supplierAuditsTable.id, audit.id));

    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "saved", actorType: "supplier", actorId: audit.recipientEmail, req,
    });
    res.json({ ok: true });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// POST /public/audits/:auditId/:token/file — upload evidence file (base64 in JSON)
const uploadSchema = z.object({
  questionId: z.string().optional(),
  filename: z.string().min(1).max(200),
  mimeType: z.string().optional(),
  contentBase64: z.string().min(1),
});
router.post("/:auditId/:token/file", async (req, res) => {
  try {
    const audit = await loadAuditByToken(req.params.auditId, req.params.token);
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.lockedAt) { res.status(400).json({ error: "Audit is locked" }); return; }
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const sizeBytes = Math.floor((parsed.data.contentBase64.length * 3) / 4);
    if (sizeBytes > MAX_FILE_BYTES) {
      res.status(413).json({ error: "File too large", message: "Maximum 5 MB per file" });
      return;
    }
    const id = randomUUID();
    await db.insert(supplierAuditFilesTable).values({
      id,
      organisationId: audit.organisationId,
      auditId: audit.id,
      questionId: parsed.data.questionId ?? null,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType ?? null,
      sizeBytes,
      contentBase64: parsed.data.contentBase64,
      uploadedByEmail: audit.recipientEmail,
    });
    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "file_uploaded", actorType: "supplier", actorId: audit.recipientEmail, req,
      payload: { fileId: id, filename: parsed.data.filename, sizeBytes },
    });
    res.status(201).json({ id, filename: parsed.data.filename, sizeBytes });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

// DELETE /public/audits/:auditId/:token/file/:fileId
router.delete("/:auditId/:token/file/:fileId", async (req, res) => {
  try {
    const audit = await loadAuditByToken(req.params.auditId, req.params.token);
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.lockedAt) { res.status(400).json({ error: "Audit is locked" }); return; }
    await db.delete(supplierAuditFilesTable).where(and(
      eq(supplierAuditFilesTable.id, req.params.fileId),
      eq(supplierAuditFilesTable.auditId, audit.id),
    ));
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

const submitSchema = saveSchema.extend({
  declarationConfirmed: z.literal(true),
  declarationName: z.string().min(1),
  declarationRole: z.string().min(1),
});

// POST /public/audits/:auditId/:token/submit — finalise + score + lock
router.post("/:auditId/:token/submit", async (req, res) => {
  try {
    const audit = await loadAuditByToken(req.params.auditId, req.params.token);
    if (!audit) { res.status(404).json({ error: "Not found" }); return; }
    if (audit.lockedAt) { res.status(400).json({ error: "Audit already locked" }); return; }
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }

    const template = await db.query.supplierAuditTemplatesTable.findFirst({ where: eq(supplierAuditTemplatesTable.id, audit.templateId) });
    if (!template) { res.status(500).json({ error: "Template missing" }); return; }
    const schemaFull = JSON.parse(template.schema) as TemplateSchema;
    // Score only against the effective set locked at send-time.
    const snapshotSubmit = (audit.questionsSnapshot as string[] | null) ?? null;
    const schemaParsed = filterSchemaToEffective(schemaFull, snapshotSubmit);

    const files = await db.select().from(supplierAuditFilesTable)
      .where(eq(supplierAuditFilesTable.auditId, audit.id));
    const filePresence: FilePresence = {};
    for (const f of files) if (f.questionId) filePresence[f.questionId] = true;

    const result = scoreSupplierAudit(
      schemaParsed,
      parsed.data.responses as Responses,
      filePresence,
      {
        environmental: template.weightEnvironmental,
        social: template.weightSocial,
        governance: template.weightGovernance,
        supplyChain: template.weightSupplyChain,
      },
    );

    const now = new Date();
    await db.update(supplierAuditsTable).set({
      responses: JSON.stringify(parsed.data.responses),
      declarationName: parsed.data.declarationName,
      declarationRole: parsed.data.declarationRole,
      declarationConfirmed: true,
      declarationDate: now,
      topRiskAnswer: parsed.data.topRiskAnswer ?? null,
      supportNeededAnswer: parsed.data.supportNeededAnswer ?? null,
      willingToAlignAnswer: parsed.data.willingToAlignAnswer ?? null,
      esgScore: result.esgScore,
      riskLevel: result.riskLevel,
      scoreBreakdown: JSON.stringify(result.breakdown),
      flags: JSON.stringify(result.flags),
      status: "submitted",
      submittedAt: now,
      lockedAt: now,
      updatedAt: now,
    }).where(eq(supplierAuditsTable.id, audit.id));

    // Update supplier rollup
    const nextDue = new Date(now);
    // We'll let the recurrence engine assign next based on supplier.auditFrequencyMonths;
    // but cache the latest score here so the dashboard is instant.
    const supplier = await db.query.suppliersTable.findFirst({ where: eq(suppliersTable.id, audit.supplierId) });
    if (supplier) {
      const months = supplier.auditFrequencyMonths || 12;
      nextDue.setMonth(nextDue.getMonth() + months);
      await db.update(suppliersTable).set({
        latestEsgScore: result.esgScore,
        latestRiskLevel: result.riskLevel,
        lastAuditAt: now,
        nextAuditDueAt: nextDue,
        updatedAt: new Date(),
      }).where(eq(suppliersTable.id, supplier.id));
    }

    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "submitted", actorType: "supplier", actorId: audit.recipientEmail, req,
      payload: { esgScore: result.esgScore, riskLevel: result.riskLevel },
    });
    await recordSupplierAuditEvent({
      organisationId: audit.organisationId, auditId: audit.id,
      eventType: "locked", actorType: "system", req,
    });

    res.json({
      ok: true,
      esgScore: result.esgScore,
      riskLevel: result.riskLevel,
      breakdown: result.breakdown,
      flags: result.flags,
    });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
