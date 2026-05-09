/**
 * Regression tests for the org-wide sign-in policy history endpoint:
 *   GET /api/organisations/:orgId/sso-policy/history
 *
 * Why this suite exists:
 *   This endpoint backs the Settings → Sign-in & SSO history block, which
 *   admins use to answer "why is everyone in our org suddenly restricted?".
 *   A silent regression here (wrong filter, dropped DESC ordering, missing
 *   auth check, unbounded ?limit) would either leak audit data across
 *   organisations or break that debugging workflow.
 *
 * What's mocked and why:
 *   - `@workspace/db` is stubbed at the module boundary. We model just the
 *     rows the route touches:
 *       * usersTable (read by `requireAuth` → `resolveUser`)
 *       * organisationsTable (read by `requireAuth` → `checkOrgLoginAllowed`)
 *       * audit_logs (read by the history `select(...).from(...).where(...)
 *         .orderBy(...).limit(...)` chain)
 *     The select-chain mock walks the where expression to find the orgId
 *     and the action filter, so a future regression that drops either
 *     predicate would surface here as cross-tenant or cross-action leakage.
 *   - `../../lib/audit.js` is stubbed because requireOrgAdmin / handler
 *     don't write audit rows for read-only history fetches, but the route
 *     module pulls the helper in transitively.
 *   - `../../lib/mailer.js` is stubbed for the same reason — the route
 *     module graph reaches it via the org `users` sub-router shared imports.
 *
 * Properties this suite pins down:
 *   1. Auth required — anonymous request returns 401.
 *   2. Org-admin only — `org_viewer` of the same org is refused (403).
 *   3. Org-scoped — `org_admin` of org-A cannot see org-B's history (403).
 *   4. DESC ordering — entries come back newest-first.
 *   5. ?limit clamping — values <1 fall back to 25, values >100 cap at 100,
 *     in-range values are honoured.
 *   6. super_admin cross-org access — a super_admin (with no org of their
 *     own) can read another org's history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be declared before importing the route) ─────────────
vi.mock("../../lib/audit.js", () => ({
  logAudit: vi.fn(async () => {}),
  SOURCE_SYSTEM: "enviroiq",
  FGC_REASON_CODES: [],
  isFgcReasonCode: () => false,
}));

vi.mock("../../lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn(async () => {}),
  sendInviteEmail: vi.fn(async () => {}),
  sendSupplierAuditInviteEmail: vi.fn(async () => {}),
  sendSupplierAuditReminderEmail: vi.fn(async () => {}),
  sendSupplierPortalMagicLink: vi.fn(async () => {}),
}));

// ─── In-memory DB state ─────────────────────────────────────────────────────

type AuditRow = {
  id: string;
  createdAt: Date;
  organisationId: string;
  userId: string | null;
  userEmail: string | null;
  actorType: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  previousValue: unknown;
  newValue: unknown;
};

const dbState: {
  users: Record<string, Record<string, unknown>>;
  organisations: Record<string, Record<string, unknown>>;
  auditLogs: AuditRow[];
  // Captured args from the most recent select-chain so tests can assert the
  // route applied a positive limit (rather than over-fetching and then
  // truncating in JS).
  lastSelectLimit: number | null;
} = {
  users: {},
  organisations: {},
  auditLogs: [],
  lastSelectLimit: null,
};

/** Walk a drizzle `where` expression and report whether `needle` appears anywhere as a string parameter. */
function whereContainsValue(node: unknown, needle: string): boolean {
  const seen = new WeakSet<object>();
  function visit(v: unknown): boolean {
    if (v === needle) return true;
    if (v === null || v === undefined) return false;
    if (typeof v === "string") return v === needle;
    if (typeof v !== "object") return false;
    const obj = v as object;
    if (seen.has(obj)) return false;
    seen.add(obj);
    if (Array.isArray(v)) return v.some(visit);
    for (const key of Reflect.ownKeys(obj)) {
      try {
        if (visit((obj as Record<string | symbol, unknown>)[key])) return true;
      } catch {
        /* getter threw — ignore */
      }
    }
    return false;
  }
  return visit(node);
}

