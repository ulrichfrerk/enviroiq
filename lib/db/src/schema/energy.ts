import { pgTable, text, timestamp, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const energyReadingsTable = pgTable("energy_readings", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  utilityType: text("utility_type").notNull(),
  provider: text("provider"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  usageKwh: real("usage_kwh"),
  usageMj: real("usage_mj"),
  costAmount: real("cost_amount"),
  costCurrency: text("cost_currency").default("NZD"),
  co2eKg: real("co2e_kg"),
  source: text("source").notNull().default("manual"),
  originalFileName: text("original_file_name"),
  rawText: text("raw_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEnergyReadingSchema = createInsertSchema(energyReadingsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertEnergyReading = z.infer<typeof insertEnergyReadingSchema>;
export type EnergyReading = typeof energyReadingsTable.$inferSelect;
