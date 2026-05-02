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
interface ReportRow { organisationId: string; periodStart: Date; periodEnd: Date }
interface OrgRow { id: string; isActive: boolean }
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
} = {
  readings: [],
  vehicles: [],
  fleetEvents: [],
  reports: [],
  orgs: [],
  events: [],
  notifications: [],
};

function reset() {
  dbState.readings = [];
  dbState.vehicles = [];
  dbState.fleetEvents = [];
  dbState.reports = [];
  dbState.orgs = [];
  dbState.events = [];
  dbState.notifications = [];
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
          if (Array.isArray(x)) return x.map(flatten).join(" ");
          if (x && typeof x === "object") return Object.values(x).map(flatten).join(" ");
          return "";
        };
        const text = flatten(q);
        if (text.includes("FROM energy_readings") && text.includes("DISTINCT")) {
          // List of (utilityType, provider) accounts active in trailing window.
          const accounts = new Map<string, { utility_type: string; provider: string }>();
          for (const r of dbState.readings) {
            const provider = r.provider ?? "";
            accounts.set(`${r.utilityType}|${provider}`, { utility_type: r.utilityType, provider });
          }
          return { rows: Array.from(accounts.values()) };
        }
        if (text.includes("FROM energy_readings") && text.includes("GROUP BY 1")) {
          // Per-account month list. The scanner runs this query once per
          // account it found above, so just return every distinct YYYY-MM in
          // dbState.readings — the scanner intersects the result with its
          // expected month range so cross-account contamination is harmless.
          const months = new Set<string>();
          for (const r of dbState.readings) {
            const m = `${r.periodStart.getUTCFullYear()}-${String(r.periodStart.getUTCMonth() + 1).padStart(2, "0")}`;
            months.add(m);
          }
          return { rows: Array.from(months).map((month) => ({ month })) };
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
        if (text.includes("FROM reports")) {
          // Scanner asks "is there ANY report covering this quarter?" Return
          // the matching reports for the org if their period range overlaps.
          // Both bound dates are passed as parameters and travel in a separate
          // params slot we don't have visibility into — so we return *all*
          // org reports and let the caller decide. Since the scanner only
          // checks `length === 0`, we return a row whenever any report
          // exists that overlaps the window for the org currently being
          // scanned. We approximate by returning every report row; if a
          // report exists for any quarter in our seed it'll suppress.
          // Tests use distinct org ids per scenario so this is safe.
          const orgIdMatch = text.match(/'(org-[^']+)'/);
          const orgId = orgIdMatch?.[1];
          const reports = orgId
            ? dbState.reports.filter((r) => r.organisationId === orgId)
            : dbState.reports;
          return { rows: reports.map((_, i) => ({ id: `r-${i}` })) };
        }
        return { rows: [] };
      }),
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

import { scanMissingBills, scanStaleTelematics, scanOverdueReports, runGapDetectorOnce, resolveDedupeKey } from "../notification-gap-scanners.js";
import * as notificationsLib from "../notifications.js";

const notifyMock = notificationsLib.notify as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  reset();
  notifyMock.mockClear();
});

describe("scanMissingBills", () => {
  it("flags months in trailing window with zero bills, then stops once they're filled", async () => {
    // Today (frozen to mid-2026) — last 12 months are 2025-05 .. 2026-04.
    const now = new Date(Date.UTC(2026, 4, 15)); // 2026-05-15
    // One account for electricity / Contact Energy with bills for every month
    // EXCEPT 2026-03 (so we expect exactly that month flagged).
    const months = ["2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-04"];
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      dbState.readings.push({ organisationId: "org-1", utilityType: "electricity", provider: "Contact Energy", periodStart: new Date(Date.UTC(y, mo - 1, 5)) });
    }
    const gaps = await scanMissingBills("org-1", now);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].category).toBe("missing_bill");
    expect(gaps[0].baseKey).toBe("missing_bill:org-1:electricity:Contact Energy");
    expect(gaps[0].body).toContain("2026-03");
    // Now fill the gap.
    dbState.readings.push({ organisationId: "org-1", utilityType: "electricity", provider: "Contact Energy", periodStart: new Date(Date.UTC(2026, 2, 5)) });
    const gaps2 = await scanMissingBills("org-1", now);
    expect(gaps2).toHaveLength(0);
  });
});

