// Compute progress against an emission reduction target on a like-for-like
// annual basis. The previous logic compared `summary.totalCo2eKg` (which is
// scoped to the user-selected dashboard period — 7d / 30d / 12m / all) to
// the target's annual baseline, which produced nonsense numbers (e.g. 7
// days of emissions vs a full baseline year reading as "98% reduction
// achieved") and changed depending on which time filter the user happened
// to have clicked.
//
// The correct approach — aligned with SBTi and GHG Protocol reporting — is
// to compare an annualised "current" emissions figure against the baseline
// year. We use a trailing-12-month (TTM) total when we have ≥ 12 months of
// data, and an annualised partial total when we have 3–11 months. With
// less than 3 months we don't trust the extrapolation enough to put a
// percentage on the screen and instead surface a "collecting baseline"
// message.
//
// Coverage is derived from the number of distinct calendar months in the
// trailing-12-month window that actually contain emission records — NOT
// from how long the org has existed. An org that signed up two years ago
// but only logged emissions for the past 4 months should be treated the
// same as a 4-month-old org: estimated, annualised from 4 months. This
// also correctly handles orgs that stop logging (e.g. integration broken)
// — the figure stays an estimate until they have a full 12 months of
// recent coverage again.

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type TargetProgressMode = "collecting" | "estimated" | "actual";

export interface TargetProgress {
  /**
   * - `collecting` — < 3 months of emissions data in the trailing 12 mo; no percentage shown.
   * - `estimated`  — 3–11 months of data; annualised to a full year.
   * - `actual`     — all 12 trailing months have data; exact 12-month figure.
   */
  mode: TargetProgressMode;
  /** Distinct calendar months in the trailing 12 mo with at least one emission record. */
  monthsOfData: number;
  /**
   * Annualised current emissions (kg CO2e) — null when in `collecting` mode.
   * In `actual` mode this is the trailing-12-month sum. In `estimated` mode
   * it's `(sum over N months) * 12 / N`.
   */
  currentAnnualisedKg: number | null;
  /** Reduction achieved as % of the reduction needed; null when collecting. */
  progressPct: number | null;
  /**
   * `true` when the org is on a credible path to hit the target:
   *   - Before the target year: at least 80% of where the linear baseline
   *     → target trajectory says they should be by now.
   *   - On or after the target year: the target is fully met (≥ 100%).
   * Null in collecting mode.
   */
  onTrack: boolean | null;
  /** True once the target year has been reached or passed. Helps UIs label "Missed" vs "Needs attention". */
  overdue: boolean;
  /** Short human-readable label suitable for UI captions. */
  caption: string;
}

interface TargetInput {
  baselineYear: number;
  baselineCo2eKg: number;
  targetYear: number;
  targetPctReduction: number;
}

interface OrgEmissionsContext {
  /** Sum of CO2e (kg) across fleet + energy in the trailing 12 months. */
  trailing12mKg: number;
  /**
   * Distinct calendar months (capped at 12) in the trailing 12 months that
   * have at least one fleet or energy record. This — not org age — drives
   * the collecting/estimated/actual mode decision.
   */
  monthsWithData: number;
}

const MIN_MONTHS_FOR_ESTIMATE = 3;
const FULL_YEAR_MONTHS = 12;

/**
 * Pulls the data needed to derive progress for ALL of an org's targets in a
 * single round-trip. One CTE: union fleet + energy events restricted to the
 * trailing 12 months, then aggregate the sum and distinct month count.
 * Targets share this context, so we compute it once per org and reuse it
 * across every target in the response.
 */
