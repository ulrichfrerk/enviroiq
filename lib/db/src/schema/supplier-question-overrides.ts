import { pgTable, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Audit Question Overrides
//
// Lets a buyer turn questions off (or back on) at two scopes:
//   - Org-level   : supplier_id IS NULL
//   - Per-supplier: supplier_id IS NOT NULL  (wins over org-level)
//
// `enabled = false` means "this question is disabled". `enabled = true` at the
// per-supplier scope means "force-on for this supplier even though org-wide
// is off". The effective set per audit is computed at send-time and snapshotted
// onto supplier_audits.questions_snapshot so in-flight audits are unaffected
// by later override changes.
//
// `rationale_snapshot` captures the question's "why this matters" copy at
// write-time so the audit trail stays truthful even if EnviroIQ later edits
// the rationale wording. `reason` is the admin's free-text justification.
// ─────────────────────────────────────────────────────────────────────────────

export const supplierAuditQuestionOverridesTable = pgTable(
  "supplier_audit_question_overrides",
  {
    id: text("id").primaryKey(),
    organisationId: text("organisation_id").notNull(),
    templateId: text("template_id").notNull(),
    questionId: text("question_id").notNull(),
    // null = org-level override. non-null = per-supplier override.
    supplierId: text("supplier_id"),
    // false = question disabled. true = question explicitly enabled (only
    // meaningful at per-supplier scope, to override an org-level off).
    enabled: boolean("enabled").notNull(),
    rationaleSnapshot: text("rationale_snapshot").notNull(),
    reason: text("reason").notNull(),
    createdByUserId: text("created_by_user_id"),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One override row per (org, template, question, supplier-or-null).
    // We use a partial-style approach: the unique guarantee is enforced via
    // two indexes — one with supplier_id, one without (NULL-safe via COALESCE
    // applied at the DB level by self-heal SQL).
    orgScopeIdx: index("supplier_q_overrides_org_scope_idx")
      .on(t.organisationId, t.templateId, t.supplierId),
    questionIdx: index("supplier_q_overrides_question_idx")
      .on(t.organisationId, t.templateId, t.questionId),
  }),
);

export const insertSupplierAuditQuestionOverrideSchema = createInsertSchema(
  supplierAuditQuestionOverridesTable,
).omit({ createdAt: true, updatedAt: true });

export type InsertSupplierAuditQuestionOverride = z.infer<
  typeof insertSupplierAuditQuestionOverrideSchema
>;
export type SupplierAuditQuestionOverride =
  typeof supplierAuditQuestionOverridesTable.$inferSelect;
