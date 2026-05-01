import { pgTable, text, boolean, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  name: text("name").notNull(),
  registration: text("registration"),
  make: text("make"),
  model: text("model"),
  year: integer("year"),
  fuelType: text("fuel_type").notNull().default("petrol"),
  emissionFactorKgPerKm: real("emission_factor_kg_per_km"),
  // Fuel consumption — used to derive litres (and therefore cost) from km when
  // fuel-card data isn't available. If null, a sensible default is applied at
  // estimation time based on fuel_type and vehicle class.
  fuelConsumptionLPer100km: real("fuel_consumption_l_per_100km"),
  // Monthly fixed running cost (lease + finance + insurance + RUC + rego + WoF).
  // Manually entered per ute. Multiplied by months in range for total fixed cost.
  monthlyFixedCostNzd: real("monthly_fixed_cost_nzd"),
  gpsProvider: text("gps_provider").default("none"),
  gpsDeviceId: text("gps_device_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fleetEventsTable = pgTable("fleet_events", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  vehicleId: text("vehicle_id").notNull(),
  eventType: text("event_type").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  speedKmh: real("speed_kmh"),
  distanceKm: real("distance_km"),
  fuelLitres: real("fuel_litres"),
  co2eKg: real("co2e_kg"),
  // Cost capture — direct from fuel-card line items where available; estimated
  // at read-time from km × L/100km × NZ monthly avg pump price otherwise.
  costNzd: real("cost_nzd"),
  unitCostNzdPerLitre: real("unit_cost_nzd_per_litre"),
  source: text("source").notNull(),
  rawPayload: text("raw_payload"),
  // Lineage — links to versioned emission factor + ingest batch for full traceability
  emissionFactorId: text("emission_factor_id"),
  importBatchId: text("import_batch_id"),
  ingestedByUserId: text("ingested_by_user_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
export type FleetEvent = typeof fleetEventsTable.$inferSelect;
