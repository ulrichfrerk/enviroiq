import { pgTable, text, real, boolean, timestamp } from "drizzle-orm/pg-core";

export const dataSourcesTable = pgTable("data_sources", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type").notNull(),
  provider: text("provider"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataSource = typeof dataSourcesTable.$inferSelect;

export type EmissionReading = {
  id: string;
  organisationId: string;
  sourceId: string;
  sourceType: "fleet" | "energy";
  scope: "1" | "2";
  co2eKg: number;
  recordedAt: Date | string;
  createdAt: Date | string;
};
