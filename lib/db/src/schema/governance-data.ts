import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const governanceSnapshotsTable = pgTable("governance_snapshots", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  periodYear: integer("period_year").notNull(),
  boardSize: integer("board_size"),
  boardIndependentCount: integer("board_independent_count"),
  boardFemaleCount: integer("board_female_count"),
  boardMeetingsPerYear: integer("board_meetings_per_year"),
  hasAuditCommittee: boolean("has_audit_committee").default(false),
  hasCodeOfConduct: boolean("has_code_of_conduct").default(false),
  hasWhistleblower: boolean("has_whistleblower").default(false),
  hasAntiBribery: boolean("has_anti_bribery").default(false),
  hasPrivacyPolicy: boolean("has_privacy_policy").default(false),
  hasCyberFramework: boolean("has_cyber_framework").default(false),
  hasEsgRiskRegister: boolean("has_esg_risk_register").default(false),
  hasTcfdAligned: boolean("has_tcfd_aligned").default(false),
  hasExternalAssurance: boolean("has_external_assurance").default(false),
  hasModernSlaveryPolicy: boolean("has_modern_slavery_policy").default(false),
  frameworkAlignment: text("framework_alignment"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGovernanceSnapshotSchema = createInsertSchema(governanceSnapshotsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type GovernanceSnapshot = typeof governanceSnapshotsTable.$inferSelect;
export type InsertGovernanceSnapshot = z.infer<typeof insertGovernanceSnapshotSchema>;
