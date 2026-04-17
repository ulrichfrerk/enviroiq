import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// FGC: Provisioning Request entity
export const provisioningRequestsTable = pgTable("provisioning_requests", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id"),
  customerId: text("customer_id"), // FGC alias of organisation
  productCode: text("product_code").notNull(),
  serviceInstanceId: text("service_instance_id"),
  environment: text("environment").notNull().default("production"),
  // FGC status: pending | provisioning | active | error | cancelled
  status: text("status").notNull().default("pending"),
  requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
  resultPayload: jsonb("result_payload").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  requestedBy: text("requested_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  correlationId: text("correlation_id"),
  sourceSystem: text("source_system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProvisioningRequestSchema = createInsertSchema(provisioningRequestsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertProvisioningRequest = z.infer<typeof insertProvisioningRequestSchema>;
export type ProvisioningRequest = typeof provisioningRequestsTable.$inferSelect;
