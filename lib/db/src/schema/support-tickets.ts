import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// FGC: Support / Service Desk Record
export const supportTicketsTable = pgTable("support_tickets", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  contactId: text("contact_id"),
  subject: text("subject").notNull(),
  description: text("description"),
  category: text("category"),
  // FGC severity: critical | high | medium | low
  severity: text("severity").notNull().default("medium"),
  // FGC status: open | in_progress | waiting_on_customer | resolved | closed | cancelled
  status: text("status").notNull().default("open"),
  assignedTo: text("assigned_to"),
  escalationLevel: text("escalation_level"),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  resolution: text("resolution"),
  tags: jsonb("tags").$type<string[]>(),
  externalTicketId: text("external_ticket_id"),
  externalSystem: text("external_system"),
  sourceSystem: text("source_system"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
