import { pgTable, text, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const socialWorkforceSnapshotsTable = pgTable("social_workforce_snapshots", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  periodYear: integer("period_year").notNull(),
  headcount: integer("headcount"),
  fteCount: real("fte_count"),
  contractorCount: integer("contractor_count"),
  turnoverPct: real("turnover_pct"),
  femalePct: real("female_pct"),
  femaleLeadershipPct: real("female_leadership_pct"),
  payEquityGapPct: real("pay_equity_gap_pct"),
  livingWageAccredited: boolean("living_wage_accredited").default(false),
  localSupplierPct: real("local_supplier_pct"),
  volunteerHours: real("volunteer_hours"),
  charityDonationNzd: real("charity_donation_nzd"),
  modernSlaveryCompliant: boolean("modern_slavery_compliant").default(false),
  supplierCodeOfConduct: boolean("supplier_code_of_conduct").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const hsIncidentsTable = pgTable("hs_incidents", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  incidentDate: timestamp("incident_date", { withTimezone: true }).notNull(),
  incidentType: text("incident_type").notNull(),
  description: text("description"),
  daysLost: integer("days_lost").default(0),
  hoursWorkedAtTime: real("hours_worked_at_time"),
  reportedBy: text("reported_by"),
  closedOut: boolean("closed_out").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const trainingRecordsTable = pgTable("training_records", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  employeeName: text("employee_name").notNull(),
  trainingDate: timestamp("training_date", { withTimezone: true }).notNull(),
  topic: text("topic").notNull(),
  hours: real("hours").notNull(),
  provider: text("provider"),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSocialWorkforceSnapshotSchema = createInsertSchema(socialWorkforceSnapshotsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertHsIncidentSchema = createInsertSchema(hsIncidentsTable).omit({
  createdAt: true,
  updatedAt: true,
});
export const insertTrainingRecordSchema = createInsertSchema(trainingRecordsTable).omit({
  createdAt: true,
});

export type SocialWorkforceSnapshot = typeof socialWorkforceSnapshotsTable.$inferSelect;
export type HsIncident = typeof hsIncidentsTable.$inferSelect;
export type TrainingRecord = typeof trainingRecordsTable.$inferSelect;
export type InsertSocialWorkforceSnapshot = z.infer<typeof insertSocialWorkforceSnapshotSchema>;
export type InsertHsIncident = z.infer<typeof insertHsIncidentSchema>;
export type InsertTrainingRecord = z.infer<typeof insertTrainingRecordSchema>;