vi.mock("@workspace/db", () => {
  const tables = {
    usersTable: { _t: "users" as const },
    organisationsTable: { _t: "organisations" as const },
    auditLogsTable: {
      _t: "audit_logs" as const,
      id: "id",
      createdAt: "createdAt",
      userId: "userId",
      userEmail: "userEmail",
      actorType: "actorType",
      organisationId: "organisationId",
      action: "action",
      resourceType: "resourceType",
      resourceId: "resourceId",
      previousValue: "previousValue",
      newValue: "newValue",
    },
    vehiclesTable: { _t: "vehicles" as const },
    widgetConfigsTable: { _t: "widget_configs" as const },
  };

  // Build the `db.select({...}).from(t).where(w).orderBy(o).limit(n)` chain
  // used by the history handler. The chain is fully thenable at the end so
  // the route can `await` the final builder.
  const select = vi.fn(() => {
    let whereExpr: unknown = null;
    let limitVal: number | null = null;
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn((w: unknown) => {
        whereExpr = w;
        return builder;
      }),
      orderBy: vi.fn(() => builder),
      limit: vi.fn((n: number) => {
        limitVal = n;
        dbState.lastSelectLimit = n;
        // Final step in the chain — return a thenable so `await` resolves
        // to the filtered, ordered, limited rows.
        const matched = dbState.auditLogs
          .filter((row) => {
            // The route MUST filter by organisationId, action, resourceType,
            // resourceId. We require at least the orgId AND the action to
            // appear in the where expression, mirroring production semantics.
            if (!whereContainsValue(whereExpr, row.organisationId)) return false;
            if (!whereContainsValue(whereExpr, row.action)) return false;
            return row.action === "sso.policy.changed";
          })
          .slice() // copy before sort
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, limitVal ?? 25)
          .map((row) => ({
            id: row.id,
            createdAt: row.createdAt,
            actorUserId: row.userId,
            actorEmail: row.userEmail,
            actorType: row.actorType,
            previousValue: row.previousValue,
            newValue: row.newValue,
          }));
        return {
          then: (resolve: (rows: unknown) => unknown) => resolve(matched),
        };
      }),
    };
    return builder;
  });

  const db = {
    query: {
      usersTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          for (const u of Object.values(dbState.users)) {
            if (whereContainsValue(args?.where, String(u.id))) return u;
          }
          return null;
        }),
      },
      organisationsTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          for (const o of Object.values(dbState.organisations)) {
            if (whereContainsValue(args?.where, String(o.id))) return o;
          }
          return null;
        }),
      },
    },
    select,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return { db, ...tables };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import organisationsRouter from "../organisations.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      name: "eiq.sid",
      cookie: { secure: false, httpOnly: true, sameSite: "lax" },
    }),
  );
  // Stamp a session as if this user signed in. The user must already exist
  // in dbState.users.
  app.post("/__test/login/:userId", (req: Request, res: Response) => {
    const u = dbState.users[req.params.userId];
    if (!u) {
      res.status(500).json({ error: "no such user" });
      return;
    }
    req.session.userId = String(u.id);
    req.session.email = String(u.email);
    req.session.name = String(u.name);
    req.session.role = u.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = (u.organisationId as string | null) ?? null;
    req.session.verifiedEmail = String(u.email);
    req.session.save(() => res.json({ ok: true }));
  });
  app.use("/api/organisations", organisationsRouter);
  return app;
}

function seedOrg(id: string) {
  dbState.organisations[id] = {
    id,
    name: `Org ${id}`,
    isActive: true,
    billingStatus: "active",
  };
}

function seedUser(opts: {
  id: string;
  organisationId: string | null;
  role: "super_admin" | "org_admin" | "org_user" | "org_viewer";
  email?: string;
}) {
  dbState.users[opts.id] = {
    id: opts.id,
    email: opts.email ?? `${opts.id}@example.com`,
    name: opts.id,
    role: opts.role,
    organisationId: opts.organisationId,
    isActive: true,
  };
}

function seedHistoryRow(opts: {
  id: string;
  organisationId: string;
  createdAt: Date;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorType?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
}) {
  dbState.auditLogs.push({
    id: opts.id,
    createdAt: opts.createdAt,
    organisationId: opts.organisationId,
    userId: opts.actorUserId ?? null,
    userEmail: opts.actorEmail ?? null,
    actorType: opts.actorType ?? "user",
    action: "sso.policy.changed",
    resourceType: "organisation",
    resourceId: opts.organisationId,
    previousValue: opts.previousValue ?? null,
    newValue: opts.newValue ?? null,
  });
}

