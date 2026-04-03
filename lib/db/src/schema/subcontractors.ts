import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subcontractorsTable = pgTable("subcontractors", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  companyName: text("company_name").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  tradeType: text("trade_type"),
  hsPrequalified: boolean("hs_prequalified").default(false),
  hsExpiryDate: timestamp("hs_expiry_date", { withTimezone: true }),
  supplierCodeSigned: boolean("supplier_code_signed").default(false),
  supplierCodeSignedDate: timestamp("supplier_code_signed_date", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subcontractorHsRecordsTable = pgTable("subcontractor_hs_records", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  subcontractorId: text("subcontractor_id").notNull(),
  projectId: text("project_id"),
  recordDate: timestamp("record_date", { withTimezone: true }).notNull(),
  recordType: text("record_type").notNull(),
  description: text("description"),
  compliant: boolean("compliant").default(true),
  correctiveAction: text("corrective_action"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSubcontractorSchema = createInsertSchema(subcontractorsTable).omit({ createdAt: true, updatedAt: true });
export const insertSubcontractorHsRecordSchema = createInsertSchema(subcontractorHsRecordsTable).omit({ createdAt: true });

export type Subcontractor = typeof subcontractorsTable.$inferSelect;
export type SubcontractorHsRecord = typeof subcontractorHsRecordsTable.$inferSelect;
export type InsertSubcontractor = z.infer<typeof insertSubcontractorSchema>;
export type InsertSubcontractorHsRecord = z.infer<typeof insertSubcontractorHsRecordSchema>;
