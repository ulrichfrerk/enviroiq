import { Router } from "express";
import { db, reportsTable, goalsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { logAudit } from "../lib/audit.js";
import { calcSustainabilityScore } from "../lib/emissions.js";

const router = Router({ mergeParams: true });

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

    const [fleetRows, energyRows] = await Promise.all([
      db.execute(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', recorded_at), 'YYYY-MM') AS month,
          COALESCE(SUM(co2e_kg), 0)::float AS fleet_co2e,
          COALESCE(SUM(distance_km), 0)::float AS fleet_km
        FROM fleet_events
        WHERE organisation_id = ${orgId}
          AND recorded_at >= NOW() - (${months} || ' months')::interval
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
          db.execute(sql`SELECT TO_CHAR(DATE_TRUNC('month', recorded_at),'YYYY-MM') as month, COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(distance_km),0)::float as km FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${from} AND recorded_at <= ${to} GROUP BY 1 ORDER BY 1`),
          db.execute(sql`SELECT TO_CHAR(DATE_TRUNC('month', period_start),'YYYY-MM') as month, COALESCE(SUM(co2e_kg),0)::float as co2e, COALESCE(SUM(usage_kwh),0)::float as kwh FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${from} AND period_end <= ${to} GROUP BY 1 ORDER BY 1`),
          db.execute(sql`SELECT v.name, v.registration, v.make, v.model, COALESCE(SUM(fe.co2e_kg),0)::float as co2e, COALESCE(SUM(fe.distance_km),0)::float as km FROM fleet_events fe JOIN vehicles v ON v.id = fe.vehicle_id WHERE fe.organisation_id = ${orgId} AND fe.recorded_at >= ${from} AND fe.recorded_at <= ${to} GROUP BY v.id, v.name, v.registration, v.make, v.model ORDER BY co2e DESC LIMIT 10`),
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

        // Build monthly table merging fleet + energy
        const monthMap: Record<string, { month: string; fleetCo2e: number; energyCo2e: number; fleetKm: number; energyKwh: number }> = {};
        for (const r of sqlRows(monthlyFleet)) {
          const m = strCol(r, "month");
          monthMap[m] = monthMap[m] ?? { month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0 };
          monthMap[m].fleetCo2e = numCol(r, "co2e");
          monthMap[m].fleetKm   = numCol(r, "km");
        }
        for (const r of sqlRows(monthlyEnergy)) {
          const m = strCol(r, "month");
          monthMap[m] = monthMap[m] ?? { month: m, fleetCo2e: 0, energyCo2e: 0, fleetKm: 0, energyKwh: 0 };
          monthMap[m].energyCo2e = numCol(r, "co2e");
          monthMap[m].energyKwh  = numCol(r, "kwh");
        }

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
          },
          monthly: Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)),
          topEmitters: sqlRows(topEmitters).map(r => ({
            name: strCol(r, "name"),
            registration: strCol(r, "registration"),
            make: strCol(r, "make"),
            model: strCol(r, "model"),
            co2e: numCol(r, "co2e"),
            km: numCol(r, "km"),
          })),
          goals: goals.map((g) => ({ title: g.title, status: g.status, targetValue: g.targetValue, targetUnit: g.targetUnit })),
        };

        await db.update(reportsTable)
          .set({ status: "ready", dataSnapshot: JSON.stringify(snapshot) })
          .where(eq(reportsTable.id, reportId));
      } catch {
        await db.update(reportsTable).set({ status: "failed" }).where(eq(reportsTable.id, reportId));
      }
    });

    await logAudit({ req, action: "report.generate", resourceType: "report", resourceId: reportId });
    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Generate report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to generate report" });
  }
});

