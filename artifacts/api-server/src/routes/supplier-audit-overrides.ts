// Supplier audit question override routes — org-level + per-supplier on/off
// switches with a snapshotted rationale and admin-supplied reason. Every
// mutation writes a `supplier_audit_question_override.changed` audit-log row
// with a structured before/after.

import { Router } from "express";
import { z } from "zod";
import {
  db,
  supplierAuditTemplatesTable,
  suppliersTable,
} from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { requireAuth, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import {
  deleteOverride,
  findOverride,
  getOverridesForOrg,
  rationaleForQuestion,
  upsertOverride,
} from "../lib/supplier-question-overrides.js";
import type { TemplateSchema } from "../lib/supplier-audit-default-template.js";

const router = Router({ mergeParams: true });

async function loadTemplateForOrg(orgId: string, templateId: string) {
  const tpl = await db.query.supplierAuditTemplatesTable.findFirst({
    where: and(
      eq(supplierAuditTemplatesTable.id, templateId),
      or(
        eq(supplierAuditTemplatesTable.organisationId, orgId),
        isNull(supplierAuditTemplatesTable.organisationId),
      ),
    ),
  });
  if (!tpl) return null;
  let parsed: TemplateSchema | null = null;
  try { parsed = JSON.parse(tpl.schema) as TemplateSchema; } catch { parsed = null; }
  return { row: tpl, schema: parsed };
}

async function loadDefaultTemplateId(orgId: string): Promise<string | null> {
  const tpl = await db.query.supplierAuditTemplatesTable.findFirst({
    where: and(
      isNull(supplierAuditTemplatesTable.organisationId),
      eq(supplierAuditTemplatesTable.isDefault, true),
    ),
  });
  return tpl?.id ?? null;
}

const querySchema = z.object({
  templateId: z.string().optional(),
  supplierId: z.string().optional(),
});

// GET — list overrides for org. Optional ?supplierId= scopes to that supplier
// (and still includes the org-level rows).
// Admin-only: override rows expose admin-supplied reasons and rationale
// snapshots that should not be visible to general org members.
router.get("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const templateId = parsed.data.templateId ?? (await loadDefaultTemplateId(orgId));
    if (!templateId) { res.status(404).json({ error: "Default template not found" }); return; }

    const supplierFilter = parsed.data.supplierId === undefined
      ? undefined
      : parsed.data.supplierId;
    const rows = await getOverridesForOrg(orgId, templateId, supplierFilter ?? undefined);
    res.json({ templateId, overrides: rows });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

const upsertBodySchema = z.object({
  templateId: z.string().optional(),
  questionId: z.string().min(1),
  supplierId: z.string().nullable().optional(),
  enabled: z.boolean(),
  reason: z.string().min(10, "Reason must be at least 10 characters"),
});

// PUT — create or update an override. Body: { templateId?, questionId, supplierId?, enabled, reason }
router.put("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = upsertBodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }

    const templateId = parsed.data.templateId ?? (await loadDefaultTemplateId(orgId));
    if (!templateId) { res.status(404).json({ error: "Default template not found" }); return; }
    const tpl = await loadTemplateForOrg(orgId, templateId);
    if (!tpl || !tpl.schema) { res.status(404).json({ error: "Template not found" }); return; }

    const supplierId = parsed.data.supplierId ?? null;
    if (supplierId) {
      const sup = await db.query.suppliersTable.findFirst({
        where: and(eq(suppliersTable.id, supplierId), eq(suppliersTable.organisationId, orgId)),
      });
      if (!sup) { res.status(404).json({ error: "Supplier not found" }); return; }
    }

    const { rationale, question } = rationaleForQuestion(tpl.schema, parsed.data.questionId);
    if (!question) { res.status(400).json({ error: "Question not found in template" }); return; }

    const result = await upsertOverride({
      organisationId: orgId,
      templateId,
      questionId: parsed.data.questionId,
      supplierId,
      enabled: parsed.data.enabled,
      rationaleSnapshot: rationale,
      reason: parsed.data.reason,
      createdByUserId: req.session?.userId ?? null,
      createdByEmail: req.session?.email ?? null,
    });

    await logAudit({
      req,
      action: "supplier_audit_question_override.changed",
      resourceType: "supplier_audit_question_override",
      resourceId: result.after.id,
      previousValue: result.before
        ? {
            enabled: result.before.enabled,
            reason: result.before.reason,
            rationale_snapshot: result.before.rationaleSnapshot,
            scope: result.before.supplierId ? "per_supplier" : "org",
          }
        : null,
      newValue: {
        questionId: parsed.data.questionId,
        questionText: question.text,
        scope: supplierId ? "per_supplier" : "org",
        supplierId,
        enabled: parsed.data.enabled,
        reason: parsed.data.reason,
        rationale_snapshot: rationale,
      },
    });

    res.json({ override: result.after });
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

const deleteQuerySchema = z.object({
  templateId: z.string().optional(),
  supplierId: z.string().optional(),
});

// DELETE /:questionId — remove an override (revert to inherited / default-on)
router.delete("/:questionId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const parsed = deleteQuerySchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Validation error", issues: parsed.error.issues }); return; }
    const templateId = parsed.data.templateId ?? (await loadDefaultTemplateId(orgId));
    if (!templateId) { res.status(404).json({ error: "Default template not found" }); return; }
    const supplierId = parsed.data.supplierId ?? null;

    const before = await findOverride(orgId, templateId, req.params.questionId, supplierId);
    if (!before) { res.status(404).json({ error: "Override not found" }); return; }
    await deleteOverride(orgId, templateId, req.params.questionId, supplierId);

    await logAudit({
      req,
      action: "supplier_audit_question_override.changed",
      resourceType: "supplier_audit_question_override",
      resourceId: before.id,
      previousValue: {
        enabled: before.enabled,
        reason: before.reason,
        rationale_snapshot: before.rationaleSnapshot,
        scope: before.supplierId ? "per_supplier" : "org",
      },
      newValue: {
        questionId: req.params.questionId,
        scope: supplierId ? "per_supplier" : "org",
        supplierId,
        enabled: null, // null = removed = inherit
      },
    });
    res.status(204).end();
  } catch (err) { req.log.error({ err }); res.status(500).json({ error: "Internal Server Error" }); }
});

export default router;
