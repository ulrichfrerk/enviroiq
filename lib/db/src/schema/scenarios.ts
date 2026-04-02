import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Lever values for a scenario — all values are 0–100 (percentages or reductions)
export const ScenarioLeversSchema = z.object({
  // Fleet levers
  evTransitionPct: z.number().min(0).max(100).default(0),        // % of fleet converted to EV
  fleetKmReductionPct: z.number().min(0).max(100).default(0),    // % reduction in total km driven
  modalShiftPct: z.number().min(0).max(100).default(0),          // % trips moved to lower-emission modes

  // Energy levers
  renewableEnergyPct: z.number().min(0).max(100).default(0),     // % of electricity from renewables (market-based)
  buildingEfficiencyPct: z.number().min(0).max(100).default(0),  // % reduction in total energy consumption

  // Offset lever
  offsetPct: z.number().min(0).max(100).default(0),              // % of remaining emissions offset
});

export type ScenarioLevers = z.infer<typeof ScenarioLeversSchema>;

export const scenariosTable = pgTable("scenarios", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  levers: jsonb("levers").notNull().$type<ScenarioLevers>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertScenarioSchema = createInsertSchema(scenariosTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenariosTable.$inferSelect;
