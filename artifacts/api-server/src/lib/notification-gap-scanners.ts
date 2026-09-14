// Nightly gap detector — finds data that *should* exist but doesn't and emits
// warn-severity notifications via the foundation `notify()`. See replit.md.

import { randomUUID } from "node:crypto";
import { eq, or, sql, like } from "drizzle-orm";
import {
  db,
  notificationEventsTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Two-stage dedupe contract.
 *
 * Scanners output `baseKey` (NOT the final `dedupeKey` used by `notify()`).
 * The `runGapDetectorOnce` orchestrator passes each `baseKey` through
 * `resolveDedupeKey()` which resolves the actual key written to the
 * notification event:
 *   - First fire ever         → uses `baseKey` as-is.
 *   - Same gap still active   → returns null (suppress, dedupe will collapse).
 *   - Re-fire after dismissal → bumps to `${baseKey}:v2`, then `:v3`, etc.
 *
 * This split exists because gap-detector notifications need a "user
 * dismissed it but the underlying gap reappeared" lifecycle that pure
 * UNIQUE-key dedupe cannot express. Keeping the two stages explicit in the
 * type system means a future caller cannot accidentally pass a `baseKey`
 * directly into `notify()` and bypass the version bump.
 */
export interface GapDescriptor {
  orgId: string;
  category: "missing_bill" | "stale_telematics" | "overdue_report";
  baseKey: string;
  title: string;
  body: string;
  linkUrl?: string;
  context?: Record<string, unknown>;
}

const STALE_TELEMATICS_DAYS = 7;
const OVERDUE_REPORT_GRACE_DAYS = 14;
const TRAILING_MONTHS = 12;

function appBase(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}/app`;
  return "http://localhost:5173";
}

// quarterEnd is still used by the result-formatting step in
// scanOverdueReports to compute the human-readable grace deadline that
// appears in the notification body. The set-based SQL itself does all
// quarter math in Postgres.
function quarterEnd(year: number, q: 1 | 2 | 3 | 4): Date {
  const endMonth = q * 3; // 3,6,9,12
  return new Date(Date.UTC(year, endMonth, 0, 23, 59, 59)); // last day of month
}

/**
 * Scan for utility-account / month combinations with zero readings in the
 * trailing 12 months. Treats each (utilityType, provider) seen in the
 * trailing window as an active "account" — there's no separate
 * utility_accounts table in v1.
 */
export async function scanMissingBills(orgId: string, now: Date): Promise<GapDescriptor[]> {
  // Calendar-month horizon: the start-of-month TRAILING_MONTHS calendar months
  // before the current month. Using a 30-day approximation here would let real
  // bills near the boundary slip outside the window (false positives) or pull
  // accounts that only have data in the boundary month into the wrong scan
  // (false negatives). Both query and the expected-month enumerator below
  // must share the same calendar-month boundary.
  const horizon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - TRAILING_MONTHS, 1));
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Single set-based query — cross-join every (utility_type, provider) account
  // active in the trailing window with the generated month series, then anti-
  // join against the actual bills. Postgres returns one row per missing
  // (account, month) pair — exactly the granularity we emit notifications at.
  // No N+1 fanout per account.
  const result = await db.execute(sql`
    WITH accounts AS (
      SELECT DISTINCT
        utility_type AS utility_type,
        COALESCE(provider, '') AS provider
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        AND period_start >= ${horizon}
        AND period_start < ${cutoff}
    ),
    months AS (
      SELECT generate_series(${horizon}::timestamp, ${cutoff}::timestamp - INTERVAL '1 month', INTERVAL '1 month') AS month_start
    ),
    expected AS (
      SELECT a.utility_type, a.provider, m.month_start
      FROM accounts a CROSS JOIN months m
    )
    SELECT
      e.utility_type AS utility_type,
      e.provider AS provider,
      TO_CHAR(e.month_start, 'YYYY-MM') AS month
    FROM expected e
    LEFT JOIN energy_readings r
      ON r.organisation_id = ${orgId}
      AND r.utility_type = e.utility_type
      AND COALESCE(r.provider, '') = e.provider
      AND DATE_TRUNC('month', r.period_start) = e.month_start
    WHERE r.id IS NULL
    ORDER BY e.utility_type, e.provider, e.month_start
  `);
  const rows = (result.rows ?? result) as Array<{ utility_type: string; provider: string; month: string }>;
  const out: GapDescriptor[] = [];
  for (const row of rows) {
    const providerLabel = row.provider || "(no provider on file)";
    out.push({
      orgId,
      category: "missing_bill",
      // Per-(account, month) dedupe so each gap-month is its own bell row.
      // A back-fill of one month never hides other still-missing months for
      // the same account, and re-broken months re-fire via :v{N} bumps.
      baseKey: `missing_bill:${orgId}:${row.utility_type}:${row.provider}:${row.month}`,
      title: `Missing ${row.utility_type} bill for ${providerLabel} — ${row.month}`,
      body: `No ${row.utility_type} reading was uploaded for ${providerLabel} covering ${row.month}.`,
      linkUrl: `${appBase()}/energy`,
      context: { utilityType: row.utility_type, provider: row.provider, month: row.month },
    });
  }
  return out;
}

/**
 * Scan for active vehicles whose telematics provider should be sending events
 * but haven't in the trailing 7 days. One notification per stale vehicle so
 * the dedupe identity is stable per-gap — when one vehicle starts reporting
 * again, that vehicle's event is the only one that resolves; the still-stale
 * neighbours' undismissed bell rows are unaffected.
 */
export async function scanStaleTelematics(orgId: string, now: Date): Promise<GapDescriptor[]> {
  const cutoff = new Date(now.getTime() - STALE_TELEMATICS_DAYS * 86400_000);
  const result = await db.execute(sql`
    SELECT v.id AS id, v.name AS name, v.registration AS registration,
           MAX(fe.recorded_at) AS last_event
    FROM vehicles v
    LEFT JOIN fleet_events fe ON fe.vehicle_id = v.id
    WHERE v.organisation_id = ${orgId}
      AND v.is_active = true
      AND v.gps_provider IS NOT NULL
      AND v.gps_provider <> 'none'
    GROUP BY v.id, v.name, v.registration
    HAVING MAX(fe.recorded_at) IS NULL OR MAX(fe.recorded_at) < ${cutoff}
  `);
  const rows = (result.rows ?? result) as Array<{ id: string; name: string; registration: string | null; last_event: Date | string | null }>;
  return rows.map((r) => {
    const label = r.registration ? `${r.name} (${r.registration})` : r.name;
    const lastSeen = r.last_event
      ? `last event ${new Date(r.last_event).toISOString().slice(0, 10)}`
      : "no events on record";
    return {
      orgId,
      category: "stale_telematics" as const,
      // Stable per-vehicle dedupe — this gap's identity is the vehicle, not
      // the set of currently-stale vehicles. A re-broken vehicle re-fires
      // via :v{N} bumps after the prior bell row was dismissed.
      baseKey: `stale_telematics:${orgId}:${r.id}`,
      title: `Vehicle ${label} hasn't reported in over ${STALE_TELEMATICS_DAYS} days`,
      body: `${label}: ${lastSeen}.`,
      linkUrl: `${appBase()}/fleet`,
      context: { vehicleId: r.id, staleSinceDays: STALE_TELEMATICS_DAYS },
    };
  });
}

