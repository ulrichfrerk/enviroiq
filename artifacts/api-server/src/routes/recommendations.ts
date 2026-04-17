import { Router } from "express";
import { db } from "@workspace/db";
import {
  vehiclesTable,
  fleetEventsTable,
  energyReadingsTable,
  emissionTargetsTable,
} from "@workspace/db/schema";
import { eq, and, gte, sum, sql, desc } from "drizzle-orm";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import {
  rankVehicleAlternatives,
  type ScoredCandidate,
  suggestSolarSystemKw,
  RENEWABLE_SUPPLIERS,
  BUILDING_MEASURES,
  OPERATIONAL_MEASURES,
  NZ_GRID_INTENSITY_KG_PER_KWH,
  NZ_RETAIL_KWH_NZD,
} from "../lib/recommendations-catalogue.js";

const router = Router({ mergeParams: true });

export type RecCategory =
  | "fleet"
  | "energy"
  | "solar"
  | "supplier"
  | "building"
  | "operations";

export type RecPriority = "high" | "medium" | "low";

export type RecEffort = "low" | "medium" | "high";

export interface Recommendation {
  id: string;
  category: RecCategory;
  priority: RecPriority;
  scope: "1" | "2" | "3";
  title: string;
  rationale: string;
  action: string;
  annualCo2eSavingKg: number;
  annualCostSavingNzd?: number;
  estimatedCapexNzd?: number;
  paybackYears?: number;
  effort: RecEffort;
  related?: { vehicleId?: string; vehicleName?: string };
  links?: { label: string; href: string }[];
  /**
   * For fleet-swap recommendations: the full ranked candidate list, so the UI
   * can show *why* the top pick beat the runners-up.
   */
  vehicleScoring?: {
    segment: string;
    pick: string;
    candidates: ScoredCandidate[];
  };
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function priorityFromImpact(annualCo2eSavingKg: number, totalKg: number): RecPriority {
  const pct = totalKg > 0 ? (annualCo2eSavingKg / totalKg) * 100 : 0;
  if (pct >= 5 || annualCo2eSavingKg >= 1000) return "high";
  if (pct >= 1 || annualCo2eSavingKg >= 200) return "medium";
  return "low";
}

// ── GET /api/organisations/:orgId/recommendations ─────────────────────────────

router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const since = new Date(Date.now() - ONE_YEAR_MS);

    // 1. Fetch fleet vehicles + per-vehicle 12-month sums
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(and(eq(vehiclesTable.organisationId, orgId), eq(vehiclesTable.isActive, true)));

    const vehicleStats = await db
      .select({
        vehicleId: fleetEventsTable.vehicleId,
        kmYear: sum(fleetEventsTable.distanceKm).mapWith(Number),
        co2eYearKg: sum(fleetEventsTable.co2eKg).mapWith(Number),
        litresYear: sum(fleetEventsTable.fuelLitres).mapWith(Number),
      })
      .from(fleetEventsTable)
      .where(
        and(
          eq(fleetEventsTable.organisationId, orgId),
          gte(fleetEventsTable.recordedAt, since),
        ),
      )
      .groupBy(fleetEventsTable.vehicleId);

    const statsByVehicle = new Map(vehicleStats.map((s) => [s.vehicleId, s]));

    // 2. Fetch energy 12-month aggregates by utility type
    const energyAgg = await db
      .select({
        utilityType: energyReadingsTable.utilityType,
        provider: energyReadingsTable.provider,
        kwhYear: sum(energyReadingsTable.usageKwh).mapWith(Number),
        co2eYearKg: sum(energyReadingsTable.co2eKg).mapWith(Number),
        renewablePct: sql<number>`AVG(COALESCE(${energyReadingsTable.supplierRenewablePct}, 0))`,
      })
      .from(energyReadingsTable)
      .where(
        and(
          eq(energyReadingsTable.organisationId, orgId),
          gte(energyReadingsTable.periodStart, since),
        ),
      )
      .groupBy(energyReadingsTable.utilityType, energyReadingsTable.provider);

    // 3. Fetch active targets (for context / gap)
    const targets = await db
      .select()
      .from(emissionTargetsTable)
      .where(eq(emissionTargetsTable.organisationId, orgId))
      .orderBy(desc(emissionTargetsTable.targetYear));

