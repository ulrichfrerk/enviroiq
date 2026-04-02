import { Router } from "express";
import { db, vehiclesTable, fleetEventsTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcFleetCo2e } from "../lib/emissions.js";

const router = Router({ mergeParams: true });
const webhookRouter = Router();

// ─── Vehicles ───────────────────────────────────────────────────────────────

// GET /organisations/:orgId/fleet/vehicles
router.get("/vehicles", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const vehicles = await db.query.vehiclesTable.findMany({
      where: eq(vehiclesTable.organisationId, orgId),
    });
    const [{ total }] = await db.select({ total: count() }).from(vehiclesTable)
      .where(eq(vehiclesTable.organisationId, orgId));
    res.json({ items: vehicles, total });
  } catch (err) {
    req.log.error({ err }, "List vehicles failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list vehicles" });
  }
});

// POST /organisations/:orgId/fleet/vehicles
router.post("/vehicles", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { name, registration, make, model, year, fuelType, emissionFactorKgPerKm, gpsProvider, gpsDeviceId } = req.body;
    if (!name || !fuelType) {
      res.status(400).json({ error: "Bad Request", message: "name, fuelType required" });
      return;
    }
    const [vehicle] = await db.insert(vehiclesTable).values({
      id: uuidv4(),
      organisationId: orgId,
      name,
      registration,
      make,
      model,
      year,
      fuelType,
      emissionFactorKgPerKm,
      gpsProvider: gpsProvider || "none",
      gpsDeviceId,
    }).returning();
    await logAudit({ req, action: "vehicle.create", resourceType: "vehicle", resourceId: vehicle.id });
    res.status(201).json(vehicle);
  } catch (err) {
    req.log.error({ err }, "Create vehicle failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create vehicle" });
  }
});

// GET /organisations/:orgId/fleet/vehicles/:vehicleId
router.get("/vehicles/:vehicleId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const vehicle = await db.query.vehiclesTable.findFirst({
      where: and(
        eq(vehiclesTable.id, req.params.vehicleId as string),
        eq(vehiclesTable.organisationId, req.params.orgId as string),
      ),
    });
    if (!vehicle) {
      res.status(404).json({ error: "Not Found", message: "Vehicle not found" });
      return;
    }
    res.json(vehicle);
  } catch (err) {
    req.log.error({ err }, "Get vehicle failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get vehicle" });
  }
});

// PATCH /organisations/:orgId/fleet/vehicles/:vehicleId
router.patch("/vehicles/:vehicleId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const { name, registration, make, model, year, fuelType, emissionFactorKgPerKm, gpsProvider, gpsDeviceId, isActive } = req.body;
    const [vehicle] = await db
      .update(vehiclesTable)
      .set({ name, registration, make, model, year, fuelType, emissionFactorKgPerKm, gpsProvider, gpsDeviceId, isActive, updatedAt: new Date() })
      .where(and(eq(vehiclesTable.id, req.params.vehicleId as string), eq(vehiclesTable.organisationId, req.params.orgId as string)))
      .returning();
    if (!vehicle) {
      res.status(404).json({ error: "Not Found", message: "Vehicle not found" });
      return;
    }
    await logAudit({ req, action: "vehicle.update", resourceType: "vehicle", resourceId: req.params.vehicleId as string });
    res.json(vehicle);
  } catch (err) {
    req.log.error({ err }, "Update vehicle failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update vehicle" });
  }
});

// DELETE /organisations/:orgId/fleet/vehicles/:vehicleId
router.delete("/vehicles/:vehicleId", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    await db.delete(vehiclesTable).where(
      and(eq(vehiclesTable.id, req.params.vehicleId as string), eq(vehiclesTable.organisationId, req.params.orgId as string)),
    );
    await logAudit({ req, action: "vehicle.delete", resourceType: "vehicle", resourceId: req.params.vehicleId as string });
    res.json({ message: "Vehicle removed" });
  } catch (err) {
    req.log.error({ err }, "Delete vehicle failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete vehicle" });
  }
});

// GET /organisations/:orgId/fleet/events
router.get("/events", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { vehicleId, from, to } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const conditions = [eq(fleetEventsTable.organisationId, orgId)];
    if (vehicleId) conditions.push(eq(fleetEventsTable.vehicleId, vehicleId as string));
    if (from) conditions.push(gte(fleetEventsTable.recordedAt, new Date(from as string)));
    if (to) conditions.push(lte(fleetEventsTable.recordedAt, new Date(to as string)));

    const [items, [{ total }]] = await Promise.all([
      db.select({
        id: fleetEventsTable.id,
        organisationId: fleetEventsTable.organisationId,
        vehicleId: fleetEventsTable.vehicleId,
        vehicleName: vehiclesTable.name,
        eventType: fleetEventsTable.eventType,
        latitude: fleetEventsTable.latitude,
        longitude: fleetEventsTable.longitude,
        speedKmh: fleetEventsTable.speedKmh,
        distanceKm: fleetEventsTable.distanceKm,
        fuelLitres: fleetEventsTable.fuelLitres,
        co2eKg: fleetEventsTable.co2eKg,
        source: fleetEventsTable.source,
        recordedAt: fleetEventsTable.recordedAt,
        createdAt: fleetEventsTable.createdAt,
      })
        .from(fleetEventsTable)
        .leftJoin(vehiclesTable, eq(fleetEventsTable.vehicleId, vehiclesTable.id))
        .where(and(...conditions))
        .orderBy(sql`${fleetEventsTable.recordedAt} DESC`)
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(fleetEventsTable).where(and(...conditions)),
    ]);

    res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "List fleet events failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list fleet events" });
  }
});

