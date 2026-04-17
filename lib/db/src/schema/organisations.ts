import { pgTable, text, boolean, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const organisationsTable = pgTable("organisations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  country: text("country"),
  logoUrl: text("logo_url"),
  widgetKey: text("widget_key").notNull().unique(),
  webhookSecret: text("webhook_secret"),
  inboundEmailAddress: text("inbound_email_address").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  // Trust & compliance settings
  requireMfa: boolean("require_mfa").notNull().default(false),
  dataResidency: text("data_residency").notNull().default("NZ"),
  // ESG computed metrics — updated by the scheduled metrics refresh engine
  esgFleetCo2eKg: real("esg_fleet_co2e_kg"),
  esgEnergyCo2eKg: real("esg_energy_co2e_kg"),
  esgTotalCo2eKg: real("esg_total_co2e_kg"),
  esgEnergyKwh: real("esg_energy_kwh"),
  esgSustainabilityScore: real("esg_sustainability_score"),
  esgComputedAt: timestamp("esg_computed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrganisationSchema = createInsertSchema(organisationsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganisation = z.infer<typeof insertOrganisationSchema>;
export type Organisation = typeof organisationsTable.$inferSelect;