/**
 * Set-based overdue-report scanner. ONE SQL roundtrip per org regardless of
 * how far back the org has missed reports — explicitly avoids the per-
 * quarter N+1 anti-pattern.
 *
 * Boundaries (intrinsic to the data, no arbitrary fixed-quarter cap):
 *
 *   (a) Upper bound: the previous completed quarter that has cleared its
 *       14-day grace window.
 *
 *   (b) Lower bound: GREATEST of
 *         (i) the org's `created_at` quarter — the org cannot be overdue
 *             for periods that ended before they existed in the system.
 *         (ii) (latest ready-report `period_end` truncated to quarter) +
 *              one quarter — once we hit a quarter the org HAS reported
 *              on, older quarters are irrelevant ("they were keeping up
 *              before they fell behind"). This was the original walking
 *              loop's "stop at first covered quarter" boundary,
 *              expressed as a SQL window.
 *
 * The query then anti-joins a `generate_series` of quarter starts against
 * the `reports` table filtered to `status = 'ready'` (filter is critical:
 * `'generating'` and `'failed'` reports never produced a deliverable
 * board pack, so they must NOT suppress the overdue notification).
 */
export async function scanOverdueReports(orgId: string, now: Date): Promise<GapDescriptor[]> {
  const result = await db.execute(sql`
    WITH org AS (
      SELECT date_trunc('quarter', created_at)::timestamptz AS created_q
      FROM organisations
      WHERE id = ${orgId}
    ),
    latest_covered AS (
      SELECT date_trunc('quarter', MAX(period_end))::timestamptz AS latest_q
      FROM reports
      WHERE organisation_id = ${orgId}
        AND status = 'ready'
    ),
    bounds AS (
      SELECT
        GREATEST(
          (SELECT created_q FROM org),
          COALESCE(
            (SELECT latest_q FROM latest_covered) + interval '3 months',
            (SELECT created_q FROM org)
          )
        ) AS lower_q,
        date_trunc('quarter', ${now}::timestamptz - interval '3 months') AS upper_q
    ),
    quarter_series AS (
      SELECT generate_series(
        (SELECT lower_q FROM bounds),
        (SELECT upper_q FROM bounds),
        interval '3 months'
      )::timestamptz AS q_start
    )
    SELECT
      EXTRACT(YEAR FROM qs.q_start)::int AS year,
      (((EXTRACT(MONTH FROM qs.q_start)::int - 1) / 3) + 1)::int AS quarter
    FROM quarter_series qs
    WHERE
      -- Past the 14-day grace window (qEnd + 14d <= now)
      qs.q_start + interval '3 months' + interval '14 days' <= ${now}::timestamptz
      -- Belt-and-suspenders: even though the lower-bound CTE already
      -- excludes covered quarters, anti-join here as defence-in-depth
      -- against partial-coverage edge cases (sparse reports). Filter to
      -- status='ready' only — 'generating' and 'failed' reports must not
      -- suppress the overdue notification.
      AND NOT EXISTS (
        SELECT 1 FROM reports r
        WHERE r.organisation_id = ${orgId}
          AND r.status = 'ready'
          AND r.period_start <= qs.q_start + interval '3 months' - interval '1 microsecond'
          AND r.period_end >= qs.q_start
      )
    ORDER BY qs.q_start DESC
  `);
  const rows = (result.rows ?? result) as Array<{ year: number; quarter: number }>;
  return rows.map((r) => {
    const year = Number(r.year);
    const quarter = Number(r.quarter) as 1 | 2 | 3 | 4;
    const qEnd = quarterEnd(year, quarter);
    const graceDeadline = new Date(qEnd.getTime() + OVERDUE_REPORT_GRACE_DAYS * 86400_000);
    const label = `Q${quarter} ${year}`;
    return {
      orgId,
      category: "overdue_report" as const,
      baseKey: `overdue_report:${orgId}:${year}-Q${quarter}`,
      title: `${label} board pack is overdue`,
      body: `No report has been generated covering ${label}. The grace window ended ${graceDeadline.toISOString().slice(0, 10)}.`,
      linkUrl: `${appBase()}/reports`,
      context: { year, quarter },
    };
  });
}

