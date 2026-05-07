/**
 * Regression tests for the magic-link sign-in flow.
 *
 * These guard `POST /api/auth/magic-link/request` and
 * `GET /api/auth/magic-link/verify` against silent regressions. Network IO
 * (mailer, audit logger, DB) is mocked at the module boundary so the suite
 * is fully hermetic.
 *
 * Mock semantics worth knowing:
 *   - The magic-link insert captures the row into `dbState.magicLink` exactly
 *     as the route writes it, including the SHA-256-hashed token. Tests
 *     assert that the persisted token is NOT the raw token (replay defence).
 *   - `magicLinksTable.findFirst` walks the drizzle where expression looking
 *     for the stored hashed token. If the route queries with a token whose
 *     SHA-256 doesn't appear anywhere in the where clause, the mock returns
 *     null — so a future regression that drops or weakens the hash predicate
 *     would surface here. The mock deliberately does NOT filter on `usedAt`:
 *     the route's atomic UPDATE...WHERE usedAt IS NULL is the real gate and
 *     must be exercised, including the replay → empty `returning()` path
 *     that produces `?error=already_used`.
 *   - `db.update(magicLinksTable).set(...).where(...).returning()` is wired
 *     to flip `usedAt` only when it is currently null, mirroring production.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// In-memory stand-in for the rows the magic-link routes read/write.
type MagicLinkRow = {
  id: string;
  userId: string;
  token: string; // hashed, as the route writes it
  expiresAt: Date;
  usedAt: Date | null;
};

const dbState: {
  user: Record<string, unknown> | null;
  organisation: Record<string, unknown> | null;
  magicLink: MagicLinkRow | null;
} = {
  user: null,
  organisation: null,
  magicLink: null,
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
    if (Array.isArray(v)) {
      return v.some(visit);
    }
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
    magicLinksTable: { _t: "magic_links" as const },
    passkeysTable: { _t: "passkeys" as const },
    webAuthnChallengesTable: { _t: "webauthn_challenges" as const },
    organisationsTable: { _t: "organisations" as const },
    ssoIdentitiesTable: { _t: "sso_identities" as const },
    auditLogsTable: { _t: "audit_logs" as const },
  };

  const insertCall = vi.fn((table: { _t: string }) => ({
    values: vi.fn((row: Record<string, unknown>) => {
      if (table === tables.magicLinksTable) {
        dbState.magicLink = {
          id: String(row.id),
          userId: String(row.userId),
          token: String(row.token),
          expiresAt: row.expiresAt as Date,
          usedAt: (row.usedAt as Date | null | undefined) ?? null,
        };
      }
      // Both `await db.insert(t).values(row)` and
      // `db.insert(t).values(row).returning()` need to work; returning a
      // plain object satisfies the first (await on a non-thenable resolves
      // to the value) and exposes a `.returning()` for the latter.
      return {
        returning: vi.fn(async () => [row]),
      };
    }),
  }));

  const updateCall = vi.fn((table: { _t: string }) => ({
    set: vi.fn((updates: Record<string, unknown>) => {
      // The route uses `.where(...).returning()` for the atomic mark on
      // magic-link verify, and bare `.where(...)` (awaited) for the simple
      // `lastLoginAt` update. We expose both shapes.
      const exec = async () => {
        if (
          table === tables.magicLinksTable &&
          dbState.magicLink &&
          dbState.magicLink.usedAt === null
        ) {
          dbState.magicLink.usedAt =
            (updates.usedAt as Date | undefined) ?? new Date();
          return [{ ...dbState.magicLink }];
        }
        return [];
      };
      const whereResult = {
        // Make the chain awaitable directly (returns undefined like prod
        // when `.returning()` is not called).
        then: <T>(
          onFulfilled?: (value: undefined) => T | PromiseLike<T>,
          onRejected?: (reason: unknown) => T | PromiseLike<T>,
        ) => Promise.resolve<undefined>(undefined).then(onFulfilled, onRejected),
        returning: vi.fn(exec),
      };
      return { where: vi.fn(() => whereResult) };
    }),
  }));

  const deleteCall = vi.fn(() => ({
    where: vi.fn(async () => undefined),
  }));

  const db = {
    query: {
      usersTable: { findFirst: vi.fn(async () => dbState.user) },
      organisationsTable: {
        findFirst: vi.fn(async () => dbState.organisation),
      },
      magicLinksTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          if (!dbState.magicLink) return null;
          // Mirror the route's `expiresAt > now()` predicate so the expired
          // token test works without separate plumbing. Replay protection
          // is enforced by the atomic UPDATE below, not here.
          if (dbState.magicLink.expiresAt.getTime() <= Date.now()) return null;
          // Fidelity check: the route MUST query with the SHA-256 hash of
          // the raw token. Walk the drizzle where expression and confirm
          // the stored hash appears in it; otherwise treat as no match.
          // This catches regressions that drop the token predicate or
          // accidentally compare against the raw token.
          if (!whereContainsValue(args?.where, dbState.magicLink.token)) {
            return null;
          }
          return { ...dbState.magicLink };
        }),
      },
      ssoIdentitiesTable: { findFirst: vi.fn(async () => null) },
      passkeysTable: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
      },
      webAuthnChallengesTable: { findFirst: vi.fn(async () => null) },
    },
    insert: insertCall,
    update: updateCall,
    delete: deleteCall,
  };

  return { db, ...tables };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import { createHash } from "node:crypto";
import authRouter from "../auth.js";
import * as audit from "../../lib/audit.js";
import * as mailer from "../../lib/mailer.js";

// ─── Helpers ────────────────────────────────────────────────────────────────
type AuditCall = {
  action: string;
  outcome?: "success" | "failure";
  organisationId?: string;
  userId?: string;
  userEmail?: string;
  details?: Record<string, unknown>;
};

function getAuditCalls(): AuditCall[] {
  const mock = audit.logAudit as unknown as { mock: { calls: [AuditCall][] } };
  return mock.mock.calls.map((c) => c[0]);
}

function getMailerCalls(): Array<[string, string]> {
  const mock = mailer.sendMagicLinkEmail as unknown as {
    mock: { calls: [string, string][] };
  };
  return mock.mock.calls;
}

function sha256b64url(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

function makeApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
      name: "eiq.sid",
      cookie: { secure: false, httpOnly: true, sameSite: "lax" },
    }),
  );
  app.use("/api/auth", authRouter);
  // Probe used to verify whether a session was established without going
  // through requireAuth (which would pull additional DB stubs).
  app.get("/__test/whoami", (req: Request, res: Response) => {
    res.json({
      userId: req.session.userId ?? null,
      email: req.session.email ?? null,
      role: req.session.role ?? null,
    });
  });
  return app;
}

const baseUser = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  role: "org_user",
  organisationId: "org-1",
  isActive: true,
  requiredSignInProvider: null as string | null,
  allowedSignInMethods: null as string[] | null,
};

const baseOrg = {
  id: "org-1",
  name: "Test Org",
  isActive: true,
  billingStatus: "active",
  googleSsoEnabled: true,
  microsoftSsoEnabled: true,
  allowedSignInMethods: ["magic_link", "passkey", "google_sso", "microsoft_sso"],
  requiredSsoProvider: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.user = { ...baseUser };
  dbState.organisation = { ...baseOrg };
  dbState.magicLink = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Extract the raw token from the URL passed to the mailer. */
