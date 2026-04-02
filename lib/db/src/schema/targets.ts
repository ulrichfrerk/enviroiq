import { pgTable, text, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Emission reduction targets — an org can have multiple (one per target year)
export const emissionTargetsTable = pgTable("emission_targets", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  // Baseline
  baselineYear: integer("baseline_year").notNull(),
  baselineCo2eKg: real("baseline_co2e_kg").notNull(),
  // Target
  targetYear: integer("target_year").notNull(),
  targetPctReduction: real("target_pct_reduction").notNull(), // e.g. 30 = 30% reduction
  // Optional notes / framework alignment
  label: text("label"), // e.g. "Science-Based Target", "Net Zero 2030"
  framework: text("framework"), // "SBTi" | "NZ-ETS" | "CEMARS" | "custom"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmissionTargetSchema = createInsertSchema(emissionTargetsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertEmissionTarget = z.infer<typeof insertEmissionTargetSchema>;
export type EmissionTarget = typeof emissionTargetsTable.$inferSelect;
