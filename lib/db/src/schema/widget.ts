import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const widgetConfigsTable = pgTable("widget_configs", {
  organisationId: text("organisation_id").primaryKey(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  title: text("title"),
  showTotalCo2e: boolean("show_total_co2e").notNull().default(true),
  showFleetStats: boolean("show_fleet_stats").notNull().default(true),
  showEnergyUsage: boolean("show_energy_usage").notNull().default(true),
  showGoals: boolean("show_goals").notNull().default(true),
  showSustainabilityScore: boolean("show_sustainability_score").notNull().default(true),
  showLastUpdated: boolean("show_last_updated").notNull().default(true),
  accentColor: text("accent_color").default("#22c55e"),
  theme: text("theme").default("light"),
  period: text("period").default("month"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWidgetConfigSchema = createInsertSchema(widgetConfigsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWidgetConfig = z.infer<typeof insertWidgetConfigSchema>;
export type WidgetConfig = typeof widgetConfigsTable.$inferSelect;