// ─── Webhooks (authenticated via per-org webhook secret) ─────────────────────

async function validateWebhookSecret(secret: string): Promise<typeof organisationsTable.$inferSelect | null> {
  if (!secret || secret.trim().length < 8) return null;
  const org = await db.query.organisationsTable.findFirst({
    where: eq(organisationsTable.webhookSecret, secret),
  });
  return org ?? null;
}

async function findVehicleByDeviceId(deviceId: string, orgId?: string) {
  if (orgId) {
    return db.query.vehiclesTable.findFirst({
      where: and(eq(vehiclesTable.gpsDeviceId, deviceId), eq(vehiclesTable.organisationId, orgId)),
    });
  }
  return db.query.vehiclesTable.findFirst({
    where: eq(vehiclesTable.gpsDeviceId, deviceId),
  });
}

async function insertFleetEvent(data: {
  vehicleId: string;
  organisationId: string;
  eventType: string;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  distanceKm?: number;
  fuelLitres?: number;
  source: string;
  recordedAt: Date;
  rawPayload: string;
  fuelType?: string;
  emissionFactor?: number;
}) {
  const co2eKg = calcFleetCo2e({
    fuelType: data.fuelType || "petrol",
    distanceKm: data.distanceKm,
    fuelLitres: data.fuelLitres,
    emissionFactorKgPerKm: data.emissionFactor,
  });

  await db.insert(fleetEventsTable).values({
    id: uuidv4(),
    vehicleId: data.vehicleId,
    organisationId: data.organisationId,
    eventType: data.eventType,
    latitude: data.latitude,
    longitude: data.longitude,
    speedKmh: data.speedKmh,
    distanceKm: data.distanceKm,
    fuelLitres: data.fuelLitres,
    co2eKg,
    source: data.source,
    rawPayload: data.rawPayload,
    recordedAt: data.recordedAt,
  });
}