    const fleetTotalKg = vehicleStats.reduce((a, s) => a + (s.co2eYearKg ?? 0), 0);
    const energyTotalKg = energyAgg.reduce((a, s) => a + (s.co2eYearKg ?? 0), 0);
    const grandTotalKg = fleetTotalKg + energyTotalKg;

    const recommendations: Recommendation[] = [];

    // ── (A) Fleet: ICE → BEV/PHEV swap recommendations ─────────────────────
    for (const v of vehicles) {
      const stats = statsByVehicle.get(v.id);
      const kmYear = stats?.kmYear ?? 0;
      const currentCo2eYear = stats?.co2eYearKg ?? 0;
      const litresYear = stats?.litresYear ?? 0;

      // Skip already-electric or low-utilisation
      if (v.fuelType === "electric") continue;
      if (kmYear < 3000) continue; // Right-sizing handled by operational measures

      // Score every candidate in this segment against the vehicle's actual duty cycle
      const { segment: seg, ranked } = rankVehicleAlternatives({
        make: v.make,
        model: v.model,
        kmYear,
        currentCo2eYearKg: currentCo2eYear,
        currentLitresYear: litresYear,
        currentFuelType: v.fuelType,
      });

      const top = ranked[0];
      if (!top || top.annualCo2eSavingKg <= 100) continue; // Not worth surfacing

      const ageYears = v.year ? new Date().getFullYear() - v.year : null;
      const runnerUp = ranked[1];
      const reasonVsRunnerUp = runnerUp
        ? ` Beat ${runnerUp.name} (${runnerUp.score}/100) by ${top.score - runnerUp.score} points — `
          + (top.breakdown.tco > runnerUp.breakdown.tco
              ? `lower 5-yr TCO ($${(top.fiveYearTcoNzd / 1000).toFixed(0)}k vs $${(runnerUp.fiveYearTcoNzd / 1000).toFixed(0)}k).`
              : top.breakdown.suitability > runnerUp.breakdown.suitability
                ? "better fit for the duty cycle."
                : top.breakdown.emissions > runnerUp.breakdown.emissions
                  ? `bigger CO₂e cut (${top.annualCo2eSavingKg.toLocaleString()} vs ${runnerUp.annualCo2eSavingKg.toLocaleString()} kg/yr).`
                  : "wider NZ availability and warranty.")
        : "";

      recommendations.push({
        id: `fleet-swap-${v.id}`,
        category: "fleet",
        priority: priorityFromImpact(top.annualCo2eSavingKg, grandTotalKg),
        scope: "1",
        title: `Replace ${v.name}${v.registration ? ` (${v.registration})` : ""} with ${top.name}`,
        rationale:
          `${v.make ?? "This"} ${v.model ?? "vehicle"}` +
          (ageYears != null ? `, ${ageYears} years old, ` : ", ") +
          `drives ~${Math.round(kmYear).toLocaleString()} km/yr emitting ${Math.round(currentCo2eYear).toLocaleString()} kg CO₂e. ` +
          `${top.note} Scored ${top.score}/100 against ${ranked.length - 1} alternative${ranked.length - 1 === 1 ? "" : "s"} in the ${seg.segment} segment.${reasonVsRunnerUp}`,
        action: `Replace with a ${top.name} (${seg.segment}, ${top.type}). Eligible for whole-of-life cost analysis via the EECA Heavy Vehicle / Light Fleet decision tools.`,
        annualCo2eSavingKg: top.annualCo2eSavingKg,
        annualCostSavingNzd: top.annualRunningSavingNzd,
        estimatedCapexNzd: top.nzPriceNzd,
        paybackYears:
          top.annualRunningSavingNzd > 0
            ? Math.round((top.nzPriceNzd / top.annualRunningSavingNzd) * 10) / 10
            : undefined,
        effort: "high",
        related: { vehicleId: v.id, vehicleName: v.name },
        vehicleScoring: {
          segment: seg.segment,
          pick: top.name,
          candidates: ranked,
        },
        links: [
          { label: "Compare in Fleet", href: "/fleet" },
          { label: "Model in Scenarios", href: "/scenarios" },
        ],
      });
    }

