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
router.get("/totals", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const period = (req.query.period as string) || "month";

    const now = new Date();
    const fromDate = new Date(now);
    switch (period) {
      case "day": fromDate.setDate(now.getDate() - 1); break;
      case "week": fromDate.setDate(now.getDate() - 7); break;
      case "month": fromDate.setMonth(now.getMonth() - 1); break;
      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "year": fromDate.setFullYear(now.getFullYear() - 1); break;
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

    const timeSeries = await db.execute(sql`
      SELECT date, SUM(co2e_kg) as co2e_kg FROM (
        SELECT DATE_TRUNC('month', recorded_at) as date, co2e_kg
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND recorded_at >= ${fromDate}
        UNION ALL
        SELECT DATE_TRUNC('month', period_start) as date, co2e_kg
        FROM energy_readings
        WHERE organisation_id = ${orgId}
          AND period_start >= ${fromDate}
      ) combined
      GROUP BY date
      ORDER BY date ASC
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
      period,
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