// POST /webhooks/fleet/navman
webhookRouter.post("/navman", async (req, res) => {
  try {
    const { deviceId, eventType, latitude, longitude, speed, odometer, timestamp, apiKey } = req.body;
    const org = await validateWebhookSecret(apiKey);
    if (!org) {
      await logAudit({ req, action: "webhook.fleet.navman", outcome: "failure", details: { reason: "invalid_api_key", deviceId } });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(deviceId, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.navman", outcome: "failure", details: { reason: "device_not_registered", deviceId }, organisationId: org.id });
      res.json({ message: "Device not registered, event ignored" });
      return;
    }

    await insertFleetEvent({
      vehicleId: vehicle.id,
      organisationId: vehicle.organisationId,
      eventType: eventType || "position",
      latitude,
      longitude,
      speedKmh: speed,
      source: "navman",
      recordedAt: new Date(timestamp),
      rawPayload: JSON.stringify(req.body),
      fuelType: vehicle.fuelType,
      emissionFactor: vehicle.emissionFactorKgPerKm || undefined,
    });

    await logAudit({ req, action: "webhook.fleet.navman", outcome: "success", resourceType: "fleet_event", details: { deviceId, vehicleId: vehicle.id, provider: "navman" }, organisationId: org.id });
    res.json({ message: "Event recorded" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to process event" });
  }
});

// POST /webhooks/fleet/blackhawk
webhookRouter.post("/blackhawk", async (req, res) => {
  try {
    const { unit_id, event, lat, lng, spd, dist, ts, token } = req.body;
    const org = await validateWebhookSecret(token);
    if (!org) {
      await logAudit({ req, action: "webhook.fleet.blackhawk", outcome: "failure", details: { reason: "invalid_token", deviceId: unit_id } });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing token" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(unit_id, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.blackhawk", outcome: "failure", details: { reason: "device_not_registered", deviceId: unit_id }, organisationId: org.id });
      res.json({ message: "Device not registered, event ignored" });
      return;
    }

    await insertFleetEvent({
      vehicleId: vehicle.id,
      organisationId: vehicle.organisationId,
      eventType: event || "position",
      latitude: lat,
      longitude: lng,
      speedKmh: spd,
      distanceKm: dist,
      source: "blackhawk",
      recordedAt: new Date(ts),
      rawPayload: JSON.stringify(req.body),
      fuelType: vehicle.fuelType,
      emissionFactor: vehicle.emissionFactorKgPerKm || undefined,
    });

    await logAudit({ req, action: "webhook.fleet.blackhawk", outcome: "success", resourceType: "fleet_event", details: { deviceId: unit_id, vehicleId: vehicle.id, provider: "blackhawk" }, organisationId: org.id });
    res.json({ message: "Event recorded" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to process event" });
  }
});

// POST /webhooks/fleet/generic
webhookRouter.post("/generic", async (req, res) => {
  try {
    const { deviceId, eventType, latitude, longitude, speedKmh, distanceKm, fuelLitres, timestamp, apiKey } = req.body;
    const org = await validateWebhookSecret(apiKey);
    if (!org) {
      await logAudit({ req, action: "webhook.fleet.generic", outcome: "failure", details: { reason: "invalid_api_key", deviceId } });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(deviceId, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.generic", outcome: "failure", details: { reason: "device_not_registered", deviceId }, organisationId: org.id });
      res.json({ message: "Device not registered, event ignored" });
      return;
    }

    await insertFleetEvent({
      vehicleId: vehicle.id,
      organisationId: vehicle.organisationId,
      eventType: eventType || "position",
      latitude,
      longitude,
      speedKmh,
      distanceKm,
      fuelLitres,
      source: "generic",
      recordedAt: new Date(timestamp),
      rawPayload: JSON.stringify(req.body),
      fuelType: vehicle.fuelType,
      emissionFactor: vehicle.emissionFactorKgPerKm || undefined,
    });

    await logAudit({ req, action: "webhook.fleet.generic", outcome: "success", resourceType: "fleet_event", details: { deviceId, vehicleId: vehicle.id, provider: "generic" }, organisationId: org.id });
    res.json({ message: "Event recorded" });
  } catch (err) {
    res.status(500).json({ error: "Internal Server Error", message: "Failed to process event" });
  }
});

// POST /organisations/:orgId/fleet/import-km
// Accepts an array of {vehicle, date, distanceKm, fuelLitres?} rows,
// matches vehicles by name or registration, and inserts fleet events.
router.post("/import-km", requireAuth, requireOrgAdmin, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { rows } = req.body as {
      rows: Array<{ vehicle: string; date: string; distanceKm: number | string; fuelLitres?: number | string }>;
    };

    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Bad Request", message: "rows array is required and must not be empty" });
      return;
    }
    if (rows.length > 20000) {
      res.status(400).json({ error: "Bad Request", message: "Maximum 20,000 rows per import" });
      return;
    }

    // Load all vehicles for this org and build lookup maps
    const orgVehicles = await db.query.vehiclesTable.findMany({
      where: eq(vehiclesTable.organisationId, orgId),
    });
    const byName = new Map(orgVehicles.map(v => [v.name.toLowerCase().trim(), v]));
    const byRego = new Map(
      orgVehicles.filter(v => v.registration).map(v => [v.registration!.toLowerCase().trim(), v])
    );

    let imported = 0;
    const skipped: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const label = row.vehicle?.trim() || `Row ${i + 1}`;
      const vehicleKey = label.toLowerCase();

      const vehicle = byName.get(vehicleKey) ?? byRego.get(vehicleKey);
      if (!vehicle) {
        skipped.push(label);
        continue;
      }

      const distanceKm = Number(row.distanceKm);
      if (!distanceKm || distanceKm <= 0) {
        errors.push(`${label}: invalid distance "${row.distanceKm}"`);
        continue;
      }

      // Parse date — supports YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
      let recordedAt: Date;
      try {
        const dateStr = (row.date || "").trim();
        const ddmm = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        recordedAt = ddmm
          ? new Date(`${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`)
          : new Date(dateStr);
        if (isNaN(recordedAt.getTime())) throw new Error("invalid");
      } catch {
        errors.push(`${label}: invalid date "${row.date}"`);
        continue;
      }

      const fuelLitres = row.fuelLitres ? Number(row.fuelLitres) : undefined;

      await insertFleetEvent({
        vehicleId: vehicle.id,
        organisationId: orgId,
        eventType: "manual-import",
        distanceKm,
        fuelLitres: fuelLitres && fuelLitres > 0 ? fuelLitres : undefined,
        source: "tn360-import",
        recordedAt,
        rawPayload: JSON.stringify(row),
        fuelType: vehicle.fuelType,
        emissionFactor: vehicle.emissionFactorKgPerKm ?? undefined,
      });

      imported++;
    }

    await logAudit({
      req,
      action: "fleet.import_km",
      outcome: "success",
      details: { imported, skipped: skipped.length, errors: errors.length },
      organisationId: orgId,
    });

    res.json({ imported, skipped, errors });
  } catch (err) {
    req.log.error({ err }, "Fleet KM import failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to import KM data" });
  }
});

export { webhookRouter };
export default router;
