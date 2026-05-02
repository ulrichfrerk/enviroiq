// Nightly gap detector — finds data that *should* exist but doesn't and emits
// warn-severity notifications via the foundation `notify()`. See replit.md.

import { and, eq, isNull, or, sql, like } from "drizzle-orm";
import {
  db,
  notificationEventsTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

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

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function quarterOf(d: Date): { year: number; q: 1 | 2 | 3 | 4 } {
  const m = d.getUTCMonth();
  const q = (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4;
  return { year: d.getUTCFullYear(), q };
}

function quarterEnd(year: number, q: 1 | 2 | 3 | 4): Date {
  const endMonth = q * 3; // 3,6,9,12
  return new Date(Date.UTC(year, endMonth, 0, 23, 59, 59)); // last day of month
}

function previousQuarter(year: number, q: 1 | 2 | 3 | 4): { year: number; q: 1 | 2 | 3 | 4 } {
  if (q === 1) return { year: year - 1, q: 4 };
  return { year, q: (q - 1) as 1 | 2 | 3 | 4 };
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
  const accounts = await db.execute(sql`
    SELECT DISTINCT
      utility_type AS utility_type,
      COALESCE(provider, '') AS provider
    FROM energy_readings
    WHERE organisation_id = ${orgId}
      AND period_start >= ${horizon}
  `);
  const rows = (accounts.rows ?? accounts) as Array<{ utility_type: string; provider: string }>;
  const out: GapDescriptor[] = [];
  for (const acc of rows) {
    const bills = await db.execute(sql`
      SELECT TO_CHAR(DATE_TRUNC('month', period_start), 'YYYY-MM') AS month
      FROM energy_readings
      WHERE organisation_id = ${orgId}
        AND utility_type = ${acc.utility_type}
        AND COALESCE(provider, '') = ${acc.provider}
        AND period_start >= ${horizon}
      GROUP BY 1
    `);
    const billRows = (bills.rows ?? bills) as Array<{ month: string }>;
    const present = new Set<string>(billRows.map((r) => r.month));

    const missing: string[] = [];
    const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - TRAILING_MONTHS, 1));
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    while (cur < cutoff) {
      const m = ymd(cur);
      if (!present.has(m)) missing.push(m);
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    if (missing.length === 0) continue;
    const providerLabel = acc.provider || "(no provider on file)";
    out.push({
      orgId,
      category: "missing_bill",
      baseKey: `missing_bill:${orgId}:${acc.utility_type}:${acc.provider}`,
      title: `Missing ${acc.utility_type} bills for ${providerLabel} (${missing.length} month${missing.length === 1 ? "" : "s"})`,
      body: `No bill uploaded for: ${missing.join(", ")}.`,
      linkUrl: `${appBase()}/energy`,
      context: { utilityType: acc.utility_type, provider: acc.provider, missingMonths: missing },
    });
  }
  return out;
}

/**
 * Scan for active vehicles whose telematics provider should be sending events
 * but haven't in the trailing 7 days. Rolls up into a single org-level
 * notification listing the vehicles.
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
  if (rows.length === 0) return [];
  const labels = rows.map((r) => r.registration ? `${r.name} (${r.registration})` : r.name);
  const idsKey = rows.map((r) => r.id).sort().join(",");
  return [{
    orgId,
    category: "stale_telematics",
    baseKey: `stale_telematics:${orgId}:${idsKey}`,
    title: `${rows.length} vehicle${rows.length === 1 ? "" : "s"} haven't reported in over ${STALE_TELEMATICS_DAYS} days`,
    body: labels.join(", "),
    linkUrl: `${appBase()}/fleet`,
    context: { vehicleIds: rows.map((r) => r.id), staleSinceDays: STALE_TELEMATICS_DAYS },
  }];
}

/**
 * For each completed quarter older than (now - 14 days) with no `reports` row,
 * emit one notification. Looks back up to 4 completed quarters.
 */
export async function scanOverdueReports(orgId: string, now: Date): Promise<GapDescriptor[]> {
  const out: GapDescriptor[] = [];
  let cur = previousQuarter(quarterOf(now).year, quarterOf(now).q);
  for (let i = 0; i < 4; i++) {
    const qEnd = quarterEnd(cur.year, cur.q);
    const graceDeadline = new Date(qEnd.getTime() + OVERDUE_REPORT_GRACE_DAYS * 86400_000);
    if (now < graceDeadline) {
      cur = previousQuarter(cur.year, cur.q);
      continue;
    }
    const qStart = new Date(Date.UTC(cur.year, (cur.q - 1) * 3, 1));
    const existing = await db.execute(sql`
      SELECT id FROM reports
      WHERE organisation_id = ${orgId}
        AND period_start <= ${qEnd}
        AND period_end >= ${qStart}
      LIMIT 1
    `);
    const existsRows = (existing.rows ?? existing) as Array<{ id: string }>;
    if (existsRows.length === 0) {
      const label = `Q${cur.q} ${cur.year}`;
      out.push({
        orgId,
        category: "overdue_report",
        baseKey: `overdue_report:${orgId}:${cur.year}-Q${cur.q}`,
        title: `${label} board pack is overdue`,
        body: `No report has been generated covering ${label}. The grace window ended ${graceDeadline.toISOString().slice(0, 10)}.`,
        linkUrl: `${appBase()}/reports`,
        context: { year: cur.year, quarter: cur.q },
      });
    }
    cur = previousQuarter(cur.year, cur.q);
  }
  return out;
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

/** Boots the gap detector. Fires once at boot, then daily. */
export function startGapDetector(intervalMs = 24 * 60 * 60 * 1000): void {
  if (gapDetectorHandle) return;
  void runGapDetectorOnce();
  gapDetectorHandle = setInterval(() => { void runGapDetectorOnce(); }, intervalMs);
  logger.info({ intervalMs }, "Notification gap detector started");
}

export function stopGapDetector(): void {
  if (gapDetectorHandle) {
    clearInterval(gapDetectorHandle);
    gapDetectorHandle = null;
  }
}

// Constants exported for tests + admin endpoint shape.
export const GAP_DETECTOR_CONSTANTS = {
  STALE_TELEMATICS_DAYS,
  OVERDUE_REPORT_GRACE_DAYS,
  TRAILING_MONTHS,
};