function extractTokenFromMail(): string {
  const calls = getMailerCalls();
  expect(calls.length).toBe(1);
  const [, url] = calls[0];
  const u = new URL(url);
  const token = u.searchParams.get("token");
  expect(token).toBeTruthy();
  return token!;
}

// ─── POST /api/auth/magic-link/request ──────────────────────────────────────
describe("POST /api/auth/magic-link/request", () => {
  it("rejects an obviously invalid email with 400 and never queries the DB", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/magic-link/request")
      .send({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Invalid email" });
    expect(getMailerCalls()).toHaveLength(0);
    expect(dbState.magicLink).toBeNull();
    // Invalid input short-circuits before any audit row is written.
    expect(getAuditCalls()).toHaveLength(0);
  });

  it("returns the generic 200 for an unknown email and audits request.unknown — no email sent, no token stored", async () => {
    dbState.user = null;
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/magic-link/request")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      message: expect.stringMatching(/sign-in link has been sent/i),
    });
    expect(getMailerCalls()).toHaveLength(0);
    expect(dbState.magicLink).toBeNull();

    const audits = getAuditCalls();
    const unknown = audits.filter(
      (a) => a.action === "auth.magic_link.request.unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      outcome: "failure",
      details: { email: "nobody@example.com" },
    });
    // No success audit must leak that the email "almost worked".
    expect(audits.some((a) => a.action === "auth.magic_link.request")).toBe(false);
  });

  it("returns the generic 200 for an inactive user (no enumeration leak) and never sends mail", async () => {
    dbState.user = { ...baseUser, isActive: false };
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/magic-link/request")
      .send({ email: baseUser.email });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(getMailerCalls()).toHaveLength(0);
    expect(dbState.magicLink).toBeNull();

    const unknown = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.request.unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ outcome: "failure" });
  });

  it("normalises the email (trim + lowercase) before lookup", async () => {
    dbState.user = { ...baseUser };
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/magic-link/request")
      .send({ email: "  USER@Example.com  " });

    expect(res.status).toBe(200);
    expect(getMailerCalls()).toHaveLength(1);
    const [to] = getMailerCalls()[0];
    expect(to).toBe("user@example.com");
  });

  it("for a valid user: persists the token as a SHA-256 hash, sends email with the raw token, and audits success", async () => {
    dbState.user = { ...baseUser };
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/magic-link/request")
      .send({ email: baseUser.email });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    // Email was sent with a raw token in the URL query string.
    const rawToken = extractTokenFromMail();
    expect(rawToken.length).toBeGreaterThanOrEqual(32);

    // Persisted token is the SHA-256(rawToken) — a DB compromise must NOT
    // hand attackers usable links.
    expect(dbState.magicLink).not.toBeNull();
    expect(dbState.magicLink!.token).toBe(sha256b64url(rawToken));
    expect(dbState.magicLink!.token).not.toBe(rawToken);
    expect(dbState.magicLink!.userId).toBe(baseUser.id);
    expect(dbState.magicLink!.usedAt).toBeNull();
    // TTL is in the future (≈15 minutes); be lenient on exact ms.
    const ttlMs = dbState.magicLink!.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(15 * 60 * 1000 + 5_000);

    const success = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.request" && a.outcome === "success",
    );
    expect(success).toHaveLength(1);
    expect(success[0]).toMatchObject({ userId: baseUser.id });

    // Break-glass MUST NOT fire on the happy path.
    expect(
      getAuditCalls().some((a) => a.action === "auth.break_glass_magic_link"),
    ).toBe(false);
  });

  describe("org sign-in policy enforcement", () => {
    it("blocks a non-admin when the org REQUIRES SSO (audit failure with reason, no email, generic 200)", async () => {
      dbState.organisation = {
        ...baseOrg,
        requiredSsoProvider: "google",
        allowedSignInMethods: ["google_sso"],
      };
      dbState.user = { ...baseUser, role: "org_user" };

      const app = makeApp();
      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: baseUser.email });

      expect(res.status).toBe(200); // generic — never leaks the policy
      expect(getMailerCalls()).toHaveLength(0);
      expect(dbState.magicLink).toBeNull();

      const fail = getAuditCalls().filter(
        (a) =>
          a.action === "auth.magic_link.request" && a.outcome === "failure",
      );
      expect(fail).toHaveLength(1);
      expect(fail[0]).toMatchObject({
        userId: baseUser.id,
        userEmail: baseUser.email,
        organisationId: "org-1",
        details: { reason: "required_provider_mismatch" },
      });
      expect(
        getAuditCalls().some((a) => a.action === "auth.break_glass_magic_link"),
      ).toBe(false);
    });

    it("blocks a non-admin when magic-link is not in the org allow-list", async () => {
      dbState.organisation = {
        ...baseOrg,
        requiredSsoProvider: null,
        allowedSignInMethods: ["passkey", "google_sso"],
      };
      dbState.user = { ...baseUser, role: "org_user" };

      const app = makeApp();
      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: baseUser.email });

      expect(res.status).toBe(200);
      expect(getMailerCalls()).toHaveLength(0);
      expect(dbState.magicLink).toBeNull();

      const fail = getAuditCalls().filter(
        (a) =>
          a.action === "auth.magic_link.request" && a.outcome === "failure",
      );
      expect(fail).toHaveLength(1);
      expect(fail[0]).toMatchObject({
        userId: baseUser.id,
        details: { reason: "method_not_allowed" },
      });
    });

    it("BREAK-GLASS: an org_admin can magic-link in even when the org requires SSO (audits auth.break_glass_magic_link)", async () => {
      // This is the only path back in for a locked-out admin and cannot be
      // exercised by the SSO suite — it's magic-link-only by design.
      dbState.organisation = {
        ...baseOrg,
        requiredSsoProvider: "google",
        allowedSignInMethods: ["google_sso"],
      };
      dbState.user = { ...baseUser, role: "org_admin" };

      const app = makeApp();
      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: baseUser.email });

      expect(res.status).toBe(200);
      // Mail WAS sent — admin is allowed through.
      expect(getMailerCalls()).toHaveLength(1);
      expect(dbState.magicLink).not.toBeNull();
      expect(dbState.magicLink!.userId).toBe(baseUser.id);

      const audits = getAuditCalls();
      const breakGlass = audits.filter(
        (a) => a.action === "auth.break_glass_magic_link",
      );
      expect(breakGlass).toHaveLength(1);
      expect(breakGlass[0]).toMatchObject({
        outcome: "success",
        userId: baseUser.id,
        organisationId: "org-1",
        details: { role: "org_admin", email: baseUser.email },
      });

      // Standard success audit is also written.
      const success = audits.filter(
        (a) => a.action === "auth.magic_link.request" && a.outcome === "success",
      );
      expect(success).toHaveLength(1);
    });

    it("BREAK-GLASS: an org_admin can magic-link in even when the org allow-list excludes magic_link", async () => {
      dbState.organisation = {
        ...baseOrg,
        requiredSsoProvider: null,
        allowedSignInMethods: ["passkey", "google_sso"],
      };
      dbState.user = { ...baseUser, role: "org_admin" };

      const app = makeApp();
      const res = await request(app)
        .post("/api/auth/magic-link/request")
        .send({ email: baseUser.email });

      expect(res.status).toBe(200);
      expect(getMailerCalls()).toHaveLength(1);
      expect(dbState.magicLink).not.toBeNull();

      const breakGlass = getAuditCalls().filter(
        (a) => a.action === "auth.break_glass_magic_link",
      );
      expect(breakGlass).toHaveLength(1);
      expect(breakGlass[0]).toMatchObject({ userId: baseUser.id });
    });
  });
});

