/**
 * Tests for the nightly gap detector. One test per scanner proves:
 *   (a) the right gaps are detected from a known DB shape
 *   (b) gaps that have since been filled don't re-fire
 *   (c) emitted notifications go through the foundation `notify()` (covered
 *       by the runGapDetectorOnce orchestration test)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../notifications.js", () => ({
  notify: vi.fn(async () => ({ created: true, eventId: "evt-x", recipientCount: 1, emailsSent: 0 })),
}));

interface ReadingRow { organisationId: string; utilityType: string; provider: string | null; periodStart: Date }
interface VehicleRow { id: string; organisationId: string; isActive: boolean; gpsProvider: string | null; name: string; registration: string | null }
interface FleetEventRow { vehicleId: string; recordedAt: Date }
interface ReportRow { organisationId: string; periodStart: Date; periodEnd: Date; status: string }
interface OrgRow { id: string; isActive: boolean; createdAt?: Date }
interface EventRow { id: string; dedupeKey: string }
interface NotificationRow { sourceEventId: string; dismissedAt: Date | null }

const dbState: {
  readings: ReadingRow[];
  vehicles: VehicleRow[];
  fleetEvents: FleetEventRow[];
  reports: ReportRow[];
  orgs: OrgRow[];
  events: EventRow[];
  notifications: NotificationRow[];
  claimedRunMarkers: Set<string>;
} = {
  readings: [],
  vehicles: [],
  fleetEvents: [],
  reports: [],
  orgs: [],
  events: [],
  notifications: [],
  claimedRunMarkers: new Set<string>(),
};

// Tests pass a frozen `now` to the scanners; the SQL mock needs to know that
// same value so its synthesized "missing months" align with the scanner's
// expected window. Tests set this in beforeEach when they freeze a date.
let scannerWindowEnd: Date | null = null;

function reset() {
  dbState.readings = [];
  dbState.vehicles = [];
  dbState.fleetEvents = [];
  dbState.reports = [];
  dbState.orgs = [];
  dbState.events = [];
  dbState.notifications = [];
  dbState.claimedRunMarkers = new Set<string>();
  scannerWindowEnd = null;
}

// Minimal SQL "interpreter" — recognises the specific shape of each query the
// scanner module emits. Each branch matches on a unique substring that's
// stable across drizzle versions because the queries are hand-written sql``
// templates in the scanner file.
vi.mock("@workspace/db", () => {
  const tableSym = (name: string) => ({ _tag: "table", name });
  return {
    db: {
      execute: vi.fn(async (q: { strings?: string[]; queryChunks?: Array<{ value?: unknown[] }>; sql?: string }) => {
        // Drizzle's sql`` produces an SQL chunk object. Depending on the driver
        // the joined SQL fragment lives at different keys; flatten any plausible
        // location into a single inspection string.
        const flatten = (x: unknown): string => {
          if (typeof x === "string") return x;
          if (typeof x === "number" || typeof x === "boolean") return String(x);
          if (x instanceof Date) return x.toISOString();
          if (Array.isArray(x)) return x.map(flatten).join(" ");
          if (x && typeof x === "object") return Object.values(x).map(flatten).join(" ");
          return "";
        };
        const text = flatten(q);
        if (text.includes("generate_series") && text.includes("WHERE r.id IS NULL")) {
          // The new set-based scanMissingBills query. Find the orgId from
          // the where clause params, then synthesize one row per missing
          // (account, month) pair within the calendar window starting at
          // (now - 12 months).
          const orgIdMatch = text.match(/(org-[A-Za-z0-9_-]+)/);
          const orgId = orgIdMatch?.[1];
          if (!orgId) return { rows: [] };
          const orgReadings = dbState.readings.filter((r) => r.organisationId === orgId);
          // Mirror the scanner's window: horizon = first day of (now - 12
          // months), cutoff = first day of current month. An account is
          // "active in the trailing window" only if it has at least one
          // reading with horizon <= period_start < cutoff. Readings in the
          // current month don't yet count as a backlog signal.
          const winEnd = scannerWindowEnd ?? new Date();
          const horizon = new Date(Date.UTC(winEnd.getUTCFullYear(), winEnd.getUTCMonth() - 12, 1));
          const cutoff = new Date(Date.UTC(winEnd.getUTCFullYear(), winEnd.getUTCMonth(), 1));
          const accounts = new Map<string, { utility_type: string; provider: string }>();
          for (const r of orgReadings) {
            if (r.periodStart < horizon || r.periodStart >= cutoff) continue;
            const provider = r.provider ?? "";
            accounts.set(`${r.utilityType}|${provider}`, { utility_type: r.utilityType, provider });
          }
          // Build expected month set covering the trailing 12 calendar months.
          const expectedMonths: string[] = [];
          const cur = new Date(horizon);
          while (cur < cutoff) {
            expectedMonths.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}`);
            cur.setUTCMonth(cur.getUTCMonth() + 1);
          }
          const out: Array<{ utility_type: string; provider: string; month: string }> = [];
          for (const acc of accounts.values()) {
            const present = new Set<string>();
            for (const r of orgReadings) {
              if (r.utilityType !== acc.utility_type) continue;
              if ((r.provider ?? "") !== acc.provider) continue;
              present.add(`${r.periodStart.getUTCFullYear()}-${String(r.periodStart.getUTCMonth() + 1).padStart(2, "0")}`);
            }
            for (const m of expectedMonths) {
              if (!present.has(m)) out.push({ utility_type: acc.utility_type, provider: acc.provider, month: m });
            }
          }
          return { rows: out };
        }
        if (text.includes("FROM vehicles v")) {
          const cutoff = new Date(Date.now() - 7 * 86400_000);
          const out: Array<{ id: string; name: string; registration: string | null; last_event: Date | null }> = [];
          for (const v of dbState.vehicles) {
            if (!v.isActive) continue;
            if (!v.gpsProvider || v.gpsProvider === "none") continue;
            const events = dbState.fleetEvents.filter((e) => e.vehicleId === v.id);
            const last = events.length > 0
              ? events.map((e) => e.recordedAt).sort((a, b) => b.getTime() - a.getTime())[0]
              : null;
            if (last === null || last < cutoff) {
              out.push({ id: v.id, name: v.name, registration: v.registration, last_event: last });
            }
          }
          return { rows: out };
        }
        if (text.includes("FROM quarter_series qs") && text.includes("generate_series")) {
          // The new set-based scanOverdueReports query. Reproduce the CTE
          // semantics in JS:
          //   - lower_q = max(org.created_at_quarter,
          //                   latest_ready_report_period_end_quarter + 1Q)
          //              (or just created_at_quarter if no ready reports)
          //   - upper_q = quarter_start(now - 3 months)
          //   - emit each quarter in [lower_q, upper_q] step 3 months that:
          //       * is past the 14-day grace deadline AND
          //       * is NOT covered by any status='ready' report
          //   - one row per missing quarter, ordered DESC.
          const orgIdMatch = text.match(/(org-[A-Za-z0-9_-]+)/);
          const orgId = orgIdMatch?.[1];
          if (!orgId) return { rows: [] };
          // The flattened SQL contains the `now` Date param emitted twice
          // (once for upper_q, once for the grace WHERE clause). Pick any
          // ISO timestamp from the flattened text as `now`.
          const isoMatches = Array.from(text.matchAll(/(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}/g));
          if (isoMatches.length === 0) return { rows: [] };
          const now = new Date(`${isoMatches[0][0]}Z`);

          const org = dbState.orgs.find((o) => o.id === orgId);
          const createdAt = org?.createdAt ?? new Date(Date.UTC(2000, 0, 1));
          const truncQuarter = (d: Date): Date => {
            const m = d.getUTCMonth();
            const qStartMonth = m - (m % 3);
            return new Date(Date.UTC(d.getUTCFullYear(), qStartMonth, 1));
          };
          const addQuarters = (d: Date, n: number): Date => {
            return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * n, 1));
          };

          const orgReports = dbState.reports.filter((r) => r.organisationId === orgId);
          const readyReports = orgReports.filter((r) => r.status === "ready");
          const createdQ = truncQuarter(createdAt);
          const latestQ = readyReports.length > 0
            ? truncQuarter(new Date(Math.max(...readyReports.map((r) => r.periodEnd.getTime()))))
            : null;
          const lowerQ = latestQ
            ? new Date(Math.max(createdQ.getTime(), addQuarters(latestQ, 1).getTime()))
            : createdQ;
          const upperQ = truncQuarter(new Date(now.getTime() - 90 * 86400_000)); // approx now - 3 months → quarter

          const out: Array<{ year: number; quarter: number }> = [];
          let qs = new Date(lowerQ);
          while (qs.getTime() <= upperQ.getTime()) {
            const qEnd = addQuarters(qs, 1);
            // Past 14-day grace window?
            const graceDeadline = new Date(qEnd.getTime() + 14 * 86400_000);
            if (graceDeadline.getTime() <= now.getTime()) {
              // Anti-join: any ready report overlapping this quarter?
              const covered = readyReports.some(
                (r) => r.periodStart.getTime() <= qEnd.getTime() - 1
                       && r.periodEnd.getTime() >= qs.getTime(),
              );
              if (!covered) {
                const year = qs.getUTCFullYear();
                const quarter = Math.floor(qs.getUTCMonth() / 3) + 1;
                out.push({ year, quarter });
              }
            }
            qs = addQuarters(qs, 1);
          }
          // Emulate ORDER BY q_start DESC.
          out.reverse();
          return { rows: out };
        }
        return { rows: [] };
      }),
      insert: vi.fn((tbl: { name?: string }) => ({
        values: vi.fn((row: { dedupeKey?: string; category?: string; id?: string }) => ({
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (tbl?.name !== "notification_events") return [];
              const key = row.dedupeKey ?? "";
              if (dbState.claimedRunMarkers.has(key)) return [];
              dbState.claimedRunMarkers.add(key);
              return [{ id: row.id ?? "evt-marker" }];
            }),
          })),
        })),
      })),
      select: vi.fn((cols?: Record<string, unknown>) => ({
        from: vi.fn((tbl: { _tag?: string; name?: string }) => ({
          where: vi.fn(async (whereClause: unknown) => {
            const wText = JSON.stringify(whereClause ?? "");
            if (tbl?.name === "organisations") {
              return dbState.orgs.filter((o) => o.isActive).map((o) => ({ id: o.id }));
            }
            if (tbl?.name === "notification_events") {
              const key = (cols && Object.keys(cols).includes("dedupeKey")) ? "dedupeKey" : null;
              if (!key) return [];
              // resolveDedupeKey calls `or(eq(dedupeKey, baseKey), like(dedupeKey, baseKey:v%))`.
              // Extract the base key from the where clause's params and match
              // both the exact base key and any `:vN` suffix variant.
              const baseMatch = wText.match(/"([^"]*missing_bill[^"]*?|[^"]*stale_telematics[^"]*?|[^"]*overdue_report[^"]*?)"/);
              const matches: { id: string; dedupeKey: string }[] = [];
              for (const e of dbState.events) {
                if (wText.includes(e.dedupeKey)) {
                  matches.push(e);
                } else if (baseMatch && (e.dedupeKey === baseMatch[1] || e.dedupeKey.startsWith(`${baseMatch[1]}:v`))) {
                  matches.push(e);
                }
              }
              return matches;
            }
            if (tbl?.name === "notifications") {
              const matches: { dismissedAt: Date | null }[] = [];
              for (const n of dbState.notifications) {
                if (wText.includes(n.sourceEventId)) matches.push({ dismissedAt: n.dismissedAt });
              }
              return matches;
            }
            return [];
          }),
        })),
      })),
    },
    notificationEventsTable: { ...tableSym("notification_events"), id: { name: "id" }, dedupeKey: { name: "dedupeKey" } },
    notificationsTable: { ...tableSym("notifications"), sourceEventId: { name: "sourceEventId" }, dismissedAt: { name: "dismissedAt" } },
    organisationsTable: { ...tableSym("organisations"), id: { name: "id" }, isActive: { name: "isActive" } },
  };
});

import { scanMissingBills, scanStaleTelematics, scanOverdueReports, runGapDetectorOnce, resolveDedupeKey, startGapDetector, stopGapDetector, __resetGapDetectorState } from "../notification-gap-scanners.js";
import * as notificationsLib from "../notifications.js";

const notifyMock = notificationsLib.notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  reset();
  notifyMock.mockClear();
});

describe("scanMissingBills", () => {
  it("emits one notification per (account, month) gap, with month in the dedupe key", async () => {
    const now = new Date(Date.UTC(2026, 4, 15)); // 2026-05-15 → window 2025-05..2026-04
    scannerWindowEnd = now;
    // One account for electricity/Contact Energy with bills for every month
    // EXCEPT 2026-03. Expect exactly one gap row.
    const months = ["2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-04"];
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      dbState.readings.push({ organisationId: "org-1", utilityType: "electricity", provider: "Contact Energy", periodStart: new Date(Date.UTC(y, mo - 1, 5)) });
    }
    const gaps = await scanMissingBills("org-1", now);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe("missing_bill");
    // Required by spec: dedupe key includes the month.
    expect(gaps[0].baseKey).toBe("missing_bill:org-1:electricity:Contact Energy:2026-03");
    expect(gaps[0].title).toContain("2026-03");
  });

  it("emits multiple per-(account, month) rows when multiple months are missing", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    // Bills for every month except 2026-02 AND 2026-03.
    const months = ["2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-04"];
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(y, mo - 1, 5)) });
    }
    const gaps = await scanMissingBills("org-1", now);
    const keys = gaps.map((g) => g.baseKey).sort();
    expect(keys).toEqual([
      "missing_bill:org-1:gas:Genesis:2026-02",
      "missing_bill:org-1:gas:Genesis:2026-03",
    ]);
  });

  it("stops emitting a month once that month is back-filled (without affecting other still-missing months)", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    const months = ["2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-04"];
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(y, mo - 1, 5)) });
    }
    // Initially missing 2026-02 and 2026-03.
    expect((await scanMissingBills("org-1", now)).map((g) => g.baseKey).sort()).toEqual([
      "missing_bill:org-1:gas:Genesis:2026-02",
      "missing_bill:org-1:gas:Genesis:2026-03",
    ]);
    // Back-fill just 2026-02.
    dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 1, 5)) });
    const gaps2 = await scanMissingBills("org-1", now);
    expect(gaps2.map((g) => g.baseKey)).toEqual(["missing_bill:org-1:gas:Genesis:2026-03"]);
  });

  it("does NOT flag a brand-new account whose first reading is in the current month (no false 12-month backlog)", async () => {
    // Window is 2025-05..2026-04 inclusive (now = 2026-05-15).
    // A new account first seen in 2026-05 (the current month) is NOT yet
    // 'active' for the trailing-12 window — the prior code regression was
    // that such an account synthesized 12 bogus missing_bill alerts.
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    dbState.readings.push({
      organisationId: "org-1",
      utilityType: "electricity",
      provider: "Mercury",
      periodStart: new Date(Date.UTC(2026, 4, 3)), // 2026-05-03 — current month
    });
    const gaps = await scanMissingBills("org-1", now);
    // The Mercury account must produce ZERO gaps (it isn't an "active in
    // trailing window" account). A separate (gas, Contact) account, fully
    // covered, also stays silent.
    expect(gaps).toEqual([]);
  });
});

describe("scanStaleTelematics", () => {
  it("emits one notification per stale vehicle (per-vehicle dedupe key, stable across set churn)", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    dbState.vehicles.push(
      { id: "v-1", organisationId: "org-1", isActive: true, gpsProvider: "navman", name: "Truck A", registration: "ABC123" },
      { id: "v-2", organisationId: "org-1", isActive: true, gpsProvider: "blackhawk", name: "Truck B", registration: "DEF456" },
      { id: "v-3", organisationId: "org-1", isActive: true, gpsProvider: "none", name: "Manual Van", registration: null },
    );
    // v-1 last reported 30d ago, v-2 30d ago — both stale. v-3 is excluded
    // because gpsProvider='none'.
    dbState.fleetEvents.push(
      { vehicleId: "v-1", recordedAt: new Date(now - 30 * 86400_000) },
      { vehicleId: "v-2", recordedAt: new Date(now - 30 * 86400_000) },
    );
    const gaps = await scanStaleTelematics("org-1", new Date(now));
    const keys = gaps.map((g) => g.baseKey).sort();
    expect(keys).toEqual(["stale_telematics:org-1:v-1", "stale_telematics:org-1:v-2"]);
    // Verify Manual Van was excluded.
    expect(gaps.some((g) => g.body.includes("Manual Van"))).toBe(false);

    // Now v-1 reports — its row drops out, but v-2's dedupe key MUST be stable
    // (i.e. it must NOT be affected by v-1 leaving the set).
    dbState.fleetEvents.push({ vehicleId: "v-1", recordedAt: new Date(now - 1 * 86400_000) });
    const gaps2 = await scanStaleTelematics("org-1", new Date(now));
    expect(gaps2.map((g) => g.baseKey)).toEqual(["stale_telematics:org-1:v-2"]);
    vi.useRealTimers();
  });
});

describe("scanOverdueReports", () => {
  it("flags overdue completed quarters, then stops the specific quarter once a ready report covers it", async () => {
    // 2026-05-15 → previous completed quarter is Q1 2026 (Jan-Mar). Grace
    // window of +14 days ends 2026-04-14; we're past that, so Q1 is overdue.
    // Q4 2025 and Q3 2025 are also overdue.
    const now = new Date(Date.UTC(2026, 4, 15));
    const gaps = await scanOverdueReports("org-1", now);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const q1Gap = gaps.find((g) => g.baseKey === "overdue_report:org-1:2026-Q1");
    expect(q1Gap).toBeDefined();
    expect(q1Gap?.title).toContain("Q1 2026");
    // Now publish a READY report covering Q1 2026.
    dbState.reports.push({
      organisationId: "org-1",
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 2, 31)),
      status: "ready",
    });
    const gaps2 = await scanOverdueReports("org-1", now);
    // Q1 must no longer appear, but earlier overdue quarters (Q4 2025, etc.)
    // are still uncovered and should still surface.
    expect(gaps2.find((g) => g.baseKey === "overdue_report:org-1:2026-Q1")).toBeUndefined();
  });

  it("walks ALL missing quarters back to the org's created_at — no fixed quarter cap", async () => {
    // 2026-05-15 → walking backwards. Org was created in 2020, so we expect
    // every completed overdue quarter from 2020-Q1 through 2026-Q1 to fire.
    // That's >20 quarters, comfortably proving the scanner has no hidden
    // 4- or 8-quarter cap.
    const now = new Date(Date.UTC(2026, 4, 15));
    dbState.orgs.push({
      id: "org-deep",
      isActive: true,
      createdAt: new Date(Date.UTC(2020, 0, 1)),
    });
    const gaps = await scanOverdueReports("org-deep", now);
    // 6 years × 4 quarters = 24, minus ~1 for a recent quarter still inside
    // the 14-day grace window. Allow a wide bound here — the point is to
    // prove we go MUCH further than 8.
    expect(gaps.length).toBeGreaterThan(20);
    // Spot-check oldest, mid, and recent quarters all surfaced.
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-deep:2020-Q1")).toBeDefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-deep:2023-Q2")).toBeDefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-deep:2026-Q1")).toBeDefined();
  });

  it("issues exactly ONE database roundtrip regardless of backlog depth (set-based, no N+1)", async () => {
    // Whether the org has missed 1 quarter or 25 quarters, the scanner must
    // execute the same fixed number of SQL roundtrips. This locks in the
    // set-based architectural requirement and prevents future regressions
    // back into the per-quarter loop pattern.
    const now = new Date(Date.UTC(2026, 4, 15));
    dbState.orgs.push({
      id: "org-deep-2",
      isActive: true,
      createdAt: new Date(Date.UTC(2020, 0, 1)),
    });
    // Reset the spy so prior tests don't pollute the count.
    const dbModule = await import("@workspace/db");
    const executeSpy = dbModule.db.execute as unknown as ReturnType<typeof vi.fn>;
    executeSpy.mockClear();
    const gaps = await scanOverdueReports("org-deep-2", now);
    expect(gaps.length).toBeGreaterThan(20);
    // The whole scanner must be ONE SQL execute(), not one per quarter.
    expect(executeSpy.mock.calls.length).toBe(1);
  });

  it("STOPS at the org's created_at quarter — never flags quarters that ended before the org existed", async () => {
    // Org was created mid-2025-Q2 (2025-05-10). The org IS liable for Q2
    // 2025 because the quarter ended (2025-06-30) AFTER they existed —
    // they had ~6 weeks plus the 14-day grace to produce a report. But
    // they are NOT liable for Q1 2025 (ended 2025-03-31, before the org
    // existed) or any earlier quarter.
    const now = new Date(Date.UTC(2026, 4, 15));
    dbState.orgs.push({
      id: "org-young",
      isActive: true,
      createdAt: new Date(Date.UTC(2025, 4, 10)),
    });
    const gaps = await scanOverdueReports("org-young", now);
    // Q2 2025 onward: liable.
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-young:2025-Q2")).toBeDefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-young:2025-Q3")).toBeDefined();
    // Q1 2025 and earlier: ended before org existed — must NOT fire.
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-young:2025-Q1")).toBeUndefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-young:2024-Q4")).toBeUndefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-young:2024-Q1")).toBeUndefined();
  });

  it("STOPS walking older quarters as soon as one is covered by a ready report", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    // Q4 2025 is covered. Q1 2026 is missing. The scanner should emit Q1 2026
    // and then stop — older quarters (Q3 2025, Q2 2025, ...) must NOT appear
    // even though they have no covering report.
    dbState.reports.push({
      organisationId: "org-stops",
      periodStart: new Date(Date.UTC(2025, 9, 1)),
      periodEnd: new Date(Date.UTC(2025, 11, 31)),
      status: "ready",
    });
    const gaps = await scanOverdueReports("org-stops", now);
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-stops:2026-Q1")).toBeDefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-stops:2025-Q3")).toBeUndefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-stops:2025-Q2")).toBeUndefined();
  });

  it("does NOT count status='generating' or status='failed' reports as covering a quarter", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    // A 'generating' report covering Q1 2026 — board pack hasn't actually
    // been produced, so the overdue notification must still fire.
    dbState.reports.push({
      organisationId: "org-2",
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 2, 31)),
      status: "generating",
    });
    // A 'failed' report covering Q4 2025 — same reasoning.
    dbState.reports.push({
      organisationId: "org-2",
      periodStart: new Date(Date.UTC(2025, 9, 1)),
      periodEnd: new Date(Date.UTC(2025, 11, 31)),
      status: "failed",
    });
    const gaps = await scanOverdueReports("org-2", now);
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-2:2026-Q1")).toBeDefined();
    expect(gaps.find((g) => g.baseKey === "overdue_report:org-2:2025-Q4")).toBeDefined();
  });
});

describe("runGapDetectorOnce", () => {
  it("walks active orgs, calls notify() with severity=warn for each gap, and skips inactive orgs", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    dbState.orgs.push({ id: "org-1", isActive: true }, { id: "org-2", isActive: false });
    dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 0, 5)) });
    await runGapDetectorOnce({ now });
    expect(notifyMock).toHaveBeenCalled();
    for (const call of notifyMock.mock.calls) {
      expect(call[0].organisationId).toBe("org-1");
      expect(call[0].severity).toBe("warn");
    }
  });

  it("dryRun=true never calls notify()", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    dbState.orgs.push({ id: "org-1", isActive: true });
    dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 0, 5)) });
    const summary = await runGapDetectorOnce({ now, dryRun: true });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(summary.orgsScanned).toBe(1);
    expect(summary.notificationsCreated).toBeGreaterThan(0);
  });

  it("isolates per-org failures so one bad org does not block the rest", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    scannerWindowEnd = now;
    dbState.orgs.push(
      { id: "org-bad", isActive: true },
      { id: "org-good", isActive: true },
    );
    dbState.readings.push({ organisationId: "org-good", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 0, 5)) });
    // Make scanMissingBills throw for org-bad by spying on db.execute to fail
    // when it sees org-bad in the next call.
    const dbModule = await import("@workspace/db");
    const exec = dbModule.db.execute as unknown as ReturnType<typeof vi.fn>;
    const original = exec.getMockImplementation();
    exec.mockImplementation(async (q: unknown) => {
      const text = JSON.stringify(q);
      if (text.includes("org-bad")) throw new Error("simulated org-bad failure");
      return original ? await original(q) : { rows: [] };
    });
    const summary = await runGapDetectorOnce({ now });
    // Even though org-bad threw, the loop continued and notify() still got
    // called for org-good — proving per-org try/catch isolation.
    expect(notifyMock).toHaveBeenCalled();
    for (const call of notifyMock.mock.calls) {
      expect(call[0].organisationId).toBe("org-good");
    }
    expect(summary.notificationsCreated).toBeGreaterThan(0);
    exec.mockImplementation(original ?? (async () => ({ rows: [] })));
  });
});

describe("resolveDedupeKey", () => {
  const baseKey = "missing_bill:org-1:electricity:Contact Energy";

  it("returns the base key when no prior event exists (first fire)", async () => {
    expect(await resolveDedupeKey(baseKey)).toBe(baseKey);
  });

  it("returns null while at least one recipient row is undismissed (suppress)", async () => {
    dbState.events.push({ id: "evt-1", dedupeKey: baseKey });
    dbState.notifications.push({ sourceEventId: "evt-1", dismissedAt: null });
    expect(await resolveDedupeKey(baseKey)).toBeNull();
  });

  it("bumps :v2 once every recipient row is dismissed", async () => {
    dbState.events.push({ id: "evt-1", dedupeKey: baseKey });
    dbState.notifications.push(
      { sourceEventId: "evt-1", dismissedAt: new Date() },
      { sourceEventId: "evt-1", dismissedAt: new Date() },
    );
    expect(await resolveDedupeKey(baseKey)).toBe(`${baseKey}:v2`);
  });

  it("bumps :v3 after :v2 has also been fully dismissed", async () => {
    dbState.events.push(
      { id: "evt-1", dedupeKey: baseKey },
      { id: "evt-2", dedupeKey: `${baseKey}:v2` },
    );
    dbState.notifications.push(
      { sourceEventId: "evt-1", dismissedAt: new Date() },
      { sourceEventId: "evt-2", dismissedAt: new Date() },
    );
    expect(await resolveDedupeKey(baseKey)).toBe(`${baseKey}:v3`);
  });

  it("returns null for orphan events with zero recipient rows (avoids infinite re-fire)", async () => {
    dbState.events.push({ id: "evt-1", dedupeKey: baseKey });
    // No recipient rows — happens when the org has no active admins at fire time.
    expect(await resolveDedupeKey(baseKey)).toBeNull();
  });
});

describe("startGapDetector (timezone-aware daily trigger)", () => {
  /**
   * Helper: seed dbState so a scanner run on the given window WILL produce
   * exactly one missing_bill gap (and therefore one notify() call). We pick
   * a single (gas, Genesis) reading 11 months back inside the trailing-12
   * window — that establishes the account, and every other month inside the
   * window is missing. The first such missing month produces the notify call
   * we assert on.
   */
  function seedSingleGapWindow(orgId: string, winEnd: Date) {
    dbState.orgs.push({ id: orgId, isActive: true });
    // One reading 11 months back, so account exists but ~11 months are missing.
    const past = new Date(Date.UTC(winEnd.getUTCFullYear(), winEnd.getUTCMonth() - 11, 5));
    dbState.readings.push({ organisationId: orgId, utilityType: "gas", provider: "Genesis", periodStart: past });
    scannerWindowEnd = winEnd;
  }

  beforeEach(() => {
    __resetGapDetectorState();
    stopGapDetector();
    notifyMock.mockClear();
  });

  it("FIRES at the configured local hour, then is idempotent within the same local day", async () => {
    process.env.GAP_DETECTOR_HOUR = "6";
    process.env.GAP_DETECTOR_TZ = "Pacific/Auckland";
    vi.useFakeTimers();
    // 17:30 UTC on 2026-02-14 → 06:30 NZDT 2026-02-15 (NZDT = UTC+13 in Feb).
    vi.setSystemTime(new Date("2026-02-14T17:30:00Z"));
    seedSingleGapWindow("org-tz1", new Date("2026-02-14T17:30:00Z"));
    startGapDetector();
    await vi.runOnlyPendingTimersAsync();
    // PROOF the daily run executed: notify() was called at least once for
    // the seeded missing_bill gaps.
    expect(notifyMock).toHaveBeenCalled();
    const firstCallCount = notifyMock.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Advance one hour — local hour is now 07, so the tick must NOT re-fire.
    vi.setSystemTime(new Date("2026-02-14T18:30:00Z"));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(notifyMock.mock.calls.length).toBe(firstCallCount);

    // Advance back into hour 06 of the SAME local day (impossible in real
    // wall-clock but we simulate by rewinding). The lastDailyRunYmd in-memory
    // guard must still suppress.
    vi.setSystemTime(new Date("2026-02-14T17:45:00Z"));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(notifyMock.mock.calls.length).toBe(firstCallCount);
    stopGapDetector();
    vi.useRealTimers();
    delete process.env.GAP_DETECTOR_HOUR;
    delete process.env.GAP_DETECTOR_TZ;
  });

  it("does not fire when the configured local hour is not the current local hour", async () => {
    process.env.GAP_DETECTOR_HOUR = "6";
    process.env.GAP_DETECTOR_TZ = "Pacific/Auckland";
    vi.useFakeTimers();
    // 12:00 UTC on 2026-02-14 → 01:00 NZDT 2026-02-15 — well outside hour=6.
    vi.setSystemTime(new Date("2026-02-14T12:00:00Z"));
    seedSingleGapWindow("org-tz2", new Date("2026-02-14T12:00:00Z"));
    startGapDetector();
    await vi.runOnlyPendingTimersAsync();
    expect(notifyMock).not.toHaveBeenCalled();
    stopGapDetector();
    vi.useRealTimers();
    delete process.env.GAP_DETECTOR_HOUR;
    delete process.env.GAP_DETECTOR_TZ;
  });

  it("survives process restart inside the trigger window (DB-backed claim prevents same-day double-fire)", async () => {
    process.env.GAP_DETECTOR_HOUR = "6";
    process.env.GAP_DETECTOR_TZ = "Pacific/Auckland";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T17:30:00Z")); // 06:30 NZDT
    seedSingleGapWindow("org-tz3", new Date("2026-02-14T17:30:00Z"));

    // First boot: runs.
    startGapDetector();
    await vi.runOnlyPendingTimersAsync();
    const firstCalls = notifyMock.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    stopGapDetector();

    // Simulate a process restart 10 minutes later — still inside the local
    // hour-6 window. The in-memory `lastDailyRunYmd` is reset, but the DB
    // marker row remains, so the claim must fail and the scanner must NOT
    // run again.
    __resetGapDetectorState();
    notifyMock.mockClear();
    vi.setSystemTime(new Date("2026-02-14T17:40:00Z")); // 06:40 NZDT same day
    startGapDetector();
    await vi.runOnlyPendingTimersAsync();
    expect(notifyMock).not.toHaveBeenCalled();
    stopGapDetector();
    vi.useRealTimers();
    delete process.env.GAP_DETECTOR_HOUR;
    delete process.env.GAP_DETECTOR_TZ;
  });

  it("DST transition (NZDT→NZST 2026-04-05): fires once on the transition day at local hour=6", async () => {
    process.env.GAP_DETECTOR_HOUR = "6";
    process.env.GAP_DETECTOR_TZ = "Pacific/Auckland";
    vi.useFakeTimers();
    // 2026-04-05 03:00 NZST (after DST end) corresponds to 2026-04-04 15:00 UTC.
    // To hit local hour=6 on 2026-04-05 (NZST = UTC+12 post-transition):
    //   06:00 NZST 2026-04-05 = 18:00 UTC 2026-04-04.
    vi.setSystemTime(new Date("2026-04-04T18:30:00Z"));
    seedSingleGapWindow("org-dst", new Date("2026-04-04T18:30:00Z"));
    startGapDetector();
    await vi.runOnlyPendingTimersAsync();
    expect(notifyMock).toHaveBeenCalled();
    const firstCalls = notifyMock.mock.calls.length;
    // Same local day, hour later — must not re-fire.
    vi.setSystemTime(new Date("2026-04-04T19:30:00Z"));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(notifyMock.mock.calls.length).toBe(firstCalls);
    stopGapDetector();
    vi.useRealTimers();
    delete process.env.GAP_DETECTOR_HOUR;
    delete process.env.GAP_DETECTOR_TZ;
  });
});
