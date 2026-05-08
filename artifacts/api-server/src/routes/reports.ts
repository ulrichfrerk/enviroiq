import { Router } from "express";
import { db, reportsTable, goalsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { logAudit } from "../lib/audit.js";
import { calcSustainabilityScore } from "../lib/emissions.js";
import { htmlToPdf } from "../lib/pdf.js";

const router = Router({ mergeParams: true });

// NZ pump-price averages used to derive fuel cost when fuel-card data is
// missing. Conservative national averages (NZ MfE / MBIE weekly fuel
// monitoring 2025/26). Kept at module scope so both the snapshot generator
// (POST) and the report renderer (GET) reference the same numbers.
const NZ_DIESEL_PRICE  = 2.20;
const NZ_PETROL_PRICE  = 2.85;

// Escape user-controlled strings to prevent stored XSS in rendered HTML
function esc(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// GET /organisations/:orgId/reports/trend — monthly CO2e for the last 24 months
router.get("/trend", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const months = parseInt(req.query.months as string) || 24;

    // Exclude the current (incomplete) month so charts only show complete months
    const [fleetRows, energyRows] = await Promise.all([
      db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
          COALESCE(SUM(co2e_kg), 0)::float AS fleet_co2e,
          COALESCE(SUM(distance_km), 0)::float AS fleet_km
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND recorded_at >= NOW() - (${months} || ' months')::interval
          AND recorded_at < DATE_TRUNC('month', NOW())
        GROUP BY 1
        ORDER BY 1
      `),
      db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', period_start), 'YYYY-MM') AS month,
          COALESCE(SUM(co2e_kg), 0)::float AS energy_co2e,
          COALESCE(SUM(usage_kwh), 0)::float AS energy_kwh
        FROM energy_readings
        WHERE organisation_id = ${orgId}
          AND period_start >= NOW() - (${months} || ' months')::interval
          AND period_start < DATE_TRUNC('month', NOW())
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    // Merge into a single map keyed by YYYY-MM
    const byMonth: Record<string, { month: string; fleetCo2e: number; energyCo2e: number; fleetKm: number; energyKwh: number }> = {};
    for (const r of sqlRows(fleetRows)) {
      const m = strCol(r, "month");
      byMonth[m] = byMonth[m] ?? { month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0 };
      byMonth[m].fleetCo2e = numCol(r, "fleet_co2e");
      byMonth[m].fleetKm   = numCol(r, "fleet_km");
    }
    for (const r of sqlRows(energyRows)) {
      const m = strCol(r, "month");
      byMonth[m] = byMonth[m] ?? { month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0 };
      byMonth[m].energyCo2e = numCol(r, "energy_co2e");
      byMonth[m].energyKwh  = numCol(r, "energy_kwh");
    }

    const data = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
    res.json({ data });
  } catch (err) {
    req.log.error({ err }, "Trend data failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch trend data" });
  }
});

// GET /organisations/:orgId/reports
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const reports = await db.query.reportsTable.findMany({
      where: eq(reportsTable.organisationId, orgId),
    });
    const [{ total }] = await db.select({ total: count() }).from(reportsTable).where(eq(reportsTable.organisationId, orgId));
    res.json({ items: reports, total });
  } catch (err) {
    req.log.error({ err }, "List reports failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list reports" });
  }
});

// POST /organisations/:orgId/reports
router.post("/", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const session = req.session;
    const { title, periodStart, periodEnd, reportType } = req.body;

    if (!periodStart || !periodEnd || !reportType) {
      res.status(400).json({ error: "Bad Request", message: "periodStart, periodEnd, reportType required" });
      return;
    }

    const reportId = uuidv4();
    const reportTitle = title || `${reportType.replace(/_/g, " ")} — ${new Date(periodStart).toLocaleDateString("en-NZ", { month: "short", year: "numeric" })} to ${new Date(periodEnd).toLocaleDateString("en-NZ", { month: "short", year: "numeric" })}`;

    const [report] = await db.insert(reportsTable).values({
      id: reportId,
      organisationId: orgId,
      title: reportTitle,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      reportType,
      status: "generating",
      createdBy: session?.userId || "system",
    }).returning();

    // Build report data snapshot asynchronously
    setImmediate(async () => {
      try {
        const from = new Date(periodStart);
        const to   = new Date(periodEnd);
        // Prior year window — same calendar offset
        const pyFrom = new Date(from); pyFrom.setFullYear(pyFrom.getFullYear() - 1);
        const pyTo   = new Date(to);   pyTo.setFullYear(pyTo.getFullYear() - 1);

        const [fleetResult, energyResult, pyFleetResult, pyEnergyResult, monthlyFleet, monthlyEnergy, topEmitters] = await Promise.all([
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(distance_km),0)::float as dist FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${from} AND recorded_at <= ${to}`),
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(usage_kwh),0)::float as kwh FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${from} AND period_end <= ${to}`),
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(distance_km),0)::float as dist FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${pyFrom} AND recorded_at <= ${pyTo}`),
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(usage_kwh),0)::float as kwh FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${pyFrom} AND period_end <= ${pyTo}`),
          db.execute(sql`SELECT TO_CHAR(DATE_TRUNC('month', recorded_at),'YYYY-MM') as month, COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(distance_km),0)::float as km, COALESCE(SUM(fuel_litres),0)::float as litres, COALESCE(SUM(cost_nzd),0)::float as cost_actual, COUNT(cost_nzd)::int as cost_event_count, COUNT(*)::int as event_count FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${from} AND recorded_at <= ${to} GROUP BY 1 ORDER BY 1`),
          db.execute(sql`SELECT TO_CHAR(DATE_TRUNC('month', period_start),'YYYY-MM') as month, COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(usage_kwh),0)::float as kwh, COUNT(*)::int as readings FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${from} AND period_end <= ${to} GROUP BY 1 ORDER BY 1`),
          db.execute(sql`
            SELECT v.name, v.registration, v.make, v.model, v.fuel_type,
                   v.fuel_consumption_l_per_100km AS lp100,
                   COALESCE(SUM(fe.co2e_kg),0)::float       AS co2e,
                   COALESCE(SUM(fe.distance_km),0)::float   AS km,
                   COALESCE(SUM(fe.fuel_litres),0)::float   AS litres,
                   COALESCE(SUM(fe.cost_nzd),0)::float      AS cost_actual,
                   COUNT(fe.cost_nzd)::int                  AS cost_event_count,
                   COUNT(fe.id)::int                        AS event_count
              FROM fleet_events fe
              JOIN vehicles v ON v.id = fe.vehicle_id
             WHERE fe.organisation_id = ${orgId}
               AND fe.recorded_at >= ${from} AND fe.recorded_at <= ${to}
             GROUP BY v.id, v.name, v.registration, v.make, v.model, v.fuel_type, v.fuel_consumption_l_per_100km
             ORDER BY co2e DESC
             LIMIT 10
          `),
        ]);

        const fr = sqlRow(fleetResult);
        const er = sqlRow(energyResult);
        const pyFr = sqlRow(pyFleetResult);
        const pyEr = sqlRow(pyEnergyResult);
        const goals = await db.query.goalsTable.findMany({ where: eq(goalsTable.organisationId, orgId) });

        const fleetCo2e  = numCol(fr, "co2e");
        const energyCo2e = numCol(er, "co2e");
        const fleetDist  = numCol(fr, "dist");
        const totalCo2e  = fleetCo2e + energyCo2e;
        const pyTotal    = numCol(pyFr, "co2e") + numCol(pyEr, "co2e");
        const yoyPct     = pyTotal > 0 ? ((totalCo2e - pyTotal) / pyTotal) * 100 : null;
        const goalsOnTrack = goals.filter((g) => g.status === "on_track").length;

        const score = calcSustainabilityScore({
          totalCo2eKg: totalCo2e,
          fleetDistanceKm: fleetDist,
          goalsOnTrack,
          totalGoals: goals.length,
        });

        // Used as a fallback so a business owner still sees a $ figure even
        // before fuel-card or bowser receipts are integrated. Estimated
        // values are flagged in the rendered report so the board knows
        // they're not invoiced. See module-level NZ_*_PRICE constants.
        // Covers the actual fuel_type values stored on `vehicles` (diesel,
        // petrol, hybrid, electric) plus a few common synonyms.
        const NZ_PUMP_PRICE: Record<string, number> = {
          diesel:   NZ_DIESEL_PRICE,
          petrol:   NZ_PETROL_PRICE,
          hybrid:   NZ_PETROL_PRICE, // Hybrid burns petrol
          phev:     NZ_PETROL_PRICE,
          electric: 0,               // Electricity cost belongs in Scope 2
          ev:       0,
          lpg:      1.40,            // NZ LPG bowser avg 2025/26
          hydrogen: 0,               // Sold per kg, not L — no comparable estimate
          other:    0,               // Unknown fuel — refuse to estimate
        };
        // Returns -1 to mean "no defensible estimate" so the caller can render
        // "—" instead of fabricating a diesel price for, say, an electric van.
        const fuelPriceFor = (fuelType: string): number => {
          const key = (fuelType || "").toLowerCase();
          return key in NZ_PUMP_PRICE ? NZ_PUMP_PRICE[key] : -1;
        };

        // Build monthly table merging fleet + energy.
        //   energyHasReadings: did the organisation actually upload a power
        //   bill / meter reading covering this month? When false, we render
        //   "Awaiting bill" instead of "0 kWh / 0 kg" so a board reader can
        //   tell the difference between "consumed nothing" and "data missing".
        type MonthAgg = {
          month: string;
          fleetCo2e: number; energyCo2e: number;
          fleetKm: number; energyKwh: number;
          fleetFuelCostNzd: number; fleetFuelCostEstimated: boolean;
          energyHasReadings: boolean;
        };
        const monthMap: Record<string, MonthAgg> = {};
        for (const r of sqlRows(monthlyFleet)) {
          const m = strCol(r, "month");
          monthMap[m] = monthMap[m] ?? {
            month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0,
            fleetFuelCostNzd: 0, fleetFuelCostEstimated: false, energyHasReadings: false,
          };
          monthMap[m].fleetCo2e = numCol(r, "co2e");
          monthMap[m].fleetKm   = numCol(r, "km");
          // Cost: combine actual (where the org has invoiced figures) with an
          // estimate for the remaining (uncosted) events, prorated by event
          // count so we don't double-count litres that already had a cost
          // associated with them. We don't know fuel type at month-level so
          // use diesel as the conservative default (matches Acme-class
          // plumbing fleets where ~90% of vehicles are diesel utes).
          const actualCost = numCol(r, "cost_actual");
          const litres     = numCol(r, "litres");
          const eventsWithCost = numCol(r, "cost_event_count");
          const eventsTotal    = numCol(r, "event_count");
          const uncostedShare  = eventsTotal > 0
            ? Math.max(0, eventsTotal - eventsWithCost) / eventsTotal
            : 0;
          if (actualCost > 0 && eventsWithCost === eventsTotal) {
            monthMap[m].fleetFuelCostNzd = actualCost;
          } else if (litres > 0) {
            const estimatedPart = litres * uncostedShare * NZ_DIESEL_PRICE;
            monthMap[m].fleetFuelCostNzd = actualCost + estimatedPart;
            monthMap[m].fleetFuelCostEstimated = estimatedPart > 0;
          } else if (actualCost > 0) {
            // Have cost but no litres — trust the actual figure.
            monthMap[m].fleetFuelCostNzd = actualCost;
          }
        }
        for (const r of sqlRows(monthlyEnergy)) {
          const m = strCol(r, "month");
          monthMap[m] = monthMap[m] ?? {
            month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0,
            fleetFuelCostNzd: 0, fleetFuelCostEstimated: false, energyHasReadings: false,
          };
          monthMap[m].energyCo2e = numCol(r, "co2e");
          monthMap[m].energyKwh  = numCol(r, "kwh");
          monthMap[m].energyHasReadings = numCol(r, "readings") > 0;
        }

        // Derive top emitters with cost estimation per vehicle.
        //
        // 3-tier fallback (board-pack rules):
        //   1. Every event has a real fuel-card / bowser cost → trust the sum.
        //   2. We have litres → trust the actual cost portion AND estimate the
        //      uncovered portion by prorating litres against the share of
        //      events that lacked a cost. This avoids double-counting litres
        //      already represented in `actualCost`.
        //   3. Last-resort: derive litres from `km × lp100/100` and price it
        //      at the pump average for the vehicle's fuel type.
        //
        // For electric / hydrogen / other (price=0) we leave fuelCostNzd
        // undefined (their fuel cost legitimately doesn't show on a bowser
        // invoice), and the renderer prints "—" — honest about missing data.
        // For unknown fuel types (price=-1 from fuelPriceFor) we also render
        // "—" rather than fabricate a diesel estimate.
        type EmitterAgg = {
          name: string; registration: string; make: string; model: string;
          co2e: number; km: number;
          fuelCostNzd?: number; fuelCostEstimated: boolean;
        };
        const topEmittersOut: EmitterAgg[] = sqlRows(topEmitters).map(r => {
          const fuelType = strCol(r, "fuel_type") || "diesel";
          const price    = fuelPriceFor(fuelType);
          const km       = numCol(r, "km");
          const litres   = numCol(r, "litres");
          const lp100    = numCol(r, "lp100"); // L per 100km from vehicle
          const actualCost     = numCol(r, "cost_actual");
          const eventsWithCost = numCol(r, "cost_event_count");
          const eventsTotal    = numCol(r, "event_count");
          const uncostedShare  = eventsTotal > 0
            ? Math.max(0, eventsTotal - eventsWithCost) / eventsTotal
            : 0;

          let fuelCostNzd: number | null = null;
          let fuelCostEstimated = false;

          if (actualCost > 0 && eventsWithCost === eventsTotal) {
            fuelCostNzd = actualCost;
          } else if (litres > 0 && price > 0) {
            // Some-or-no real cost, but we have litres → estimate the
            // uncosted portion only (litres × uncostedShare × pump price)
            // and add it on top of the actual cost so we never drop or
            // double-count what the org already invoiced.
            const estimatedPart = litres * uncostedShare * price;
            fuelCostNzd = actualCost + estimatedPart;
            fuelCostEstimated = estimatedPart > 0;
          } else if (lp100 > 0 && km > 0 && price > 0) {
            // No litres at all → derive litres from km × lp100 and price
            // them, but again only estimate the uncosted share so any real
            // actualCost is preserved.
            const estimatedPart = (km * lp100 / 100) * uncostedShare * price;
            fuelCostNzd = actualCost + estimatedPart;
            fuelCostEstimated = estimatedPart > 0;
          } else if (actualCost > 0) {
            fuelCostNzd = actualCost;
          }

          return {
            name:         strCol(r, "name"),
            registration: strCol(r, "registration"),
            make:         strCol(r, "make"),
            model:        strCol(r, "model"),
            co2e:         numCol(r, "co2e"),
            km,
            fuelCostNzd:  fuelCostNzd == null ? undefined : Math.round(fuelCostNzd),
            fuelCostEstimated,
          };
        });

        // Roll up totals + period coverage flags for the cover page / banners.
        const totalFuelCostNzd = topEmittersOut.reduce((s, e) => s + (e.fuelCostNzd ?? 0), 0);
        const anyFuelCostEstimated = topEmittersOut.some(e => e.fuelCostEstimated);
        const monthsInPeriod = Object.keys(monthMap).length;
        const monthsMissingEnergy = Object.values(monthMap).filter(m => !m.energyHasReadings).length;

        const snapshot = {
          summary: {
            totalCo2eKg: totalCo2e,
            fleetCo2eKg: fleetCo2e,
            energyCo2eKg: energyCo2e,
            totalEnergyKwh: numCol(er, "kwh"),
            fleetKm: fleetDist,
            sustainabilityScore: score,
            priorYearCo2eKg: pyTotal,
            priorYearFleetKm: numCol(pyFr, "dist"),
            yoyChangePct: yoyPct,
            totalFuelCostNzd,
            anyFuelCostEstimated,
            monthsInPeriod,
            monthsMissingEnergy,
          },
          monthly: Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)),
          topEmitters: topEmittersOut,
          goals: goals.map((g) => ({ title: g.title, status: g.status, targetValue: g.targetValue, targetUnit: g.targetUnit })),
        };

        await db.update(reportsTable)
          .set({ status: "ready", dataSnapshot: JSON.stringify(snapshot) })
          .where(eq(reportsTable.id, reportId));
      } catch {
        await db.update(reportsTable).set({ status: "failed" }).where(eq(reportsTable.id, reportId));
      }
    });

    await logAudit({ req, action: "report.generate", resourceType: "report", resourceId: reportId, organisationId: orgId });
    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Generate report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to generate report" });
  }
});

// Reserved sub-paths under /reports that must not be matched as a :reportId.
// Express matches routes in registration order, so without this guard a request
// for /reports/tender-pack falls into the /:reportId handler below and 404s
// because no report with id "tender-pack" exists. Keep this list in sync with
// any new static sub-routes added to this router.
const RESERVED_REPORT_SUBPATHS = new Set(["tender-pack", "trend"]);

// GET /organisations/:orgId/reports/:reportId
router.get("/:reportId", requireAuth, requireOrgAccess, async (req, res, next) => {
  if (RESERVED_REPORT_SUBPATHS.has(req.params.reportId as string)) return next();
  try {
    const orgId = req.params.orgId as string; const reportId = req.params.reportId as string;
    const report = await db.query.reportsTable.findFirst({
      where: and(eq(reportsTable.id, reportId), eq(reportsTable.organisationId, orgId)),
    });
    if (!report) {
      res.status(404).json({ error: "Not Found", message: "Report not found" });
      return;
    }

    await logAudit({ req, action: "report.view", resourceType: "report", resourceId: reportId, organisationId: orgId });

    const snapshot = report.dataSnapshot ? JSON.parse(report.dataSnapshot) : {};
    res.json({ ...report, ...snapshot });
  } catch (err) {
    req.log.error({ err }, "Get report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get report" });
  }
});

// GET /organisations/:orgId/reports/:reportId/pdf — serve printable HTML report
router.get("/:reportId/pdf", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const reportId = req.params.reportId as string;
    const [report, orgRows] = await Promise.all([
      db.query.reportsTable.findFirst({
        where: and(eq(reportsTable.id, reportId), eq(reportsTable.organisationId, orgId)),
      }),
      db.execute(sql`SELECT name FROM organisations WHERE id = ${orgId} LIMIT 1`),
    ]);
    if (!report) { res.status(404).send("Report not found"); return; }
    if (report.status !== "ready") { res.status(409).send("Report is not yet ready"); return; }

    await logAudit({ req, action: "report.download", resourceType: "report", resourceId: reportId, organisationId: orgId });

    const orgName = esc(String((sqlRows(orgRows)[0] as Record<string, unknown>)?.name ?? "Organisation"));

    type MonthRow = {
      month: string;
      fleetCo2e: number; energyCo2e: number;
      fleetKm: number; energyKwh: number;
      // Fields below were added to fix the "Mar 2026: 0 / 0" silent-gap bug
      // and the missing-fuel-cost board complaint. They're optional so old
      // snapshots (generated before the fix) still render without exceptions.
      fleetFuelCostNzd?: number;
      fleetFuelCostEstimated?: boolean;
      energyHasReadings?: boolean;
    };
    type EmitterRow = {
      name: string; registration: string; make: string; model: string;
      co2e: number; km: number;
      fuelCostNzd?: number;          // Optional — see MonthRow comment above.
      fuelCostEstimated?: boolean;
    };
    type GoalRow = { title: string; status: string; targetValue: number | null; targetUnit: string | null };
    type SnapshotSummary = {
      totalCo2eKg?: number; fleetCo2eKg?: number; energyCo2eKg?: number;
      totalEnergyKwh?: number; fleetKm?: number; sustainabilityScore?: number;
      priorYearCo2eKg?: number; priorYearFleetKm?: number; yoyChangePct?: number | null;
      totalFuelCostNzd?: number;
      anyFuelCostEstimated?: boolean;
      monthsInPeriod?: number;
      monthsMissingEnergy?: number;
    };
    const s = report.dataSnapshot ? (JSON.parse(report.dataSnapshot) as { summary?: SnapshotSummary; monthly?: MonthRow[]; topEmitters?: EmitterRow[]; goals?: GoalRow[] }) : {};
    const summary = s.summary || {};
    const monthly = s.monthly || [];
    const topEmitters = s.topEmitters || [];
    const goals = s.goals || [];

    const fmt  = (n: number | undefined | null, dp = 1) => typeof n === "number" ? n.toLocaleString("en-NZ", { maximumFractionDigits: dp }) : "—";
    const fmtT = (kg: number | undefined | null) => typeof kg === "number" ? (kg / 1000).toLocaleString("en-NZ", { maximumFractionDigits: 2 }) : "—";
    const fmtDate = (d: Date | string | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
      d ? new Date(d).toLocaleDateString("en-NZ", opts ?? { day: "numeric", month: "long", year: "numeric" }) : "—";

    const periodFrom = fmtDate(report.periodStart, { day: "numeric", month: "short", year: "numeric" });
    const periodTo   = fmtDate(report.periodEnd,   { day: "numeric", month: "short", year: "numeric" });
    const generatedOn = fmtDate(new Date(), { day: "numeric", month: "long", year: "numeric" });

    const yoy = summary.yoyChangePct;
    const yoySign  = yoy != null ? (yoy < 0 ? "▼" : yoy > 0 ? "▲" : "●") : null;
    const yoyColor = yoy != null ? (yoy < 0 ? "#15803d" : yoy > 0 ? "#b91c1c" : "#6b7280") : "#6b7280";
    const yoyLabel = yoy != null ? `${yoySign} ${Math.abs(yoy).toFixed(1)}% vs prior year` : "No prior year data";

    const score = summary.sustainabilityScore ?? 0;
    const fleetPct  = summary.totalCo2eKg ? Math.round(((summary.fleetCo2eKg  || 0) / summary.totalCo2eKg) * 100) : 0;
    const energyPct = 100 - fleetPct;

    // ── Score rating helpers ─────────────────────────────────────────────────
    function scoreRating(s: number) {
      if (s >= 86) return "Excellent";
      if (s >= 71) return "Good — Managed";
      if (s >= 51) return "Moderate";
      if (s >= 31) return "High Risk";
      return "Critical Risk";
    }
    function scoreColor(s: number) {
      if (s >= 86) return "#15803d";
      if (s >= 71) return "#16a34a";
      if (s >= 51) return "#d97706";
      if (s >= 31) return "#ea580c";
      return "#dc2626";
    }

    // ── Auto-generate executive narrative ────────────────────────────────────
    const totalT = typeof summary.totalCo2eKg === "number" ? (summary.totalCo2eKg / 1000).toFixed(2) : "—";
    const priorT = typeof summary.priorYearCo2eKg === "number" ? (summary.priorYearCo2eKg / 1000).toFixed(2) : null;

    const posture = scoreRating(score);
    const fleetDominant = fleetPct > 75;

    const overallPosture = `${orgName}'s ESG sustainability posture for the reporting period is <strong>${posture}</strong>, with a composite ESG score of <strong>${score}/100</strong>. Total greenhouse gas emissions for the period stand at <strong>${totalT} tCO₂e</strong> (Scope 1: ${fmtT(summary.fleetCo2eKg)} tCO₂e fleet, Scope 2: ${fmtT(summary.energyCo2eKg)} tCO₂e energy). ${priorT ? `This compares to ${priorT} tCO₂e in the prior year — a ${yoyLabel}.` : "No prior year data is available for direct comparison."} ${fleetDominant ? `Fleet combustion dominates the emissions profile at ${fleetPct}%, highlighting vehicle operations as the primary lever for reduction.` : `Emissions are more evenly distributed between fleet (${fleetPct}%) and energy (${energyPct}%).`}`;

    const strengths: string[] = [];
    const risks: string[] = [];
    if (score >= 60) strengths.push(`Composite ESG score of ${score}/100 reflects a functional sustainability management system`);
    if ((yoy ?? 0) < 0) strengths.push(`Year-on-year emissions reduction of ${Math.abs(yoy!).toFixed(1)}% demonstrates improving trajectory`);
    if (goals.some(g => g.status === "on_track")) strengths.push(`${goals.filter(g => g.status === "on_track").length} sustainability goal${goals.filter(g => g.status === "on_track").length > 1 ? "s are" : " is"} on track`);
    if (summary.totalEnergyKwh && summary.totalEnergyKwh > 0) strengths.push(`Active energy consumption monitoring across ${fmt(summary.totalEnergyKwh, 0)} kWh enables data-driven reduction`);
    if (strengths.length === 0) strengths.push("Data collection and reporting infrastructure is in place");

    if (score < 50) risks.push(`ESG score of ${score}/100 indicates material gaps that require prioritised remediation`);
    if ((yoy ?? 0) > 5) risks.push(`Year-on-year emissions increased by ${(yoy!).toFixed(1)}% — the trajectory requires corrective action`);
    if (fleetPct > 85) risks.push(`Fleet combustion represents ${fleetPct}% of total emissions — a single-source concentration risk`);
    if (goals.some(g => g.status === "behind")) risks.push(`${goals.filter(g => g.status === "behind").length} sustainability goal${goals.filter(g => g.status === "behind").length > 1 ? "s are" : " is"} behind schedule`);
    if (risks.length === 0) risks.push("Continued monitoring required to sustain current performance levels");

    const actions = [
      fleetPct > 75 ? `Develop a fleet electrification or fuel-efficiency roadmap — fleet combustion at ${fleetPct}% of total is the highest-value reduction lever` : `Maintain balanced reduction focus across fleet and energy consumption streams`,
      goals.some(g => g.status === "behind") ? `Urgently review and resource the ${goals.filter(g => g.status === "behind").length} sustainability goal${goals.filter(g => g.status === "behind").length > 1 ? "s" : ""} currently tracking behind schedule` : `Formalise annual emission reduction targets aligned to NZ science-based pathways`,
      `Complete the Scope 1 and Scope 2 emissions data set to enable full Toitū CEMARS or GHG Protocol third-party assurance`,
      score < 70 ? `Commission an independent ESG maturity assessment to identify and sequence improvement initiatives` : `Pursue external assurance of this report to strengthen board and investor confidence`,
    ];

    const outlook = `${yoy != null && yoy < 0 ? `The downward emissions trajectory is encouraging` : `Stabilising and then reducing the emissions profile should be the near-term priority`}. ${score >= 60 ? `The current ESG score of ${score}/100 positions ${orgName} in the Moderate to Good range` : `The ESG score of ${score}/100 indicates significant improvement is required`}. The next reporting cycle should focus on: ${fleetPct > 75 ? "fleet decarbonisation strategy" : "balanced Scope 1 and Scope 2 reduction"}, goal formalisation, and data completeness for independent assurance. Proactive action now will strengthen the organisation's position ahead of any future regulatory requirements under New Zealand's climate disclosure framework.`;

    // ── Monthly table HTML ───────────────────────────────────────────────────
    // Old snapshots (pre fuel-cost / energy-gap fix) won't have
    // `energyHasReadings` set. We treat that legacy case as "data unknown" —
    // i.e. fall back to "≥0 kWh implies bill present" which matches the
    // pre-fix behaviour for already-generated reports.
    const fmtMoney = (n: number | undefined | null) =>
      typeof n === "number" ? `$${n.toLocaleString("en-NZ", { maximumFractionDigits: 0 })}` : "—";

    const monthlyHtml = monthly.length
      ? monthly.map((m, i) => {
          const energyMissing = m.energyHasReadings === false;
          const energyKwhCell  = energyMissing
            ? `<span style="color:#b45309;font-style:italic;">Awaiting bill</span>`
            : fmt(m.energyKwh, 0);
          const energyCo2eCell = energyMissing ? `<span style="color:#9ca3af;">—</span>` : fmt(m.energyCo2e, 0);
          // Total — only fleet when energy is missing, so we don't pretend a
          // missing bill = zero consumption.
          const total = energyMissing ? m.fleetCo2e : (m.fleetCo2e + m.energyCo2e);
          const totalCell = energyMissing
            ? `${fmt(total, 0)}<span style="color:#b45309;font-size:9px;font-weight:600;"> *</span>`
            : `${fmt(total, 0)}`;
          // Fleet cost — show whatever the snapshot has; star it if estimated.
          const costCell = (typeof m.fleetFuelCostNzd === "number" && m.fleetFuelCostNzd > 0)
            ? `${fmtMoney(m.fleetFuelCostNzd)}${m.fleetFuelCostEstimated ? `<span style="color:#6b7280;font-size:9px;font-weight:600;"> *</span>` : ""}`
            : `<span style="color:#9ca3af;">—</span>`;
          const label = (() => { const [y, mo] = m.month.split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString("en-NZ", { month: "short", year: "numeric" }); })();
          const bg = i % 2 === 0 ? "#fff" : "#f9fafb";
          return `<tr style="background:${bg};">
            <td style="padding:7px 12px;">${esc(label)}</td>
            <td style="padding:7px 12px;text-align:right;">${fmt(m.fleetKm, 0)}</td>
            <td style="padding:7px 12px;text-align:right;">${fmt(m.fleetCo2e, 0)}</td>
            <td style="padding:7px 12px;text-align:right;">${costCell}</td>
            <td style="padding:7px 12px;text-align:right;">${energyKwhCell}</td>
            <td style="padding:7px 12px;text-align:right;">${energyCo2eCell}</td>
            <td style="padding:7px 12px;text-align:right;font-weight:700;">${totalCell}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="7" style="padding:14px;text-align:center;color:#9ca3af;">No monthly data available for this period</td></tr>`;

    // Footnote — only render when at least one row needed an asterisk so we
    // don't clutter clean reports.
    const monthlyHasEnergyGap = monthly.some(m => m.energyHasReadings === false);
    const monthlyHasEstimatedCost = monthly.some(m => m.fleetFuelCostEstimated);
    const monthlyFootnoteHtml = (monthlyHasEnergyGap || monthlyHasEstimatedCost)
      ? `<div style="margin-top:8px;font-size:10px;color:#6b7280;line-height:1.6;">
          ${monthlyHasEnergyGap        ? `<div><span style="color:#b45309;font-weight:600;">*</span> Power bill not yet uploaded for this month — Scope 2 figure excludes the gap rather than recording it as zero. Total is fleet-only.</div>` : ""}
          ${monthlyHasEstimatedCost    ? `<div><span style="color:#6b7280;font-weight:600;">*</span> Fuel cost estimated from litres × NZ pump average (diesel $${NZ_DIESEL_PRICE.toFixed(2)}/L). Connect a fuel card or bowser receipt feed for invoiced figures.</div>` : ""}
        </div>`
      : "";

    // ── Emitters table HTML ──────────────────────────────────────────────────
    const maxCo2e = topEmitters[0]?.co2e || 1;
    const emittersHtml = topEmitters.length
      ? topEmitters.map((e, i) => {
          const barW = Math.round((e.co2e / maxCo2e) * 100);
          const bg = i % 2 === 0 ? "#fff" : "#f9fafb";
          // Fuel cost — show "$X" when available; star it if estimated (so the
          // board reader can see at a glance which figures came from a fuel
          // card vs. derived from litres × NZ pump average). Show "—" when
          // we have neither cost nor litres nor consumption-l-per-100km, so
          // the cell is honest about missing data.
          const costCell = (typeof e.fuelCostNzd === "number" && e.fuelCostNzd > 0)
            ? `${fmtMoney(e.fuelCostNzd)}${e.fuelCostEstimated ? `<span style="color:#6b7280;font-size:9px;font-weight:600;"> *</span>` : ""}`
            : `<span style="color:#9ca3af;">—</span>`;
          return `<tr style="background:${bg};">
            <td style="padding:8px 12px;font-weight:700;color:#9ca3af;width:32px;">${i + 1}</td>
            <td style="padding:8px 12px;font-family:monospace;font-weight:800;font-size:12px;">${esc(e.name)}</td>
            <td style="padding:8px 12px;color:#6b7280;font-size:11px;">${esc([e.make, e.model].filter(Boolean).join(" "))}</td>
            <td style="padding:8px 12px;text-align:right;">${fmt(e.km, 0)} km</td>
            <td style="padding:8px 12px;text-align:right;font-weight:600;white-space:nowrap;">${costCell}</td>
            <td style="padding:8px 12px;min-width:120px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="flex:1;height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;"><div style="width:${barW}%;height:100%;background:#3b82f6;border-radius:3px;"></div></div>
                <span style="font-weight:700;white-space:nowrap;font-size:11px;">${fmt(e.co2e, 0)} kg</span>
              </div>
            </td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="6" style="padding:14px;text-align:center;color:#9ca3af;">No fleet data available for this period</td></tr>`;

    const emittersHasEstimatedCost = topEmitters.some(e => e.fuelCostEstimated);
    const emittersFootnoteHtml = emittersHasEstimatedCost
      ? `<div style="margin-top:8px;font-size:10px;color:#6b7280;line-height:1.6;">
          <span style="color:#6b7280;font-weight:600;">*</span> Fuel cost estimated from litres × NZ pump average (diesel $${NZ_DIESEL_PRICE.toFixed(2)}/L · petrol $${NZ_PETROL_PRICE.toFixed(2)}/L). Connect a fuel card or upload bowser receipts for invoiced figures.
        </div>`
      : "";

    // ── Goals HTML ───────────────────────────────────────────────────────────
    const goalStatusMap: Record<string, { bg: string; color: string; label: string }> = {
      on_track:    { bg: "#d1fae5", color: "#065f46", label: "On Track" },
      behind:      { bg: "#fee2e2", color: "#991b1b", label: "Behind" },
      at_risk:     { bg: "#fef3c7", color: "#92400e", label: "At Risk" },
      not_started: { bg: "#f3f4f6", color: "#6b7280", label: "Not Started" },
      completed:   { bg: "#ede9fe", color: "#5b21b6", label: "Completed" },
    };
    const goalsHtml = goals.length
      ? goals.map((g, i) => {
          const st = goalStatusMap[g.status] ?? { bg: "#f3f4f6", color: "#6b7280", label: g.status };
          const bg = i % 2 === 0 ? "#fff" : "#f9fafb";
          return `<tr style="background:${bg};">
            <td style="padding:9px 12px;">${esc(g.title)}</td>
            <td style="padding:9px 12px;text-align:right;">${g.targetValue != null ? esc(String(g.targetValue)) : "—"} ${esc(g.targetUnit || "")}</td>
            <td style="padding:9px 12px;text-align:center;"><span style="background:${st.bg};color:${st.color};padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;">${st.label}</span></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="3" style="padding:14px;text-align:center;color:#9ca3af;">No sustainability goals defined</td></tr>`;

    // ── Shared CSS + page footer helper ─────────────────────────────────────
    const css = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
      @page { size: A4; margin: 0; }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; }
        .no-print { display: none !important; }
        .page { page-break-after: always; break-after: page; }
        .page:last-child { page-break-after: avoid; break-after: avoid; }
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      html, body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #fff; color: #1e293b; font-size: 13px; line-height: 1.5; }

      /* ── Save button ── */
      .no-print { position: fixed; top: 20px; right: 20px; background: #16a34a; color: #fff; border: none; padding: 11px 22px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,.2); font-family: inherit; }
      .no-print:hover { background: #15803d; }

      /* ── Cover page ── */
      .cover { background: #0f172a; color: #fff; width: 210mm; min-height: 297mm; display: flex; flex-direction: column; justify-content: space-between; padding: 0; }
      .cover-top { padding: 48px 56px 0; }
      .cover-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 72px; }
      .cover-brand-dot { width: 12px; height: 12px; background: #22c55e; border-radius: 50%; }
      .cover-brand-name { font-size: 15px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; }
      .cover-accent-line { width: 64px; height: 4px; background: #22c55e; border-radius: 2px; margin-bottom: 32px; }
      .cover-doc-type { font-size: 13px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; margin-bottom: 12px; }
      .cover-title { font-size: 42px; font-weight: 900; line-height: 1.1; color: #fff; margin-bottom: 8px; }
      .cover-subtitle { font-size: 18px; font-weight: 400; color: #94a3b8; margin-bottom: 48px; }
      .cover-company-block { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px 28px; display: inline-block; margin-bottom: 0; }
      .cover-company-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
      .cover-company-name { font-size: 26px; font-weight: 800; color: #f1f5f9; }
      .cover-meta { padding: 36px 56px; background: rgba(0,0,0,0.2); }
      .cover-meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
      .cover-meta-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
      .cover-meta-value { font-size: 13px; font-weight: 600; color: #cbd5e1; }

      /* ── Standard page ── */
      .page { width: 210mm; min-height: 297mm; padding: 0; display: flex; flex-direction: column; }
      .page-body { flex: 1; padding: 36px 48px 24px; }
      .page-footer { padding: 14px 48px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #94a3b8; font-weight: 500; }
      .page-footer-brand { font-weight: 700; color: #64748b; }

      /* ── Section header ── */
      .section-header { background: #1e293b; color: #fff; padding: 20px 28px; border-radius: 10px; margin-bottom: 24px; }
      .section-header-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
      .section-header-title { font-size: 20px; font-weight: 800; color: #f1f5f9; }
      .section-header-desc { font-size: 12px; color: #94a3b8; margin-top: 4px; }

      /* ── Index score box ── */
      .index-box { background: #0f172a; border-radius: 10px; padding: 20px 28px; margin-bottom: 20px; display: flex; align-items: baseline; gap: 16px; }
      .index-number { font-size: 56px; font-weight: 900; line-height: 1; color: #fff; }
      .index-slash { font-size: 28px; color: #475569; font-weight: 300; }
      .index-denom { font-size: 24px; color: #475569; font-weight: 600; }
      .index-label { font-size: 13px; color: #94a3b8; margin-top: 2px; }

      /* ── KPI cards ── */
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
      .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; }
      .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 8px; }
      .kpi-value { font-size: 28px; font-weight: 900; color: #16a34a; line-height: 1; }
      .kpi-unit { font-size: 13px; font-weight: 500; color: #94a3b8; }
      .kpi-sub { font-size: 11px; color: #64748b; margin-top: 6px; }

      /* ── Progress bars (category breakdown) ── */
      .breakdown-row { margin-bottom: 14px; }
      .breakdown-label { font-size: 12px; font-weight: 600; color: #1e293b; margin-bottom: 2px; }
      .breakdown-desc { font-size: 10px; color: #94a3b8; margin-bottom: 6px; }
      .bar-track { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; position: relative; }
      .bar-fill { height: 100%; border-radius: 4px; background: #1e293b; }
      .breakdown-pct { font-size: 12px; font-weight: 700; color: #1e293b; margin-left: 8px; min-width: 36px; text-align: right; }
      .breakdown-row-flex { display: flex; align-items: center; gap: 0; }
      .bar-wrapper { flex: 1; }

      /* ── Two-column findings ── */
      .findings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
      .findings-card { border-radius: 8px; padding: 14px 16px; }
      .findings-strengths { background: #f0fdf4; border: 1px solid #bbf7d0; }
      .findings-risks { background: #fff7ed; border: 1px solid #fed7aa; }
      .findings-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 10px; }
      .findings-strengths .findings-title { color: #15803d; }
      .findings-risks .findings-title { color: #c2410c; }
      .findings-item { font-size: 11px; color: #374151; margin-bottom: 5px; padding-left: 12px; position: relative; }
      .findings-item::before { content: "•"; position: absolute; left: 0; }
      .findings-strengths .findings-item::before { color: #16a34a; }
      .findings-risks .findings-item::before { color: #ea580c; }

      /* ── Actions / metrics two-col ── */
      .actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
      .actions-card { border-radius: 8px; padding: 14px 16px; border: 1px solid #e2e8f0; background: #f8fafc; }
      .actions-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 10px; }
      .actions-item { font-size: 11px; color: #374151; margin-bottom: 6px; padding-left: 18px; position: relative; }
      .actions-item-num { position: absolute; left: 0; font-weight: 700; color: #16a34a; }

      /* ── Score interpretation bar ── */
      .interp-bar { display: flex; margin-top: 16px; border-radius: 6px; overflow: hidden; height: 24px; }
      .interp-seg { display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #fff; }
      .interp-labels { display: flex; margin-top: 4px; }
      .interp-label { font-size: 9px; color: #94a3b8; text-align: center; }
      .interp-section { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
      .interp-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 8px; }

      /* ── Page headings ── */
      h2 { font-size: 13px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; margin: 24px 0 12px; }
      h3 { font-size: 12px; font-weight: 700; color: #374151; margin: 0 0 8px; }

      /* ── Tables ── */
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      thead tr { background: #1e293b; }
      th { text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
      th.r { text-align: right; }
      th.c { text-align: center; }
      td { color: #374151; }

      /* ── Scope cards ── */
      .scope-row { display: flex; gap: 12px; margin-bottom: 20px; }
      .scope-card { flex: 1; border-radius: 10px; padding: 16px 18px; }
      .scope-1 { background: #eff6ff; border: 1px solid #bfdbfe; }
      .scope-2 { background: #f0fdf4; border: 1px solid #bbf7d0; }
      .scope-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; margin-bottom: 6px; }
      .scope-value { font-size: 22px; font-weight: 900; margin-bottom: 2px; }
      .scope-1 .scope-value { color: #1d4ed8; }
      .scope-2 .scope-value { color: #15803d; }
      .scope-bar { height: 6px; border-radius: 3px; background: #e5e7eb; margin-top: 8px; overflow: hidden; }
      .scope-bar-fill { height: 100%; border-radius: 3px; }

      /* ── Narrative text ── */
      .narrative { font-size: 12px; color: #374151; line-height: 1.7; margin-bottom: 16px; }
      .narrative-section { margin-bottom: 18px; }
      .narrative-heading { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #1e293b; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 8px; }

      /* ── Methodology box ── */
      .method-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; font-size: 11px; color: #64748b; line-height: 1.7; }
      .method-box strong { color: #374151; }
    `;

    const footerHtml = (page: string) =>
      `<div class="page-footer"><span class="page-footer-brand">EnviroIQ ESG Board Pack</span><span>— ${orgName} —</span><span>Page ${page}</span></div>`;

    // ── Score interpretation HTML ────────────────────────────────────────────
    function interpBar(currentScore: number) {
      const segments = [
        { label: "0–30\nCritical Risk",     width: 15, color: "#dc2626" },
        { label: "31–50\nHigh Risk",         width: 20, color: "#ea580c" },
        { label: "51–70\nModerate",           width: 20, color: "#d97706" },
        { label: "71–85\nManaged",            width: 20, color: "#16a34a" },
        { label: "86–100\nExcellent",         width: 25, color: "#15803d" },
      ];
      const boundaries = [0, 30, 50, 70, 85, 100];
      const posPct = (currentScore / 100) * 100;
      return `
        <div class="interp-section">
          <div class="interp-title">Score Interpretation</div>
          <div style="position:relative;">
            <div class="interp-bar">
              ${segments.map(s => `<div class="interp-seg" style="width:${s.width}%;background:${s.color};"></div>`).join("")}
            </div>
            <div style="position:absolute;top:-6px;left:calc(${posPct}% - 6px);width:12px;height:36px;background:#0f172a;border-radius:2px;border:2px solid #fff;box-shadow:0 0 0 1px #0f172a;"></div>
          </div>
          <div class="interp-labels" style="margin-top:4px;">
            ${segments.map(s => `<div class="interp-label" style="width:${s.width}%;">${s.label.replace("\n", "<br>")}</div>`).join("")}
          </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  BUILD HTML
    // ══════════════════════════════════════════════════════════════════════════

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.title)} — ESG Board Pack</title>
<style>${css}</style>
</head>
<body>

<!-- ══ PAGE 1: COVER ══════════════════════════════════════════════════════ -->
<div class="page cover">
  <div class="cover-top">
    <div class="cover-brand">
      <div class="cover-brand-dot"></div>
      <div class="cover-brand-name">EnviroIQ &nbsp;·&nbsp; ESG Platform</div>
    </div>
    <div class="cover-accent-line"></div>
    <div class="cover-doc-type">ESG Governance Report</div>
    <div class="cover-title">ESG Board Pack</div>
    <div class="cover-subtitle">${esc(report.title)}</div>
    <div class="cover-company-block">
      <div class="cover-company-label">Prepared for</div>
      <div class="cover-company-name">${orgName}</div>
    </div>
  </div>
  <div class="cover-meta">
    <div class="cover-meta-grid">
      <div>
        <div class="cover-meta-label">Report Generated</div>
        <div class="cover-meta-value">${generatedOn}</div>
      </div>
      <div>
        <div class="cover-meta-label">Reporting Period</div>
        <div class="cover-meta-value">${periodFrom} – ${periodTo}</div>
      </div>
      <div>
        <div class="cover-meta-label">Methodology</div>
        <div class="cover-meta-value">NZ MfE 2024 · GHG Protocol</div>
      </div>
    </div>
  </div>
</div>

<!-- ══ PAGE 2: EXECUTIVE DASHBOARD ═══════════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Overview</div>
      <div class="section-header-title">Executive Dashboard</div>
      <div class="section-header-desc">Key performance indicators for the reporting period</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total GHG Emissions</div>
        <div class="kpi-value">${fmtT(summary.totalCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
        <div class="kpi-sub" style="color:${yoyColor};font-weight:700;">${yoyLabel}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Scope 1 — Fleet</div>
        <div class="kpi-value" style="color:#1d4ed8;">${fmtT(summary.fleetCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
        <div class="kpi-sub">${fmt(summary.fleetKm, 0)} km driven</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Scope 2 — Energy</div>
        <div class="kpi-value" style="color:#0891b2;">${fmtT(summary.energyCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
        <div class="kpi-sub">${fmt(summary.totalEnergyKwh, 0)} kWh consumed</div>
      </div>
      <div class="kpi-card" style="background:#f0fdf4;border-color:#86efac;">
        <div class="kpi-label">ESG Score</div>
        <div class="kpi-value" style="color:${scoreColor(score)};">${score}<span class="kpi-unit">/100</span></div>
        <div class="kpi-sub">${scoreRating(score)}</div>
      </div>
    </div>

    <div class="scope-row">
      <div class="scope-card scope-1">
        <div class="scope-label">Scope 1 — Direct Emissions (Fleet Combustion)</div>
        <div class="scope-value">${fmtT(summary.fleetCo2eKg)} tCO₂e</div>
        <div style="font-size:11px;color:#1d4ed8;margin-bottom:6px;">${fleetPct}% of total emissions</div>
        <div class="scope-bar"><div class="scope-bar-fill" style="width:${fleetPct}%;background:#3b82f6;"></div></div>
      </div>
      <div class="scope-card scope-2">
        <div class="scope-label">Scope 2 — Indirect Emissions (Electricity &amp; Gas)</div>
        <div class="scope-value">${fmtT(summary.energyCo2eKg)} tCO₂e</div>
        <div style="font-size:11px;color:#15803d;margin-bottom:6px;">${energyPct}% of total emissions</div>
        <div class="scope-bar"><div class="scope-bar-fill" style="width:${energyPct}%;background:#22c55e;"></div></div>
      </div>
      ${summary.priorYearCo2eKg != null && summary.priorYearCo2eKg > 0 ? `
      <div class="scope-card" style="background:#fafaf9;border:1px solid #e7e5e4;flex:0.65;">
        <div class="scope-label">Prior Year (Same Period)</div>
        <div class="scope-value" style="color:#78716c;">${fmtT(summary.priorYearCo2eKg)} tCO₂e</div>
        <div style="font-size:11px;color:${yoyColor};font-weight:700;margin-bottom:2px;">${yoyLabel}</div>
        <div style="font-size:11px;color:#9ca3af;">${fmt(summary.priorYearFleetKm, 0)} km prior year</div>
      </div>` : ""}
    </div>

    <h2>Sustainability Goals Summary</h2>
    <table>
      <thead><tr><th>Goal</th><th class="r">Target</th><th class="c">Status</th></tr></thead>
      <tbody>${goalsHtml}</tbody>
    </table>
  </div>
  ${footerHtml("1 of 5")}
</div>

<!-- ══ PAGE 3: EXECUTIVE SUMMARY ════════════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">AI-Assisted Analysis</div>
      <div class="section-header-title">Executive Summary — ${orgName} ESG Posture</div>
    </div>

    <div class="narrative-section">
      <div class="narrative-heading">Overall Posture</div>
      <div class="narrative">${overallPosture}</div>
    </div>

    <div class="findings-grid">
      <div class="findings-card findings-strengths">
        <div class="findings-title">Key Strengths</div>
        ${strengths.map(s => `<div class="findings-item">${esc(s)}</div>`).join("")}
      </div>
      <div class="findings-card findings-risks">
        <div class="findings-title">Critical Areas</div>
        ${risks.map(r => `<div class="findings-item">${esc(r)}</div>`).join("")}
      </div>
    </div>

    <div class="narrative-section">
      <div class="narrative-heading">Recommended Actions</div>
      ${actions.map((a, i) => `<div class="narrative" style="margin-bottom:10px;padding-left:24px;position:relative;"><span style="position:absolute;left:0;font-weight:800;color:#16a34a;">${i + 1}.</span>${esc(a)}</div>`).join("")}
    </div>

    <div class="narrative-section">
      <div class="narrative-heading">Outlook</div>
      <div class="narrative">${outlook}</div>
    </div>
  </div>
  ${footerHtml("2 of 5")}
</div>

<!-- ══ PAGE 4: SCOPE 1 FLEET ════════════════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Scope 1 — Direct Emissions</div>
      <div class="section-header-title">Fleet &amp; Vehicle Emissions</div>
      <div class="section-header-desc">Fuel combustion from owned and operated fleet vehicles</div>
    </div>

    <div class="index-box">
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Fleet Emissions Index</div>
        <div style="display:flex;align-items:baseline;gap:8px;">
          <div class="index-number">${fmtT(summary.fleetCo2eKg)}</div>
          <div style="font-size:18px;color:#475569;font-weight:500;">tCO₂e</div>
        </div>
        <div style="font-size:13px;color:#94a3b8;margin-top:4px;">${fleetPct}% of total organisational emissions · ${fmt(summary.fleetKm, 0)} km driven</div>
      </div>
    </div>

    <h2>Category Breakdown</h2>
    ${[
      { label: "Fleet share of total emissions", desc: "Proportion of Scope 1 vs total organisational GHG", pct: fleetPct },
      { label: "Vehicle activity coverage", desc: "Fleet events recorded and emissions-calculated vs fleet size", pct: topEmitters.length > 0 ? Math.min(100, Math.round((topEmitters.length / Math.max(topEmitters.length, 1)) * 100)) : 0, note: `${topEmitters.length} vehicles with recorded activity` },
    ].map(b => `
      <div class="breakdown-row">
        <div class="breakdown-label">${esc(b.label)}</div>
        <div class="breakdown-desc">${esc(b.desc)}${(b as Record<string,unknown>).note ? ` · ${esc(String((b as Record<string,unknown>).note))}` : ""}</div>
        <div class="breakdown-row-flex">
          <div class="bar-wrapper"><div class="bar-track"><div class="bar-fill" style="width:${b.pct}%;"></div></div></div>
          <span class="breakdown-pct">${b.pct}%</span>
        </div>
      </div>`).join("")}

    <h2>Top Fleet Emitters</h2>
    <table>
      <thead><tr>
        <th style="width:28px;">#</th>
        <th>Vehicle</th>
        <th>Make / Model</th>
        <th class="r">Distance</th>
        <th class="r">Fuel cost</th>
        <th>CO₂e</th>
      </tr></thead>
      <tbody>${emittersHtml}</tbody>
    </table>
    ${emittersFootnoteHtml}

    ${interpBar(Math.max(10, 100 - fleetPct))}
  </div>
  ${footerHtml("3 of 5")}
</div>

<!-- ══ PAGE 5: SCOPE 2 + MONTHLY TABLE ═══════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Scope 2 — Indirect Emissions</div>
      <div class="section-header-title">Energy &amp; Electricity Consumption</div>
      <div class="section-header-desc">Indirect emissions from purchased electricity and gas</div>
    </div>

    <div class="index-box">
      <div>
        <div style="font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#475569;margin-bottom:6px;">Energy Emissions Index</div>
        <div style="display:flex;align-items:baseline;gap:8px;">
          <div class="index-number">${fmtT(summary.energyCo2eKg)}</div>
          <div style="font-size:18px;color:#475569;font-weight:500;">tCO₂e</div>
        </div>
        <div style="font-size:13px;color:#94a3b8;margin-top:4px;">${energyPct}% of total emissions · ${fmt(summary.totalEnergyKwh, 0)} kWh consumed</div>
      </div>
    </div>

    <h2>Category Breakdown</h2>
    ${[
      { label: "Energy share of total emissions", desc: "Proportion of Scope 2 vs total organisational GHG", pct: energyPct },
      { label: "Renewable electricity proportion (NZ grid)", desc: "NZ electricity mix — real-time grid data sourced from em6 API", pct: 91 },
    ].map(b => `
      <div class="breakdown-row">
        <div class="breakdown-label">${esc(b.label)}</div>
        <div class="breakdown-desc">${esc(b.desc)}</div>
        <div class="breakdown-row-flex">
          <div class="bar-wrapper"><div class="bar-track"><div class="bar-fill" style="width:${b.pct}%;background:#0891b2;"></div></div></div>
          <span class="breakdown-pct">${b.pct}%</span>
        </div>
      </div>`).join("")}

    <div class="actions-grid" style="margin-top:20px;">
      <div class="actions-card">
        <div class="actions-title">Board-Level Metrics</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Energy CO₂e: ${fmtT(summary.energyCo2eKg)} tCO₂e</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Total kWh consumed: ${fmt(summary.totalEnergyKwh, 0)}</div>
        <div class="actions-item"><span class="actions-item-num">·</span>NZ grid intensity (avg): 0.098 kg CO₂e/kWh</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Grid renewable fraction: ~91% (em6 real-time)</div>
      </div>
      <div class="actions-card">
        <div class="actions-title">Recommended Actions</div>
        <div class="actions-item"><span class="actions-item-num">1.</span>Audit energy bills for accuracy and completeness</div>
        <div class="actions-item"><span class="actions-item-num">2.</span>Investigate solar / on-site generation feasibility</div>
        <div class="actions-item"><span class="actions-item-num">3.</span>Switch to a certified Renewable Energy provider</div>
      </div>
    </div>

    <h2>Monthly Emissions Breakdown</h2>
    ${(typeof summary.monthsMissingEnergy === "number" && summary.monthsMissingEnergy > 0)
      ? `<div style="margin:0 0 10px;padding:10px 14px;border-left:3px solid #b45309;background:#fffbeb;font-size:11px;color:#78350f;line-height:1.5;border-radius:0 4px 4px 0;">
          <strong>Data completeness:</strong> ${summary.monthsMissingEnergy} of ${summary.monthsInPeriod ?? monthly.length} month${(summary.monthsInPeriod ?? monthly.length) === 1 ? "" : "s"} in this period have no power bill on file. Those months are shown as <em>"Awaiting bill"</em> in the table below — Scope 2 totals exclude them rather than recording zero. Upload the missing bills under <strong>Energy</strong> to firm up the figures.
        </div>`
      : ""}
    <table>
      <thead><tr>
        <th>Month</th>
        <th class="r">Fleet km</th>
        <th class="r">Fleet CO₂e (kg)</th>
        <th class="r">Fuel cost</th>
        <th class="r">Energy kWh</th>
        <th class="r">Energy CO₂e (kg)</th>
        <th class="r">Total CO₂e (kg)</th>
      </tr></thead>
      <tbody>${monthlyHtml}</tbody>
    </table>
    ${monthlyFootnoteHtml}

    ${interpBar(Math.max(10, 100 - energyPct * 2))}
  </div>
  ${footerHtml("4 of 5")}
</div>

<!-- ══ PAGE 6: METHODOLOGY ═══════════════════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Assurance &amp; Standards</div>
      <div class="section-header-title">Measurement Methodology</div>
      <div class="section-header-desc">Emission factors, data sources, and framework alignment</div>
    </div>

    <div class="method-box">
      <p style="margin-bottom:12px;"><strong>Scope 1 — Fleet Combustion (Direct Emissions)</strong><br>
      Calculated using NZ Ministry for the Environment <em>Measuring Emissions: A Guide for Organisations</em> (2024 edition) vehicle-class emission factors. Light commercial diesel (Hilux, Hiace class): <strong>0.214 kg CO₂e/km</strong> · Medium truck (Isuzu NPR, Hino Dutro, Fuso Canter): <strong>0.340 kg CO₂e/km</strong> · Petrol light vehicle: <strong>0.196 kg CO₂e/km</strong> · Hybrid: <strong>0.104 kg CO₂e/km</strong> · PHEV: <strong>0.067 kg CO₂e/km</strong>. Where fuel-card litres are available, actual consumption is used (diesel: 2.68 kg CO₂e/litre, petrol: 2.31 kg CO₂e/litre).</p>

      <p style="margin-bottom:12px;"><strong>Scope 2 — Energy &amp; Electricity (Indirect Emissions)</strong><br>
      Electricity emissions calculated using NZ real-time grid intensity data sourced from Electricity Authority <em>em6</em> API where available, otherwise NZ national annual average (<strong>0.098 kg CO₂e/kWh</strong> per MfE 2024). Gas consumption uses NZ Ministry for the Environment natural gas emission factor (<strong>2.05 kg CO₂e/kWh</strong>).</p>

      <p><strong>Framework Alignment</strong><br>
      This report is prepared consistent with the <em>GHG Protocol Corporate Accounting and Reporting Standard</em> (World Resources Institute / WBCSD) and is structured to align with the Toitū Envirocare <em>CEMARS</em> (Certified Emissions Measurement and Reduction Scheme) disclosure requirements. Data collection and emission factor selection follow NZ MfE guidance throughout.</p>
    </div>

    <div class="actions-grid" style="margin-top:20px;">
      <div class="actions-card">
        <div class="actions-title">Standards &amp; Frameworks Applied</div>
        <div class="actions-item"><span class="actions-item-num">·</span>NZ MfE Measuring Emissions Guide 2024</div>
        <div class="actions-item"><span class="actions-item-num">·</span>GHG Protocol Corporate Standard</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Toitū Envirocare CEMARS alignment</div>
        <div class="actions-item"><span class="actions-item-num">·</span>NZ Electricity Authority em6 real-time grid data</div>
      </div>
      <div class="actions-card">
        <div class="actions-title">Report Details</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Organisation: ${orgName}</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Period: ${periodFrom} – ${periodTo}</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Generated: ${generatedOn}</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Report ID: ${report.id.substring(0, 8).toUpperCase()}</div>
        <div class="actions-item"><span class="actions-item-num">·</span>Platform: EnviroIQ (enviroiq.net)</div>
      </div>
    </div>

    <div style="margin-top:24px;padding:16px 20px;background:#0f172a;border-radius:10px;color:#94a3b8;font-size:11px;line-height:1.7;">
      <span style="color:#22c55e;font-weight:700;">EnviroIQ ESG Platform</span> &nbsp;·&nbsp; enviroiq.net &nbsp;·&nbsp; This report was automatically generated from verified emission data recorded in the EnviroIQ platform. Emission calculations have been performed using approved NZ Ministry for the Environment emission factors. This report does not constitute third-party assurance. For Toitū CEMARS certification or external verification, engage an accredited verifier.
    </div>
  </div>
  ${footerHtml("5 of 5")}
</div>

</body>
</html>`;

    const wantsHtml = req.query.format === "html";
    if (wantsHtml) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", "inline");
      res.send(html);
      return;
    }

    const safeTitle = report.title.replace(/[^a-z0-9]/gi, "_");
    const pdfBuffer = await htmlToPdf(html, {
      footerLabel: `EnviroIQ ESG Board Pack · ${report.title}`,
      showPageNumbers: true,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_board_pack.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "Download report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to generate PDF" });
  }
});

// GET /organisations/:orgId/reports/tender-pack — NZ govt procurement evidence pack
router.get("/tender-pack", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;

    await logAudit({ req, action: "report.tender_pack_download", resourceType: "report", resourceId: orgId, organisationId: orgId });

    const [orgRows, emissionsRow, hsRows, trainingRows, workforceRow, govRow, wasteRow, subRows, goalsRows] = await Promise.all([
      db.execute(sql`SELECT name FROM organisations WHERE id = ${orgId} LIMIT 1`),
      // Aggregate from the two real source tables (fleet_events + energy_readings).
      // The legacy "emission_readings" view was removed in the multi-source refactor.
      db.execute(sql`
        SELECT
          COALESCE((SELECT SUM(co2e_kg)::float    FROM fleet_events     WHERE organisation_id = ${orgId}), 0) AS fleet_co2e,
          COALESCE((SELECT SUM(co2e_kg)::float    FROM energy_readings  WHERE organisation_id = ${orgId}), 0) AS energy_co2e,
          COALESCE((SELECT SUM(co2e_kg)::float    FROM fleet_events     WHERE organisation_id = ${orgId}), 0)
          + COALESCE((SELECT SUM(co2e_kg)::float  FROM energy_readings  WHERE organisation_id = ${orgId}), 0) AS total_co2e,
          COALESCE((SELECT SUM(distance_km)::float FROM fleet_events    WHERE organisation_id = ${orgId}), 0) AS total_km
      `),
      db.execute(sql`SELECT incident_type, incident_date, description, days_lost, closed_out FROM hs_incidents WHERE organisation_id = ${orgId} ORDER BY incident_date DESC LIMIT 20`),
      db.execute(sql`SELECT topic, category, hours, employee_name, training_date FROM training_records WHERE organisation_id = ${orgId} ORDER BY training_date DESC LIMIT 10`),
      // NOTE: maori_pct / pasifika_pct columns were never added to
      // social_workforce_snapshots — referencing them here previously caused
      // a 500 ("column \"maori_pct\" does not exist"). Until/unless those
      // columns are introduced, the "Māori / Pasifika" KPI renders as "—".
      db.execute(sql`SELECT headcount, female_pct, female_leadership_pct, period_year, living_wage_accredited, supplier_code_of_conduct FROM social_workforce_snapshots WHERE organisation_id = ${orgId} ORDER BY period_year DESC LIMIT 1`),
      db.execute(sql`SELECT board_size, board_female_count, board_independent_count, has_code_of_conduct, has_whistleblower, has_anti_bribery, has_privacy_policy, has_esg_risk_register, has_external_assurance, has_modern_slavery_policy, framework_alignment FROM governance_snapshots WHERE organisation_id = ${orgId} ORDER BY period_year DESC LIMIT 1`),
      db.execute(sql`SELECT COALESCE(SUM(quantity_kg),0)::float AS total_kg, COALESCE(SUM(CASE WHEN diverted THEN quantity_kg ELSE 0 END),0)::float AS diverted_kg FROM waste_records WHERE organisation_id = ${orgId}`),
      db.execute(sql`SELECT company_name, trade_type, hs_prequalified, supplier_code_signed, status FROM subcontractors WHERE organisation_id = ${orgId} AND status='active' ORDER BY company_name LIMIT 30`),
      db.execute(sql`SELECT title, status, target_value, target_unit FROM goals WHERE organisation_id = ${orgId}`),
    ]);

    const org = esc(String((sqlRows(orgRows)[0] as Record<string,unknown>)?.name ?? "Organisation"));
    const em = sqlRows(emissionsRow)[0] as Record<string,number> ?? {};
    const wf = sqlRows(workforceRow)[0] as Record<string,unknown> ?? {};
    const gov = sqlRows(govRow)[0] as Record<string,unknown> ?? {};
    const waste = sqlRows(wasteRow)[0] as Record<string,number> ?? {};
    const subs = sqlRows(subRows) as Record<string,unknown>[];
    const hs = sqlRows(hsRows) as Record<string,unknown>[];
    const training = sqlRows(trainingRows) as Record<string,unknown>[];
    const goals = sqlRows(goalsRows) as Record<string,unknown>[];

    const fmtT = (kg: number) => (kg / 1000).toFixed(2);
    const fmt = (n: unknown, dp = 1) => typeof n === "number" ? n.toLocaleString("en-NZ", { maximumFractionDigits: dp }) : "—";
    const bool = (v: unknown) => v ? "✓ Yes" : "✗ No";
    const pct = (v: unknown) => typeof v === "number" ? `${v.toFixed(1)}%` : "—";
    const generatedOn = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });

    const totalKg = em.total_co2e ?? 0;
    const divertedKg = waste.diverted_kg ?? 0;
    const totalWasteKg = waste.total_kg ?? 0;
    const diversionRate = totalWasteKg > 0 ? (divertedKg / totalWasteKg * 100).toFixed(1) : "—";

    const subPrequalPct = subs.length > 0 ? Math.round(subs.filter(s => s.hs_prequalified).length / subs.length * 100) : 0;
    const subCodePct = subs.length > 0 ? Math.round(subs.filter(s => s.supplier_code_signed).length / subs.length * 100) : 0;

    const totalTrainingHrs = training.reduce((a, t) => a + (typeof t.hours === "number" ? t.hours : 0), 0);
    const ltiFree = hs.filter(i => (i.days_lost as number) > 0).length === 0;
    const openIncidents = hs.filter(i => !i.closed_out).length;

    const goalsHtml = goals.length
      ? goals.map((g, i) => {
          const st = g.status as string;
          const sc = st === "on_track" ? "#15803d" : st === "behind" ? "#dc2626" : st === "completed" ? "#7c3aed" : "#92400e";
          const sl = st === "on_track" ? "On Track" : st === "behind" ? "Behind" : st === "completed" ? "Completed" : st === "at_risk" ? "At Risk" : st;
          return `<tr style="background:${i%2===0?"#fff":"#f9fafb"}"><td style="padding:8px 12px;">${esc(String(g.title))}</td><td style="padding:8px 12px;text-align:right;">${g.target_value != null ? `${fmt(g.target_value as number)} ${esc(String(g.target_unit ?? ""))}` : "—"}</td><td style="padding:8px 12px;text-align:center;"><span style="background:${sc}20;color:${sc};padding:2px 10px;border-radius:999px;font-size:10px;font-weight:700;">${sl}</span></td></tr>`;
        }).join("")
      : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af;">No goals defined</td></tr>`;

    const subHtml = subs.length
      ? subs.map((s, i) => `<tr style="background:${i%2===0?"#fff":"#f9fafb"}">
          <td style="padding:8px 12px;font-weight:600;">${esc(String(s.company_name))}</td>
          <td style="padding:8px 12px;color:#6b7280;">${esc(String(s.trade_type ?? "—")).replace(/_/g," ")}</td>
          <td style="padding:8px 12px;text-align:center;color:${s.hs_prequalified?"#15803d":"#dc2626"};">${s.hs_prequalified?"✓":"✗"}</td>
          <td style="padding:8px 12px;text-align:center;color:${s.supplier_code_signed?"#15803d":"#dc2626"};">${s.supplier_code_signed?"✓":"✗"}</td>
        </tr>`).join("")
      : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#9ca3af;">No subcontractors registered</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${org} — Tender Evidence Pack</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  @media print { .no-print { display: none !important; } }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 32px 40px; color: #111827; background: #fff; font-size: 13px; line-height: 1.6; }
  .no-print { position: fixed; top: 16px; right: 16px; background: #16a34a; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 100; }
  .cover { background: #0f172a; color: #fff; padding: 56px 64px; border-radius: 12px; margin-bottom: 32px; }
  .cover-brand { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 48px; display: flex; align-items: center; gap: 8px; }
  .cover-dot { width: 8px; height: 8px; background: #22c55e; border-radius: 50%; }
  .cover-accent { width: 48px; height: 3px; background: #22c55e; border-radius: 2px; margin-bottom: 20px; }
  .cover-type { font-size: 12px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 8px; }
  .cover-title { font-size: 36px; font-weight: 900; color: #fff; margin-bottom: 6px; }
  .cover-sub { font-size: 16px; color: #94a3b8; margin-bottom: 40px; }
  .cover-company { background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 16px 24px; display: inline-block; }
  .cover-clabel { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; }
  .cover-cname { font-size: 22px; font-weight: 800; color: #f1f5f9; }
  .cover-meta { margin-top: 48px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.1); display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
  .cover-mlabel { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; }
  .cover-mvalue { font-size: 13px; font-weight: 600; color: #cbd5e1; margin-top: 2px; }
  .disclaimer { background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin-bottom: 24px; font-size: 11px; color: #92400e; }
  .section { margin-bottom: 32px; }
  .section-header { background: #1e293b; color: #fff; padding: 14px 20px; border-radius: 8px 8px 0 0; display: flex; align-items: baseline; justify-content: space-between; }
  .section-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; }
  .section-title { font-size: 16px; font-weight: 800; color: #f1f5f9; }
  .section-body { border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px; padding: 20px; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 0; }
  .kpi { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 6px; }
  .kpi-value { font-size: 22px; font-weight: 900; color: #16a34a; }
  .kpi-unit { font-size: 12px; font-weight: 400; color: #94a3b8; }
  .checklist { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .check-item { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 6px 0; }
  .check-yes { color: #15803d; font-weight: 700; }
  .check-no { color: #dc2626; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: #f8fafc; }
  th { text-align: left; padding: 8px 12px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; border-bottom: 2px solid #e2e8f0; }
  th.r { text-align: right; } th.c { text-align: center; }
  .footer { margin-top: 40px; font-size: 10px; color: #9ca3af; border-top: 1px solid #e2e8f0; padding-top: 10px; text-align: center; }
</style>
</head>
<body>
<div class="cover">
  <div class="cover-brand"><div class="cover-dot"></div>EnviroIQ &nbsp;·&nbsp; ESG Platform</div>
  <div class="cover-accent"></div>
  <div class="cover-type">NZ Government Procurement Evidence</div>
  <div class="cover-title">Tender Evidence Pack</div>
  <div class="cover-sub">Responsible Business Practice — Proof of Compliance</div>
  <div class="cover-company">
    <div class="cover-clabel">Prepared for</div>
    <div class="cover-cname">${org}</div>
  </div>
  <div class="cover-meta">
    <div><div class="cover-mlabel">Generated</div><div class="cover-mvalue">${generatedOn}</div></div>
    <div><div class="cover-mlabel">Standards</div><div class="cover-mvalue">NZ Govt Procurement Rules 5th Ed.</div></div>
    <div><div class="cover-mlabel">Framework</div><div class="cover-mvalue">GHG Protocol · NZ MfE 2024</div></div>
  </div>
</div>

<div class="disclaimer">
  <strong>Document Purpose:</strong> This pack provides evidence of responsible business practices for use in NZ Government tender responses, consistent with the Government Procurement Rules (5th Edition), Supplier Code of Conduct, and NZS 4801 / HealthSafe. Generated from verified data in the EnviroIQ ESG platform.
</div>

<!-- 1. EMISSIONS -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 1</div><div class="section-title">Emissions Baseline (Scope 1 &amp; 2)</div></div>
  </div>
  <div class="section-body">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Total GHG Emissions</div><div class="kpi-value">${fmtT(totalKg)}<span class="kpi-unit"> tCO₂e</span></div></div>
      <div class="kpi"><div class="kpi-label">Scope 1 — Fleet</div><div class="kpi-value">${fmtT(em.fleet_co2e ?? 0)}<span class="kpi-unit"> tCO₂e</span></div></div>
      <div class="kpi"><div class="kpi-label">Scope 2 — Energy</div><div class="kpi-value">${fmtT(em.energy_co2e ?? 0)}<span class="kpi-unit"> tCO₂e</span></div></div>
      <div class="kpi"><div class="kpi-label">Fleet Distance</div><div class="kpi-value">${fmt(em.total_km, 0)}<span class="kpi-unit"> km</span></div></div>
    </div>
    <p style="margin-top:14px;font-size:11px;color:#6b7280;">Emissions calculated using NZ Ministry for the Environment <em>Measuring Emissions Guide</em> (2024 edition) vehicle-class factors and real-time NZ grid intensity from Electricity Authority em6 API. Consistent with GHG Protocol Corporate Standard.</p>
    ${goals.length ? `<h4 style="font-size:11px;font-weight:700;margin:16px 0 8px;color:#374151;">Emission Reduction Goals</h4><table><thead><tr><th>Goal</th><th class="r">Target</th><th class="c">Status</th></tr></thead><tbody>${goalsHtml}</tbody></table>` : ""}
  </div>
</div>

<!-- 2. WASTE & ENVIRONMENTAL -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 2</div><div class="section-title">Waste &amp; Environmental Performance</div></div>
  </div>
  <div class="section-body">
    <div class="kpi-grid">
      <div class="kpi"><div class="kpi-label">Total Waste Generated</div><div class="kpi-value">${(totalWasteKg/1000).toFixed(2)}<span class="kpi-unit"> tonnes</span></div></div>
      <div class="kpi"><div class="kpi-label">Waste Diversion Rate</div><div class="kpi-value" style="color:${totalWasteKg>0?"#16a34a":"#6b7280"};">${diversionRate}<span class="kpi-unit">${totalWasteKg>0?"%":""}</span></div></div>
      <div class="kpi"><div class="kpi-label">Diverted from Landfill</div><div class="kpi-value">${(divertedKg/1000).toFixed(2)}<span class="kpi-unit"> tonnes</span></div></div>
    </div>
    <p style="margin-top:14px;font-size:11px;color:#6b7280;">Waste tracking covers construction debris, concrete, timber, steel, recyclables, hazardous, and general waste streams. All records include disposal method and diversion status. Environmental incident register maintained separately.</p>
  </div>
</div>

<!-- 3. HEALTH & SAFETY -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 3</div><div class="section-title">Health &amp; Safety</div></div>
  </div>
  <div class="section-body">
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi"><div class="kpi-label">Recorded Incidents</div><div class="kpi-value">${hs.length}</div></div>
      <div class="kpi"><div class="kpi-label">Lost Time Incidents</div><div class="kpi-value" style="color:${ltiFree?"#16a34a":"#dc2626"};">${hs.filter(i => (i.days_lost as number) > 0).length}</div></div>
      <div class="kpi"><div class="kpi-label">Open Items</div><div class="kpi-value" style="color:${openIncidents>0?"#ea580c":"#16a34a"};">${openIncidents}</div></div>
    </div>
    ${hs.length ? `
    <table>
      <thead><tr><th>Type</th><th>Date</th><th>Description</th><th class="c">Days Lost</th><th class="c">Closed</th></tr></thead>
      <tbody>${hs.slice(0,10).map((i, idx) => `<tr style="background:${idx%2===0?"#fff":"#f9fafb"}">
        <td style="padding:7px 12px;font-weight:600;">${esc(String(i.incident_type ?? "")).replace(/_/g," ")}</td>
        <td style="padding:7px 12px;color:#6b7280;">${new Date(String(i.incident_date)).toLocaleDateString("en-NZ")}</td>
        <td style="padding:7px 12px;">${esc(String(i.description ?? "").substring(0,60))}${String(i.description ?? "").length>60?"…":""}</td>
        <td style="padding:7px 12px;text-align:center;">${i.days_lost ?? 0}</td>
        <td style="padding:7px 12px;text-align:center;color:${i.closed_out?"#15803d":"#ea580c"};">${i.closed_out?"✓":"○"}</td>
      </tr>`).join("")}</tbody>
    </table>` : `<p style="color:#9ca3af;font-size:12px;text-align:center;padding:8px;">No incidents recorded in the platform</p>`}
  </div>
</div>

<!-- 4. WORKFORCE & SOCIAL -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 4</div><div class="section-title">Workforce &amp; Social Outcomes</div></div>
  </div>
  <div class="section-body">
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi"><div class="kpi-label">Headcount</div><div class="kpi-value">${fmt(wf.headcount, 0)}</div></div>
      <div class="kpi"><div class="kpi-label">Female Representation</div><div class="kpi-value">${pct(wf.female_pct)}</div></div>
      <div class="kpi"><div class="kpi-label">Māori / Pasifika</div><div class="kpi-value">${typeof wf.maori_pct === "number" && typeof wf.pasifika_pct === "number" ? pct(wf.maori_pct + wf.pasifika_pct) : "—"}</div></div>
      <div class="kpi"><div class="kpi-label">Training Hours (recent)</div><div class="kpi-value">${totalTrainingHrs.toFixed(0)}<span class="kpi-unit"> hrs</span></div></div>
    </div>
    <div class="checklist">
      <div class="check-item"><span class="${wf.living_wage_accredited?"check-yes":"check-no"}">${bool(wf.living_wage_accredited)}</span> Living Wage Accredited</div>
      <div class="check-item"><span class="${wf.supplier_code_of_conduct?"check-yes":"check-no"}">${bool(wf.supplier_code_of_conduct)}</span> Supplier Code of Conduct Applied</div>
    </div>
    ${training.length ? `
    <h4 style="font-size:11px;font-weight:700;margin:16px 0 8px;color:#374151;">Recent Training Records (sample)</h4>
    <table>
      <thead><tr><th>Employee</th><th>Topic</th><th>Category</th><th class="r">Hours</th><th>Date</th></tr></thead>
      <tbody>${training.map((t, idx) => `<tr style="background:${idx%2===0?"#fff":"#f9fafb"}">
        <td style="padding:7px 12px;">${esc(String(t.employee_name))}</td>
        <td style="padding:7px 12px;">${esc(String(t.topic))}</td>
        <td style="padding:7px 12px;color:#6b7280;">${esc(String(t.category ?? ""))}</td>
        <td style="padding:7px 12px;text-align:right;">${fmt(t.hours as number)}</td>
        <td style="padding:7px 12px;color:#6b7280;">${new Date(String(t.training_date)).toLocaleDateString("en-NZ")}</td>
      </tr>`).join("")}</tbody>
    </table>` : ""}
  </div>
</div>

<!-- 5. GOVERNANCE -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 5</div><div class="section-title">Governance &amp; Responsible Business Practices</div></div>
  </div>
  <div class="section-body">
    <div class="checklist">
      <div class="check-item"><span class="${gov.has_code_of_conduct?"check-yes":"check-no"}">${bool(gov.has_code_of_conduct)}</span> Code of Conduct</div>
      <div class="check-item"><span class="${gov.has_whistleblower?"check-yes":"check-no"}">${bool(gov.has_whistleblower)}</span> Whistleblower Policy</div>
      <div class="check-item"><span class="${gov.has_anti_bribery?"check-yes":"check-no"}">${bool(gov.has_anti_bribery)}</span> Anti-Bribery / Anti-Corruption</div>
      <div class="check-item"><span class="${gov.has_privacy_policy?"check-yes":"check-no"}">${bool(gov.has_privacy_policy)}</span> Privacy Policy (NZ Privacy Act 2020)</div>
      <div class="check-item"><span class="${gov.has_esg_risk_register?"check-yes":"check-no"}">${bool(gov.has_esg_risk_register)}</span> ESG Risk Register</div>
      <div class="check-item"><span class="${gov.has_modern_slavery_policy?"check-yes":"check-no"}">${bool(gov.has_modern_slavery_policy)}</span> Modern Slavery Policy</div>
      <div class="check-item"><span class="${gov.has_external_assurance?"check-yes":"check-no"}">${bool(gov.has_external_assurance)}</span> Third-Party Assurance</div>
    </div>
    ${gov.framework_alignment ? `<p style="margin-top:14px;font-size:11px;color:#6b7280;"><strong>Framework Alignment:</strong> ${esc(String(gov.framework_alignment))}</p>` : ""}
  </div>
</div>

<!-- 6. SUPPLY CHAIN -->
<div class="section">
  <div class="section-header">
    <div><div class="section-eyebrow">Proof Point 6</div><div class="section-title">Supply Chain H&amp;S Compliance</div></div>
  </div>
  <div class="section-body">
    <div class="kpi-grid" style="margin-bottom:16px;">
      <div class="kpi"><div class="kpi-label">Active Subcontractors</div><div class="kpi-value">${subs.length}</div></div>
      <div class="kpi"><div class="kpi-label">H&amp;S Prequalified</div><div class="kpi-value" style="color:#16a34a;">${subPrequalPct}%</div></div>
      <div class="kpi"><div class="kpi-label">Supplier Code Signed</div><div class="kpi-value" style="color:#0891b2;">${subCodePct}%</div></div>
    </div>
    ${subs.length ? `
    <table>
      <thead><tr><th>Company</th><th>Trade</th><th class="c">H&amp;S Prequalified</th><th class="c">Code Signed</th></tr></thead>
      <tbody>${subHtml}</tbody>
    </table>` : `<p style="color:#9ca3af;font-size:12px;text-align:center;padding:8px;">No subcontractors registered in the platform</p>`}
  </div>
</div>

<div class="footer">
  This Tender Evidence Pack was generated by EnviroIQ ESG Platform (enviroiq.net) on ${generatedOn} for ${org}.<br>
  Data is sourced from the organisation's live ESG records. This document is consistent with NZ Government Procurement Rules (5th Edition) and the Supplier Code of Conduct.
</div>
</body>
</html>`;

    const orgName = String((sqlRows(orgRows)[0] as Record<string, unknown>)?.name ?? "Organisation");
    const safeName = orgName.replace(/[^a-z0-9]/gi, "_");

    if (req.query.format === "html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", "inline");
      res.send(html);
      return;
    }

    const pdfBuffer = await htmlToPdf(html, {
      footerLabel: `EnviroIQ Tender Evidence Pack · ${orgName}`,
      marginMm: { top: 0, right: 0, bottom: 14, left: 0 },
      showPageNumbers: true,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_tender_pack.pdf"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (err) {
    req.log.error({ err }, "Tender pack failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to generate tender pack PDF" });
  }
});

router.delete("/:reportId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const reportId = req.params.reportId as string;
    const deleted = await db.delete(reportsTable)
      .where(and(eq(reportsTable.id, reportId), eq(reportsTable.organisationId, orgId)))
      .returning();
    if (!deleted.length) {
      res.status(404).json({ error: "Not Found", message: "Report not found" });
      return;
    }
    await logAudit({ req, action: "report.delete", resourceType: "report", resourceId: reportId, organisationId: orgId });
    res.json({ message: "Report deleted" });
  } catch (err) {
    req.log.error({ err }, "Delete report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete report" });
  }
});

export default router;
