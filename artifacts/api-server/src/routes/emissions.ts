import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/emissions
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const { orgId } = req.params;
    const { source = "all", from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    const fromDate = from ? new Date(from as string) : new Date(Date.now() - 30 * 86400000);
    const toDate = to ? new Date(to as string) : new Date();

    const fleetRows = source === "all" || source === "fleet"
      ? await db.execute(sql`
          SELECT
            id, ${orgId}::text as organisation_id, vehicle_id as source_id,
            'fleet' as source, co2e_kg, 1 as scope,
            recorded_at, created_at
          FROM fleet_events
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND recorded_at >= ${fromDate}
            AND recorded_at <= ${toDate}
          ORDER BY recorded_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
      : { rows: [] };

    const energyRows = source === "all" || source === "energy"
      ? await db.execute(sql`
          SELECT
            id, ${orgId}::text as organisation_id, id as source_id,
            'energy' as source, co2e_kg, 2 as scope,
            period_start as recorded_at, created_at
          FROM energy_readings
          WHERE organisation_id = ${orgId}
            AND co2e_kg > 0
            AND period_start >= ${fromDate}
            AND period_end <= ${toDate}
          ORDER BY period_start DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
      : { rows: [] };

    const fleetData = (fleetRows as any).rows || fleetRows || [];
    const energyData = (energyRows as any).rows || energyRows || [];
    const items = [...fleetData, ...energyData];

    res.json({ items, total: items.length, page, limit });
  } catch (err) {
    req.log.error({ err }, "List emissions failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list emissions" });
  }
});

// GET /organisations/:orgId/emissions/totals
router.get("/totals", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const { orgId } = req.params;
    const period = (req.query.period as string) || "month";
    const groupBy = (req.query.groupBy as string) || "source";

    const now = new Date();
    let fromDate = new Date();
    switch (period) {
      case "day": fromDate.setDate(now.getDate() - 1); break;
      case "week": fromDate.setDate(now.getDate() - 7); break;
      case "month": fromDate.setMonth(now.getMonth() - 1); break;
      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "year": fromDate.setFullYear(now.getFullYear() - 1); break;
    }

    // Get fleet totals
    const fleetTotals = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total
      FROM fleet_events
      WHERE organisation_id = ${orgId}
        AND recorded_at >= ${fromDate}
        AND recorded_at <= ${now}
    `);

    // Get energy totals
    const energyTotals = await db.execute(sql`
      SELECT COALESCE(SUM(co2e_kg), 0) as total
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        AND period_start >= ${fromDate}
    `);

    const fleetCo2e = parseFloat((fleetTotals as any).rows?.[0]?.total || (fleetTotals as any)[0]?.total || "0");
    const energyCo2e = parseFloat((energyTotals as any).rows?.[0]?.total || (energyTotals as any)[0]?.total || "0");
    const totalCo2e = fleetCo2e + energyCo2e;

    // Time series (monthly buckets)
    const timeSeries = await db.execute(sql`
      SELECT
        DATE_TRUNC('month', recorded_at) as date,
        SUM(co2e_kg) as co2e_kg
      FROM fleet_events
      WHERE organisation_id = ${orgId}
        AND recorded_at >= ${fromDate}
      GROUP BY DATE_TRUNC('month', recorded_at)
      ORDER BY date ASC
    `);

    const timeSeriesRows = (timeSeries as any).rows || timeSeries || [];

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
      timeSeries: timeSeriesRows.map((r: any) => ({
        date: r.date,
        co2eKg: parseFloat(r.co2e_kg) || 0,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Get emission totals failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get emission totals" });
  }
});

export default router;
