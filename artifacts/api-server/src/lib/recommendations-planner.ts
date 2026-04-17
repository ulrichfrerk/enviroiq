/**
 * Multi-year roll-out planner for ESG recommendations.
 *
 * Takes the flat list of `Recommendation` items produced by GET /recommendations
 * and schedules them across a horizon based on a chosen aggressiveness level,
 * producing a year-by-year capex / savings / CO2e reduction trajectory.
 *
 *   conservative — 7 years, low-capex / quick wins first, big capex deferred.
 *   moderate     — 5 years, sorted by ROI, evenly spread across the horizon.
 *   aggressive   — 3 years, biggest CO2e impact first, packed into the first
 *                  half of the horizon.
 *
 * Each recommendation is "installed" in exactly one year. From the year of
 * install onwards, its annual CO2e saving and annual cost saving accrue every
 * subsequent year. Capex hits only the install year. Cumulative cash savings
 * are summed across years.
 */

export type Aggressiveness = "conservative" | "moderate" | "aggressive";

export interface PlannableRecommendation {
  id: string;
  title: string;
  category: string;
  annualCo2eSavingKg: number;
  annualCostSavingNzd?: number;
  estimatedCapexNzd?: number;
  effort: "low" | "medium" | "high";
}

export interface PlanYearItem {
  id: string;
  title: string;
  category: string;
  capexNzd: number;
  annualCo2eSavingKg: number;
  annualCostSavingNzd: number;
}

export interface PlanYear {
  year: number;
  /** Years from now (0 = current calendar year). */
  yearOffset: number;
  /** Capex spent in this year only. */
  capexNzd: number;
  /** Cumulative capex spent through end of this year. */
  cumulativeCapexNzd: number;
  /** Annual run-rate cost saving achieved by end of this year (all installed-to-date). */
  annualSavingNzdRunRate: number;
  /** Cumulative cash saved through end of this year (sum of run-rates). */
  cumulativeSavingNzd: number;
  /** Annual run-rate CO2e reduction achieved by end of this year. */
  annualCo2eReductionKg: number;
  /** Residual annual CO2e at end of year = baseline − run-rate reduction (clamped at 0). */
  residualCo2eKg: number;
  /** % of baseline footprint cut by end of this year. */
  reductionPctOfBaseline: number;
  /** Items installed in this year. */
  items: PlanYearItem[];
}

export interface RolloutPlan {
  aggressiveness: Aggressiveness;
  horizonYears: number;
  startYear: number;
  baselineCo2eKg: number;
  /** Total capex across all years. */
  totalCapexNzd: number;
  /** Sum of items' annual savings once everything is installed. */
  matureAnnualSavingNzd: number;
  /** Sum of items' annual CO2e savings once everything is installed. */
  matureAnnualCo2eReductionKg: number;
  /** matureAnnualCo2eReductionKg / baseline (capped 100). */
  matureReductionPct: number;
  /** Simple payback = totalCapex / matureAnnualSaving. null if no savings. */
  simplePaybackYears: number | null;
  years: PlanYear[];
  /** Optional alignment to active emission target. */
  targetAlignment?: {
    targetYear: number;
    targetPctReduction: number;
    targetCo2eKg: number;
    /** Plan's residual CO2e in the target year (or last plan year if shorter). */
    planResidualInTargetYearKg: number;
    onTrack: boolean;
    shortfallKg: number;
  };
}

const HORIZON_BY_LEVEL: Record<Aggressiveness, number> = {
  conservative: 7,
  moderate: 5,
  aggressive: 3,
};

function compareForLevel(level: Aggressiveness) {
  return (a: PlannableRecommendation, b: PlannableRecommendation) => {
    if (level === "aggressive") {
      // Biggest CO2e cuts first, capex be damned.
      return b.annualCo2eSavingKg - a.annualCo2eSavingKg;
    }
    if (level === "conservative") {
      // Low / no capex first; ties broken by impact.
      const ca = a.estimatedCapexNzd ?? 0;
      const cb = b.estimatedCapexNzd ?? 0;
      if (ca !== cb) return ca - cb;
      return b.annualCo2eSavingKg - a.annualCo2eSavingKg;
    }
    // moderate — best ROI first ($ saved per $ capex). No-capex measures get
    // a very high ROI by construction so they bubble up first.
    const roi = (r: PlannableRecommendation) => {
      const saving = r.annualCostSavingNzd ?? 0;
      const capex = r.estimatedCapexNzd ?? 0;
      if (capex === 0) return saving > 0 ? Number.POSITIVE_INFINITY : 1; // no-capex but free saving
      return saving / capex;
    };
    return roi(b) - roi(a);
  };
}

