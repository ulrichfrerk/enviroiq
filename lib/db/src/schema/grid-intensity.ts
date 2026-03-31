import { pgTable, serial, text, timestamp, real, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const gridIntensitySnapshotsTable = pgTable("grid_intensity_snapshots", {
  id: serial("id").primaryKey(),
  source: text("source").notNull().default("em6"),
  region: text("region").notNull().default("NZ"),
  tradingPeriodStart: timestamp("trading_period_start", { withTimezone: true }).notNull(),
  gco2PerKwh: real("gco2_per_kwh").notNull(),
  renewablePct: real("renewable_pct"),
  carbonTonnes: real("carbon_tonnes"),
  rawJson: jsonb("raw_json"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("grid_intensity_snapshots_period_uniq").on(
    table.source,
    table.region,
    table.tradingPeriodStart,
  ),
]);

export type GridIntensitySnapshot = typeof gridIntensitySnapshotsTable.$inferSelect;