/**
 * Resolves a stable base dedupe key into the actual key to pass to notify().
 *
 *   - No prior event with this base key → return base key (first fire).
 *   - Prior event exists; recipients still have one or more rows that aren't
 *     dismissed → return null (suppress; gap is already in someone's inbox).
 *   - Prior event exists; ALL recipient rows are dismissed → bump version
 *     suffix `:v{N}` so a new event is created and the gap re-fires.
 *   - Prior event exists with zero recipient rows (org had no admins at the
 *     time) → return null to avoid an infinite re-fire loop on orphan orgs.
 */
export async function resolveDedupeKey(baseKey: string): Promise<string | null> {
  const events = await db
    .select({ id: notificationEventsTable.id, dedupeKey: notificationEventsTable.dedupeKey })
    .from(notificationEventsTable)
    .where(or(
      eq(notificationEventsTable.dedupeKey, baseKey),
      like(notificationEventsTable.dedupeKey, `${baseKey}:v%`),
    ));
  if (events.length === 0) return baseKey;

  const versionOf = (k: string): number => {
    const m = k.match(/:v(\d+)$/);
    return m ? Number(m[1]) : 1;
  };
  const sorted = [...events].sort((a, b) => versionOf(b.dedupeKey) - versionOf(a.dedupeKey));
  const latest = sorted[0];
  const recipients = await db
    .select({ dismissedAt: notificationsTable.dismissedAt })
    .from(notificationsTable)
    .where(eq(notificationsTable.sourceEventId, latest.id));
  if (recipients.length === 0) return null;
  if (recipients.some((r) => r.dismissedAt === null)) return null;
  const nextVersion = versionOf(latest.dedupeKey) + 1;
  return `${baseKey}:v${nextVersion}`;
}

