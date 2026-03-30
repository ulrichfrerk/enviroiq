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
  source: text("source").notNull(),
  rawPayload: text("raw_payload"),
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
