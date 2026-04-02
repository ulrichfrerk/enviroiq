import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { sqlRow, numCol, intCol } from "../lib/sql-result.js";

const router = Router({ mergeParams: true });

export interface MaturityDimension {
  id: string;
  label: string;
  score: number;      // 0–max
  max: number;
  description: string;
  tips: string[];
}

export interface MaturityResult {
  total: number;       // 0–100
  grade: string;       // "Starter" | "Developing" | "Advanced" | "Leader"
  dimensions: MaturityDimension[];
  computedAt: string;
}

/**
 * GET /organisations/:orgId/maturity
 * Returns a maturity score breakdown for the organisation.
 *
 * Dimensions (total = 100):
 *   Data Foundation    40 pts — has fleet + energy data, recency
 *   Coverage           30 pts — % of last 12 months with data
 *   Quality            20 pts — emission factor completeness
 *   Governance          10 pts — targets + scenarios set up
 */
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const now = new Date();
    const ago90  = new Date(now.getTime() - 90  * 86400000);
    const ago365 = new Date(now.getTime() - 365 * 86400000);

    // ── 1. Data Foundation (max 40) ──────────────────────────────────────────
    // Fleet presence (10) + recency (10) + energy presence (10) + recency (10)
    const fleetPresence = await db.execute(sql`
      SELECT COUNT(*) AS vehicle_count,
             (SELECT COUNT(*) FROM fleet_events WHERE organisation_id = ${orgId}) AS event_count,
             (SELECT COUNT(*) FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${ago90}) AS recent_events
      FROM vehicles WHERE organisation_id = ${orgId}
    `);
    const fp = sqlRow(fleetPresence);
    const vehicleCount  = intCol(fp, "vehicle_count");
    const fleetEventCount = intCol(fp, "event_count");
    const recentFleetEvents = intCol(fp, "recent_events");

    const energyPresence = await db.execute(sql`
      SELECT COUNT(*) AS reading_count,
             (SELECT COUNT(*) FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${ago90}) AS recent_readings
      FROM energy_readings WHERE organisation_id = ${orgId}
    `);
    const ep = sqlRow(energyPresence);
    const energyReadingCount = intCol(ep, "reading_count");
    const recentEnergyReadings = intCol(ep, "recent_readings");

    // Score each sub-component
    const hasFleet    = vehicleCount > 0     ? 5  : 0;
    const fleetActive = recentFleetEvents > 0 ? 10 : fleetEventCount > 0 ? 5 : 0;
    const hasEnergy   = energyReadingCount > 0 ? 5 : 0;
    const energyActive = recentEnergyReadings > 0 ? 10 : energyReadingCount > 0 ? 5 : 0;
    const bothSources = (vehicleCount > 0 && energyReadingCount > 0) ? 10 : 0;
    const foundationScore = Math.min(40, hasFleet + fleetActive + hasEnergy + energyActive + bothSources);

    // ── 2. Coverage (max 30) — how many of last 12 months have data ──────────
    const fleetCoverage = await db.execute(sql`
      SELECT COUNT(DISTINCT DATE_TRUNC('month', recorded_at)) AS months
      FROM fleet_events
      WHERE organisation_id = ${orgId} AND recorded_at >= ${ago365}
    `);
    const energyCoverage = await db.execute(sql`
      SELECT COUNT(DISTINCT DATE_TRUNC('month', period_start)) AS months
      FROM energy_readings
      WHERE organisation_id = ${orgId} AND period_start >= ${ago365}
    `);
    const fleetMonths  = intCol(sqlRow(fleetCoverage), "months");
    const energyMonths = intCol(sqlRow(energyCoverage), "months");
    const fleetCoverageScore  = Math.round((Math.min(fleetMonths, 12)  / 12) * 15);
    const energyCoverageScore = Math.round((Math.min(energyMonths, 12) / 12) * 15);
    const coverageScore = fleetCoverageScore + energyCoverageScore;

    // ── 3. Quality (max 20) — emission factor completeness ───────────────────
    const fleetQuality = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE emission_factor_kg_per_km IS NOT NULL) AS with_factor,
        COUNT(*) AS total
      FROM vehicles WHERE organisation_id = ${orgId}
    `);
    const fq = sqlRow(fleetQuality);
    const vehiclesWithFactor = intCol(fq, "with_factor");
    const totalVehicles      = intCol(fq, "total");
    const fleetQualityScore  = totalVehicles > 0 ? Math.round((vehiclesWithFactor / totalVehicles) * 10) : 0;

    const energyQuality = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE grid_intensity_kg_co2_per_kwh IS NOT NULL) AS with_intensity,
        COUNT(*) AS total
      FROM energy_readings WHERE organisation_id = ${orgId} AND utility_type = 'electricity'
    `);
    const eq2 = sqlRow(energyQuality);
    const readingsWithIntensity = intCol(eq2, "with_intensity");
    const totalElecReadings     = intCol(eq2, "total");
    const energyQualityScore    = totalElecReadings > 0 ? Math.round((readingsWithIntensity / totalElecReadings) * 10) : 0;
    const qualityScore = fleetQualityScore + energyQualityScore;

    // ── 4. Governance (max 10) — targets + scenarios ─────────────────────────
    const governance = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM emission_targets WHERE organisation_id = ${orgId}) AS targets,
        (SELECT COUNT(*) FROM scenarios WHERE organisation_id = ${orgId}) AS scenarios
    `);
    const gov = sqlRow(governance);
    const hasTargets   = intCol(gov, "targets") > 0   ? 5 : 0;
    const hasScenarios = intCol(gov, "scenarios") > 0 ? 5 : 0;
    const governanceScore = hasTargets + hasScenarios;

    // ── Total ─────────────────────────────────────────────────────────────────
    const total = foundationScore + coverageScore + qualityScore + governanceScore;

    const grade =
      total >= 80 ? "Leader" :
      total >= 55 ? "Advanced" :
      total >= 30 ? "Developing" :
                    "Starter";

    // ── Dimension detail ─────────────────────────────────────────────────────
    const dimensions: MaturityDimension[] = [
      {
        id: "foundation",
        label: "Data Foundation",
        score: foundationScore,
        max: 40,
        description: "Do you have both fleet and energy data, and is it being updated regularly?",
        tips: [
          ...(vehicleCount === 0 ? ["Add at least one fleet vehicle to start tracking Scope 1 emissions."] : []),
          ...(recentFleetEvents === 0 && vehicleCount > 0 ? ["No fleet activity in the last 90 days — connect a GPS data source or import trips."] : []),
          ...(energyReadingCount === 0 ? ["Upload at least one energy bill to capture Scope 2 emissions."] : []),
          ...(recentEnergyReadings === 0 && energyReadingCount > 0 ? ["Energy data is stale — forward recent utility bills to your inbound email."] : []),
          ...(vehicleCount > 0 && energyReadingCount === 0 ? ["Capturing both fleet and energy sources earns a 10-point bonus."] : []),
        ].slice(0, 3),
      },
      {
        id: "coverage",
        label: "Coverage",
        score: coverageScore,
        max: 30,
        description: "What percentage of the last 12 months has complete data for fleet and energy?",
        tips: [
          ...(fleetMonths < 6 ? [`Fleet data covers ${fleetMonths}/12 months — import historical trip data to improve coverage.`] : []),
          ...(energyMonths < 6 ? [`Energy data covers ${energyMonths}/12 months — upload older bills or connect auto-forwarding.`] : []),
          ...(fleetMonths >= 12 && energyMonths >= 12 ? ["Full 12-month coverage achieved — excellent for GHG inventory reporting."] : []),
        ].slice(0, 2),
      },
      {
        id: "quality",
        label: "Data Quality",
        score: qualityScore,
        max: 20,
        description: "Are emission factors complete and sourced from real-time grid intensity data?",
        tips: [
          ...(vehiclesWithFactor < totalVehicles ? [`${totalVehicles - vehiclesWithFactor} vehicle(s) missing emission factors — update vehicle class to fix.`] : []),
          ...(readingsWithIntensity < totalElecReadings ? [`${totalElecReadings - readingsWithIntensity} electricity reading(s) using estimated factors — upload bills with exact period dates for live em6 factors.`] : []),
          ...(fleetQualityScore === 10 && energyQualityScore === 10 ? ["All emission factors are sourced from real data — high quality GHG inventory."] : []),
        ].slice(0, 2),
      },
      {
        id: "governance",
        label: "Governance",
        score: governanceScore,
        max: 10,
        description: "Have you set emission reduction targets and modelled decarbonisation pathways?",
        tips: [
          ...(hasTargets === 0 ? ["Set a Science-Based Target or net zero goal to unlock full governance points."] : []),
          ...(hasScenarios === 0 ? ["Model at least one decarbonisation scenario (e.g. EV fleet transition) to demonstrate planning maturity."] : []),
          ...(hasTargets > 0 && hasScenarios > 0 ? ["Targets + scenario models in place — this satisfies most ESG tender governance requirements."] : []),
        ].slice(0, 2),
      },
    ];

    const result: MaturityResult = {
      total,
      grade,
      dimensions,
      computedAt: now.toISOString(),
    };

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Maturity score calculation failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
