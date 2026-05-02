/**
 * Source-wiring tests for the foundation notification system.
 *
 * Where `lib/__tests__/notifications.test.ts` proves the `notify()`
 * fan-out internals (idempotency, transactional rollback, batched send,
 * digest stamping), this suite proves that the **call sites** that should
 * raise notifications actually do so with:
 *   - the right `severity` and `category`,
 *   - a `sourceAuditId` that equals the audit row id we just persisted, and
 *   - a `dedupeKey` that is anchored on that audit id (not a coarse
 *     calendar-day cap that would silently swallow distinct failures).
 *
 * The route modules are imported with their dependencies mocked at the
 * module boundary so the suite is hermetic and fast — no DB, no Resend,
 * no real auth. The handlers are mounted onto a throwaway Express app and
 * driven via supertest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Module mocks (must be declared before importing the routes) ────────────

// notify() and logAudit() are the two seams we assert against. The rest of
// the lib surface is stubbed minimally to keep the routes importable.
vi.mock("../../lib/notifications.js", () => ({
  notify: vi.fn(async () => ({ created: true, eventId: "evt-1", recipientCount: 1, emailsSent: 0 })),
}));
let auditCounter = 0;
vi.mock("../../lib/audit.js", () => ({
  logAudit: vi.fn(async () => `audit-${++auditCounter}`),
  SOURCE_SYSTEM: "enviroiq",
  FGC_REASON_CODES: [],
  isFgcReasonCode: () => false,
}));

// Auth middlewares are passthrough — every test request is treated as an
// authenticated org_admin in org-1. Org access checks are short-circuited.
vi.mock("../../lib/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: "u-admin", role: "org_admin", organisationId: "org-1" };
    next();
  },
  requireOrgAccess: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  requireOrgAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  READ_ONLY_ROLES: [],
  ALL_ROLES: [],
}));

vi.mock("../../lib/emissions.js", () => ({
  calcFleetCo2e: () => 0,
  vehicleClassEmissionFactor: () => 0,
  calcEnergyCo2e: () => 0,
  resolveElectricityFactor: () => ({ factorKgCo2PerKwh: 0.1, method: "test", note: "" }),
}));

vi.mock("../../lib/em6.js", () => ({
  getCurrentGridIntensity: vi.fn(async () => null),
}));

vi.mock("../../lib/billParser.js", () => ({
  parseBillText: vi.fn(() => {
    throw new Error("parser blew up");
  }),
}));

vi.mock("../../lib/documentArchive.js", () => ({
  archiveDocument: vi.fn(async () => undefined),
}));

// ─── In-memory DB stand-in ──────────────────────────────────────────────────
// Each test sets `dbState.vehicles` / `dbState.vehicleByDeviceId` to control
// what the route sees. Webhook secret validation is controlled via
// `dbState.orgByApiKey` returning null (= invalid_api_key path) or an org.

interface VehicleRow {
  id: string;
  organisationId: string;
  fuelType: string | null;
  emissionFactorKgPerKm: number | null;
  gpsDeviceId: string | null;
  name: string;
  registration: string | null;
  make: string | null;
  model: string | null;
}

const dbState: {
  orgByApiKey: Record<string, { id: string; name: string } | null>;
  vehicles: VehicleRow[];
  insertedFleetEvents: unknown[];
} = {
  orgByApiKey: {},
  vehicles: [],
  insertedFleetEvents: [],
};

function resetDb() {
  dbState.orgByApiKey = {};
  dbState.vehicles = [];
  dbState.insertedFleetEvents = [];
  auditCounter = 0;
}

vi.mock("@workspace/db", () => {
  return {
    db: {
      query: {
        organisationsTable: {
          findFirst: vi.fn(async (args: { where?: unknown }) => {
            // Webhook secret resolution: walk the where expression for an
            // apiKey value and look it up in orgByApiKey. Easier: callers
            // pass a single eq() so we just scan for any string in the
            // dbState.orgByApiKey keys.
            const w = JSON.stringify(args.where);
            for (const key of Object.keys(dbState.orgByApiKey)) {
              if (w.includes(key)) return dbState.orgByApiKey[key];
            }
            return null;
          }),
        },
        vehiclesTable: {
          findFirst: vi.fn(async (args: { where?: unknown }) => {
            const w = JSON.stringify(args.where);
            for (const v of dbState.vehicles) {
              if (v.gpsDeviceId && w.includes(v.gpsDeviceId)) return v;
              if (v.name && w.includes(v.name)) return v;
              if (v.registration && w.includes(v.registration)) return v;
            }
            return null;
          }),
          findMany: vi.fn(async () => dbState.vehicles),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => [{ total: 0 }]),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((row: unknown) => {
          dbState.insertedFleetEvents.push(row);
          return Promise.resolve();
        }),
      })),
    },
    vehiclesTable: { id: "id", organisationId: "organisationId", gpsDeviceId: "gpsDeviceId", name: "name", registration: "registration" },
    fleetEventsTable: {},
    organisationsTable: { id: "id", apiKey: "apiKey" },
    energyReadingsTable: {},
  };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import * as notifications from "../../lib/notifications.js";
import * as audit from "../../lib/audit.js";
import fleetRouter, { webhookRouter } from "../fleet.js";
import energyRouter from "../energy.js";

const notifyMock = notifications.notify as unknown as ReturnType<typeof vi.fn>;
const logAuditMock = audit.logAudit as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetDb();
  notifyMock.mockClear();
  logAuditMock.mockClear();
  // Default behaviour: each logAudit call returns a fresh, monotonically
  // increasing id so we can assert "the notification's sourceAuditId is the
  // SAME id that logAudit just returned".
  logAuditMock.mockImplementation(async () => `audit-${++auditCounter}`);
});

function makeApp() {
  const app = express();
  app.use(express.json());
  // Stub `req.log` (pino-http injects this in production) so the route's
  // own try/catch doesn't itself crash before reaching the audit + notify
  // calls we want to assert on.
  app.use((req, _res, next) => {
    (req as unknown as { log: { info: () => void; warn: () => void; error: () => void; debug: () => void } }).log = {
      info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
    };
    next();
  });
  app.use("/webhooks/fleet", webhookRouter);
  app.use("/api/organisations/:orgId/fleet", fleetRouter);
  app.use("/api/organisations/:orgId/energy", energyRouter);
  return app;
}

describe("Fleet webhook → notify wiring", () => {
  it("Navman invalid_api_key persists audit row first then notifies with sourceAuditId === auditId", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/webhooks/fleet/navman")
      .send({ deviceId: "GPS-1", apiKey: "wrong-key", timestamp: new Date().toISOString() });

    expect(res.status).toBe(401);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const auditReturn = await logAuditMock.mock.results[0].value;
    const callArg = notifyMock.mock.calls[0][0];
    expect(callArg.organisationId).toBe("PLATFORM");
    expect(callArg.severity).toBe("error");
    expect(callArg.category).toBe("webhook.fleet.invalid_api_key");
    expect(callArg.sourceAuditId).toBe(auditReturn);
    // Per-event dedupe (audit-id-anchored, not day-capped).
    expect(callArg.dedupeKey).toBe(`webhook.fleet.invalid_api_key:navman:${auditReturn}`);
  });

  it("two distinct invalid_api_key rejections produce two distinct dedupe keys (no day-cap suppression)", async () => {
    const app = makeApp();
    await request(app).post("/webhooks/fleet/navman").send({ deviceId: "GPS-1", apiKey: "bad-1", timestamp: new Date().toISOString() });
    await request(app).post("/webhooks/fleet/navman").send({ deviceId: "GPS-2", apiKey: "bad-2", timestamp: new Date().toISOString() });
    expect(notifyMock).toHaveBeenCalledTimes(2);
    const k1 = notifyMock.mock.calls[0][0].dedupeKey;
    const k2 = notifyMock.mock.calls[1][0].dedupeKey;
    expect(k1).not.toBe(k2);
    // Neither should contain a YYYY-MM-DD calendar-day suffix anchor.
    expect(k1).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
    expect(k2).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
  });

  it("device_not_registered notify uses the audit id from the second logAudit call", async () => {
    dbState.orgByApiKey["good-key"] = { id: "org-1", name: "Test Org" };
    // No vehicle for this device id.
    const app = makeApp();
    const res = await request(app)
      .post("/webhooks/fleet/navman")
      .send({ deviceId: "UNKNOWN-DEVICE", apiKey: "good-key", timestamp: new Date().toISOString() });
    expect(res.status).toBe(200);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const auditId = await logAuditMock.mock.results[0].value;
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.category).toBe("webhook.fleet.device_not_registered");
    expect(arg.severity).toBe("warn");
    expect(arg.sourceAuditId).toBe(auditId);
    expect(arg.dedupeKey).toContain(auditId);
  });
});

describe("Fleet /import-km → notify wiring", () => {
  it("crash path persists failure audit row first, then fires error notify with audit-id-anchored dedupe", async () => {
    // Force the route to crash by making the per-org vehicle preload throw.
    // The route catches the throw, persists a failure audit row, and then
    // fires the error-severity notification.
    const dbModule = (await import("@workspace/db")) as unknown as { db: { query: { vehiclesTable: { findMany: ReturnType<typeof vi.fn> } } } };
    dbModule.db.query.vehiclesTable.findMany.mockImplementation(async () => {
      throw new Error("boom");
    });

    const app = makeApp();
    const res = await request(app)
      .post("/api/organisations/org-1/fleet/import-km")
      .send({ rows: [{ vehicle: "Truck A", date: "2026-04-01", distanceKm: 10 }] });

    // Restore default mock for subsequent tests.
    dbModule.db.query.vehiclesTable.findMany.mockImplementation(async () => dbState.vehicles);

    expect(res.status).toBe(500);
    // Failure audit row is created first; notify is fired afterwards.
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].outcome).toBe("failure");
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const auditId = await logAuditMock.mock.results[0].value;
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.category).toBe("import.fleet_csv");
    expect(arg.severity).toBe("error");
    expect(arg.sourceAuditId).toBe(auditId);
    expect(arg.dedupeKey).toBe(`import.fleet_csv.error:org-1:${auditId}`);
    // No calendar-day suffix that would coalesce distinct crashes.
    expect(arg.dedupeKey).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Energy /upload → notify wiring", () => {
  it("crash path persists failure audit row first, then fires error notify with audit-id-anchored dedupe", async () => {
    const app = makeApp();
    // parseBillText is mocked at module top to throw — drives the catch path.
    const fakePdf = Buffer.from("%PDF-1.4 fake");
    const res = await request(app)
      .post("/api/organisations/org-1/energy/upload")
      .attach("file", fakePdf, "bill.pdf");

    expect(res.status).toBe(500);
    expect(logAuditMock).toHaveBeenCalledTimes(1);
    expect(logAuditMock.mock.calls[0][0].outcome).toBe("failure");
    expect(logAuditMock.mock.calls[0][0].action).toBe("energy_bill.upload");
    expect(notifyMock).toHaveBeenCalledTimes(1);
    const auditId = await logAuditMock.mock.results[0].value;
    const arg = notifyMock.mock.calls[0][0];
    expect(arg.organisationId).toBe("org-1");
    expect(arg.category).toBe("upload.energy_bill");
    expect(arg.severity).toBe("error");
    expect(arg.sourceAuditId).toBe(auditId);
    expect(arg.dedupeKey).toBe(`upload.energy_bill:${auditId}`);
    expect(arg.dedupeKey).not.toMatch(/\d{4}-\d{2}-\d{2}$/);
  });
});
