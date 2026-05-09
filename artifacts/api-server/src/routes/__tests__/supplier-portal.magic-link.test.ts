/**
 * Regression tests for the supplier-portal magic-link sign-in flow.
 *
 * These guard `POST /portal/request-link` and `GET /portal/verify` against
 * silent regressions. The supplier-portal flow is *parallel to* the in-app
 * magic-link flow but uses a different mailer template
 * (`sendSupplierPortalMagicLink`), a 30-minute TTL, a hex (not base64url)
 * SHA-256 hash, and a separate cookie session — so it needs its own coverage.
 * A regression here would silently break supplier responses to audit
 * requests, which we'd only notice from inbound complaints.
 *
 * Mock semantics worth knowing:
 *   - The supplier-audits lookup is satisfied/unsatisfied by toggling
 *     `dbState.supplierAuditExists`. The route never reads any field off it
 *     except truthiness, so we don't have to model audit rows in detail.
 *   - All inserts into `supplierPortalSessionsTable` are captured into
 *     `dbState.sessions` exactly as the route writes them, including the
 *     SHA-256-hashed token. Tests assert the persisted token is NOT the raw
 *     token (replay defence — a DB compromise must not hand attackers usable
 *     links or cookies).
 *   - `supplierPortalSessionsTable.findFirst` walks the drizzle `where`
 *     expression looking for the literal email + tokenHash strings the route
 *     is querying with. Sessions whose `expiresAt` has passed are filtered
 *     out (mirrors the production `gt(expiresAt, now())` predicate). If the
 *     route ever drops the tokenHash predicate or compares against the raw
 *     token, the mock will fail to match and the suite turns red.
 *   - `db.delete(supplierPortalSessionsTable).where(eq(id, ...))` is wired
 *     to actually remove the matching row from `dbState.sessions`, so the
 *     "magic-link is single-use" property is exercised end-to-end (replay
 *     of the same magic-link token must 401 because the row is gone).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be declared before importing the route) ─────────────
vi.mock("../../lib/audit.js", () => ({
  logAudit: vi.fn(async () => "audit-id"),
  SOURCE_SYSTEM: "enviroiq",
  FGC_REASON_CODES: [],
  isFgcReasonCode: () => false,
}));

vi.mock("../../lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn(async () => ({ sent: true, devMode: false })),
  sendInviteEmail: vi.fn(async () => ({ sent: true, devMode: false })),
  sendSupplierAuditInviteEmail: vi.fn(async () => ({ sent: true, devMode: false })),
  sendSupplierAuditReminderEmail: vi.fn(async () => ({ sent: true, devMode: false })),
  sendSupplierPortalMagicLink: vi.fn(async () => ({ sent: true, devMode: false })),
}));

// In-memory stand-ins for the rows the supplier-portal route reads/writes.
type SessionRow = {
  id: string;
  email: string;
  tokenHash: string; // hex sha256
  expiresAt: Date;
};

const dbState: {
  supplierAuditExists: boolean;
  sessions: SessionRow[];
  // Captures every supplierAuditsTable.findFirst lookup so we can assert the
  // route is searching by the email it received (post-normalisation).
  supplierAuditLookups: string[];
} = {
  supplierAuditExists: false,
  sessions: [],
  supplierAuditLookups: [],
};

/**
 * Recursively walk a drizzle `where` expression and return true if `needle`
 * appears anywhere as a string value. Drizzle stores parameter values inside
 * SQL chunks under various symbol/string keys; rather than depend on private
 * shapes, we simply traverse every property (including symbols) and look for
 * the literal string. Cycles are guarded by a WeakSet.
 */
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
    supplierPortalSessionsTable: { _t: "supplier_portal_sessions" as const },
    supplierAuditsTable: { _t: "supplier_audits" as const },
    suppliersTable: { _t: "suppliers" as const },
    organisationsTable: { _t: "organisations" as const },
  };

  const insertCall = vi.fn((table: { _t: string }) => ({
    values: vi.fn(async (row: Record<string, unknown>) => {
      if (table === tables.supplierPortalSessionsTable) {
        dbState.sessions.push({
          id: String(row.id),
          email: String(row.email),
          tokenHash: String(row.tokenHash),
          expiresAt: row.expiresAt as Date,
        });
      }
      return undefined;
    }),
  }));

  const deleteCall = vi.fn((table: { _t: string }) => ({
    where: vi.fn(async (whereExpr: unknown) => {
      if (table !== tables.supplierPortalSessionsTable) return undefined;
      // Walk the where expression and drop any session whose id (or email +
      // tokenHash combo, for the logout path) appears in it.
      dbState.sessions = dbState.sessions.filter((s) => {
        const idMatch = whereContainsValue(whereExpr, s.id);
        const pairMatch =
          whereContainsValue(whereExpr, s.email) &&
          whereContainsValue(whereExpr, s.tokenHash);
        return !(idMatch || pairMatch);
      });
      return undefined;
    }),
  }));

  const db = {
    query: {
      supplierAuditsTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          // Capture the literal string the route is querying with so tests
          // can assert email normalisation (trim + lowercase).
          // Walk the where expression for any string value that looks like
          // an email and record it.
          const collected: string[] = [];
          const seen = new WeakSet<object>();
          (function visit(v: unknown) {
            if (v === null || v === undefined) return;
            if (typeof v === "string" && v.includes("@")) {
              collected.push(v);
              return;
            }
            if (typeof v !== "object") return;
            const obj = v as object;
            if (seen.has(obj)) return;
            seen.add(obj);
            if (Array.isArray(v)) {
              v.forEach(visit);
              return;
            }
            for (const key of Reflect.ownKeys(obj)) {
              try {
                visit((obj as Record<string | symbol, unknown>)[key]);
              } catch {
                /* ignore getter throws */
              }
            }
          })(args?.where);
          if (collected.length > 0) {
            dbState.supplierAuditLookups.push(collected[0]!);
          }
          return dbState.supplierAuditExists ? { id: "audit-1" } : null;
        }),
      },
      supplierPortalSessionsTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          const now = Date.now();
          for (const s of dbState.sessions) {
            if (s.expiresAt.getTime() <= now) continue; // mirror gt(expiresAt, now())
            if (!whereContainsValue(args?.where, s.email)) continue;
            // Fidelity check: route MUST query with the SHA-256 hash. If it
            // ever drops/weakens that predicate this match fails.
            if (!whereContainsValue(args?.where, s.tokenHash)) continue;
            return { ...s };
          }
          return null;
        }),
      },
      suppliersTable: { findFirst: vi.fn(async () => null) },
      organisationsTable: { findFirst: vi.fn(async () => null) },
    },
    insert: insertCall,
    delete: deleteCall,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })),
      })),
    })),
  };

  return { db, ...tables };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createHash } from "node:crypto";
