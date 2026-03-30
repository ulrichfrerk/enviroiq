import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  title: text("title").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  reportType: text("report_type").notNull(),
  status: text("status").notNull().default("generating"),
  dataSnapshot: text("data_snapshot"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({
  createdAt: true,
});

export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
