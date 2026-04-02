import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { scenariosTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { sqlRow, numCol } from "../lib/sql-result.js";
import type { ScenarioLevers } from "@workspace/db/schema";

const router = Router({ mergeParams: true });

// ── Scenario modelling engine ──────────────────────────────────────────────────
// Takes current baseline emissions and applies lever reductions to compute
// a projected scenario outcome.

interface ScenarioResult {
  baselineCo2eKg: number;
  baselineFleetKg: number;
  baselineEnergyKg: number;
  projectedCo2eKg: number;
  projectedFleetKg: number;
  projectedEnergyKg: number;
  savedCo2eKg: number;
  savedPct: number;
  leverImpacts: {
    lever: string;
    label: string;
    savedKg: number;
    pct: number;
  }[];
}

function applyLevers(
  fleetKg: number,
  energyKg: number,
  levers: ScenarioLevers,
): ScenarioResult {
  const baselineCo2eKg = fleetKg + energyKg;

  // ── Fleet levers ────────────────────────────────────────────────────────────
  // EV transition: EVs have ~0 Scope 1 emissions. We model NZ grid-charged EVs
  // as ~80% lower than ICE (NZ electricity is ~97g/kWh vs petrol ~250g/km).
  // We apply a 0.8 reduction factor per % of fleet electrified.
  const evReduction       = (levers.evTransitionPct / 100) * 0.80;
  const kmReduction       = levers.fleetKmReductionPct / 100;
  const modalReduction    = levers.modalShiftPct / 100;

  // Combined multiplicative reduction — order doesn't matter for result
  const fleetMultiplier   = (1 - evReduction) * (1 - kmReduction) * (1 - modalReduction);
  const projectedFleetKg  = fleetKg * fleetMultiplier;

  // ── Energy levers ────────────────────────────────────────────────────────────
  // Building efficiency reduces total energy consumed first
  const efficiencyMultiplier = 1 - (levers.buildingEfficiencyPct / 100);
  // Renewable energy reduces electricity emissions (market-based: 100% = 0 CO₂e)
  const renewableMultiplier  = 1 - (levers.renewableEnergyPct / 100);
  const projectedEnergyKg    = energyKg * efficiencyMultiplier * renewableMultiplier;

  // ── Offset lever ─────────────────────────────────────────────────────────────
  const postLeverTotal   = projectedFleetKg + projectedEnergyKg;
  const offsetKg         = postLeverTotal * (levers.offsetPct / 100);
  const finalTotal       = postLeverTotal - offsetKg;

  const savedCo2eKg = baselineCo2eKg - finalTotal;
  const savedPct    = baselineCo2eKg > 0 ? (savedCo2eKg / baselineCo2eKg) * 100 : 0;

  // ── Per-lever attribution (marginal, sequential) ─────────────────────────────
  const leverImpacts = [];

  if (levers.evTransitionPct > 0) {
    const saving = fleetKg * evReduction;
    leverImpacts.push({ lever: "evTransitionPct", label: `EV fleet transition (${levers.evTransitionPct}%)`, savedKg: saving, pct: baselineCo2eKg > 0 ? (saving / baselineCo2eKg) * 100 : 0 });
  }
  if (levers.fleetKmReductionPct > 0) {
    const remaining = fleetKg * (1 - evReduction);
    const saving = remaining * kmReduction;
    leverImpacts.push({ lever: "fleetKmReductionPct", label: `Fleet km reduction (${levers.fleetKmReductionPct}%)`, savedKg: saving, pct: baselineCo2eKg > 0 ? (saving / baselineCo2eKg) * 100 : 0 });
  }
  if (levers.modalShiftPct > 0) {
    const remaining = fleetKg * (1 - evReduction) * (1 - kmReduction);
    const saving = remaining * modalReduction;
    leverImpacts.push({ lever: "modalShiftPct", label: `Modal shift (${levers.modalShiftPct}%)`, savedKg: saving, pct: baselineCo2eKg > 0 ? (saving / baselineCo2eKg) * 100 : 0 });
  }
  if (levers.buildingEfficiencyPct > 0) {
    const saving = energyKg * (1 - renewableMultiplier) + energyKg * renewableMultiplier * (levers.buildingEfficiencyPct / 100);
    const cleanSaving = energyKg * (levers.buildingEfficiencyPct / 100);
    leverImpacts.push({ lever: "buildingEfficiencyPct", label: `Building efficiency (${levers.buildingEfficiencyPct}%)`, savedKg: cleanSaving, pct: baselineCo2eKg > 0 ? (cleanSaving / baselineCo2eKg) * 100 : 0 });
  }
  if (levers.renewableEnergyPct > 0) {
    const afterEfficiency = energyKg * efficiencyMultiplier;
    const saving = afterEfficiency * (levers.renewableEnergyPct / 100);
    leverImpacts.push({ lever: "renewableEnergyPct", label: `Renewable energy (${levers.renewableEnergyPct}%)`, savedKg: saving, pct: baselineCo2eKg > 0 ? (saving / baselineCo2eKg) * 100 : 0 });
  }
  if (levers.offsetPct > 0) {
    leverImpacts.push({ lever: "offsetPct", label: `Carbon offsets (${levers.offsetPct}%)`, savedKg: offsetKg, pct: baselineCo2eKg > 0 ? (offsetKg / baselineCo2eKg) * 100 : 0 });
  }

  return {
    baselineCo2eKg,
    baselineFleetKg: fleetKg,
    baselineEnergyKg: energyKg,
    projectedCo2eKg: finalTotal,
    projectedFleetKg,
    projectedEnergyKg: projectedEnergyKg * (1 - (levers.offsetPct / 100)),
    savedCo2eKg,
    savedPct,
    leverImpacts,
  };
}

// GET /organisations/:orgId/scenarios
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const rows = await db
      .select()
      .from(scenariosTable)
      .where(eq(scenariosTable.organisationId, orgId))
      .orderBy(desc(scenariosTable.updatedAt));

    // Fetch baseline emissions (last 12 months)
    const baseline = await getBaselineEmissions(orgId);

    const itemsWithResults = rows.map(row => ({
      ...row,
      result: applyLevers(baseline.fleetKg, baseline.energyKg, row.levers as ScenarioLevers),
    }));

    res.json({ items: itemsWithResults, baseline, total: rows.length });
  } catch (err) {
    req.log.error({ err }, "List scenarios failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /organisations/:orgId/scenarios/preview
// Live preview — runs the model without saving
router.post("/preview", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { levers } = req.body as { levers: ScenarioLevers };
    if (!levers) { res.status(400).json({ error: "Bad Request", message: "levers required" }); return; }
    const baseline = await getBaselineEmissions(orgId);
    const result = applyLevers(baseline.fleetKg, baseline.energyKg, levers);
    res.json({ baseline, result });
  } catch (err) {
    req.log.error({ err }, "Scenario preview failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /organisations/:orgId/scenarios
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { name, description, levers } = req.body as { name: string; description?: string; levers: ScenarioLevers };
    if (!name || !levers) { res.status(400).json({ error: "Bad Request", message: "name and levers required" }); return; }

    const [row] = await db.insert(scenariosTable).values({
      id: uuidv4(),
      organisationId: orgId,
      name,
      description: description ?? null,
      levers,
    }).returning();

    await logAudit(req, orgId, "scenario.created", { scenarioId: row.id, name });
    const baseline = await getBaselineEmissions(orgId);
    res.status(201).json({ ...row, result: applyLevers(baseline.fleetKg, baseline.energyKg, row.levers as ScenarioLevers) });
  } catch (err) {
    req.log.error({ err }, "Create scenario failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PUT /organisations/:orgId/scenarios/:scenarioId
router.put("/:scenarioId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const scenarioId = req.params.scenarioId as string;
    const { name, description, levers } = req.body as { name?: string; description?: string; levers?: ScenarioLevers };

    const [updated] = await db
      .update(scenariosTable)
      .set({
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(levers && { levers }),
        updatedAt: new Date(),
      })
      .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.organisationId, orgId)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not Found" }); return; }
    await logAudit(req, orgId, "scenario.updated", { scenarioId });
    const baseline = await getBaselineEmissions(orgId);
    res.json({ ...updated, result: applyLevers(baseline.fleetKg, baseline.energyKg, updated.levers as ScenarioLevers) });
  } catch (err) {
    req.log.error({ err }, "Update scenario failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// DELETE /organisations/:orgId/scenarios/:scenarioId
router.delete("/:scenarioId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const scenarioId = req.params.scenarioId as string;
    const [deleted] = await db.delete(scenariosTable)
      .where(and(eq(scenariosTable.id, scenarioId), eq(scenariosTable.organisationId, orgId)))
      .returning({ id: scenariosTable.id });
    if (!deleted) { res.status(404).json({ error: "Not Found" }); return; }
    await logAudit(req, orgId, "scenario.deleted", { scenarioId });
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Delete scenario failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function getBaselineEmissions(orgId: string): Promise<{ fleetKg: number; energyKg: number; totalKg: number }> {
  const ago365 = new Date(Date.now() - 365 * 86400000);
  const result = await db.execute(sql`
    SELECT
      COALESCE((SELECT SUM(co2e_kg) FROM fleet_events  WHERE organisation_id = ${orgId} AND recorded_at  >= ${ago365}), 0) AS fleet_kg,
      COALESCE((SELECT SUM(co2e_kg) FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${ago365}), 0) AS energy_kg
  `);
  const row = sqlRow(result);
  const fleetKg  = numCol(row, "fleet_kg");
  const energyKg = numCol(row, "energy_kg");
  return { fleetKg, energyKg, totalKg: fleetKg + energyKg };
}

export default router;