import portalRouter from "../supplier-portal.js";
import * as mailer from "../../lib/mailer.js";
import * as audit from "../../lib/audit.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
type AuditCall = {
  action: string;
  outcome?: "success" | "failure";
  organisationId?: string;
  userId?: string;
  userEmail?: string;
  details?: Record<string, unknown>;
};

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function getMailerCalls(): Array<[string, string]> {
  const mock = mailer.sendSupplierPortalMagicLink as unknown as {
    mock: { calls: [string, string][] };
  };
  return mock.mock.calls;
}

function getAuditCalls(): AuditCall[] {
  const mock = audit.logAudit as unknown as { mock: { calls: [AuditCall][] } };
  return mock.mock.calls.map((c) => c[0]);
}

function makeApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  // The route uses pino-http's `req.log` in catch blocks; provide a no-op.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { log: { error: () => void; info: () => void } }).log = {
      error: () => {},
      info: () => {},
    };
    next();
  });
  app.use("/portal", portalRouter);
  return app;
}

/** Extract the raw token from the URL passed to the supplier-portal mailer. */
function extractTokenFromMail(): { token: string; emailParam: string } {
  const calls = getMailerCalls();
  expect(calls.length).toBe(1);
  const [, url] = calls[0];
  const u = new URL(url);
  const token = u.searchParams.get("token");
  const emailParam = u.searchParams.get("email");
  expect(token).toBeTruthy();
  expect(emailParam).toBeTruthy();
  return { token: token!, emailParam: emailParam! };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.supplierAuditExists = false;
  dbState.sessions = [];
  dbState.supplierAuditLookups = [];
  // Fixed dev-mode mailer behaviour. Individual tests override as needed.
  (mailer.sendSupplierPortalMagicLink as unknown as { mockResolvedValue: (v: unknown) => void })
    .mockResolvedValue({ sent: true, devMode: false });
});

