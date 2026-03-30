import { Router } from "express";
import { db, reportsTable, goalsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { logAudit } from "../lib/audit.js";
import { calcSustainabilityScore } from "../lib/emissions.js";

const router = Router({ mergeParams: true });

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
        const to = new Date(periodEnd);

        const [fleetResult, energyResult] = await Promise.all([
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(distance_km),0) as dist FROM fleet_events WHERE organisation_id = ${orgId} AND recorded_at >= ${from} AND recorded_at <= ${to}`),
          db.execute(sql`SELECT COALESCE(SUM(co2e_kg),0) as co2e, COALESCE(SUM(usage_kwh),0) as kwh FROM energy_readings WHERE organisation_id = ${orgId} AND period_start >= ${from} AND period_end <= ${to}`),
        ]);

        const fr = sqlRow(fleetResult);
        const er = sqlRow(energyResult);
        const goals = await db.query.goalsTable.findMany({ where: eq(goalsTable.organisationId, orgId) });

        const fleetCo2e = numCol(fr, "co2e");
        const energyCo2e = numCol(er, "co2e");
        const fleetDist = numCol(fr, "dist");
        const goalsOnTrack = goals.filter((g) => g.status === "on_track").length;

        const score = calcSustainabilityScore({
          totalCo2eKg: fleetCo2e + energyCo2e,
          fleetDistanceKm: fleetDist,
          goalsOnTrack,
          totalGoals: goals.length,
        });

        const snapshot = {
          summary: {
            totalCo2eKg: fleetCo2e + energyCo2e,
            fleetCo2eKg: fleetCo2e,
            energyCo2eKg: energyCo2e,
            totalEnergyKwh: numCol(er, "kwh"),
            sustainabilityScore: score,
          },
          goals: goals.map((g) => ({ title: g.title, status: g.status, targetValue: g.targetValue, targetUnit: g.targetUnit })),
          highlights: [
            `Total CO2e emissions: ${(fleetCo2e + energyCo2e).toFixed(1)} kg`,
            `Sustainability score: ${score}/100`,
            `Goals on track: ${goalsOnTrack}/${goals.length}`,
          ],
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

    const s = report.dataSnapshot ? (JSON.parse(report.dataSnapshot) as {
      summary?: { totalCo2eKg?: number; fleetCo2eKg?: number; energyCo2eKg?: number; totalEnergyKwh?: number; sustainabilityScore?: number };
      goals?: Array<{ title: string; status: string; targetValue: number | null; targetUnit: string | null }>;
      highlights?: string[];
    }) : {};
    const summary = s.summary || {};
    const goals = s.goals || [];
    const highlights = s.highlights || [];

    const fmt = (n: number | undefined, dp = 1) =>
      typeof n === "number" ? n.toLocaleString("en-NZ", { maximumFractionDigits: dp }) : "—";

    const goalsHtml = goals.length
      ? goals.map((g) => `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${g.title}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${g.targetValue != null ? g.targetValue : "—"} ${g.targetUnit || ""}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
            <span style="background:${g.status === "on_track" ? "#d1fae5" : g.status === "behind" ? "#fee2e2" : "#fef3c7"};color:${g.status === "on_track" ? "#065f46" : g.status === "behind" ? "#991b1b" : "#92400e"};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">${g.status.replace("_", " ")}</span>
          </td>
        </tr>`).join("")
      : `<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af;">No goals defined</td></tr>`;

    const highlightsHtml = highlights.map((h) => `<li style="margin-bottom:6px;">${h}</li>`).join("");

    const periodFrom = report.periodStart ? new Date(report.periodStart).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "";
    const periodTo = report.periodEnd ? new Date(report.periodEnd).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${report.title} — EnviroIQ ESG Report</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none; } }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 40px; color: #111827; background: #fff; }
  h1 { font-size: 28px; font-weight: 800; margin: 0; color: #111827; }
  .brand { color: #16a34a; font-weight: 700; font-size: 18px; }
  .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #16a34a; padding-bottom: 20px; margin-bottom: 32px; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .metric { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; }
  .metric-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; margin-bottom: 8px; }
  .metric-value { font-size: 32px; font-weight: 800; color: #16a34a; }
  .metric-unit { font-size: 14px; font-weight: 400; color: #9ca3af; }
  .score { background: #f0fdf4; border: 1px solid #86efac; }
  .score .metric-value { color: #15803d; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { background: #f9fafb; text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
  h2 { font-size: 17px; font-weight: 700; color: #111827; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 32px; margin-bottom: 12px; }
  ul { margin: 0; padding-left: 20px; color: #374151; }
  .print-btn { position: fixed; top: 20px; right: 20px; background: #16a34a; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .footer { margin-top: 40px; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 12px; }
</style>
</head>
<body>
<button class="no-print print-btn" onclick="window.print()">⬇ Download PDF</button>
<div class="header">
  <div>
    <div class="brand">EnviroIQ</div>
    <h1>${report.title}</h1>
    <div style="font-size:13px;color:#6b7280;margin-top:6px;">Period: ${periodFrom} — ${periodTo} · Type: ${report.reportType.replace(/_/g, " ")}</div>
  </div>
  <div style="text-align:right;font-size:12px;color:#6b7280;">Generated: ${new Date().toLocaleDateString("en-NZ")}<br>Report ID: ${report.id.substring(0, 8).toUpperCase()}</div>
</div>

<div class="metrics">
  <div class="metric">
    <div class="metric-label">Total CO₂e</div>
    <div class="metric-value">${fmt((summary.totalCo2eKg || 0) / 1000)}<span class="metric-unit"> t</span></div>
  </div>
  <div class="metric">
    <div class="metric-label">Fleet Emissions</div>
    <div class="metric-value">${fmt((summary.fleetCo2eKg || 0) / 1000)}<span class="metric-unit"> t</span></div>
  </div>
  <div class="metric">
    <div class="metric-label">Energy Emissions</div>
    <div class="metric-value">${fmt((summary.energyCo2eKg || 0) / 1000)}<span class="metric-unit"> t</span></div>
  </div>
  <div class="metric">
    <div class="metric-label">Energy Usage</div>
    <div class="metric-value">${fmt(summary.totalEnergyKwh)}<span class="metric-unit"> kWh</span></div>
  </div>
  <div class="metric score">
    <div class="metric-label">Sustainability Score</div>
    <div class="metric-value">${summary.sustainabilityScore ?? "—"}<span class="metric-unit">/100</span></div>
  </div>
</div>

<h2>Key Highlights</h2>
${highlights.length ? `<ul>${highlightsHtml}</ul>` : `<p style="color:#9ca3af;">No highlights available.</p>`}

<h2>Sustainability Goals</h2>
<table>
  <thead><tr><th>Goal</th><th>Target</th><th>Status</th></tr></thead>
  <tbody>${goalsHtml}</tbody>
</table>

<div class="footer">
  This report was generated by EnviroIQ ESG Platform · ${new Date().toISOString().split("T")[0]}
  · Report covers the period ${periodFrom} to ${periodTo}.
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
