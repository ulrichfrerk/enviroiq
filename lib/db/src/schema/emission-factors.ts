import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Versioned emission factors. Append-only — never modify a row.
 * To "update" a factor, insert a new row with the same factorKey,
 * a new version, and a new effectiveFrom date.
 *
 * Every fleet_event and energy_reading carries an emission_factor_id
 * referencing the factor version that was applied at ingest time.
 */
export const emissionFactorsTable = pgTable("emission_factors", {
  id: text("id").primaryKey(),
  factorKey: text("factor_key").notNull(),         // e.g. "fuel_diesel_kg_co2e_per_l"
  version: text("version").notNull(),              // e.g. "v2024.1"
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),  // null = current
  value: real("value").notNull(),                  // numeric factor value
  unit: text("unit").notNull(),                    // e.g. "kg_CO2e/L"
  category: text("category").notNull(),            // "fuel" | "electricity" | "gas"
  source: text("source").notNull(),                // "NZ_MfE_2024" | "em6" | "supplier"
  methodology: text("methodology").notNull(),      // human-readable explanation
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmissionFactorSchema = createInsertSchema(emissionFactorsTable).omit({
  createdAt: true,
});
export type InsertEmissionFactor = z.infer<typeof insertEmissionFactorSchema>;
export type EmissionFactor = typeof emissionFactorsTable.$inferSelect;