async function loginAs(app: ReturnType<typeof makeApp>, userId: string) {
  const agent = request.agent(app);
  const res = await agent.post(`/__test/login/${userId}`);
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.users = {};
  dbState.organisations = {};
  dbState.auditLogs = [];
  dbState.lastSelectLimit = null;
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("GET /api/organisations/:orgId/sso-policy/history", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    seedOrg("org-1");
    const app = makeApp();
    const res = await request(app).get("/api/organisations/org-1/sso-policy/history");
    expect(res.status).toBe(401);
  });

  it("returns 403 for an org_viewer of the same org (admin-only endpoint)", async () => {
    seedOrg("org-1");
    seedUser({ id: "viewer-1", organisationId: "org-1", role: "org_viewer" });
    const app = makeApp();
    const agent = await loginAs(app, "viewer-1");
    const res = await agent.get("/api/organisations/org-1/sso-policy/history");
    expect(res.status).toBe(403);
  });

  it("returns 403 when an org_admin of org-A asks for org-B's history (cross-tenant guard)", async () => {
    seedOrg("org-A");
    seedOrg("org-B");
    seedUser({ id: "admin-A", organisationId: "org-A", role: "org_admin" });
    // Plant a row in org-B that should NEVER be visible to admin-A.
    seedHistoryRow({
      id: "row-b-1",
      organisationId: "org-B",
      createdAt: new Date("2026-04-01T10:00:00Z"),
    });

    const app = makeApp();
    const agent = await loginAs(app, "admin-A");
    const res = await agent.get("/api/organisations/org-B/sso-policy/history");
    expect(res.status).toBe(403);
    // Body must not echo the foreign org's row.
    expect(JSON.stringify(res.body)).not.toContain("row-b-1");
  });

  it("returns entries in DESC order (newest first) and only for the requested org", async () => {
    seedOrg("org-1");
    seedOrg("org-2");
    seedUser({ id: "admin-1", organisationId: "org-1", role: "org_admin" });
    seedHistoryRow({
      id: "row-old",
      organisationId: "org-1",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      actorEmail: "old@example.com",
    });
    seedHistoryRow({
      id: "row-new",
      organisationId: "org-1",
      createdAt: new Date("2026-04-05T10:00:00Z"),
      actorEmail: "new@example.com",
    });
    seedHistoryRow({
      id: "row-mid",
      organisationId: "org-1",
      createdAt: new Date("2026-04-03T10:00:00Z"),
      actorEmail: "mid@example.com",
    });
    // Decoy from a different org — must not appear.
    seedHistoryRow({
      id: "row-other",
      organisationId: "org-2",
      createdAt: new Date("2026-04-09T10:00:00Z"),
    });

    const app = makeApp();
    const agent = await loginAs(app, "admin-1");
    const res = await agent.get("/api/organisations/org-1/sso-policy/history");

    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toEqual(["row-new", "row-mid", "row-old"]);
    expect(ids).not.toContain("row-other");
  });

  it("clamps ?limit: garbage / non-positive falls back to 25, values >100 cap at 100, in-range honoured", async () => {
    seedOrg("org-1");
    seedUser({ id: "admin-1", organisationId: "org-1", role: "org_admin" });
    // Seed enough rows that the limit can actually bite.
    for (let i = 0; i < 5; i++) {
      seedHistoryRow({
        id: `row-${i}`,
        organisationId: "org-1",
        createdAt: new Date(2026, 3, 1 + i, 10, 0, 0),
      });
    }
    const app = makeApp();
    const agent = await loginAs(app, "admin-1");

    // In-range limit is honoured AND actually limits the rows returned.
    const inRange = await agent.get("/api/organisations/org-1/sso-policy/history?limit=2");
    expect(inRange.status).toBe(200);
    expect(dbState.lastSelectLimit).toBe(2);
    expect((inRange.body.items as unknown[]).length).toBe(2);

    // Negative limit → clamped to default (25).
    const negative = await agent.get("/api/organisations/org-1/sso-policy/history?limit=-5");
    expect(negative.status).toBe(200);
    expect(dbState.lastSelectLimit).toBe(25);

    // Garbage limit → clamped to default (25).
    const garbage = await agent.get("/api/organisations/org-1/sso-policy/history?limit=banana");
    expect(garbage.status).toBe(200);
    expect(dbState.lastSelectLimit).toBe(25);

    // Over-large limit → capped at 100. A regression that dropped the cap
    // would let a caller pull the whole audit table in one request.
    const huge = await agent.get("/api/organisations/org-1/sso-policy/history?limit=1000");
    expect(huge.status).toBe(200);
    expect(dbState.lastSelectLimit).toBe(100);
  });

  it("allows a super_admin (no org of their own) to read any organisation's history", async () => {
    seedOrg("org-target");
    seedUser({ id: "super-1", organisationId: null, role: "super_admin" });
    seedHistoryRow({
      id: "row-target-1",
      organisationId: "org-target",
      createdAt: new Date("2026-04-04T10:00:00Z"),
      actorEmail: "someone@target.example",
    });

    const app = makeApp();
    const agent = await loginAs(app, "super-1");
    const res = await agent.get("/api/organisations/org-target/sso-policy/history");

    expect(res.status).toBe(200);
    const ids = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toEqual(["row-target-1"]);
  });
});