describe("scanStaleTelematics", () => {
  it("flags vehicles with no events in the trailing 7 days, then stops once an event lands", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    dbState.vehicles.push(
      { id: "v-1", organisationId: "org-1", isActive: true, gpsProvider: "navman", name: "Truck A", registration: "ABC123" },
      { id: "v-2", organisationId: "org-1", isActive: true, gpsProvider: "blackhawk", name: "Truck B", registration: "DEF456" },
      { id: "v-3", organisationId: "org-1", isActive: true, gpsProvider: "none", name: "Manual Van", registration: null },
    );
    // v-2 has a fresh event; v-1 has only an old one.
    dbState.fleetEvents.push(
      { vehicleId: "v-1", recordedAt: new Date(now - 30 * 86400_000) },
      { vehicleId: "v-2", recordedAt: new Date(now - 1 * 86400_000) },
    );
    const gaps = await scanStaleTelematics("org-1", new Date(now));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].title).toContain("1 vehicle");
    expect(gaps[0].body).toContain("Truck A");
    expect(gaps[0].body).not.toContain("Truck B");
    expect(gaps[0].body).not.toContain("Manual Van"); // gpsProvider=none excluded
    // Now v-1 reports.
    dbState.fleetEvents.push({ vehicleId: "v-1", recordedAt: new Date(now - 1 * 86400_000) });
    const gaps2 = await scanStaleTelematics("org-1", new Date(now));
    expect(gaps2).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("scanOverdueReports", () => {
  it("flags overdue completed quarters, then stops once a covering report exists", async () => {
    // 2026-05-15 → previous completed quarter is Q1 2026 (Jan-Mar). Grace
    // window of +14 days ends 2026-04-14; we're past that, so Q1 is overdue.
    // Q4 2025 also overdue. Q3 2025 also.
    const now = new Date(Date.UTC(2026, 4, 15));
    const gaps = await scanOverdueReports("org-1", now);
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const q1Gap = gaps.find((g) => g.baseKey === "overdue_report:org-1:2026-Q1");
    expect(q1Gap).toBeDefined();
    expect(q1Gap?.title).toContain("Q1 2026");
    // Now publish a report covering Q1 2026.
    dbState.reports.push({
      organisationId: "org-1",
      periodStart: new Date(Date.UTC(2026, 0, 1)),
      periodEnd: new Date(Date.UTC(2026, 2, 31)),
    });
    const gaps2 = await scanOverdueReports("org-1", now);
    // After the report is filed, no new overdue notifications should be
    // emitted for any quarter (the test mock returns rows for every report
    // once any exist for the org — fine for confirming "filling fixes it").
    expect(gaps2.length).toBe(0);
  });
});

describe("runGapDetectorOnce", () => {
  it("walks active orgs, calls notify() for each gap, and skips inactive orgs", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    dbState.orgs.push({ id: "org-1", isActive: true }, { id: "org-2", isActive: false });
    // org-1: one missing bill gap.
    dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 0, 5)) });
    await runGapDetectorOnce({ now });
    // At least one notify() call against org-1, none against org-2.
    expect(notifyMock).toHaveBeenCalled();
    for (const call of notifyMock.mock.calls) {
      expect(call[0].organisationId).toBe("org-1");
      expect(call[0].severity).toBe("warn");
    }
  });

  it("dryRun=true never calls notify()", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
    dbState.orgs.push({ id: "org-1", isActive: true });
    dbState.readings.push({ organisationId: "org-1", utilityType: "gas", provider: "Genesis", periodStart: new Date(Date.UTC(2026, 0, 5)) });
    const summary = await runGapDetectorOnce({ now, dryRun: true });
    expect(notifyMock).not.toHaveBeenCalled();
    expect(summary.orgsScanned).toBe(1);
    expect(summary.notificationsCreated).toBeGreaterThan(0);
  });

  it("isolates per-org failures so one bad org does not block the rest", async () => {
    const now = new Date(Date.UTC(2026, 4, 15));
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
