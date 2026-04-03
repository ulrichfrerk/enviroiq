import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/emissions
// Returns paginated emission readings from both fleet and energy sources via UNION ALL
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { source = "all", from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to as string) : new Date();

    const sourceFilter = source as string;

    const countResult = await db.execute(sql`
      SELECT COUNT(*) as total FROM (
        ${sourceFilter === "energy" ? sql`SELECT 1 WHERE false` : sql`
          SELECT id FROM fleet_events
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND recorded_at >= ${fromDate}
            AND recorded_at <= ${toDate}
        `}
        ${sourceFilter !== "fleet" && sourceFilter !== "energy" ? sql`UNION ALL` : sql``}
        ${sourceFilter === "fleet" ? sql`SELECT 1 WHERE false` : sql`
          SELECT id FROM energy_readings
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND period_start >= ${fromDate}
            AND period_end <= ${toDate}
        `}
      ) combined
    `);

    let itemsResult;
    if (sourceFilter === "fleet") {
      itemsResult = await db.execute(sql`
        SELECT id, ${orgId}::text as organisation_id, vehicle_id as source_id,
               'fleet' as source_type, co2e_kg, '1' as scope, recorded_at, created_at
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND co2e_kg > 0
          AND recorded_at >= ${fromDate}
          AND recorded_at <= ${toDate}
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
    } else if (sourceFilter === "energy") {
      itemsResult = await db.execute(sql`
        SELECT id, ${orgId}::text as organisation_id, id as source_id,
               'energy' as source_type, co2e_kg, '2' as scope, period_start as recorded_at, created_at
        FROM energy_readings
        WHERE organisation_id = ${orgId}
          AND co2e_kg > 0
          AND period_start >= ${fromDate}
          AND period_end <= ${toDate}
        ORDER BY period_start DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
    } else {
      itemsResult = await db.execute(sql`
        SELECT * FROM (
          SELECT id, ${orgId}::text as organisation_id, vehicle_id as source_id,
                 'fleet' as source_type, co2e_kg, '1' as scope, recorded_at, created_at
          FROM fleet_events
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND recorded_at >= ${fromDate}
            AND recorded_at <= ${toDate}
          UNION ALL
          SELECT id, ${orgId}::text as organisation_id, id as source_id,
                 'energy' as source_type, co2e_kg, '2' as scope, period_start as recorded_at, created_at
          FROM energy_readings
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND period_start >= ${fromDate}
            AND period_end <= ${toDate}
        ) combined
        ORDER BY recorded_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);
    }

    const total = intCol(sqlRow(countResult), "total");
    const items = sqlRows(itemsResult).map((r) => ({
      id: strCol(r, "id"),
      organisationId: strCol(r, "organisation_id"),
      sourceId: strCol(r, "source_id"),
      sourceType: strCol(r, "source_type"),
      scope: strCol(r, "scope"),
      co2eKg: numCol(r, "co2e_kg"),
      recordedAt: strCol(r, "recorded_at"),
      createdAt: strCol(r, "created_at"),
    }));

    const totalPages = Math.ceil(total / limit);
    res.json({ items, total, page, limit, totalPages });
  } catch (err) {
    req.log.error({ err }, "List emissions failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list emissions" });
  }
});

// GET /organisations/:orgId/emissions/totals
// Query params:
//   period  = "all" | "7d" | "30d" | "3m" | "12m"  (or legacy "day"|"week"|"month"|"quarter"|"year")
//   groupBy = "day" | "week" | "month"      (default depends on period)
//
// Returns a fully-filled time series (every period in range, 0 for empty buckets)
// using PostgreSQL generate_series so the chart never shows gaps.
// "all" returns all recorded data grouped by month.
router.get("/totals", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const periodParam = (req.query.period as string) || "12m";
    const isAll = periodParam === "all";

    const now = new Date();
    const fromDate = new Date(now);

    // Map period string → lookback
    switch (periodParam) {
      case "all":                     fromDate.setFullYear(2018, 0, 1); break; // epoch-ish; covers all realistic data
      case "7d":      case "day":     fromDate.setDate(now.getDate() - 7); break;
      case "30d":     case "week":    fromDate.setDate(now.getDate() - 30); break;
      case "3m":      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "12m":     case "year":    fromDate.setFullYear(now.getFullYear() - 1); break;
      case "month":                   fromDate.setMonth(now.getMonth() - 1); break;
      default:                        fromDate.setFullYear(now.getFullYear() - 1);
    }

    // Determine groupBy: explicit param wins, otherwise default by period
    let groupByParam = (req.query.groupBy as string) || "";
    if (!["day", "week", "month"].includes(groupByParam)) {
      if (!isAll && (periodParam === "7d" || periodParam === "30d" || periodParam === "day" || periodParam === "week")) {
        groupByParam = "day";
      } else if (!isAll && (periodParam === "3m" || periodParam === "quarter")) {
        groupByParam = "week";
      } else {
        groupByParam = "month"; // all-time and 12m both group by month
      }
    }

    const fleetTotals = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total
      FROM fleet_events
      WHERE organisation_id = ${orgId}
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${now}
    `);

    const energyTotals = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        AND period_start >= ${fromDate}
    `);

    const fleetCo2e = parseFloat(String(sqlRow(fleetTotals).total ?? "0")) || 0;
    const energyCo2e = parseFloat(String(sqlRow(energyTotals).total ?? "0")) || 0;
    const totalCo2e = fleetCo2e + energyCo2e;

    // Build fully-filled time series using generate_series so every period shows (even zeros)
    // groupByParam is validated above to be one of "day" | "week" | "month"
    const truncUnit = groupByParam === "day" ? "day" : groupByParam === "week" ? "week" : "month";
    const stepInterval = truncUnit === "day" ? "1 day" : truncUnit === "week" ? "1 week" : "1 month";

    const timeSeries = await db.execute(sql`
      WITH series AS (
        SELECT generate_series(
          DATE_TRUNC(${truncUnit}, ${fromDate}::timestamptz),
          DATE_TRUNC(${truncUnit}, ${now}::timestamptz),
          ${stepInterval}::interval
        ) AS bucket
      ),
      raw_data AS (
        SELECT DATE_TRUNC(${truncUnit}, recorded_at) AS bucket, co2e_kg
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND recorded_at >= ${fromDate}
          AND recorded_at <= ${now}
        UNION ALL
        SELECT DATE_TRUNC(${truncUnit}, period_start) AS bucket, co2e_kg
        FROM energy_readings
        WHERE organisation_id = ${orgId}
          AND period_start >= ${fromDate}
          AND period_start <= ${now}
      )
      SELECT
        TO_CHAR(s.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        COALESCE(SUM(d.co2e_kg), 0) AS co2e_kg
      FROM series s
      LEFT JOIN raw_data d ON d.bucket = s.bucket
      GROUP BY s.bucket
      ORDER BY s.bucket ASC
    `);

    const timeSeriesRows = sqlRows(timeSeries);

    const breakdowns = [
      {
        label: "Fleet",
        co2eKg: fleetCo2e,
        percentage: totalCo2e > 0 ? (fleetCo2e / totalCo2e) * 100 : 0,
      },
      {
        label: "Energy",
        co2eKg: energyCo2e,
        percentage: totalCo2e > 0 ? (energyCo2e / totalCo2e) * 100 : 0,
      },
    ];

    res.json({
      organisationId: orgId,
      period: periodParam,
      groupBy: groupByParam,
      totalCo2eKg: totalCo2e,
      breakdowns,
      timeSeries: timeSeriesRows.map((r) => ({
        date: strCol(r, "date"),
        co2eKg: numCol(r, "co2e_kg"),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get emission totals failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get emission totals" });
  }
});

export default router;