// ─── POST /portal/request-link ──────────────────────────────────────────────
describe("POST /portal/request-link", () => {
  it("rejects an obviously invalid email with 400 and never queries / sends mail / writes audit", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/email/i) });
    expect(getMailerCalls()).toHaveLength(0);
    expect(dbState.sessions).toHaveLength(0);
    expect(dbState.supplierAuditLookups).toHaveLength(0);
    // Invalid input short-circuits before any audit row is written.
    expect(getAuditCalls()).toHaveLength(0);
  });

  it("returns the generic 200 for an unknown supplier email — no mail, no token stored (no enumeration leak), audits request.unknown", async () => {
    dbState.supplierAuditExists = false;
    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "stranger@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    // Critically: no `url` field — the route must not leak whether the email
    // is on file by varying the response shape.
    expect(res.body).not.toHaveProperty("url");
    expect(getMailerCalls()).toHaveLength(0);
    expect(dbState.sessions).toHaveLength(0);
    // We did look in supplier-audits using the normalised email.
    expect(dbState.supplierAuditLookups).toEqual(["stranger@example.com"]);

    const audits = getAuditCalls();
    const unknown = audits.filter(
      (a) => a.action === "auth.supplier_portal_magic_link.request.unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      outcome: "failure",
      userEmail: "stranger@example.com",
      details: { email: "stranger@example.com" },
    });
    // No success audit must leak that the email "almost worked".
    expect(
      audits.some((a) => a.action === "auth.supplier_portal_magic_link.request"),
    ).toBe(false);
  });

  it("lowercases the email before the supplier-audits lookup so case differences don't cause a spurious miss", async () => {
    // NOTE: the route runs `parsed.data.email.toLowerCase().trim()` AFTER
    // zod's `.email()` validation, so leading/trailing whitespace is
    // rejected by zod before the trim ever runs. We only assert lowercase
    // normalisation here — what the route actually delivers — rather than
    // pinning a `.trim()` that has no effect in this code path.
    dbState.supplierAuditExists = true;
    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "SUPPLIER@Example.COM" });

    expect(res.status).toBe(200);
    expect(dbState.supplierAuditLookups).toEqual(["supplier@example.com"]);
    expect(getMailerCalls()).toHaveLength(1);
    const [to] = getMailerCalls()[0];
    expect(to).toBe("supplier@example.com");
    // Persisted session row carries the normalised email too.
    expect(dbState.sessions).toHaveLength(1);
    expect(dbState.sessions[0].email).toBe("supplier@example.com");
  });

  it("for a known supplier: persists token as a SHA-256(hex) hash, sends supplier-portal mail with the raw token, 30-min TTL, and audits success", async () => {
    dbState.supplierAuditExists = true;
    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "supplier@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, devMode: false });
    // Resend confirmed the send → URL must NOT be returned to the caller.
    expect(res.body).not.toHaveProperty("url");

    // Mail was sent through the supplier-portal-specific mailer (NOT the
    // in-app sendMagicLinkEmail).
    expect(getMailerCalls()).toHaveLength(1);
    expect(
      (mailer.sendMagicLinkEmail as unknown as { mock: { calls: unknown[] } })
        .mock.calls,
    ).toHaveLength(0);
    const { token: rawToken, emailParam } = extractTokenFromMail();
    expect(rawToken.length).toBeGreaterThanOrEqual(32);
    expect(emailParam).toBe("supplier@example.com");

    // Persisted token is the SHA-256(rawToken) hex digest — a DB compromise
    // must NOT hand attackers usable links.
    expect(dbState.sessions).toHaveLength(1);
    const stored = dbState.sessions[0];
    expect(stored.tokenHash).toBe(sha256hex(rawToken));
    expect(stored.tokenHash).not.toBe(rawToken);
    expect(/^[a-f0-9]{64}$/.test(stored.tokenHash)).toBe(true);
    expect(stored.email).toBe("supplier@example.com");

    // TTL is ~30 minutes; be lenient on exact ms.
    const ttlMs = stored.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(25 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000 + 5_000);

    // Exactly one success audit row, scoped to the supplier email. No
    // unknown-email row must fire on the happy path (would leak the lookup).
    const audits = getAuditCalls();
    const success = audits.filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.request" &&
        a.outcome === "success",
    );
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({
      userEmail: "supplier@example.com",
      details: { devMode: false },
    });
    expect(
      audits.some(
        (a) => a.action === "auth.supplier_portal_magic_link.request.unknown",
      ),
    ).toBe(false);
  });

  it("when the mailer reports devMode (no Resend configured), returns the URL so devs can click through", async () => {
    dbState.supplierAuditExists = true;
    (mailer.sendSupplierPortalMagicLink as unknown as { mockResolvedValueOnce: (v: unknown) => void })
      .mockResolvedValueOnce({ sent: false, devMode: true });

    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "supplier@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, devMode: true });
    expect(typeof res.body.url).toBe("string");
    const u = new URL(res.body.url);
    expect(u.searchParams.get("email")).toBe("supplier@example.com");
    expect(u.searchParams.get("token")).toBeTruthy();
    // The URL field MUST contain the *raw* token, never the stored hash.
    const rawTokenInUrl = u.searchParams.get("token")!;
    expect(rawTokenInUrl).not.toBe(dbState.sessions[0].tokenHash);
    expect(sha256hex(rawTokenInUrl)).toBe(dbState.sessions[0].tokenHash);
  });

  it("if the mailer throws, returns 500, NEVER leaks the magic-link URL/token, and audits the failure", async () => {
    dbState.supplierAuditExists = true;
    (mailer.sendSupplierPortalMagicLink as unknown as { mockRejectedValueOnce: (e: unknown) => void })
      .mockRejectedValueOnce(new Error("resend exploded"));

    const app = makeApp();
    const res = await request(app)
      .post("/portal/request-link")
      .send({ email: "supplier@example.com" });

    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("url");
    // We may have written the session row before attempting to send — that's
    // fine (it'll expire in 30 min) — but we must not have given the caller
    // any way to use it.
    const body = JSON.stringify(res.body);
    if (dbState.sessions.length > 0) {
      // If the route did persist a row, the response must not echo its hash.
      for (const s of dbState.sessions) {
        expect(body).not.toContain(s.tokenHash);
      }
    }

    // Failure audit row records the mailer failure; no spurious success row.
    const audits = getAuditCalls();
    const fail = audits.filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.request" &&
        a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userEmail: "supplier@example.com",
      details: { reason: "mailer_failed" },
    });
    expect(
      audits.some(
        (a) =>
          a.action === "auth.supplier_portal_magic_link.request" &&
          a.outcome === "success",
      ),
    ).toBe(false);
  });
});