// GET /organisations/:orgId/reports/:reportId
router.get("/:reportId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string; const reportId = req.params.reportId as string;
    const report = await db.query.reportsTable.findFirst({
      where: and(eq(reportsTable.id, reportId), eq(reportsTable.organisationId, orgId)),
    });
    if (!report) {
      res.status(404).json({ error: "Not Found", message: "Report not found" });
      return;
    }

    await logAudit({ req, action: "report.view", resourceType: "report", resourceId: reportId });

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
    const report = await db.query.reportsTable.findFirst({
      where: and(eq(reportsTable.id, reportId), eq(reportsTable.organisationId, orgId)),
    });
    if (!report) {
      res.status(404).send("Report not found");
      return;
    }
    if (report.status !== "ready") {
      res.status(409).send("Report is not yet ready");
      return;
    }

    await logAudit({ req, action: "report.download", resourceType: "report", resourceId: reportId });

    type MonthRow = { month: string; fleetCo2e: number; energyCo2e: number; fleetKm: number; energyKwh: number };
    type EmitterRow = { name: string; registration: string; make: string; model: string; co2e: number; km: number };
    type GoalRow = { title: string; status: string; targetValue: number | null; targetUnit: string | null };
    type SnapshotSummary = { totalCo2eKg?: number; fleetCo2eKg?: number; energyCo2eKg?: number; totalEnergyKwh?: number; fleetKm?: number; sustainabilityScore?: number; priorYearCo2eKg?: number; priorYearFleetKm?: number; yoyChangePct?: number | null };
    const s = report.dataSnapshot ? (JSON.parse(report.dataSnapshot) as { summary?: SnapshotSummary; monthly?: MonthRow[]; topEmitters?: EmitterRow[]; goals?: GoalRow[] }) : {};
    const summary = s.summary || {};
    const monthly = s.monthly || [];
    const topEmitters = s.topEmitters || [];
    const goals = s.goals || [];

    const fmt = (n: number | undefined | null, dp = 1) =>
      typeof n === "number" ? n.toLocaleString("en-NZ", { maximumFractionDigits: dp }) : "—";
    const fmtT = (kg: number | undefined | null) => typeof kg === "number" ? (kg / 1000).toLocaleString("en-NZ", { maximumFractionDigits: 2 }) : "—";

    const periodFrom = report.periodStart ? new Date(report.periodStart).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "";
    const periodTo   = report.periodEnd   ? new Date(report.periodEnd).toLocaleDateString("en-NZ",   { day: "numeric", month: "short", year: "numeric" }) : "";

    const yoy = summary.yoyChangePct;
    const yoySign = yoy != null ? (yoy < 0 ? "▼" : yoy > 0 ? "▲" : "●") : null;
    const yoyColor = yoy != null ? (yoy < 0 ? "#15803d" : yoy > 0 ? "#b91c1c" : "#6b7280") : "#6b7280";
    const yoyLabel = yoy != null ? `${yoySign} ${Math.abs(yoy).toFixed(1)}% vs prior year` : "No prior year data";

    const fleetPct = summary.totalCo2eKg ? Math.round(((summary.fleetCo2eKg || 0) / summary.totalCo2eKg) * 100) : 0;
    const energyPct = 100 - fleetPct;

    const goalsHtml = goals.length
      ? goals.map(g => {
          const bg = g.status === "on_track" ? "#d1fae5" : g.status === "behind" ? "#fee2e2" : "#fef3c7";
          const col = g.status === "on_track" ? "#065f46" : g.status === "behind" ? "#991b1b" : "#92400e";
          return `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${esc(g.title)}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${g.targetValue != null ? esc(String(g.targetValue)) : "—"} ${esc(g.targetUnit || "")}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;"><span style="background:${bg};color:${col};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">${esc(g.status.replace(/_/g, " "))}</span></td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af;">No goals defined</td></tr>`;

    const monthlyHtml = monthly.length
      ? monthly.map(m => {
          const total = m.fleetCo2e + m.energyCo2e;
          const label = (() => { const [y, mo] = m.month.split("-"); return new Date(+y, +mo - 1, 1).toLocaleDateString("en-NZ", { month: "short", year: "numeric" }); })();
          return `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;">${esc(label)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(m.fleetKm, 0)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(m.fleetCo2e, 0)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(m.energyKwh, 0)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(m.energyCo2e, 0)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">${fmt(total, 0)}</td>
          </tr>`;
        }).join("")
      : `<tr><td colspan="6" style="padding:12px;text-align:center;color:#9ca3af;">No monthly data available</td></tr>`;

    const emittersHtml = topEmitters.length
      ? topEmitters.map((e, i) => `<tr>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#6b7280;">${i + 1}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-weight:700;">${esc(e.name)}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;color:#6b7280;">${esc([e.make, e.model].filter(Boolean).join(" "))}</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;">${fmt(e.km, 0)} km</td>
            <td style="padding:7px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">${fmt(e.co2e, 0)} kg</td>
          </tr>`).join("")
      : `<tr><td colspan="5" style="padding:12px;text-align:center;color:#9ca3af;">No fleet data</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(report.title)} — EnviroIQ Board Report</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  @media print { body { margin: 0; padding: 0; } .no-print { display: none !important; } }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 32px 40px; color: #111827; background: #fff; font-size: 13px; }
  .no-print { position: fixed; top: 16px; right: 16px; background: #16a34a; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #16a34a; padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-size: 13px; font-weight: 700; color: #16a34a; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  h1 { font-size: 24px; font-weight: 800; margin: 0 0 4px; color: #111827; }
  .period-tag { font-size: 12px; color: #6b7280; }
  .header-right { text-align: right; font-size: 11px; color: #9ca3af; line-height: 1.7; }
  /* KPI row */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; }
  .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9ca3af; margin-bottom: 6px; }
  .kpi-value { font-size: 26px; font-weight: 800; color: #16a34a; line-height: 1; }
  .kpi-unit { font-size: 12px; font-weight: 400; color: #9ca3af; }
  .kpi-sub { font-size: 11px; margin-top: 4px; }
  .kpi-yoy { font-weight: 700; }
  /* Scope bar */
  .scope-row { display: flex; gap: 12px; margin-bottom: 20px; }
  .scope-card { flex: 1; border-radius: 10px; padding: 14px 16px; }
  .scope-1 { background: #eff6ff; border: 1px solid #bfdbfe; }
  .scope-2 { background: #f0fdf4; border: 1px solid #bbf7d0; }
  .scope-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin-bottom: 4px; }
  .scope-value { font-size: 20px; font-weight: 800; margin-bottom: 2px; }
  .scope-1 .scope-value { color: #1d4ed8; }
  .scope-2 .scope-value { color: #15803d; }
  .scope-bar { height: 6px; border-radius: 3px; background: #e5e7eb; margin-top: 8px; overflow: hidden; }
  .scope-bar-fill { height: 100%; border-radius: 3px; }
  /* Tables */
  h2 { font-size: 14px; font-weight: 700; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; margin: 24px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f9fafb; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; border-bottom: 2px solid #e5e7eb; }
  th.r { text-align: right; }
  /* Footer */
  .footer { margin-top: 32px; font-size: 10px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 10px; line-height: 1.7; }
  .methodology { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-top: 20px; font-size: 11px; color: #6b7280; line-height: 1.6; }
  .methodology strong { color: #374151; }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">⬇ Save as PDF</button>

<div class="header">
  <div>
    <div class="brand">EnviroIQ ESG Platform</div>
    <h1>${esc(report.title)}</h1>
    <div class="period-tag">Period: ${esc(periodFrom)} – ${esc(periodTo)} &nbsp;·&nbsp; ${esc(report.reportType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()))}</div>
  </div>
  <div class="header-right">
    Generated: ${new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}<br>
    Report ID: ${report.id.substring(0, 8).toUpperCase()}<br>
    Methodology: NZ MfE 2024
  </div>
</div>

<!-- KPI Cards -->
<div class="kpis">
  <div class="kpi">
    <div class="kpi-label">Total GHG Emissions</div>
    <div class="kpi-value">${fmtT(summary.totalCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
    <div class="kpi-sub kpi-yoy" style="color:${yoyColor};">${yoyLabel}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Scope 1 — Fleet</div>
    <div class="kpi-value">${fmtT(summary.fleetCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
    <div class="kpi-sub" style="color:#6b7280;">${fmt(summary.fleetKm, 0)} km driven</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Scope 2 — Energy</div>
    <div class="kpi-value">${fmtT(summary.energyCo2eKg)}<span class="kpi-unit"> tCO₂e</span></div>
    <div class="kpi-sub" style="color:#6b7280;">${fmt(summary.totalEnergyKwh, 0)} kWh consumed</div>
  </div>
  <div class="kpi" style="background:#f0fdf4;border-color:#86efac;">
    <div class="kpi-label">ESG Score</div>
    <div class="kpi-value" style="color:#15803d;">${summary.sustainabilityScore ?? "—"}<span class="kpi-unit">/100</span></div>
    <div class="kpi-sub" style="color:#6b7280;">Composite sustainability index</div>
  </div>
</div>

<!-- Scope split -->
<div class="scope-row">
  <div class="scope-card scope-1">
    <div class="scope-label">Scope 1 — Direct (Fleet Combustion)</div>
    <div class="scope-value">${fmtT(summary.fleetCo2eKg)} tCO₂e</div>
    <div style="font-size:11px;color:#1d4ed8;">${fleetPct}% of total emissions</div>
    <div class="scope-bar"><div class="scope-bar-fill" style="width:${fleetPct}%;background:#3b82f6;"></div></div>
  </div>
  <div class="scope-card scope-2">
    <div class="scope-label">Scope 2 — Indirect (Electricity &amp; Gas)</div>
    <div class="scope-value">${fmtT(summary.energyCo2eKg)} tCO₂e</div>
    <div style="font-size:11px;color:#15803d;">${energyPct}% of total emissions</div>
    <div class="scope-bar"><div class="scope-bar-fill" style="width:${energyPct}%;background:#22c55e;"></div></div>
  </div>
  ${summary.priorYearCo2eKg != null && summary.priorYearCo2eKg > 0 ? `
  <div class="scope-card" style="background:#fafaf9;border:1px solid #e7e5e4;flex:0.6;">
    <div class="scope-label">Prior Year (same period)</div>
    <div class="scope-value" style="color:#78716c;">${fmtT(summary.priorYearCo2eKg)} tCO₂e</div>
    <div style="font-size:11px;color:${yoyColor};font-weight:700;">${yoyLabel}</div>
    <div style="font-size:11px;color:#9ca3af;margin-top:2px;">${fmt(summary.priorYearFleetKm, 0)} km prior year</div>
  </div>` : ""}
</div>

<!-- Monthly breakdown -->
<h2>Monthly Emissions Breakdown</h2>
<table>
  <thead><tr>
    <th>Month</th>
    <th class="r">Fleet km</th>
    <th class="r">Fleet CO₂e (kg)</th>
    <th class="r">Energy kWh</th>
    <th class="r">Energy CO₂e (kg)</th>
    <th class="r">Total CO₂e (kg)</th>
  </tr></thead>
  <tbody>${monthlyHtml}</tbody>
</table>

<!-- Top fleet emitters -->
<h2>Top Fleet Emitters (Scope 1)</h2>
<table>
  <thead><tr><th>#</th><th>Vehicle</th><th>Make / Model</th><th class="r">Distance</th><th class="r">CO₂e</th></tr></thead>
  <tbody>${emittersHtml}</tbody>
</table>

<!-- Goals -->
<h2>Sustainability Goals</h2>
<table>
  <thead><tr><th>Goal</th><th>Target</th><th>Status</th></tr></thead>
  <tbody>${goalsHtml}</tbody>
</table>

<!-- Methodology -->
<div class="methodology">
  <strong>Measurement Methodology &amp; Standards</strong><br>
  Scope 1 (fleet) emissions calculated using NZ Ministry for the Environment <em>Measuring Emissions: A Guide for Organisations</em> (2024 edition) vehicle-class emission factors.
  Light commercial diesel (Hilux, Hiace class): 0.214 kg CO₂e/km · Medium truck (Isuzu NPR, Hino Dutro, Fuso Canter): 0.340 kg CO₂e/km · Petrol light vehicle: 0.196 kg CO₂e/km · Hybrid: 0.104 kg CO₂e/km · PHEV: 0.067 kg CO₂e/km.
  Where fuel-card litres are available, actual consumption is used (diesel: 2.68 kg CO₂e/litre, petrol: 2.31 kg CO₂e/litre).
  Scope 2 (electricity) emissions use NZ real-time grid intensity data sourced from Electricity Authority em6 API where available, otherwise NZ national annual average (0.098 kg CO₂e/kWh per MfE 2024).
  Gas emissions use MfE natural gas factor (2.05 kg CO₂e/kWh). This report is prepared consistent with GHG Protocol Corporate Standard and is aligned to Toitū Envirocare CEMARS disclosure requirements.
</div>

<div class="footer">
  This report was prepared by EnviroIQ ESG Platform (enviroiq.net) &nbsp;·&nbsp; Generated ${new Date().toLocaleString("en-NZ")} &nbsp;·&nbsp; Report ID: ${report.id.substring(0, 8).toUpperCase()}<br>
  Reporting period: ${esc(periodFrom)} – ${esc(periodTo)} &nbsp;·&nbsp; Emission factors: NZ MfE Measuring Emissions Guide 2024 &nbsp;·&nbsp; Consistent with GHG Protocol Corporate Standard
</div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${report.title.replace(/[^a-z0-9]/gi, "_")}.html"`);
    res.send(html);
  } catch (err) {
    req.log.error({ err }, "Download report failed");
    res.status(500).send("Failed to generate report");
  }
});

// DELETE /organisations/:orgId/reports/:reportId
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
    await logAudit({ req, action: "report.delete", resourceType: "report", resourceId: reportId });
    res.json({ message: "Report deleted" });
  } catch (err) {
    req.log.error({ err }, "Delete report failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete report" });
  }
});

export default router;
