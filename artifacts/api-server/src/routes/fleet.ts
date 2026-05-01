import { Router } from "express";
import { db, vehiclesTable, fleetEventsTable, organisationsTable } from "@workspace/db";
import { eq, and, gte, lte, count, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { requireAuth, requireOrgAccess, requireOrgAdmin } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { calcFleetCo2e, vehicleClassEmissionFactor } from "../lib/emissions.js";
import { notify } from "../lib/notifications.js";

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

// GET /organisations/:orgId/fleet/vehicles/lookup-plate?plate=XXX
// Looks up a vehicle by NZ plate number using the EECA Fuelsaver API and returns
// WLTP CO₂ g/km + derived kg CO₂e/km emission factor (with NZ MfE WTT upstream uplift).
router.get("/vehicles/lookup-plate", requireAuth, requireOrgAccess, async (req, res) => {
  const plate = ((req.query.plate as string) ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!plate || plate.length < 2) {
    res.status(400).json({ error: "plate query param required" });
    return;
  }

  const login = process.env.FUELSAVER_LOGIN;
  if (!login) {
    res.status(503).json({ found: false, configured: false, error: "Fuelsaver credentials not set" });
    return;
  }

  try {
    const params = JSON.stringify({ api: "labels", listingid: "001", login, plate });
    const url = `https://resources.fuelsaver.govt.nz/api/?params=${encodeURIComponent(params)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      res.status(502).json({ found: false, error: `Fuelsaver HTTP ${resp.status}` });
      return;
    }
    const data = await resp.json() as Record<string, unknown>;

    // Fuelsaver returns ErrorCode when plate not found or credentials wrong
    if (data.ErrorCode || !data.CO2) {
      res.json({ found: false, plate, errorCode: data.ErrorCode ?? "NO_CO2" });
      return;
    }

    const co2GPerKm = Number(data.CO2);
    const fuelRaw = ((data.FuelType as string) ?? "").toLowerCase();
    const fuelType = fuelRaw.includes("diesel")   ? "diesel"
      : fuelRaw.includes("electric") ? "electric"
      : fuelRaw.includes("hybrid")   ? "hybrid"
      : fuelRaw.includes("lpg")      ? "lpg"
      : "petrol";

    // WTT upstream uplift per NZ MfE: ~15% for diesel/petrol, 0 for electric
    const wttUplift = fuelType === "electric" ? 0 : 1.15;
    const emissionFactorKgPerKm = fuelType === "electric" ? 0 : (co2GPerKm * wttUplift) / 1000;

    const mvrYearRaw = data.mvrYear as string | null | undefined;
    const year = mvrYearRaw ? parseInt(mvrYearRaw, 10) || null : null;

    res.json({
      found: true,
      plate,
      make:                  data.Make      ?? null,
      model:                 data.Model     ?? null,
      subModel:              data.SubModel  ?? null,
      year,
      vehicleType:           data.VehicleType ?? null,
      transmission:          data.Transmission ?? null,
      engineSizeCc:          data.EngineSize ?? null,
      fuelType,
      co2GPerKm,
      co2Stars:              data.CO2stars  ?? null,
      fuelEconomyText:       data.FuelEconomyText ?? null,
      emissionFactorKgPerKm,
      wttUplift,
      yearlyTonnes:          data.YearlyCO2 ?? null,
      annualCostNzd:         data.AnnFuelCostText ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, plate }, "Fuelsaver lookup failed");
    res.status(502).json({ found: false, error: "Fuelsaver request failed", detail: msg });
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

// GET /organisations/:orgId/fleet/vehicles/stats — per-vehicle CO₂ leaderboard
router.get("/vehicles/stats", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { from, to } = req.query;

    const conditions = [eq(fleetEventsTable.organisationId, orgId)];
    if (from) conditions.push(gte(fleetEventsTable.recordedAt, new Date(from as string)));
    if (to)   conditions.push(lte(fleetEventsTable.recordedAt, new Date(to as string)));

    const rows = await db
      .select({
        vehicleId: fleetEventsTable.vehicleId,
        totalKm:     sql<number>`COALESCE(SUM(${fleetEventsTable.distanceKm}), 0)`,
        totalCo2eKg: sql<number>`COALESCE(SUM(${fleetEventsTable.co2eKg}), 0)`,
        eventCount:  sql<number>`COUNT(*)`,
        firstEvent:  sql<string>`MIN(${fleetEventsTable.recordedAt})`,
        lastEvent:   sql<string>`MAX(${fleetEventsTable.recordedAt})`,
      })
      .from(fleetEventsTable)
      .where(and(...conditions))
      .groupBy(fleetEventsTable.vehicleId);

    // Join vehicle metadata
    const vehicles = await db.query.vehiclesTable.findMany({
      where: eq(vehiclesTable.organisationId, orgId),
    });
    const vehicleMap = new Map(vehicles.map(v => [v.id, v]));

    const stats = rows.map(row => {
      const v = vehicleMap.get(row.vehicleId);
      const days = row.firstEvent && row.lastEvent
        ? Math.max(1, Math.round((new Date(row.lastEvent).getTime() - new Date(row.firstEvent).getTime()) / 86400000))
        : 1;
      const storedFactor = v?.emissionFactorKgPerKm ?? null;
      const classFactor  = vehicleClassEmissionFactor(v?.make ?? "", v?.model ?? "");
      const effectiveFactor = storedFactor ?? classFactor;
      return {
        vehicleId:                  row.vehicleId,
        name:                       v?.name ?? row.vehicleId,
        make:                       v?.make ?? null,
        model:                      v?.model ?? null,
        fuelType:                   v?.fuelType ?? "diesel",
        emissionFactorKgPerKm:      storedFactor,
        classEmissionFactorKgPerKm: classFactor,
        effectiveEmissionFactor:    effectiveFactor,
        gpsProvider:                v?.gpsProvider ?? "none",
        totalKm:                    Number(row.totalKm),
        totalCo2eKg:                Number(row.totalCo2eKg),
        eventCount:                 Number(row.eventCount),
        avgDailyKm:                 Number(row.totalKm) / days,
        co2ePerKm:                  Number(row.totalKm) > 0 ? Number(row.totalCo2eKg) / Number(row.totalKm) : 0,
      };
    }).sort((a, b) => b.totalCo2eKg - a.totalCo2eKg);

    res.json({ items: stats, total: stats.length });
  } catch (err) {
    req.log.error({ err }, "Vehicle stats failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load vehicle stats" });
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
  make?: string;
  model?: string;
}) {
  // Resolve emission factor: explicit override → vehicle class detection → fuel-type default
  const resolvedFactor = data.emissionFactor
    ?? vehicleClassEmissionFactor(data.make ?? "", data.model ?? "")
    ?? undefined;
  const co2eKg = calcFleetCo2e({
    fuelType: data.fuelType || "petrol",
    distanceKm: data.distanceKm,
    fuelLitres: data.fuelLitres,
    emissionFactorKgPerKm: resolvedFactor,
    make: data.make,
    model: data.model,
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
      // Alert platform ops when telematics webhooks arrive with bad credentials.
      // We don't know which org was the intended target (the api key didn't
      // match), so use the platform-fallback path by passing a sentinel orgId
      // — resolveRecipients() finds zero org admins and falls back to platform
      // super_admins automatically. Daily-cap the dedupe so a misconfigured
      // provider sending every 30s only generates one alert per day.
      void notify({
        organisationId: "PLATFORM",
        category: "webhook.fleet.invalid_api_key",
        severity: "warn",
        title: "Telematics webhook rejected — bad credentials",
        body: `A Navman telematics webhook was rejected because the API key did not match any organisation. If a provider has just been onboarded, double-check the api key configured in the integration.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.invalid_api_key:navman:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "navman", deviceId, ip: req.ip, userAgent: req.get("user-agent") },
      });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(deviceId, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.navman", outcome: "failure", details: { reason: "device_not_registered", deviceId }, organisationId: org.id });
      // Daily-capped warn: a broken telematics integration sending a wrong
      // device id every 30s would otherwise generate thousands of rows.
      void notify({
        organisationId: org.id,
        category: "webhook.fleet.device_not_registered",
        severity: "warn",
        title: "Telematics event ignored — device not registered",
        body: `A Navman telematics event arrived for device "${deviceId}" but no vehicle is registered with that device id. Add the device under Fleet → Vehicles to start capturing emissions.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.device_not_registered:${org.id}:navman:${deviceId}:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "navman", deviceId },
      });
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
      void notify({
        organisationId: "PLATFORM",
        category: "webhook.fleet.invalid_api_key",
        severity: "warn",
        title: "Telematics webhook rejected — bad credentials",
        body: `A Blackhawk telematics webhook was rejected because the token did not match any organisation. If a provider has just been onboarded, double-check the token configured in the integration.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.invalid_api_key:blackhawk:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "blackhawk", deviceId: unit_id, ip: req.ip, userAgent: req.get("user-agent") },
      });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing token" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(unit_id, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.blackhawk", outcome: "failure", details: { reason: "device_not_registered", deviceId: unit_id }, organisationId: org.id });
      void notify({
        organisationId: org.id,
        category: "webhook.fleet.device_not_registered",
        severity: "warn",
        title: "Telematics event ignored — device not registered",
        body: `A Blackhawk telematics event arrived for device "${unit_id}" but no vehicle is registered with that device id. Add the device under Fleet → Vehicles to start capturing emissions.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.device_not_registered:${org.id}:blackhawk:${unit_id}:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "blackhawk", deviceId: unit_id },
      });
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
      void notify({
        organisationId: "PLATFORM",
        category: "webhook.fleet.invalid_api_key",
        severity: "warn",
        title: "Telematics webhook rejected — bad credentials",
        body: `A telematics webhook (generic provider) was rejected because the API key did not match any organisation. If a provider has just been onboarded, double-check the api key configured in the integration.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.invalid_api_key:generic:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "generic", deviceId, ip: req.ip, userAgent: req.get("user-agent") },
      });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or missing API key" });
      return;
    }

    const vehicle = await findVehicleByDeviceId(deviceId, org.id);
    if (!vehicle) {
      await logAudit({ req, action: "webhook.fleet.generic", outcome: "failure", details: { reason: "device_not_registered", deviceId }, organisationId: org.id });
      void notify({
        organisationId: org.id,
        category: "webhook.fleet.device_not_registered",
        severity: "warn",
        title: "Telematics event ignored — device not registered",
        body: `A telematics event arrived for device "${deviceId}" but no vehicle is registered with that device id. Add the device under Fleet → Vehicles to start capturing emissions.`,
        linkUrl: "/fleet",
        dedupeKey: `webhook.fleet.device_not_registered:${org.id}:generic:${deviceId}:${new Date().toISOString().slice(0, 10)}`,
        context: { provider: "generic", deviceId },
      });
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
    const created: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const label = row.vehicle?.trim() || `Row ${i + 1}`;
      const vehicleKey = label.toLowerCase();

      let vehicle = byName.get(vehicleKey) ?? byRego.get(vehicleKey);
      if (!vehicle) {
        // Auto-create the vehicle so new registrations aren't silently dropped
        const [newVehicle] = await db.insert(vehiclesTable).values({
          id: uuidv4(),
          organisationId: orgId,
          name: label,
          registration: label,
          fuelType: "diesel",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();
        vehicle = newVehicle;
        byName.set(vehicleKey, newVehicle);
        byRego.set(vehicleKey, newVehicle);
        created.push(label);
        await logAudit({ req, action: "vehicle.auto_create", resourceType: "vehicle", resourceId: newVehicle.id, organisationId: orgId, details: { name: label, source: "import" } });
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
        make: vehicle.make ?? undefined,
        model: vehicle.model ?? undefined,
      });

      imported++;
    }

    await logAudit({
      req,
      action: "fleet.import_km",
      outcome: "success",
      details: { imported, created: created.length, errors: errors.length },
      organisationId: orgId,
    });

    // Notify admins when one or more rows in the CSV import were skipped.
    // dedupeKey includes the imported/error counts so re-running an import
    // with the same shape still notifies (different shape => different key).
    if (errors.length > 0) {
      const errorPreview = errors.slice(0, 5).join("\n");
      const more = errors.length > 5 ? `\n…and ${errors.length - 5} more` : "";
      void notify({
        organisationId: orgId,
        category: "import.fleet_csv",
        severity: "warn",
        title: `Fleet KM import — ${errors.length} row${errors.length === 1 ? "" : "s"} skipped`,
        body: `${imported} row(s) imported, ${errors.length} skipped due to bad data:\n${errorPreview}${more}`,
        linkUrl: "/fleet",
        dedupeKey: `import.fleet_csv:${orgId}:${imported}:${errors.length}:${new Date().toISOString().slice(0, 19)}`,
        context: { imported, created: created.length, errorCount: errors.length, errors: errors.slice(0, 50) },
      });
    }

    res.json({ imported, created, errors });
  } catch (err) {
    req.log.error({ err }, "Fleet KM import failed");
    const orgId = req.params.orgId as string;
    void notify({
      organisationId: orgId,
      category: "import.fleet_csv",
      severity: "error",
      title: "Fleet KM import failed",
      body: `The fleet KM CSV import crashed and no rows were saved. Please retry, or contact support if the issue persists.`,
      linkUrl: "/fleet",
      // Cap error notifications to once per org per day per source —
      // repeated identical crashes shouldn't spam admins, but we still
      // want a fresh alert if the issue is still failing tomorrow.
      dedupeKey: `import.fleet_csv.error:${orgId}:${new Date().toISOString().slice(0, 10)}`,
      context: { error: err instanceof Error ? err.message : String(err) },
    });
    res.status(500).json({ error: "Internal Server Error", message: "Failed to import KM data" });
  }
});

export { webhookRouter };
export default router;
