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
  // Emission factor provenance — which kg CO2e/kWh was used and why
  gridIntensityKgCo2PerKwh: real("grid_intensity_kg_co2_per_kwh"),
  emissionMethod: text("emission_method"),   // e.g. "location_based_annual_avg", "market_based_100pct_renewable"
  emissionNote: text("emission_note"),        // human-readable explanation of the factor chosen
  supplierRenewablePct: real("supplier_renewable_pct"), // 0-100, from supplier contract
  source: text("source").notNull().default("manual"),
  originalFileName: text("original_file_name"),
  rawText: text("raw_text"),
  // Lineage — links to versioned emission factor + ingest batch for full traceability
  emissionFactorId: text("emission_factor_id"),
  importBatchId: text("import_batch_id"),
  ingestedByUserId: text("ingested_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEnergyReadingSchema = createInsertSchema(energyReadingsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertEnergyReading = z.infer<typeof insertEnergyReadingSchema>;
export type EnergyReading = typeof energyReadingsTable.$inferSelect;