function placementYear(
  idx: number,
  total: number,
  horizon: number,
  level: Aggressiveness,
): number {
  if (total <= 0) return 0;
  if (level === "aggressive") {
    // Pack everything into the first half of the horizon.
    const activeYears = Math.max(1, Math.ceil(horizon / 2));
    return Math.min(activeYears - 1, Math.floor((idx * activeYears) / total));
  }
  // moderate + conservative: evenly distribute across the full horizon.
  // Sort order already handles which items land early vs late.
  return Math.min(horizon - 1, Math.floor((idx * horizon) / total));
}

export function buildRolloutPlan(
  recs: PlannableRecommendation[],
  baselineCo2eKg: number,
  level: Aggressiveness,
  target?: { targetYear: number; targetPctReduction: number } | null,
): RolloutPlan {
  const horizon = HORIZON_BY_LEVEL[level];
  const startYear = new Date().getFullYear();

  // Initialise empty years.
  const years: PlanYear[] = Array.from({ length: horizon }, (_, i) => ({
    year: startYear + i,
    yearOffset: i,
    capexNzd: 0,
    cumulativeCapexNzd: 0,
    annualSavingNzdRunRate: 0,
    cumulativeSavingNzd: 0,
    annualCo2eReductionKg: 0,
    residualCo2eKg: baselineCo2eKg,
    reductionPctOfBaseline: 0,
    items: [],
  }));

  const sorted = [...recs].sort(compareForLevel(level));

  // Place each recommendation in its target year and accrue run-rate savings
  // from that year onwards.
  sorted.forEach((r, idx) => {
    const placeIdx = placementYear(idx, sorted.length, horizon, level);
    const capex = r.estimatedCapexNzd ?? 0;
    const saving = r.annualCostSavingNzd ?? 0;
    const co2e = r.annualCo2eSavingKg;

    years[placeIdx].capexNzd += capex;
    years[placeIdx].items.push({
      id: r.id,
      title: r.title,
      category: r.category,
      capexNzd: capex,
      annualCo2eSavingKg: co2e,
      annualCostSavingNzd: saving,
    });

    for (let k = placeIdx; k < horizon; k++) {
      years[k].annualSavingNzdRunRate += saving;
      years[k].annualCo2eReductionKg += co2e;
    }
  });

  // Roll up cumulative figures.
  let cumCapex = 0;
  let cumSaving = 0;
  for (const y of years) {
    cumCapex += y.capexNzd;
    cumSaving += y.annualSavingNzdRunRate;
    y.cumulativeCapexNzd = Math.round(cumCapex);
    y.cumulativeSavingNzd = Math.round(cumSaving);
    y.capexNzd = Math.round(y.capexNzd);
    y.annualSavingNzdRunRate = Math.round(y.annualSavingNzdRunRate);
    y.annualCo2eReductionKg = Math.round(y.annualCo2eReductionKg);
    y.residualCo2eKg = Math.max(0, Math.round(baselineCo2eKg - y.annualCo2eReductionKg));
    y.reductionPctOfBaseline = baselineCo2eKg > 0
      ? Math.round((y.annualCo2eReductionKg / baselineCo2eKg) * 1000) / 10
      : 0;
  }

  const matureSavingNzd = sorted.reduce((a, r) => a + (r.annualCostSavingNzd ?? 0), 0);
  const matureCo2eKg = sorted.reduce((a, r) => a + r.annualCo2eSavingKg, 0);
  const totalCapex = Math.round(cumCapex);

  let targetAlignment: RolloutPlan["targetAlignment"];
  if (target) {
    const targetCo2eKg = Math.round(baselineCo2eKg * (1 - target.targetPctReduction / 100));
    // Find the plan year matching target year; if target is beyond horizon, use last year.
    const targetYearOffset = Math.max(0, target.targetYear - startYear);
    const matchedIdx = Math.min(horizon - 1, targetYearOffset);
    const planResidual = years[matchedIdx]?.residualCo2eKg ?? baselineCo2eKg;
    const onTrack = planResidual <= targetCo2eKg;
    targetAlignment = {
      targetYear: target.targetYear,
      targetPctReduction: target.targetPctReduction,
      targetCo2eKg,
      planResidualInTargetYearKg: planResidual,
      onTrack,
      shortfallKg: Math.max(0, planResidual - targetCo2eKg),
    };
  }

  return {
    aggressiveness: level,
    horizonYears: horizon,
    startYear,
    baselineCo2eKg: Math.round(baselineCo2eKg),
    totalCapexNzd: totalCapex,
    matureAnnualSavingNzd: Math.round(matureSavingNzd),
    matureAnnualCo2eReductionKg: Math.round(matureCo2eKg),
    matureReductionPct: baselineCo2eKg > 0
      ? Math.min(100, Math.round((matureCo2eKg / baselineCo2eKg) * 1000) / 10)
      : 0,
    simplePaybackYears: matureSavingNzd > 0
      ? Math.round((totalCapex / matureSavingNzd) * 10) / 10
      : null,
    years,
    targetAlignment,
  };
}
