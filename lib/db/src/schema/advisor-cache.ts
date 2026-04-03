import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const advisorCacheTable = pgTable("advisor_cache", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().unique(),
  insightsJson: text("insights_json").notNull(),
  orgContextJson: text("org_context_json").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  generatedBy: text("generated_by"),
});

export type AdvisorCache = typeof advisorCacheTable.$inferSelect;
