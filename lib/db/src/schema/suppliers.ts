import { pgTable, text, boolean, timestamp, integer, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Registry
// ─────────────────────────────────────────────────────────────────────────────

export const suppliersTable = pgTable("suppliers", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),

  // Company details
  legalName: text("legal_name").notNull(),
  tradingName: text("trading_name"),
  companyNumber: text("company_number"),
  country: text("country"),
  industry: text("industry"),
  description: text("description"), // goods / services supplied

  // Primary ESG contact
  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
  // Secondary contact
  secondaryContactName: text("secondary_contact_name"),
  secondaryContactEmail: text("secondary_contact_email"),
  // Senior responsible officer
  seniorResponsibleOfficer: text("senior_responsible_officer"),

  // Logistics
  shippingMethod: text("shipping_method"), // road | sea | air | mixed
  shippingCompanies: text("shipping_companies"),
  regionsSupplied: text("regions_supplied"),

  // Risk classification
  materialType: text("material_type"),
  riskTag: text("risk_tag").notNull().default("medium"), // low | medium | high
  isCritical: boolean("is_critical").notNull().default(false),

  // Audit cycle
  auditFrequencyMonths: integer("audit_frequency_months").notNull().default(12),
  lastAuditAt: timestamp("last_audit_at", { withTimezone: true }),
  nextAuditDueAt: timestamp("next_audit_due_at", { withTimezone: true }),

  // Latest scoring rollup (cached from latest submitted audit)
  latestEsgScore: real("latest_esg_score"),
  latestRiskLevel: text("latest_risk_level"), // low | medium | high

  status: text("status").notNull().default("active"), // active | inactive | offboarded
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Audit Templates (versioned, JSON schema for sections + questions)
//
// `schema` JSON shape:
// {
//   sections: [
//     {
//       id: "environmental",
//       title: "Environmental",
//       weight: 35,
//       questions: [
//         { id: "ghg.measure", text: "...", type: "yesno", weight: 1,
//           rationale: "Why this matters in plain language",
//           evidenceRequired: false, evidenceGivesBonus: true }
//       ]
//     }, ...
//   ]
// }
//
// Question types: yesno | yesno_evidence | text | number | scale | file
// ─────────────────────────────────────────────────────────────────────────────

export const supplierAuditTemplatesTable = pgTable("supplier_audit_templates", {
  id: text("id").primaryKey(),
  // null = global default template visible to all orgs
  organisationId: text("organisation_id"),
  name: text("name").notNull(),
  description: text("description"),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  // Section weights (must total 100). Stored explicitly so the scoring engine
  // doesn't need to crack the JSON to weight sections.
  weightEnvironmental: integer("weight_environmental").notNull().default(35),
  weightSocial: integer("weight_social").notNull().default(20),
  weightGovernance: integer("weight_governance").notNull().default(25),
  weightSupplyChain: integer("weight_supply_chain").notNull().default(20),
  schema: text("schema").notNull(), // JSON
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierAuditTemplateSchema = createInsertSchema(
  supplierAuditTemplatesTable,
).omit({ createdAt: true, updatedAt: true });
export type InsertSupplierAuditTemplate = z.infer<typeof insertSupplierAuditTemplateSchema>;
export type SupplierAuditTemplate = typeof supplierAuditTemplatesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Audits (one row per cycle, locked on submission)
// ─────────────────────────────────────────────────────────────────────────────

export const supplierAuditsTable = pgTable("supplier_audits", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  supplierId: text("supplier_id").notNull(),
  templateId: text("template_id").notNull(),
  templateVersion: integer("template_version").notNull(),

  status: text("status").notNull().default("draft"),
  // draft | sent | in_progress | submitted | approved | expired | revoked

  // SHA-256 of the secret token. Secret is only ever sent in the email link.
  tokenHash: text("token_hash").notNull(),

  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),

  responses: text("responses"),         // JSON keyed by questionId
  scoreBreakdown: text("score_breakdown"), // JSON {environmental:%, social:%, ...}
  flags: text("flags"),                 // JSON array of {category, severity, message}
  esgScore: real("esg_score"),
  riskLevel: text("risk_level"),        // low | medium | high

  // Lifecycle timestamps
  sentAt: timestamp("sent_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedByUserId: text("approved_by_user_id"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  expiredAt: timestamp("expired_at", { withTimezone: true }),
  lockedAt: timestamp("locked_at", { withTimezone: true }),

  // Declaration
  declarationName: text("declaration_name"),
  declarationRole: text("declaration_role"),
  declarationConfirmed: boolean("declaration_confirmed").notNull().default(false),
  declarationDate: timestamp("declaration_date", { withTimezone: true }),

  // Reminder bookkeeping (JSON array of {type:"30d"|"7d"|"overdue", sentAt})
  remindersSent: text("reminders_sent"),

  // Power-move free-text answers
  topRiskAnswer: text("top_risk_answer"),
  supportNeededAnswer: text("support_needed_answer"),
  willingToAlignAnswer: text("willing_to_align_answer"),

  // Effective question set locked at send time. Array of question IDs that
  // ARE applicable to this audit (after org + per-supplier overrides). null
  // means "use full template" (back-compat for audits sent before overrides
  // existed). In-flight audits are unaffected by later override changes.
  questionsSnapshot: jsonb("questions_snapshot"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierAuditSchema = createInsertSchema(supplierAuditsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertSupplierAudit = z.infer<typeof insertSupplierAuditSchema>;
export type SupplierAudit = typeof supplierAuditsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Audit Events (immutable audit trail — feeds SOC 2)
// ─────────────────────────────────────────────────────────────────────────────

export const supplierAuditEventsTable = pgTable("supplier_audit_events", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  auditId: text("audit_id").notNull(),
  eventType: text("event_type").notNull(),
  // created | sent | opened | saved | submitted | approved | reminder_sent
  // | locked | expired | revoked | reopened
  actorType: text("actor_type").notNull(), // user | supplier | system
  actorId: text("actor_id"),               // userId or recipient email
  payload: text("payload"),                // JSON {anything}
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierAuditEventSchema = createInsertSchema(
  supplierAuditEventsTable,
).omit({ createdAt: true });
export type InsertSupplierAuditEvent = z.infer<typeof insertSupplierAuditEventSchema>;
export type SupplierAuditEvent = typeof supplierAuditEventsTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Audit Files (evidence uploads — small docs stored as base64)
// ─────────────────────────────────────────────────────────────────────────────

export const supplierAuditFilesTable = pgTable("supplier_audit_files", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  auditId: text("audit_id").notNull(),
  questionId: text("question_id"),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  contentBase64: text("content_base64").notNull(),
  uploadedByEmail: text("uploaded_by_email"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierAuditFileSchema = createInsertSchema(
  supplierAuditFilesTable,
).omit({ uploadedAt: true });
export type InsertSupplierAuditFile = z.infer<typeof insertSupplierAuditFileSchema>;
export type SupplierAuditFile = typeof supplierAuditFilesTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// Supplier Portal Sessions (lightweight magic-link auth for suppliers)
// ─────────────────────────────────────────────────────────────────────────────

export const supplierPortalSessionsTable = pgTable("supplier_portal_sessions", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  // SHA-256 of the cookie token actually sent to the supplier browser.
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupplierPortalSessionSchema = createInsertSchema(
  supplierPortalSessionsTable,
).omit({ createdAt: true, lastSeenAt: true });
export type SupplierPortalSession = typeof supplierPortalSessionsTable.$inferSelect;