export interface ScannerSummary {
  orgsScanned: number;
  notificationsCreated: number;
  byCategory: Record<GapDescriptor["category"], number>;
}

export async function runGapScannersForOrg(
  orgId: string,
  now: Date,
): Promise<GapDescriptor[]> {
  const [a, b, c] = await Promise.all([
    scanMissingBills(orgId, now),
    scanStaleTelematics(orgId, now),
    scanOverdueReports(orgId, now),
  ]);
  return [...a, ...b, ...c];
}

/**
 * Walks every active organisation, runs all three scanners, resolves dedupe
 * keys, and (unless dryRun) calls notify() with severity=warn so the daily
 * digest email path takes care of delivery.
 *
 * Per-org failures are logged and skipped — never throws. Returns a summary
 * suitable for the admin endpoint and for ops alerting.
 */
export async function runGapDetectorOnce(opts: {
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<ScannerSummary> {
  const now = opts.now ?? new Date();
  const summary: ScannerSummary = {
    orgsScanned: 0,
    notificationsCreated: 0,
    byCategory: { missing_bill: 0, stale_telematics: 0, overdue_report: 0 },
  };
  // Lazy-import notify to keep the scanner trivially testable in isolation.
  const { notify } = await import("./notifications.js");
  const { organisationsTable } = await import("@workspace/db");
  const orgs = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.isActive, true));

  for (const org of orgs) {
    try {
      const gaps = await runGapScannersForOrg(org.id, now);
      for (const gap of gaps) {
        const dedupeKey = await resolveDedupeKey(gap.baseKey);
        if (dedupeKey === null) continue;
        if (opts.dryRun) {
          summary.notificationsCreated++;
          summary.byCategory[gap.category]++;
          continue;
        }
        const result = await notify({
          organisationId: gap.orgId,
          category: gap.category,
          severity: "warn",
          title: gap.title,
          body: gap.body,
          linkUrl: gap.linkUrl,
          context: gap.context,
          dedupeKey,
        });
        if (result.created) {
          summary.notificationsCreated++;
          summary.byCategory[gap.category]++;
        }
      }
      summary.orgsScanned++;
    } catch (err) {
      logger.error({ err, orgId: org.id }, "Gap detector tick failed for org — continuing");
    }
  }
  logger.info({ summary }, "Gap detector run complete");
  return summary;
}

let gapDetectorHandle: ReturnType<typeof setInterval> | null = null;
let lastDailyRunYmd: string | null = null;

/**
 * Atomically claim the daily-run slot for the given (tz, ymd) using
 * notification_events.dedupe_key UNIQUE as a distributed lock. Returns true
 * iff THIS process won the race (and therefore should run the scanners).
 *
 * This survives restarts: a process that crashes/restarts mid-window still
 * sees the existing marker row and skips the run, even though the in-memory
 * `lastDailyRunYmd` was reset to null.
 *
 * The marker row is intentionally orphan (zero recipients): `resolveDedupeKey`
 * already suppresses orphan-event re-fires, so the marker doesn't pollute any
 * user-facing surface — it's a pure synchronisation token.
 */
async function tryClaimDailyRun(tz: string, ymd: string): Promise<boolean> {
  const dedupeKey = `gap_detector:run:${tz}:${ymd}`;
  const inserted = await db
    .insert(notificationEventsTable)
    .values({
      id: randomUUID(),
      organisationId: "PLATFORM",
      category: "gap_detector_run_marker",
      severity: "info",
      title: "Gap detector daily run marker",
      body: `tz=${tz} ymd=${ymd}`,
      dedupeKey,
    })
    .onConflictDoNothing({ target: notificationEventsTable.dedupeKey })
    .returning({ id: notificationEventsTable.id });
  return inserted.length > 0;
}