    // ── (B) Energy: renewable supplier switch ──────────────────────────────
    for (const e of energyAgg) {
      if (e.utilityType !== "electricity") continue;
      const kwh = e.kwhYear ?? 0;
      if (kwh < 5000) continue;

      const renewablePct = e.renewablePct ?? 0;
      if (renewablePct >= 95) continue; // Already on renewable plan

      const annualCo2eSavingKg = Math.round(kwh * NZ_GRID_INTENSITY_KG_PER_KWH * (1 - renewablePct / 100));
      if (annualCo2eSavingKg <= 50) continue;

      const supplier = RENEWABLE_SUPPLIERS[0]; // Lead with Ecotricity

      recommendations.push({
        id: `energy-supplier-${e.provider ?? "default"}`,
        category: "supplier",
        priority: priorityFromImpact(annualCo2eSavingKg, grandTotalKg),
        scope: "2",
        title: `Switch electricity to ${supplier.name} (certified renewable)`,
        rationale:
          `Your current electricity supply (${e.provider ?? "incumbent"}) is ${renewablePct.toFixed(0)}% renewable on the GHG Protocol market-based method. ` +
          `Annual usage is ~${Math.round(kwh).toLocaleString()} kWh, generating ${Math.round(e.co2eYearKg ?? 0).toLocaleString()} kg CO₂e/yr.`,
        action: `Move the contract to ${supplier.name}. ${supplier.note} Certification: ${supplier.certification}.`,
        annualCo2eSavingKg,
        annualCostSavingNzd: 0,
        effort: "low",
        links: [
          { label: "Energy detail", href: "/energy" },
          { label: "Switch via Ecotricity", href: "https://ecotricity.co.nz/business" },
        ],
      });
    }

    // ── (C) Solar PV recommendation ────────────────────────────────────────
    const totalElectricityKwh = energyAgg
      .filter((e) => e.utilityType === "electricity")
      .reduce((a, e) => a + (e.kwhYear ?? 0), 0);

    if (totalElectricityKwh >= 8000) {
      const sizing = suggestSolarSystemKw(totalElectricityKwh);
      recommendations.push({
        id: "solar-pv",
        category: "solar",
        priority: priorityFromImpact(sizing.annualCo2eSavingKg, grandTotalKg),
        scope: "2",
        title: `Install a ${sizing.kw} kW rooftop solar PV system`,
        rationale:
          `Annual electricity load of ~${Math.round(totalElectricityKwh).toLocaleString()} kWh supports a right-sized ${sizing.kw} kW PV system. ` +
          `Expected generation ${sizing.annualGenerationKwh.toLocaleString()} kWh/yr (NZ avg 1,400 kWh/kW), with ~70% self-consumed. ` +
          `Capex ~$${sizing.capexNzd.toLocaleString()} (SEANZ benchmark $1.65/W), saving ~$${sizing.annualSavingNzd.toLocaleString()}/yr — payback ~${sizing.paybackYears} years.`,
        action: `Get three quotes from SEANZ-accredited installers for a ${sizing.kw} kW commercial-grade system. Confirm structural roof load and grid-export approval with your lines company.`,
        annualCo2eSavingKg: sizing.annualCo2eSavingKg,
        annualCostSavingNzd: sizing.annualSavingNzd,
        estimatedCapexNzd: sizing.capexNzd,
        paybackYears: sizing.paybackYears,
        effort: "high",
        links: [
          { label: "SEANZ accredited installers", href: "https://www.seanz.org.nz/find-an-installer" },
          { label: "Energy detail", href: "/energy" },
        ],
      });
    }

