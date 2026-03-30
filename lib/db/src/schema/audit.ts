import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id"),
  userId: text("user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: text("details"),
  outcome: text("outcome").notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