/**
 * Compute the local Y-M-D and hour for a given timezone using Intl.
 * Falls back to Pacific/Auckland if the supplied tz is invalid.
 */
function localPartsForTz(tz: string, when: Date): { hour: number; ymd: string } {
  const tryFormat = (timeZone: string) => {
    const fmt = new Intl.DateTimeFormat("en-NZ", {
      timeZone,
      hour: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(when).map((p) => [p.type, p.value]));
    return { hour: Number(parts.hour), ymd: `${parts.year}-${parts.month}-${parts.day}` };
  };
  try {
    return tryFormat(tz);
  } catch {
    return tryFormat("Pacific/Auckland");
  }
}

/**
 * Boots the gap detector. Ticks every `intervalMs` (default 1 hour) and
 * fires the daily run when the configured timezone reports the configured
 * local hour. Defaults to 06:00 Pacific/Auckland. The per-day guard
 * (`lastDailyRunYmd`) ensures exactly one run per local day even if the
 * tick window catches multiple in-hour ticks.
 *
 * Configurable via env: GAP_DETECTOR_HOUR (0-23, default 6),
 * GAP_DETECTOR_TZ (IANA tz, default Pacific/Auckland).
 *
 * @param opts.intervalMs Override the tick interval (default 1 hour =
 *   3,600,000 ms). Primarily exposed for deterministic test harnesses
 *   that need to pump ticks faster than real time without faking timers.
 *   Production should not override this.
 */

function gapDetectorHour(): number {
  const rawHour = Number(process.env.GAP_DETECTOR_HOUR);
  return Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23 ? Math.floor(rawHour) : 6;
}

export async function runGapDetectorTick(hour = gapDetectorHour(), tz = process.env.GAP_DETECTOR_TZ || "Pacific/Auckland"): Promise<void> {
  try {
    const { hour: localHour, ymd } = localPartsForTz(tz, new Date());
    if (localHour !== hour) return;
    // Fast in-memory short-circuit: if we already ran today inside *this*
    // process, skip without hitting the DB.
    if (lastDailyRunYmd === ymd) return;
    // Cross-restart guard: claim the (tz, ymd) slot atomically via the
    // notification_events.dedupe_key UNIQUE constraint. If another process
    // (or a previous incarnation of this one) already claimed it, skip.
    const won = await tryClaimDailyRun(tz, ymd);
    lastDailyRunYmd = ymd; // remember either way to avoid re-querying
    if (!won) {
      logger.info({ tz, ymd }, "Gap detector daily run already claimed by another process — skipping");
      return;
    }
    await runGapDetectorOnce();
  } catch (err) {
    logger.error({ err }, "Gap detector tick failed");
  }
}

export function startGapDetector(opts?: { intervalMs?: number }): void {
  if (gapDetectorHandle) return;
  const rawHour = Number(process.env.GAP_DETECTOR_HOUR);
  const hour = Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23
    ? Math.floor(rawHour)
    : 6;
  const tz = process.env.GAP_DETECTOR_TZ || "Pacific/Auckland";
  const intervalMs = opts?.intervalMs && opts.intervalMs > 0
    ? opts.intervalMs
    : 60 * 60 * 1000;
  const tick = () => runGapDetectorTick(hour, tz);
  // Run an initial tick at boot in case the server starts up inside the
  // configured hour window. The lastDailyRunYmd guard makes this idempotent.
  void tick();
  gapDetectorHandle = setInterval(() => { void tick(); }, intervalMs);
  logger.info({ hour, tz, intervalMs }, "Notification gap detector started (per-day local-time trigger)");
}

export function stopGapDetector(): void {
  if (gapDetectorHandle) {
    clearInterval(gapDetectorHandle);
    gapDetectorHandle = null;
  }
}

/** Test-only: reset the per-day guard between assertions. */
export function __resetGapDetectorState(): void {
  lastDailyRunYmd = null;
}

// Constants exported for tests + admin endpoint shape.
export const GAP_DETECTOR_CONSTANTS = {
  STALE_TELEMATICS_DAYS,
  OVERDUE_REPORT_GRACE_DAYS,
  TRAILING_MONTHS,
};
