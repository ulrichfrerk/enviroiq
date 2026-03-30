import { Router } from "express";
import { db, organisationsTable, usersTable, vehiclesTable, auditLogsTable } from "@workspace/db";
import { count, sql } from "drizzle-orm";
import { requireRole } from "../lib/auth.js";

const router = Router();

// GET /admin/stats
router.get("/stats", requireRole("super_admin"), async (req, res) => {
  try {
    const [
      [{ totalOrgs }],
      [{ activeOrgs }],
      [{ totalUsers }],
      [{ totalVehicles }],
      fleetCo2eResult,
      energyCo2eResult,
      recentActivity,
    ] = await Promise.all([
      db.select({ totalOrgs: count() }).from(organisationsTable),
      db.select({ activeOrgs: count() }).from(organisationsTable).where(sql`is_active = true`),
      db.select({ totalUsers: count() }).from(usersTable),
      db.select({ totalVehicles: count() }).from(vehiclesTable),
      db.execute(sql`
        SELECT COALESCE(SUM(co2e_kg), 0) as total
        FROM fleet_events
        WHERE recorded_at >= DATE_TRUNC('month', NOW())
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(co2e_kg), 0) as total
        FROM energy_readings
        WHERE period_start >= DATE_TRUNC('month', NOW())
      `),
      db.select().from(auditLogsTable).orderBy(sql`created_at DESC`).limit(10),
    ]);

    const fc = (fleetCo2eResult as any).rows?.[0]?.total || (fleetCo2eResult as any)[0]?.total || 0;
    const ec = (energyCo2eResult as any).rows?.[0]?.total || (energyCo2eResult as any)[0]?.total || 0;

    res.json({
      totalOrganisations: parseInt(String(totalOrgs)) || 0,
      activeOrganisations: parseInt(String(activeOrgs)) || 0,
      totalUsers: parseInt(String(totalUsers)) || 0,
      totalVehicles: parseInt(String(totalVehicles)) || 0,
      totalCo2eKgThisMonth: parseFloat(fc) + parseFloat(ec),
      totalEnergyKwhThisMonth: 0,
      recentActivity,
    });
  } catch (err) {
    req.log.error({ err }, "Get admin stats failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get admin stats" });
  }
});

export default router;