// ─── GET /api/auth/magic-link/verify (interstitial — does NOT consume) ─────
//
// The GET endpoint MUST NOT consume the token, because email-security gateways
// (Microsoft Defender Safe Links, Proofpoint, Mimecast, Gmail link-preview)
// fetch every URL in incoming mail to scan it. A GET-consumes design lets the
// scanner burn the token before the human ever clicks. The interstitial GET
// renders an HTML page that auto-POSTs; only POST consumes.
describe("GET /api/auth/magic-link/verify (interstitial)", () => {
  it("redirects to ?error=invalid_link when the token query param is missing", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent.get("/api/auth/magic-link/verify").redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=invalid_link$/);

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("does NOT consume a valid token on GET — email-scanner pre-fetch defence", async () => {
    // Regression guard for the customer-reported "magic link said expired on
    // first click" bug: a corporate mail security gateway GETs the link while
    // scanning the inbound email. If GET consumes, the human's real click then
    // sees no matching unused row and gets redirected to ?error=expired.
    const rawToken = "scanner-prefetch-token";
    dbState.magicLink = {
      id: "ml-prefetch",
      userId: baseUser.id,
      token: sha256b64url(rawToken),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
    };

    const app = makeApp();
    // Fresh agent simulates the scanner — different IP/cookie than the user.
    const scanner = request.agent(app);
    const res = await scanner
      .get(`/api/auth/magic-link/verify?token=${encodeURIComponent(rawToken)}`)
      .redirects(0);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    // The interstitial must not be cached anywhere along the path.
    expect(res.headers["cache-control"]).toMatch(/no-store/);
    // The token MUST still be unused after the scanner GET.
    expect(dbState.magicLink!.usedAt).toBeNull();
    // No verify audit (success OR failure) on the GET side — those belong to POST.
    const verifyAudits = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.verify",
    );
    expect(verifyAudits).toHaveLength(0);

    // The interstitial form must POST back to the verify endpoint with the
    // token in a hidden field, not GET it.
    expect(res.text).toMatch(/method="POST"/i);
    expect(res.text).toMatch(/action="[^"]*\/api\/auth\/magic-link\/verify"/);
    expect(res.text).toContain(`value="${rawToken}"`);
  });

  it("HEAD on the verify URL also does not consume — some scanners use HEAD before GET", async () => {
    // Production logs showed Defender / similar gateways issue HEAD as well as
    // GET while scanning. Express routes HEAD to the GET handler, but pin it
    // down so a future refactor (e.g. moving consumption back into GET) can't
    // silently re-introduce the scanner-burn bug via the HEAD path.
    const rawToken = "head-prefetch-token";
    dbState.magicLink = {
      id: "ml-head",
      userId: baseUser.id,
      token: sha256b64url(rawToken),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
    };

    const app = makeApp();
    const scanner = request.agent(app);
    const res = await scanner
      .head(`/api/auth/magic-link/verify?token=${encodeURIComponent(rawToken)}`)
      .redirects(0);

    // 200 (interstitial body) — what matters is the side effect, not the code.
    expect([200, 304]).toContain(res.status);
    expect(dbState.magicLink!.usedAt).toBeNull();
    const verifyAudits = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.verify",
    );
    expect(verifyAudits).toHaveLength(0);
  });

  it("HTML-escapes the token and base URL so a hostile token can't break out of the form", async () => {
    // Tokens are base64url in production but the route should be defence-in-
    // depth: an attacker-supplied query string must not be able to inject
    // markup into the interstitial.
    const app = makeApp();
    const agent = request.agent(app);
    const evil = `"><script>alert(1)</script>`;
    const res = await agent
      .get(`/api/auth/magic-link/verify?token=${encodeURIComponent(evil)}`)
      .redirects(0);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("<script>alert(1)</script>");
    expect(res.text).toContain("&lt;script&gt;");
  });
});

