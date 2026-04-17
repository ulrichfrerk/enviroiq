import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id"),
  userId: text("user_id"),
  userEmail: text("user_email"),
  // FGC: actor_type — user | system | api_key | scheduler | webhook
  actorType: text("actor_type"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: text("details"),
  // FGC: structured before/after snapshots for material changes
  previousValue: jsonb("previous_value"),
  newValue: jsonb("new_value"),
  // FGC reason_code (e.g. customer_request, billing_non_payment, security_event)
  reasonCode: text("reason_code"),
  // FGC: correlation_id ties multi-step workflows together across systems
  correlationId: text("correlation_id"),
  // FGC: source_system (which app emitted this — "enviroiq", "fgc-crm", etc.)
  sourceSystem: text("source_system"),
  outcome: text("outcome").notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
