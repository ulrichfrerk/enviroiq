// Supplier audit question overrides — pure data + helpers.
//
// "Effective" question set is computed as:
//   start with all questions in the template
//   remove any with org-level override.enabled = false
//     (unless that question has a per-supplier override.enabled = true)
//   remove any with per-supplier override.enabled = false
//
// At send-time we compute the effective set and snapshot just the question IDs
// onto supplier_audits.questions_snapshot so the audit is locked to the
// effective set even if overrides change later.

import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import { db, supplierAuditQuestionOverridesTable } from "@workspace/db";
import type {
  TemplateSchema,
  TemplateQuestion,
} from "./supplier-audit-default-template.js";

export interface OverrideRow {
  id: string;
  organisationId: string;
  templateId: string;
  questionId: string;
  supplierId: string | null;
  enabled: boolean;
  rationaleSnapshot: string;
  reason: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Look up every override visible to an org for a given template (org + all suppliers, or filtered to one supplier). */
export async function getOverridesForOrg(
  organisationId: string,
  templateId: string,
  supplierId?: string | null,
): Promise<OverrideRow[]> {
  const rows = await db
    .select()
    .from(supplierAuditQuestionOverridesTable)
    .where(and(
      eq(supplierAuditQuestionOverridesTable.organisationId, organisationId),
      eq(supplierAuditQuestionOverridesTable.templateId, templateId),
      supplierId === undefined
        ? undefined
        : supplierId === null
          ? isNull(supplierAuditQuestionOverridesTable.supplierId)
          : or(
              isNull(supplierAuditQuestionOverridesTable.supplierId),
              eq(supplierAuditQuestionOverridesTable.supplierId, supplierId),
            ),
    ));
  return rows as OverrideRow[];
}

/** Find a single override row for a question at a given scope. */
export async function findOverride(
  organisationId: string,
  templateId: string,
  questionId: string,
  supplierId: string | null,
): Promise<OverrideRow | null> {
  const rows = await db
    .select()
    .from(supplierAuditQuestionOverridesTable)
    .where(and(
      eq(supplierAuditQuestionOverridesTable.organisationId, organisationId),
      eq(supplierAuditQuestionOverridesTable.templateId, templateId),
      eq(supplierAuditQuestionOverridesTable.questionId, questionId),
      supplierId === null
        ? isNull(supplierAuditQuestionOverridesTable.supplierId)
        : eq(supplierAuditQuestionOverridesTable.supplierId, supplierId),
    ))
    .limit(1);
  return (rows[0] as OverrideRow | undefined) ?? null;
}

export interface UpsertOverrideInput {
  organisationId: string;
  templateId: string;
  questionId: string;
  supplierId: string | null;
  enabled: boolean;
  rationaleSnapshot: string;
  reason: string;
  createdByUserId: string | null;
  createdByEmail: string | null;
}

export interface UpsertOverrideResult {
  before: OverrideRow | null;
  after: OverrideRow;
}

export async function upsertOverride(input: UpsertOverrideInput): Promise<UpsertOverrideResult> {
  const before = await findOverride(input.organisationId, input.templateId, input.questionId, input.supplierId);
  if (before) {
    const [updated] = await db
      .update(supplierAuditQuestionOverridesTable)
      .set({
        enabled: input.enabled,
        rationaleSnapshot: input.rationaleSnapshot,
        reason: input.reason,
        createdByUserId: input.createdByUserId,
        createdByEmail: input.createdByEmail,
        updatedAt: new Date(),
      })
      .where(eq(supplierAuditQuestionOverridesTable.id, before.id))
      .returning();
    return { before, after: updated as OverrideRow };
  }
  const id = randomUUID();
  const [inserted] = await db
    .insert(supplierAuditQuestionOverridesTable)
    .values({
      id,
      organisationId: input.organisationId,
      templateId: input.templateId,
      questionId: input.questionId,
      supplierId: input.supplierId,
      enabled: input.enabled,
      rationaleSnapshot: input.rationaleSnapshot,
      reason: input.reason,
      createdByUserId: input.createdByUserId,
      createdByEmail: input.createdByEmail,
    })
    .returning();
  return { before: null, after: inserted as OverrideRow };
}

export async function deleteOverride(
  organisationId: string,
  templateId: string,
  questionId: string,
  supplierId: string | null,
): Promise<OverrideRow | null> {
  const before = await findOverride(organisationId, templateId, questionId, supplierId);
  if (!before) return null;
  await db
    .delete(supplierAuditQuestionOverridesTable)
    .where(eq(supplierAuditQuestionOverridesTable.id, before.id));
  return before;
}

/**
 * Compute the effective question ID set for a (org, template, supplier) tuple.
 * Per-supplier overrides win over org-level overrides per the spec.
 */
export function computeEffectiveQuestionIds(
  schema: TemplateSchema,
  overrides: OverrideRow[],
  supplierId: string | null,
): string[] {
  const orgOverrides = new Map<string, boolean>();
  const supplierOverrides = new Map<string, boolean>();
  for (const o of overrides) {
    if (o.supplierId === null) orgOverrides.set(o.questionId, o.enabled);
    else if (o.supplierId === supplierId) supplierOverrides.set(o.questionId, o.enabled);
  }
  const result: string[] = [];
  for (const sec of schema.sections) {
    for (const q of sec.questions) {
      const supplierDecision = supplierOverrides.get(q.id);
      const orgDecision = orgOverrides.get(q.id);
      // Per-supplier wins; otherwise org-level; otherwise on by default.
      const enabled = supplierDecision ?? orgDecision ?? true;
      if (enabled) result.push(q.id);
    }
  }
  return result;
}

/**
 * Filter the template schema down to only the effective question IDs. Sections
 * with zero remaining questions are dropped.
 */
export function filterSchemaToEffective(
  schema: TemplateSchema,
  effectiveIds: string[] | null | undefined,
): TemplateSchema {
  if (!effectiveIds) return schema;
  const set = new Set(effectiveIds);
  const sections = schema.sections
    .map((s) => ({ ...s, questions: s.questions.filter((q) => set.has(q.id)) }))
    .filter((s) => s.questions.length > 0);
  return { ...schema, sections };
}

/** Snapshot the rationale for a question by ID. Returns "" if missing. */
export function rationaleForQuestion(
  schema: TemplateSchema,
  questionId: string,
): { rationale: string; question: TemplateQuestion | null } {
  for (const sec of schema.sections) {
    for (const q of sec.questions) {
      if (q.id === questionId) return { rationale: q.rationale ?? "", question: q };
    }
  }
  return { rationale: "", question: null };
}

export interface OverrideCounts {
  orgDisabled: number;
  supplierDisabled: number;
  supplierForcedOn: number;
  totalDisabled: number; // questions removed from the audit (org ∪ supplier off, minus supplier on)
}

export function countDisabledForSupplier(
  schema: TemplateSchema,
  overrides: OverrideRow[],
  supplierId: string | null,
): OverrideCounts {
  let orgDisabled = 0;
  let supplierDisabled = 0;
  let supplierForcedOn = 0;
  let totalDisabled = 0;
  const orgOff = new Map<string, boolean>();
  const supplierMap = new Map<string, boolean>();
  for (const o of overrides) {
    if (o.supplierId === null && !o.enabled) orgOff.set(o.questionId, true);
    if (o.supplierId === null && !o.enabled) orgDisabled += 1;
    if (o.supplierId === supplierId && supplierId !== null) {
      supplierMap.set(o.questionId, o.enabled);
      if (o.enabled) supplierForcedOn += 1;
      else supplierDisabled += 1;
    }
  }
  for (const sec of schema.sections) {
    for (const q of sec.questions) {
      const supDecision = supplierMap.get(q.id);
      const orgDecision = orgOff.get(q.id) ? false : undefined;
      const enabled = supDecision ?? orgDecision ?? true;
      if (!enabled) totalDisabled += 1;
    }
  }
  return { orgDisabled, supplierDisabled, supplierForcedOn, totalDisabled };
}