// ─── POST /api/auth/magic-link/verify (the actual consumer) ────────────────
describe("POST /api/auth/magic-link/verify", () => {
  it("redirects to ?error=invalid_link when the token is missing", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send("")
      .redirects(0);

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=invalid_link$/);

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("redirects to ?error=expired for an unknown token and never establishes a session", async () => {
    dbState.magicLink = null; // nothing on file
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: "nope-not-a-real-token" })
      .redirects(0);

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=expired$/);

    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.verify" && a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      details: { reason: "invalid_or_expired" },
    });

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("redirects to ?error=expired when a valid link is on file but the body token doesn't match its hash", async () => {
    // A different (still-valid) link exists; the body presents a token whose
    // SHA-256 is NOT the stored hash. The route MUST still treat this as
    // not-found rather than letting the wrong link through. The mock's
    // hash-aware findFirst makes this regression-detectable.
    const realRaw = "real-token-for-other-user";
    dbState.magicLink = {
      id: "ml-real",
      userId: baseUser.id,
      token: sha256b64url(realRaw),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
    };

    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: "totally-different-token" })
      .redirects(0);

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=expired$/);
    // The legitimate link MUST NOT be marked used by the wrong-token attempt.
    expect(dbState.magicLink!.usedAt).toBeNull();

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("redirects to ?error=expired when the token is present but expired", async () => {
    const rawToken = "expired-token-raw";
    dbState.magicLink = {
      id: "ml-1",
      userId: baseUser.id,
      token: sha256b64url(rawToken),
      expiresAt: new Date(Date.now() - 60 * 1000), // 60s ago
      usedAt: null,
    };

    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: rawToken })
      .redirects(0);

    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=expired$/);
    // Expired link must NOT be marked used.
    expect(dbState.magicLink!.usedAt).toBeNull();

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("happy path: establishes a session, marks the link usedAt, and 303s into the app", async () => {
    // Drive the request endpoint first so we exercise the full hash-then-verify
    // round-trip with a token the route generated itself.
    dbState.user = { ...baseUser };
    const app = makeApp();
    const agent = request.agent(app);

    await agent
      .post("/api/auth/magic-link/request")
      .send({ email: baseUser.email })
      .expect(200);

    const rawToken = extractTokenFromMail();
    expect(dbState.magicLink!.token).toBe(sha256b64url(rawToken));
    expect(dbState.magicLink!.usedAt).toBeNull();

    const res = await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: rawToken })
      .redirects(0);

    expect(res.status).toBe(303);
    // Either dashboard or the passkey-enrolment landing — both are valid
    // post-sign-in destinations depending on whether the user has a passkey.
    expect(res.headers.location).toMatch(
      /\/app\/(dashboard|account\?enroll_passkey=1)$/,
    );

    // Atomic mark-used must have fired.
    expect(dbState.magicLink!.usedAt).toBeInstanceOf(Date);

    const verifySuccess = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.verify" && a.outcome === "success",
    );
    expect(verifySuccess).toHaveLength(1);
    expect(verifySuccess[0]).toMatchObject({ userId: baseUser.id });

    const me = await agent.get("/__test/whoami");
    expect(me.body).toMatchObject({
      userId: baseUser.id,
      email: baseUser.email,
      role: baseUser.role,
    });
  });

  it("accepts the token via query string as a fallback (noscript form GET would never reach this — POST body is the contract)", async () => {
    // Defence-in-depth: the route falls back to req.query.token if the body
    // is empty, so misconfigured proxies or future client changes still work.
    dbState.user = { ...baseUser };
    const app = makeApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/magic-link/request")
      .send({ email: baseUser.email })
      .expect(200);
    const rawToken = extractTokenFromMail();

    const res = await agent
      .post(
        `/api/auth/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      )
      .redirects(0);

    expect(res.status).toBe(303);
    expect(dbState.magicLink!.usedAt).toBeInstanceOf(Date);
  });

  it("replay of an already-used token redirects to ?error=already_used and does not re-establish a session", async () => {
    // First request + verify.
    dbState.user = { ...baseUser };
    const app = makeApp();
    const agent = request.agent(app);
    await agent
      .post("/api/auth/magic-link/request")
      .send({ email: baseUser.email })
      .expect(200);

    const rawToken = extractTokenFromMail();
    await agent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: rawToken })
      .redirects(0)
      .expect(303);
    expect(dbState.magicLink!.usedAt).toBeInstanceOf(Date);
    const firstUsedAt = dbState.magicLink!.usedAt!.getTime();

    // Replay with a fresh agent so a leftover session can't make this look
    // like success.
    const replayAgent = request.agent(app);
    const replay = await replayAgent
      .post("/api/auth/magic-link/verify")
      .type("form")
      .send({ token: rawToken })
      .redirects(0);

    expect(replay.status).toBe(303);
    expect(replay.headers.location).toMatch(
      /\/app\/sign-in\?error=already_used$/,
    );
    // usedAt was NOT bumped a second time.
    expect(dbState.magicLink!.usedAt!.getTime()).toBe(firstUsedAt);

    const me = await replayAgent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();

    // Exactly one verify-success audit overall — replay must not log success.
    const verifySuccess = getAuditCalls().filter(
      (a) => a.action === "auth.magic_link.verify" && a.outcome === "success",
    );
    expect(verifySuccess).toHaveLength(1);
  });
});
