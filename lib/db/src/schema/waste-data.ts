import { pgTable, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wasteRecordsTable = pgTable("waste_records", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  projectId: text("project_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  wasteType: text("waste_type").notNull(),
  quantityKg: real("quantity_kg").notNull(),
  disposalMethod: text("disposal_method").notNull(),
  diverted: boolean("diverted").notNull().default(false),
  siteOrLocation: text("site_or_location"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const environmentalIncidentsTable = pgTable("environmental_incidents", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  projectId: text("project_id"),
  incidentDate: timestamp("incident_date", { withTimezone: true }).notNull(),
  incidentType: text("incident_type").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("minor"),
  reportedToRegulator: boolean("reported_to_regulator").default(false),
  correctiveAction: text("corrective_action"),
  closedOut: boolean("closed_out").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const waterReadingsTable = pgTable("water_readings", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  projectId: text("project_id"),
  readingDate: timestamp("reading_date", { withTimezone: true }).notNull(),
  cubicMetres: real("cubic_metres").notNull(),
  meterRef: text("meter_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWasteRecordSchema = createInsertSchema(wasteRecordsTable).omit({ createdAt: true });
export const insertEnvironmentalIncidentSchema = createInsertSchema(environmentalIncidentsTable).omit({ createdAt: true, updatedAt: true });
export const insertWaterReadingSchema = createInsertSchema(waterReadingsTable).omit({ createdAt: true });

export type WasteRecord = typeof wasteRecordsTable.$inferSelect;
export type EnvironmentalIncident = typeof environmentalIncidentsTable.$inferSelect;
export type WaterReading = typeof waterReadingsTable.$inferSelect;
export type InsertWasteRecord = z.infer<typeof insertWasteRecordSchema>;
export type InsertEnvironmentalIncident = z.infer<typeof insertEnvironmentalIncidentSchema>;
export type InsertWaterReading = z.infer<typeof insertWaterReadingSchema>;
