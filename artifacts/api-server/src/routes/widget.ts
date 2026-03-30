import { Router } from "express";
import { db, widgetConfigsTable, organisationsTable, goalsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { calcSustainabilityScore } from "../lib/emissions.js";

const router = Router({ mergeParams: true });
export const widgetPublicRouter = Router();

// GET /organisations/:orgId/widget/config
router.get("/config", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string;
    const org = await db.query.organisationsTable.findFirst({ where: eq(organisationsTable.id, orgId) });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }

    let config = await db.query.widgetConfigsTable.findFirst({
      where: eq(widgetConfigsTable.organisationId, orgId),
    });

    if (!config) {
      const [newConfig] = await db.insert(widgetConfigsTable).values({ organisationId: orgId }).returning();
      config = newConfig;
    }

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0] || "localhost";
    const embedScript = `<script src="https://${domain}/api/widget/${org.widgetKey}/widget.js" async></script>\n<div id="enviroiq-widget"></div>`;

    res.json({ ...config, widgetKey: org.widgetKey, embedScript });
  } catch (err) {
    req.log.error({ err }, "Get widget config failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get widget config" });
  }
});

// PUT /organisations/:orgId/widget/config
router.put("/config", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string as string;
    const {
      isEnabled, title, showTotalCo2e, showFleetStats, showEnergyUsage,
      showGoals, showSustainabilityScore, showLastUpdated,
      accentColor, theme, period,
    } = req.body;

    const [config] = await db
      .insert(widgetConfigsTable)
      .values({
        organisationId: orgId,
        isEnabled: isEnabled ?? true,
        title,
        showTotalCo2e: showTotalCo2e ?? true,
        showFleetStats: showFleetStats ?? true,
        showEnergyUsage: showEnergyUsage ?? true,
        showGoals: showGoals ?? true,
        showSustainabilityScore: showSustainabilityScore ?? true,
        showLastUpdated: showLastUpdated ?? true,
        accentColor: accentColor ?? "#22c55e",
        theme: theme ?? "light",
        period: period ?? "month",
      })
      .onConflictDoUpdate({
        target: widgetConfigsTable.organisationId,
        set: {
          isEnabled, title, showTotalCo2e, showFleetStats, showEnergyUsage,
          showGoals, showSustainabilityScore, showLastUpdated,
          accentColor, theme, period,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.json(config);
  } catch (err) {
    req.log.error({ err }, "Update widget config failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update widget config" });
  }
});

// GET /widget/:widgetKey/data — public, no auth
widgetPublicRouter.get("/:widgetKey/data", async (req, res) => {
  try {
    const widgetKey = req.params.widgetKey as string as string;
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.widgetKey, widgetKey),
    });

    if (!org || !org.isActive) {
      res.status(404).json({ error: "Not Found", message: "Widget not found" });
      return;
    }

    const config = await db.query.widgetConfigsTable.findFirst({
      where: eq(widgetConfigsTable.organisationId, org.id),
    });

    if (!config?.isEnabled) {
      res.status(404).json({ error: "Not Found", message: "Widget is disabled" });
      return;
    }

    const now = new Date();
    let fromDate = new Date();
    const period = config.period || "month";
    switch (period) {
      case "month": fromDate.setMonth(now.getMonth() - 1); break;
      case "quarter": fromDate.setMonth(now.getMonth() - 3); break;
      case "year": fromDate.setFullYear(now.getFullYear() - 1); break;
    }

    const [fleetResult, energyResult, goals] = await Promise.all([
      db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(distance_km),0) as dist, COUNT(DISTINCT vehicle_id) as vehicles FROM fleet_events WHERE organisation_id = ${org.id} AND recorded_at >= ${fromDate}`),
      db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(usage_kwh),0) as kwh FROM energy_readings WHERE organisation_id = ${org.id} AND period_start >= ${fromDate}`),
      db.query.goalsTable.findMany({ where: eq(goalsTable.organisationId, org.id) }),
    ]);

    const fr = (fleetResult as any).rows?.[0] || (fleetResult as any)[0] || {};
    const er = (energyResult as any).rows?.[0] || (energyResult as any)[0] || {};

    const fleetCo2e = parseFloat(fr.co2e) || 0;
    const energyCo2e = parseFloat(er.co2e) || 0;
    const fleetDist = parseFloat(fr.dist) || 0;
    const goalsOnTrack = goals.filter((g) => g.status === "on_track").length;

    const score = calcSustainabilityScore({
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetDistanceKm: fleetDist,
      goalsOnTrack,
      totalGoals: goals.length,
    });

    res.json({
      organisationName: org.name,
      period,
      config,
      totalCo2eKg: fleetCo2e + energyCo2e,
      fleetCo2eKg: fleetCo2e,
      energyCo2eKg: energyCo2e,
      totalEnergyKwh: parseFloat(er.kwh) || 0,
      fleetDistanceKm: fleetDist,
      sustainabilityScore: score,
      activeVehicles: parseInt(fr.vehicles) || 0,
      goals: goals
        .filter((g) => g.isPublic)
        .map((g) => ({ title: g.title, progressPercent: 0, status: g.status })),
      lastUpdated: now.toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get widget data" });
  }
});

export default router;