    // ── (D) Building efficiency measures ────────────────────────────────────
    if (totalElectricityKwh >= 3000) {
      for (const m of BUILDING_MEASURES) {
        const co2Saved = Math.round(
          totalElectricityKwh * m.electricityReductionPct * NZ_GRID_INTENSITY_KG_PER_KWH,
        );
        const costSaved = Math.round(
          totalElectricityKwh * m.electricityReductionPct * NZ_RETAIL_KWH_NZD,
        );
        if (co2Saved < 30) continue;

        recommendations.push({
          id: `building-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          category: "building",
          priority: priorityFromImpact(co2Saved, grandTotalKg),
          scope: "2",
          title: m.title,
          rationale: `${m.note} Applied to your annual electricity load of ${Math.round(totalElectricityKwh).toLocaleString()} kWh, this would cut ~${(m.electricityReductionPct * 100).toFixed(0)}%.`,
          action: m.action,
          annualCo2eSavingKg: co2Saved,
          annualCostSavingNzd: costSaved,
          paybackYears: m.paybackYears,
          effort: m.effort,
          links: [{ label: "Energy detail", href: "/energy" }],
        });
      }
    }

    // ── (E) Operational measures ────────────────────────────────────────────
    if (fleetTotalKg >= 500) {
      for (const m of OPERATIONAL_MEASURES) {
        const co2Saved = Math.round(fleetTotalKg * m.fleetReductionPct);
        if (co2Saved < 30) continue;
        recommendations.push({
          id: `ops-${m.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          category: "operations",
          priority: priorityFromImpact(co2Saved, grandTotalKg),
          scope: "1",
          title: m.title,
          rationale: `${m.note} Applied to your fleet emissions of ${Math.round(fleetTotalKg).toLocaleString()} kg CO₂e/yr, this would cut ~${(m.fleetReductionPct * 100).toFixed(0)}%.`,
          action: m.action,
          annualCo2eSavingKg: co2Saved,
          paybackYears: m.paybackYears,
          effort: m.effort,
          links: [{ label: "Fleet detail", href: "/fleet" }],
        });
      }
    }

    // ── Sort: priority then biggest impact ──────────────────────────────────
    const priorityRank: Record<RecPriority, number> = { high: 0, medium: 1, low: 2 };
    recommendations.sort((a, b) => {
      const pr = priorityRank[a.priority] - priorityRank[b.priority];
      if (pr !== 0) return pr;
      return b.annualCo2eSavingKg - a.annualCo2eSavingKg;
    });

    // ── Totals ──────────────────────────────────────────────────────────────
    const totalSavingKg = recommendations.reduce((a, r) => a + r.annualCo2eSavingKg, 0);
    const totalSavingNzd = recommendations.reduce(
      (a, r) => a + (r.annualCostSavingNzd ?? 0),
      0,
    );

    // ── Target gap context ───────────────────────────────────────────────────
    const activeTarget = targets[0];
    let targetGap: {
      targetYear: number;
      targetPctReduction: number;
      currentKg: number;
      targetKg: number;
      gapKg: number;
      yearsRemaining: number;
      requiredAnnualReductionKg: number;
      coveredByRecommendationsPct: number;
    } | null = null;
    if (activeTarget) {
      const targetKg = activeTarget.baselineCo2eKg * (1 - activeTarget.targetPctReduction / 100);
      const gapKg = Math.max(0, grandTotalKg - targetKg);
      const yearsRemaining = Math.max(1, activeTarget.targetYear - new Date().getFullYear());
      const requiredAnnualReductionKg = gapKg / yearsRemaining;
      const coveredByRecommendationsPct =
        gapKg > 0 ? Math.min(100, (totalSavingKg / gapKg) * 100) : 100;
      targetGap = {
        targetYear: activeTarget.targetYear,
        targetPctReduction: activeTarget.targetPctReduction,
        currentKg: Math.round(grandTotalKg),
        targetKg: Math.round(targetKg),
        gapKg: Math.round(gapKg),
        yearsRemaining,
        requiredAnnualReductionKg: Math.round(requiredAnnualReductionKg),
        coveredByRecommendationsPct: Math.round(coveredByRecommendationsPct),
      };
    }

    res.json({
      generatedAt: new Date().toISOString(),
      baseline: {
        totalCo2eKg: Math.round(grandTotalKg),
        fleetCo2eKg: Math.round(fleetTotalKg),
        energyCo2eKg: Math.round(energyTotalKg),
      },
      totals: {
        count: recommendations.length,
        annualCo2eSavingKg: Math.round(totalSavingKg),
        annualCostSavingNzd: Math.round(totalSavingNzd),
        reductionPct:
          grandTotalKg > 0 ? Math.round((totalSavingKg / grandTotalKg) * 1000) / 10 : 0,
      },
      targetGap,
      items: recommendations,
    });
  } catch (err) {
    req.log.error({ err }, "List recommendations failed");
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
