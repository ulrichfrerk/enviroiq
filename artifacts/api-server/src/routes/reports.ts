import { Router } from "express";
import { db, reportsTable, goalsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcSustainabilityScore } from "../lib/emissions.js";

const router = Router({ mergeParams: true });

// GET /organisations/:orgId/reports
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const { orgId } = req.params;
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
router.post("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const { orgId } = req.params;
    const session = (req as any).session;
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

        const fr = (fleetResult as any).rows?.[0] || (fleetResult as any)[0] || {};
        const er = (energyResult as any).rows?.[0] || (energyResult as any)[0] || {};
        const goals = await db.query.goalsTable.findMany({ where: eq(goalsTable.organisationId, orgId) });

        const fleetCo2e = parseFloat(fr.co2e) || 0;
        const energyCo2e = parseFloat(er.co2e) || 0;
        const fleetDist = parseFloat(fr.dist) || 0;
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
            totalEnergyKwh: parseFloat(er.kwh) || 0,
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
    const { orgId, reportId } = req.params;
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

export default router;
