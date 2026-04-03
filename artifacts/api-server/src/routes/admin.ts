import { Router } from "express";
import { db, organisationsTable, usersTable, vehiclesTable, auditLogsTable, fleetEventsTable, energyReadingsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { requireRole } from "../lib/auth.js";
import { sqlRow, sqlRows, numCol, intCol, strCol } from "../lib/sql-result.js";
import { calcFleetCo2e, calcEnergyCo2e, resolveElectricityFactor } from "../lib/emissions.js";
import { logAudit } from "../lib/audit.js";

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

    const fc = parseFloat(String(sqlRow(fleetCo2eResult).total ?? 0)) || 0;
    const ec = parseFloat(String(sqlRow(energyCo2eResult).total ?? 0)) || 0;

    res.json({
      totalOrganisations: parseInt(String(totalOrgs)) || 0,
      activeOrganisations: parseInt(String(activeOrgs)) || 0,
      totalUsers: parseInt(String(totalUsers)) || 0,
      totalVehicles: parseInt(String(totalVehicles)) || 0,
      totalCo2eKgThisMonth: fc + ec,
      totalEnergyKwhThisMonth: 0,
      recentActivity,
    });
  } catch (err) {
    req.log.error({ err }, "Get admin stats failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get admin stats" });
  }
});

// POST /admin/organisations/:orgId/recalculate-emissions
// Re-runs current emission factor logic against all stored fleet events for an org.
// Use after updating vehicle make/model/fuelType or after improving the emission factor logic.
router.post("/organisations/:orgId/recalculate-emissions", requireRole("super_admin"), async (req, res) => {
  const { orgId } = req.params as { orgId: string };
  try {
    // Load all vehicles for this org → lookup map by id
    const vehicles = await db.query.vehiclesTable.findMany({
      where: eq(vehiclesTable.organisationId, orgId),
    });
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

    // Load all fleet events for this org
    const events = await db.query.fleetEventsTable.findMany({
      where: eq(fleetEventsTable.organisationId, orgId),
    });

    if (events.length === 0) {
      res.json({ updated: 0, skipped: 0, errors: 0, message: "No fleet events found for this organisation." });
      return;
    }

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches of 200 to avoid long transactions
    const BATCH = 200;
    for (let i = 0; i < events.length; i += BATCH) {
      const batch = events.slice(i, i + BATCH);
      await Promise.all(batch.map(async (event) => {
        try {
          const vehicle = vehicleMap.get(event.vehicleId);
          if (!vehicle) { skipped++; return; }

          const newCo2eKg = calcFleetCo2e({
            fuelType: vehicle.fuelType,
            distanceKm: event.distanceKm ?? undefined,
            fuelLitres: event.fuelLitres ?? undefined,
            emissionFactorKgPerKm: vehicle.emissionFactorKgPerKm ?? undefined,
            make: vehicle.make ?? undefined,
            model: vehicle.model ?? undefined,
          });

          // Only update if value has changed (avoids unnecessary writes)
          const oldVal = event.co2eKg ?? 0;
          if (Math.abs(newCo2eKg - oldVal) < 0.001) { skipped++; return; }

          await db.update(fleetEventsTable)
            .set({ co2eKg: newCo2eKg })
            .where(eq(fleetEventsTable.id, event.id));

          updated++;
        } catch {
          errors++;
        }
      }));
    }

    // Also recalculate energy readings using current factor logic
    const energyReadings = await db.query.energyReadingsTable.findMany({
      where: eq(energyReadingsTable.organisationId, orgId),
    });

    let energyUpdated = 0;
    let energySkipped = 0;

    const EBATCH = 100;
    for (let i = 0; i < energyReadings.length; i += EBATCH) {
      const batch = energyReadings.slice(i, i + EBATCH);
      await Promise.all(batch.map(async (reading) => {
        try {
          const { factorKgCo2PerKwh, method, note } = resolveElectricityFactor({
            periodStart: reading.periodStart,
            supplierRenewablePct: reading.supplierRenewablePct !== null ? Number(reading.supplierRenewablePct) : undefined,
          });
          const newCo2eKg = calcEnergyCo2e({
            utilityType: reading.utilityType,
            usageKwh: reading.usageKwh !== null ? Number(reading.usageKwh) : undefined,
            usageMj: reading.usageMj !== null ? Number(reading.usageMj) : undefined,
            electricityFactorKgCo2PerKwh: factorKgCo2PerKwh,
          });
          const oldVal = reading.co2eKg !== null ? Number(reading.co2eKg) : 0;
          if (Math.abs(newCo2eKg - oldVal) < 0.001) { energySkipped++; return; }
          await db.update(energyReadingsTable)
            .set({ co2eKg: newCo2eKg, gridIntensityKgCo2PerKwh: reading.utilityType === "electricity" ? factorKgCo2PerKwh : undefined, emissionMethod: reading.utilityType === "electricity" ? method : undefined, emissionNote: reading.utilityType === "electricity" ? note : undefined })
            .where(eq(energyReadingsTable.id, reading.id));
          energyUpdated++;
        } catch {
          errors++;
        }
      }));
    }

    await logAudit({
      req,
      action: "admin.recalculate_emissions",
      resourceType: "organisation",
      resourceId: orgId,
      outcome: "success",
      details: { updated, skipped, errors, totalEvents: events.length, energyUpdated, energySkipped, totalEnergyReadings: energyReadings.length },
      organisationId: orgId,
    });

    res.json({ updated, skipped, errors, totalEvents: events.length, energyUpdated, energySkipped, totalEnergyReadings: energyReadings.length });
  } catch (err) {
    req.log.error({ err }, "Recalculate emissions failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to recalculate emissions" });
  }
});

export default router;