export async function loadOrgEmissionsContext(
  orgId: string,
  now: Date = new Date(),
): Promise<OrgEmissionsContext> {
  const ttmFrom = new Date(now);
  ttmFrom.setFullYear(now.getFullYear() - 1);

  const result = await db.execute<{
    ttm_kg: number | string | null;
    months_with_data: number | string | null;
  }>(sql`
    WITH events AS (
      SELECT recorded_at AS ts, co2e_kg
        FROM fleet_events
       WHERE organisation_id = ${orgId}
         AND recorded_at >= ${ttmFrom} AND recorded_at <= ${now}
      UNION ALL
      SELECT period_start AS ts, co2e_kg
        FROM energy_readings
       WHERE organisation_id = ${orgId}
         AND period_start  >= ${ttmFrom} AND period_end    <= ${now}
    )
    SELECT
      COALESCE(SUM(co2e_kg), 0)                    AS ttm_kg,
      COUNT(DISTINCT date_trunc('month', ts))      AS months_with_data
    FROM events
  `);

  const row = result.rows[0] ?? { ttm_kg: 0, months_with_data: 0 };
  return {
    trailing12mKg: Number(row.ttm_kg ?? 0),
    monthsWithData: Math.min(FULL_YEAR_MONTHS, Number(row.months_with_data ?? 0)),
  };
}

/**
 * Derive a single target's progress from the pre-fetched org context.
 * Pure (no DB calls) so it's trivially testable and cheap to call N times.
 */
export function computeTargetProgress(
  target: TargetInput,
  ctx: OrgEmissionsContext,
  now: Date = new Date(),
): TargetProgress {
  const { baselineYear, baselineCo2eKg, targetYear, targetPctReduction } = target;
  const targetCo2eKg = baselineCo2eKg * (1 - targetPctReduction / 100);
  const reductionNeeded = baselineCo2eKg - targetCo2eKg;
  const overdue = now.getFullYear() >= targetYear;

  // Linear "expected progress so far" along the baseline → target trajectory.
  const yearsElapsed = now.getFullYear() - baselineYear;
  const totalYears = targetYear - baselineYear;
  const expectedProgressPct = totalYears > 0
    ? Math.min(Math.max((yearsElapsed / totalYears) * 100, 0), 100)
    : 0;

  // Mode 1 — not enough data: be honest, don't fabricate a percentage.
  if (ctx.monthsWithData < MIN_MONTHS_FOR_ESTIMATE) {
    return {
      mode: "collecting",
      monthsOfData: ctx.monthsWithData,
      currentAnnualisedKg: null,
      progressPct: null,
      onTrack: null,
      overdue,
      caption: `Collecting baseline — ${ctx.monthsWithData} of 12 months`,
    };
  }

  // Modes 2 & 3 — annualise, then compute progress vs the target trajectory.
  const annualised = ctx.monthsWithData >= FULL_YEAR_MONTHS
    ? ctx.trailing12mKg
    : (ctx.trailing12mKg * FULL_YEAR_MONTHS) / ctx.monthsWithData;

  const reductionAchieved = baselineCo2eKg - annualised;
  const progressPct = reductionNeeded > 0
    ? Math.max(0, Math.min((reductionAchieved / reductionNeeded) * 100, 100))
    : 0;

  // Once the target year has arrived, the only honest "on track" is "fully
  // met" — applying the 80% tolerance to a clamped 100% expectation would
  // call an org at 81% of an overdue target "on track", which is wrong.
  const onTrack = overdue
    ? progressPct >= 100
    : progressPct >= expectedProgressPct * 0.8;

  const mode: TargetProgressMode = ctx.monthsWithData >= FULL_YEAR_MONTHS ? "actual" : "estimated";

  let caption: string;
  if (overdue && progressPct >= 100) {
    caption = `Target met — ${Math.round(progressPct)}% reduction achieved`;
  } else if (overdue) {
    caption = `${Math.round(progressPct)}% reduction achieved — target year ${targetYear} reached`;
  } else if (mode === "actual") {
    caption = `${Math.round(progressPct)}% reduction achieved (last 12 months)`;
  } else {
    caption = `${Math.round(progressPct)}% reduction achieved · estimated from ${ctx.monthsWithData} months`;
  }

  return {
    mode,
    monthsOfData: ctx.monthsWithData,
    currentAnnualisedKg: annualised,
    progressPct,
    onTrack,
    overdue,
    caption,
  };
}
