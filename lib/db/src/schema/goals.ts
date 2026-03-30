import { pgTable, text, timestamp, real, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const goalsTable = pgTable("goals", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  targetType: text("target_type").notNull(),
  targetValue: real("target_value").notNull(),
  targetUnit: text("target_unit").notNull(),
  baselineValue: real("baseline_value"),
  baselineYear: integer("baseline_year"),
  targetYear: integer("target_year"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  status: text("status").notNull().default("not_started"),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goalsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertGoal = z.infer<typeof insertGoalSchema>;
export type Goal = typeof goalsTable.$inferSelect;