// ─── GET /portal/verify ─────────────────────────────────────────────────────
describe("GET /portal/verify", () => {
  it("redirects to /portal/login?error=invalid_link when the token query param is missing and never establishes a session", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .get("/portal/verify?email=supplier@example.com")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/portal\/login\?error=invalid_link$/);
    expect(res.headers["set-cookie"]).toBeUndefined();

    const fail = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userEmail: "supplier@example.com",
      details: { reason: "invalid_link" },
    });
  });

  it("redirects to /portal/login?error=invalid_link when the email query param is missing and never establishes a session", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .get("/portal/verify?token=anything")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/portal\/login\?error=invalid_link$/);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("redirects to /portal/login?error=expired for an unknown token (nothing on file), never sets the cookie, audits failure", async () => {
    dbState.sessions = []; // nothing on file
    const app = makeApp();
    const res = await request(app)
      .get("/portal/verify?token=nope-not-a-real-token&email=supplier@example.com")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/portal\/login\?error=expired$/);
    expect(res.headers["set-cookie"]).toBeUndefined();

    const fail = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userEmail: "supplier@example.com",
      details: { reason: "invalid_or_expired" },
    });
    // No success audit must fire on a failed verify.
    expect(
      getAuditCalls().some(
        (a) =>
          a.action === "auth.supplier_portal_magic_link.verify" &&
          a.outcome === "success",
      ),
    ).toBe(false);
  });

  it("redirects to /portal/login?error=expired when a valid link exists but the URL token doesn't match its hash (replay-against-other-supplier defence)", async () => {
    // A different (still-valid) link exists; the URL presents a token whose
    // SHA-256 is NOT the stored hash. The route MUST treat this as not-found
    // rather than letting the wrong token through.
    const realRaw = "real-token-for-someone-else";
    dbState.sessions = [
      {
        id: "ses-real",
        email: "supplier@example.com",
        tokenHash: sha256hex(realRaw),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    ];

    const app = makeApp();
    const res = await request(app)
      .get("/portal/verify?token=totally-different-token&email=supplier@example.com")
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/portal\/login\?error=expired$/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    // The legitimate link MUST still be on file (the wrong-token attempt
    // does NOT consume it).
    expect(dbState.sessions.find((s) => s.id === "ses-real")).toBeTruthy();
  });

  it("redirects to /portal/login?error=expired when the token matches but is past expiresAt; the expired row is NOT consumed", async () => {
    const rawToken = "expired-token-raw";
    dbState.sessions = [
      {
        id: "ses-expired",
        email: "supplier@example.com",
        tokenHash: sha256hex(rawToken),
        expiresAt: new Date(Date.now() - 60 * 1000), // 60s ago
      },
    ];

    const app = makeApp();
    const res = await request(app)
      .get(
        `/portal/verify?token=${encodeURIComponent(rawToken)}&email=supplier@example.com`,
      )
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/portal\/login\?error=expired$/);
    expect(res.headers["set-cookie"]).toBeUndefined();
    // Expired session row must not be deleted by the failed attempt; the
    // delete path is reserved for successful single-use consumption.
    expect(dbState.sessions.find((s) => s.id === "ses-expired")).toBeTruthy();

    const fail = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userEmail: "supplier@example.com",
      details: { reason: "invalid_or_expired" },
    });
  });

  it("happy path: 302s into /portal, sets the supplier cookie, deletes the magic-link row, and a fresh long-lived session row is on file", async () => {
    // Drive the request endpoint first so we exercise the full
    // hash-then-verify round-trip with a token the route generated itself.
    dbState.supplierAuditExists = true;
    const app = makeApp();
    const agent = request.agent(app);

    await agent
      .post("/portal/request-link")
      .send({ email: "supplier@example.com" })
      .expect(200);

    expect(dbState.sessions).toHaveLength(1);
    const magicLinkRow = { ...dbState.sessions[0] };
    const { token: rawToken } = extractTokenFromMail();
    expect(magicLinkRow.tokenHash).toBe(sha256hex(rawToken));

    const res = await agent
      .get(
        `/portal/verify?token=${encodeURIComponent(rawToken)}&email=supplier@example.com`,
      )
      .redirects(0);

    expect(res.status).toBe(302);
    // Redirects into the supplier portal landing.
    expect(res.headers.location).toMatch(/\/portal$/);

    // Cookie was set: httpOnly, scoped to /, named eiq_supplier_session.
    const setCookie = res.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie);
    expect(cookieStr).toMatch(/eiq_supplier_session=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/Path=\//i);

    // The cookie value is `${email}.${rawCookieSecret}` — NOT the
    // magic-link raw token, NOT the stored hash. The cookie *consumer*
    // (`requireSupplier`) splits on the LAST dot so emails with dots in
    // the domain (i.e. essentially every real email) round-trip correctly.
    const cookieMatch = cookieStr.match(/eiq_supplier_session=([^;]+)/);
    expect(cookieMatch).toBeTruthy();
    const cookieValue = decodeURIComponent(cookieMatch![1]);
    expect(cookieValue.includes(".")).toBe(true);
    expect(cookieValue.startsWith("supplier@example.com.")).toBe(true);
    const cookieSecret = cookieValue.slice("supplier@example.com.".length);
    expect(cookieSecret.length).toBeGreaterThanOrEqual(32);
    expect(cookieSecret).not.toBe(rawToken); // must be a freshly rolled secret
    // Critically: the secret half must NOT itself contain a dot — otherwise
    // a "split on last dot" parse would still misattribute bytes between
    // email and secret. base64url contains no dots, so this is a free check.
    expect(cookieSecret.includes(".")).toBe(false);

    // Positive cookie round-trip: present the cookie to /portal/me and get
    // back our own email. This is the assertion the original
    // `raw.split(".", 2)` bug would have failed, because the ".com" of
    // the email was being lopped off and treated as the secret.
    // We set the Cookie header explicitly rather than relying on the
    // supertest agent because the route marks the cookie `Secure` whenever
    // REPLIT_DOMAINS is set in the env, and the agent (over HTTP) won't
    // resend a Secure cookie.
    const me = await request(app)
      .get("/portal/me")
      .set("Cookie", `eiq_supplier_session=${cookieMatch![1]}`);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ email: "supplier@example.com" });

    // The original magic-link row was burned, and a NEW long-lived session
    // (~30 days) is on file with sha256(cookieSecret) as its tokenHash.
    expect(dbState.sessions.find((s) => s.id === magicLinkRow.id)).toBeUndefined();
    const liveSessions = dbState.sessions.filter(
      (s) => s.email === "supplier@example.com",
    );
    expect(liveSessions).toHaveLength(1);
    expect(liveSessions[0].tokenHash).toBe(sha256hex(cookieSecret));
    const liveTtlDays =
      (liveSessions[0].expiresAt.getTime() - Date.now()) / (86_400 * 1000);
    expect(liveTtlDays).toBeGreaterThan(29);
    expect(liveTtlDays).toBeLessThan(31);

    // Exactly one verify-success audit row, scoped to the supplier email.
    const verifySuccess = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "success",
    );
    expect(verifySuccess).toHaveLength(1);
    expect(verifySuccess[0]).toMatchObject({
      userEmail: "supplier@example.com",
    });
    // No verify-failure row must accompany the success.
    expect(
      getAuditCalls().some(
        (a) =>
          a.action === "auth.supplier_portal_magic_link.verify" &&
          a.outcome === "failure",
      ),
    ).toBe(false);
  });

  it("replay of an already-used magic-link token redirects to /portal/login?error=expired and does NOT establish a session (audits failure)", async () => {
    // Drive request → verify so we have a real, just-consumed magic-link.
    dbState.supplierAuditExists = true;
    const app = makeApp();
    const setupAgent = request.agent(app);

    await setupAgent
      .post("/portal/request-link")
      .send({ email: "supplier@example.com" })
      .expect(200);

    const { token: rawToken } = extractTokenFromMail();
    await setupAgent
      .get(
        `/portal/verify?token=${encodeURIComponent(rawToken)}&email=supplier@example.com`,
      )
      .redirects(0)
      .expect(302);

    // Replay with a fresh agent so the new cookie session can't make this
    // look like success.
    const replayAgent = request.agent(app);
    const replay = await replayAgent
      .get(
        `/portal/verify?token=${encodeURIComponent(rawToken)}&email=supplier@example.com`,
      )
      .redirects(0);

    expect(replay.status).toBe(302);
    expect(replay.headers.location).toMatch(/\/portal\/login\?error=expired$/);
    expect(replay.headers["set-cookie"]).toBeUndefined();

    // Exactly one verify-success row total — the replay must NOT also be
    // logged as success.
    const verifySuccess = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "success",
    );
    expect(verifySuccess).toHaveLength(1);
    // And the replay attempt itself produced exactly one verify-failure row.
    const verifyFail = getAuditCalls().filter(
      (a) =>
        a.action === "auth.supplier_portal_magic_link.verify" &&
        a.outcome === "failure",
    );
    expect(verifyFail).toHaveLength(1);
    expect(verifyFail[0]).toMatchObject({
      details: { reason: "invalid_or_expired" },
    });
  });
});
