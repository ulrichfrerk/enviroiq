/**
 * Regression tests for the passkey (WebAuthn) sign-in flow.
 *
 * These guard `POST /api/auth/passkey/login/options`,
 * `POST /api/auth/passkey/login/verify`,
 * `POST /api/auth/passkey/register/options`, and
 * `POST /api/auth/passkey/register/verify` against silent regressions.
 *
 * What's mocked and why:
 *   - `@simplewebauthn/server` is fully stubbed so each test can control
 *     whether `verifyAuthenticationResponse` / `verifyRegistrationResponse`
 *     reports success and what `newCounter` they emit. The route's behaviour
 *     under each outcome is what we're asserting; the upstream library is
 *     out of scope.
 *   - `@workspace/db` is stubbed at the boundary. A small in-memory `dbState`
 *     models exactly what the passkey routes touch:
 *       * user row (read by `requireAuth` and the verify path)
 *       * organisation row (read by `requireAuth` → `checkOrgLoginAllowed`)
 *       * passkey row (looked up by credentialId on login, by userId on
 *         register-options)
 *       * webauthn challenge row (inserted by `/options`, read by `/verify`)
 *     The challenge table mock honours the `expiresAt > now()` predicate so
 *     the "expired challenge" test works without separate plumbing.
 *   - The audit logger is stubbed; tests assert which audit rows are written
 *     (and which are NOT — e.g. a successful login MUST NOT also write a
 *     failure row).
 *
 * Why these tests exist (security properties they pin down):
 *   1. `/passkey/login/options` enforces org sign-in policy and writes a
 *      `auth.passkey.login` failure row with stage=options when refused.
 *   2. `/passkey/login/verify` re-checks the same policy AFTER cryptographic
 *      verification — defends against an attacker who calls `/verify`
 *      directly and bypasses `/options`.
 *   3. A successful verify rotates the session id (anti-fixation), updates
 *      the credential counter, deletes the consumed challenge, and writes
 *      `auth.passkey.login` success.
 *   4. Missing challenge (no `/options` first) → 400; expired challenge
 *      (in DB but past `expiresAt`) → 400. Neither establishes a session
 *      nor mutates the credential counter.
 *   5. `/passkey/register/verify` requires an in-progress session challenge
 *      and audits the registration outcome.
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
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: "reg-challenge-from-lib",
    rp: { name: "EnviroIQ", id: "test.local" },
    user: { id: "u", name: "u@example.com", displayName: "U" },
    pubKeyCredParams: [],
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: "new-credential-id",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ["internal"] as string[],
      },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
    },
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: "auth-challenge-from-lib",
    rpId: "test.local",
    allowCredentials: [],
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 7 },
  })),
}));

// ─── In-memory DB state ─────────────────────────────────────────────────────

type ChallengeRow = {
  id: string;
  challenge: string;
  email: string | null;
  type: "registration" | "authentication";
  expiresAt: Date;
};

type PasskeyRow = {
  id: string;
  userId: string;
  credentialId: string;
  credentialPublicKey: string;
  counter: string;
  deviceType: string;
  backedUp: boolean;
  transports: string | null;
  label: string | null;
};

const dbState: {
  user: Record<string, unknown> | null;
  organisation: Record<string, unknown> | null;
  passkey: PasskeyRow | null;
  // Extra passkey rows beyond the primary `passkey` field. The DELETE
  // handler counts ALL of the user's passkeys to enforce its
  // "would leave no sign-in path" guard, so the unlink tests need to be
  // able to model "user has more than one passkey" without rewriting the
  // login/register tests that assume a single row.
  extraPasskeys: PasskeyRow[];
  // Linked SSO identities for the user. The DELETE /passkeys/:id guard
  // also consults this to decide whether removing the last passkey would
  // strand the user.
  ssoIdentities: { id: string; userId: string }[];
  challenge: ChallengeRow | null;
  insertedPasskey: Record<string, unknown> | null;
  counterUpdate: { id: string; counter: string } | null;
  // Set whenever the passkey login verify path stamps lastUsedAt — this is
  // the "successful login" signal the Account page reads, so failed/blocked
  // logins MUST leave it null.
  lastUsedUpdate: { id: string; at: Date } | null;
  // Set whenever PATCH /auth/passkeys/:id writes a new label. Tracked
  // separately from the other update fields so rename tests can assert
  // "exactly one label update happened with this value".
  labelUpdate: { id: string; label: string | null } | null;
  deletedChallengeIds: string[];
  deletedPasskeyIds: string[];
} = {
  user: null,
  organisation: null,
  passkey: null,
  extraPasskeys: [],
  ssoIdentities: [],
  challenge: null,
  insertedPasskey: null,
  counterUpdate: null,
  lastUsedUpdate: null,
  labelUpdate: null,
  deletedChallengeIds: [],
  deletedPasskeyIds: [],
};

/**
 * Walk a drizzle `where` expression and report whether `needle` appears
 * anywhere as a string parameter. Used so the challenge mock can require
 * the route to actually pass the stored challenge id (rather than silently
 * returning the row regardless of predicate).
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
      if (table === tables.webAuthnChallengesTable) {
        dbState.challenge = {
          id: String(row.id),
          challenge: String(row.challenge),
          email: (row.email as string | null | undefined) ?? null,
          type: row.type as "registration" | "authentication",
          expiresAt: row.expiresAt as Date,
        };
      } else if (table === tables.passkeysTable) {
        dbState.insertedPasskey = { ...row };
      }
      return { returning: vi.fn(async () => [row]) };
    }),
  }));

  const updateCall = vi.fn((table: { _t: string }) => ({
    set: vi.fn((updates: Record<string, unknown>) => ({
      where: vi.fn(async (whereExpr: unknown) => {
        if (
          table === tables.passkeysTable &&
          dbState.passkey &&
          whereContainsValue(whereExpr, dbState.passkey.id)
        ) {
          // The verify path issues two separate UPDATEs against passkeys:
          // one for `counter` (always, for replay defence) and a later one
          // for `lastUsedAt` (only after policy/active checks succeed).
          // Track them separately so tests can assert each independently.
          if (Object.prototype.hasOwnProperty.call(updates, "counter")) {
            dbState.counterUpdate = {
              id: dbState.passkey.id,
              counter: String(updates.counter ?? ""),
            };
            dbState.passkey.counter = String(updates.counter ?? dbState.passkey.counter);
          }
          if (Object.prototype.hasOwnProperty.call(updates, "lastUsedAt")) {
            const value = updates.lastUsedAt;
            dbState.lastUsedUpdate = {
              id: dbState.passkey.id,
              at: value instanceof Date ? value : new Date(String(value)),
            };
          }
          if (Object.prototype.hasOwnProperty.call(updates, "label")) {
            const value = updates.label;
            const next =
              value === null || value === undefined ? null : String(value);
            dbState.labelUpdate = { id: dbState.passkey.id, label: next };
            dbState.passkey.label = next;
          }
        }
        return undefined;
      }),
    })),
  }));

  const deleteCall = vi.fn((table: { _t: string }) => ({
    where: vi.fn(async (whereExpr: unknown) => {
      if (table === tables.webAuthnChallengesTable && dbState.challenge) {
        if (whereContainsValue(whereExpr, dbState.challenge.id)) {
          dbState.deletedChallengeIds.push(dbState.challenge.id);
          dbState.challenge = null;
        }
      }
      if (
        table === tables.passkeysTable &&
        dbState.passkey &&
        whereContainsValue(whereExpr, dbState.passkey.id)
      ) {
        dbState.deletedPasskeyIds.push(dbState.passkey.id);
      }
      return undefined;
    }),
  }));

  const db = {
    query: {
      usersTable: { findFirst: vi.fn(async () => dbState.user) },
      organisationsTable: { findFirst: vi.fn(async () => dbState.organisation) },
      magicLinksTable: { findFirst: vi.fn(async () => null) },
      ssoIdentitiesTable: {
        findFirst: vi.fn(async () => null),
        // The DELETE /passkeys/:id guard counts the user's linked SSO
        // identities to decide whether removing this passkey would leave
        // them with no sign-in path. Tests can populate
        // `dbState.ssoIdentities` to model "this user also has SSO".
        findMany: vi.fn(async () => dbState.ssoIdentities.map((i) => ({ ...i }))),
      },
      passkeysTable: {
        // Return a shallow snapshot so callers see a stable view of the row
        // even if a later mock-side mutation (e.g. update mock writing
        // `label`) changes the underlying dbState. Mirrors real Drizzle
        // behaviour where `findFirst` returns a fresh row object per call.
        findFirst: vi.fn(async () => (dbState.passkey ? { ...dbState.passkey } : null)),
        findMany: vi.fn(async () => {
          const rows: PasskeyRow[] = [];
          if (dbState.passkey) rows.push({ ...dbState.passkey });
          for (const p of dbState.extraPasskeys) rows.push({ ...p });
          return rows;
        }),
      },
      webAuthnChallengesTable: {
        findFirst: vi.fn(async (args?: { where?: unknown }) => {
          if (!dbState.challenge) return null;
          // Honour `expiresAt > now()` — expired rows must not match.
          if (dbState.challenge.expiresAt.getTime() <= Date.now()) return null;
          // Fidelity check: route MUST query by the stored challenge id.
          if (!whereContainsValue(args?.where, dbState.challenge.id)) return null;
          return { ...dbState.challenge };
        }),
      },
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
import authRouter from "../auth.js";
import * as audit from "../../lib/audit.js";
import * as webauthn from "@simplewebauthn/server";

// Reuse the real upstream return types so test stubs stay shape-locked to
// the library — if @simplewebauthn/server changes its result shape, these
// stubs (and any tests built on them) will fail to compile rather than
// silently drift.
type VerifiedAuth = Awaited<ReturnType<typeof webauthn.verifyAuthenticationResponse>>;
type VerifiedReg = Awaited<ReturnType<typeof webauthn.verifyRegistrationResponse>>;
type AuthOptions = Awaited<ReturnType<typeof webauthn.generateAuthenticationOptions>>;
type RegOptions = Awaited<ReturnType<typeof webauthn.generateRegistrationOptions>>;

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
  // Test-only login: stamp a session as if the user signed in via magic
  // link, so we can exercise the requireAuth-protected register endpoints
  // without dragging the whole magic-link flow into this suite.
  app.post("/__test/login", (req: Request, res: Response) => {
    const u = dbState.user as Record<string, unknown> | null;
    if (!u) {
      res.status(500).json({ error: "no user in dbState" });
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
  // Probe used to verify whether a session was established without going
  // through requireAuth (which would pull additional DB stubs).
  app.get("/__test/whoami", (req: Request, res: Response) => {
    res.json({
      userId: req.session.userId ?? null,
      email: req.session.email ?? null,
      role: req.session.role ?? null,
    });
  });
  app.use("/api/auth", authRouter);
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

const basePasskey: PasskeyRow = {
  id: "pk-1",
  userId: "user-1",
  credentialId: "credential-id-abc",
  credentialPublicKey: Buffer.from([10, 20, 30]).toString("base64url"),
  counter: "3",
  deviceType: "singleDevice",
  backedUp: false,
  transports: "internal",
  label: null,
};

/** Build a successful authentication verification result, narrowed to VerifiedAuth. */
function makeVerifiedAuth(overrides: Partial<VerifiedAuth> = {}): VerifiedAuth {
  return {
    verified: true,
    authenticationInfo: {
      newCounter: 7,
      credentialID: basePasskey.credentialId,
      userVerified: false,
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      origin: "https://test.local",
      rpID: "test.local",
    },
    ...overrides,
  } as VerifiedAuth;
}

/** Build a successful registration verification result, narrowed to VerifiedReg. */
function makeVerifiedReg(overrides: Partial<VerifiedReg> = {}): VerifiedReg {
  return {
    verified: true,
    registrationInfo: {
      credential: {
        id: "new-credential-id",
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ["internal"],
      },
      credentialDeviceType: "singleDevice",
      credentialBackedUp: false,
      fmt: "none",
      aaguid: "00000000-0000-0000-0000-000000000000",
      attestationObject: new Uint8Array([]),
      userVerified: false,
      origin: "https://test.local",
      rpID: "test.local",
    },
    ...overrides,
  } as VerifiedReg;
}

function makeAuthOptions(): AuthOptions {
  return {
    challenge: "auth-challenge-from-lib",
    rpId: "test.local",
    allowCredentials: [],
    timeout: 60000,
    userVerification: "preferred",
  } as AuthOptions;
}

function makeRegOptions(): RegOptions {
  return {
    challenge: "reg-challenge-from-lib",
    rp: { name: "EnviroIQ", id: "test.local" },
    user: { id: "u", name: "u@example.com", displayName: "U" },
    pubKeyCredParams: [],
    timeout: 60000,
    attestation: "none",
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  } as RegOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.user = { ...baseUser };
  dbState.organisation = { ...baseOrg };
  dbState.passkey = { ...basePasskey };
  dbState.challenge = null;
  dbState.insertedPasskey = null;
  dbState.counterUpdate = null;
  dbState.lastUsedUpdate = null;
  dbState.labelUpdate = null;
  dbState.deletedChallengeIds = [];
  dbState.deletedPasskeyIds = [];
  dbState.extraPasskeys = [];
  dbState.ssoIdentities = [];
  // Restore default verification stubs (individual tests may override).
  // The factories use the upstream return types so a future shape change
  // in @simplewebauthn/server breaks compilation here, not silently at
  // runtime.
  vi.mocked(webauthn.verifyAuthenticationResponse).mockResolvedValue(makeVerifiedAuth());
  vi.mocked(webauthn.verifyRegistrationResponse).mockResolvedValue(makeVerifiedReg());
  vi.mocked(webauthn.generateAuthenticationOptions).mockResolvedValue(makeAuthOptions());
  vi.mocked(webauthn.generateRegistrationOptions).mockResolvedValue(makeRegOptions());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Pull just the SID portion of the express-session cookie from a response. */
function sidFromSetCookie(setCookie: string | string[] | undefined): string | null {
  if (!setCookie) return null;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  if (arr.length === 0) return null;
  const eiq = arr.find((c) => c.startsWith("eiq.sid="));
  if (!eiq) return null;
  return eiq.split(";")[0]; // "eiq.sid=s%3A..."
}

// ─── /passkey/login/options ─────────────────────────────────────────────────
describe("POST /api/auth/passkey/login/options", () => {
  it("returns 403 when org policy disallows passkeys and writes auth.passkey.login failure (stage=options)", async () => {
    dbState.organisation = {
      ...baseOrg,
      allowedSignInMethods: ["magic_link", "google_sso"], // no passkey
    };

    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/passkey/login/options")
      .send({ email: baseUser.email });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: expect.stringMatching(/passkey/i),
      // Task #19: the response carries a structured `code` + `source` so
      // the sign-in page can render the same friendly amber restriction
      // callout the SSO callback flow uses. The code is `passkey_*` (mirrors
      // the SSO `sso_*` codes) and the source reflects the deciding policy.
      // For an org-level refusal (no per-user override) source MUST be "org".
      code: "passkey_method_not_allowed",
      source: "org",
    });

    // The challenge MUST NOT have been written for a refused request — a
    // future regression that audits-but-still-issues options would surface
    // here as a non-null challenge row.
    expect(dbState.challenge).toBeNull();

    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userId: baseUser.id,
      // `source` is also persisted in the audit trail so admins can
      // distinguish per-user-override refusals from org-wide ones when
      // diagnosing why a user couldn't sign in.
      details: { reason: "method_not_allowed", stage: "options", source: "org" },
    });
  });

  it("returns source=user when a per-user override (not org policy) is what refused passkey", async () => {
    // Task #19: wording on the sign-in page must match the deciding
    // policy source, so the API has to surface "user" vs "org". This
    // exercises the per-user-override branch end-to-end so a future
    // refactor that drops `policy.source` in the response would fail
    // here even if the org-level test above keeps passing.
    dbState.organisation = {
      ...baseOrg,
      // Org would allow passkey on its own.
      allowedSignInMethods: ["magic_link", "google_sso", "passkey"],
    };
    dbState.user = {
      ...baseUser,
      // …but this single user is restricted to magic_link only.
      allowedSignInMethods: ["magic_link"],
    };

    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/passkey/login/options")
      .send({ email: baseUser.email });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: "passkey_method_not_allowed",
      source: "user",
      // Wording reflects "your account" rather than "your organisation"
      // so a curl/test caller debugging without the UI sees the same
      // distinction the sign-in page would render.
      error: expect.stringMatching(/your account/i),
    });

    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({
      userId: baseUser.id,
      details: { reason: "method_not_allowed", stage: "options", source: "user" },
    });
  });

  it("on success: stores a challenge in DB, binds the challengeId to the session, and returns the options payload", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/passkey/login/options")
      .send({ email: baseUser.email });

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe("auth-challenge-from-lib");

    // Persisted challenge tracks the lib-issued value and is of authentication type.
    expect(dbState.challenge).not.toBeNull();
    expect(dbState.challenge!.type).toBe("authentication");
    expect(dbState.challenge!.challenge).toBe("auth-challenge-from-lib");
    // TTL ~5 minutes; be lenient.
    const ttlMs = dbState.challenge!.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(60_000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60 * 1000 + 5_000);

    // No failure audit on the happy path.
    expect(
      getAuditCalls().some(
        (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
      ),
    ).toBe(false);

    // The session cookie was issued (challenge id is bound to it).
    expect(sidFromSetCookie(res.headers["set-cookie"])).toBeTruthy();
  });

  it("for a unknown email: still issues options with empty allowCredentials (no enumeration leak), no policy audit", async () => {
    dbState.user = null;
    const app = makeApp();
    const res = await request(app)
      .post("/api/auth/passkey/login/options")
      .send({ email: "ghost@example.com" });

    expect(res.status).toBe(200);
    expect(dbState.challenge).not.toBeNull();
    // Policy is only evaluated once a user is found; unknown emails MUST NOT
    // produce policy-failure audit rows that could be used to enumerate.
    expect(
      getAuditCalls().some((a) => a.action === "auth.passkey.login"),
    ).toBe(false);
  });
});

// ─── /passkey/login/verify ──────────────────────────────────────────────────
describe("POST /api/auth/passkey/login/verify", () => {
  /** Drive `/options` first so the agent's session has the challenge id bound. */
  async function startLogin(agent: ReturnType<typeof request.agent>) {
    const res = await agent
      .post("/api/auth/passkey/login/options")
      .send({ email: baseUser.email });
    expect(res.status).toBe(200);
    return res;
  }

  it("missing-challenge and expired-challenge return 400 with INDISTINGUISHABLE responses (no leak about session state)", async () => {
    // The "Done looks like" spec for this task requires that callers cannot
    // distinguish "I never called /options" from "my challenge expired" —
    // otherwise an attacker can probe whether a stolen session cookie has
    // an in-progress passkey flow bound to it. This test exercises both
    // paths back-to-back from independent agents and asserts the response
    // shape is identical (status, body, and content-type).

    const app = makeApp();

    // Path 1: no /options was ever called → no session-bound challenge.
    const agentMissing = request.agent(app);
    const missing = await agentMissing
      .post("/api/auth/passkey/login/verify")
      .send({ id: basePasskey.credentialId, response: {} });

    // Path 2: /options was called, then the challenge row expired.
    const agentExpired = request.agent(app);
    await startLogin(agentExpired);
    dbState.challenge!.expiresAt = new Date(Date.now() - 60_000);
    const expired = await agentExpired
      .post("/api/auth/passkey/login/verify")
      .send({ id: basePasskey.credentialId, response: {} });

    // Identical status.
    expect(missing.status).toBe(400);
    expect(expired.status).toBe(400);
    // Identical content-type (a future regression that returned text in
    // one path and JSON in the other would be a leak too).
    expect(missing.headers["content-type"]).toBe(expired.headers["content-type"]);
    // Identical response body (must NOT distinguish the two conditions).
    expect(missing.body).toEqual(expired.body);
    // The body must not name "no authentication in progress" — that phrase
    // would tell the caller specifically that the missing-challenge branch
    // was hit. ("invalid or expired" is intentionally ambiguous about
    // which condition occurred and is therefore acceptable.)
    expect(JSON.stringify(missing.body)).not.toMatch(
      /no authentication in progress|no auth(entication)? in progress/i,
    );

    // Neither path may advance state.
    expect(dbState.counterUpdate).toBeNull();
    expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();
    expect(
      getAuditCalls().some(
        (a) => a.action === "auth.passkey.login" && a.outcome === "success",
      ),
    ).toBe(false);
  });

  it("re-checks org policy at /verify: refuses with 403 even when /options was bypassed", async () => {
    // Simulate an attacker who somehow has a valid session-bound challenge
    // (e.g. policy was relaxed when /options was issued, then tightened
    // again before /verify) and tries to slip past with a real assertion.
    const app = makeApp();
    const agent = request.agent(app);
    await startLogin(agent);

    // After /options succeeded, tighten the org policy to forbid passkeys.
    dbState.organisation = {
      ...baseOrg,
      allowedSignInMethods: ["magic_link", "google_sso"],
    };

    const res = await agent
      .post("/api/auth/passkey/login/verify")
      .send({
        id: basePasskey.credentialId,
        response: { signature: "stub" },
      });

    expect(res.status).toBe(403);

    // Cryptographic verification ran (the route must not skip it before
    // re-checking policy). NOTE: the route deliberately updates the
    // credential counter even when policy ultimately refuses the sign-in —
    // an authenticator assertion has been observed and the counter must
    // advance to defend against replay regardless of authorisation outcome.
    // We therefore assert the counter DID advance, but a session was NOT
    // established (the policy block must keep userId out of the session).
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
    expect(dbState.counterUpdate).toEqual({ id: basePasskey.id, counter: "7" });

    // BUT lastUsedAt MUST stay untouched — a policy-blocked attempt is not a
    // successful login, so the Account page's "Last used …" indicator must
    // not advance and pretend the device was actually used.
    expect(dbState.lastUsedUpdate).toBeNull();

    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
    );
    expect(fail.length).toBeGreaterThanOrEqual(1);
    // The verify-stage policy failure must specifically tag stage=verify so
    // we can distinguish it in the audit log from /options refusals.
    expect(
      fail.some((f) => (f.details as { stage?: string } | undefined)?.stage === "verify"),
    ).toBe(true);
    // No session may have been bound to the user — verify response carries
    // no `user` payload and the response body is not the success shape.
    expect(res.body).not.toMatchObject({ verified: true });

    // Direct probe: the agent's session must NOT carry a userId. A future
    // regression that updated the session before the policy re-check
    // would surface here even if the response shape stayed the same.
    const me = await agent.get("/__test/whoami");
    expect(me.body).toMatchObject({ userId: null, email: null, role: null });

    // Task #19: the verify-stage refusal MUST also carry the structured
    // `code` + `source` fields so the sign-in page can render the same
    // friendly amber restriction callout it shows for SSO refusals. A
    // future regression that returned only the legacy `error` string would
    // silently downgrade the UX to the small inline error banner.
    expect(res.body).toMatchObject({
      code: "passkey_method_not_allowed",
      source: "org",
      error: expect.stringMatching(/passkey/i),
    });
  });

  it("on success: rotates the session id, updates the credential counter, deletes the challenge, and audits success", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const optionsRes = await startLogin(agent);
    const sidBefore = sidFromSetCookie(optionsRes.headers["set-cookie"]);
    expect(sidBefore).toBeTruthy();

    const verifyRes = await agent
      .post("/api/auth/passkey/login/verify")
      .send({
        id: basePasskey.credentialId,
        response: { signature: "stub" },
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toMatchObject({
      verified: true,
      user: {
        userId: baseUser.id,
        email: baseUser.email,
        organisationId: baseUser.organisationId,
      },
    });

    // Counter rolled to whatever the WebAuthn library reported.
    expect(dbState.counterUpdate).toEqual({ id: basePasskey.id, counter: "7" });

    // lastUsedAt was bumped to "now" — this is what the Account page reads
    // to render "Last used …" / stale-after-90-days. We just assert a fresh
    // timestamp landed on the right passkey row (don't pin to ms precision).
    expect(dbState.lastUsedUpdate).not.toBeNull();
    expect(dbState.lastUsedUpdate?.id).toBe(basePasskey.id);
    expect(dbState.lastUsedUpdate?.at.getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(dbState.lastUsedUpdate?.at.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    // The consumed challenge was deleted (single-use).
    expect(dbState.deletedChallengeIds).toContain(
      // We captured the id in the `dbState.challenge` shape before delete
      // moved it; just assert at least one challenge id was deleted.
      dbState.deletedChallengeIds[0],
    );
    expect(dbState.deletedChallengeIds.length).toBeGreaterThanOrEqual(1);
    expect(dbState.challenge).toBeNull();

    // Session rotation: the eiq.sid cookie value MUST change after a
    // successful sign-in (anti-fixation). `regenerateSession` issues a new
    // session id; express-session re-sets the cookie because we modified
    // the session afterwards.
    const sidAfter = sidFromSetCookie(verifyRes.headers["set-cookie"]);
    expect(sidAfter).toBeTruthy();
    expect(sidAfter).not.toBe(sidBefore);

    // Exactly one success audit, no failure audit.
    const audits = getAuditCalls().filter((a) => a.action === "auth.passkey.login");
    expect(audits.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(audits.filter((a) => a.outcome === "failure")).toHaveLength(0);
    expect(audits.find((a) => a.outcome === "success")).toMatchObject({
      userId: baseUser.id,
    });
  });

  it("rejects with 400 when the credential is unknown and audits credential_unknown", async () => {
    // No passkey row matches the presented credential id.
    dbState.passkey = null;

    const app = makeApp();
    const agent = request.agent(app);
    await startLogin(agent);

    const res = await agent
      .post("/api/auth/passkey/login/verify")
      .send({ id: "not-a-known-credential", response: {} });

    expect(res.status).toBe(400);
    expect(webauthn.verifyAuthenticationResponse).not.toHaveBeenCalled();

    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
    );
    expect(fail.some((f) => (f.details as { reason?: string } | undefined)?.reason === "credential_unknown")).toBe(true);
  });

  it("rejects with 400 when verifyAuthenticationResponse returns verified=false (bad signature)", async () => {
    vi.mocked(webauthn.verifyAuthenticationResponse).mockResolvedValueOnce(
      makeVerifiedAuth({ verified: false }),
    );

    const app = makeApp();
    const agent = request.agent(app);
    await startLogin(agent);

    const res = await agent
      .post("/api/auth/passkey/login/verify")
      .send({
        id: basePasskey.credentialId,
        response: { signature: "tampered" },
      });

    expect(res.status).toBe(400);
    expect(dbState.counterUpdate).toBeNull();
    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.login" && a.outcome === "failure",
    );
    expect(fail.some((f) => f.userId === basePasskey.userId)).toBe(true);
  });
});

// ─── /passkey/register/verify ───────────────────────────────────────────────
describe("POST /api/auth/passkey/register/verify", () => {
  it("missing-challenge and expired-challenge return 400 with INDISTINGUISHABLE responses (mirrors login/verify)", async () => {
    // Same anti-leak property as the login flow: an authenticated user
    // hitting /register/verify with no in-progress challenge, vs one whose
    // challenge expired between /options and /verify, must be told the
    // same thing.
    const app = makeApp();

    // Path 1: signed in but never called /register/options.
    const agentMissing = request.agent(app);
    await agentMissing.post("/__test/login");
    const missing = await agentMissing
      .post("/api/auth/passkey/register/verify")
      .send({ id: "x", response: {} });

    // Path 2: signed in, called /register/options, then the row expired.
    const agentExpired = request.agent(app);
    await agentExpired.post("/__test/login");
    const optsRes = await agentExpired
      .post("/api/auth/passkey/register/options")
      .send({});
    expect(optsRes.status).toBe(200);
    expect(dbState.challenge).not.toBeNull();
    expect(dbState.challenge!.type).toBe("registration");
    dbState.challenge!.expiresAt = new Date(Date.now() - 60_000);
    const expired = await agentExpired
      .post("/api/auth/passkey/register/verify")
      .send({ id: "x", response: {} });

    expect(missing.status).toBe(400);
    expect(expired.status).toBe(400);
    expect(missing.headers["content-type"]).toBe(expired.headers["content-type"]);
    expect(missing.body).toEqual(expired.body);
    // Same anti-leak rule as login/verify: must not specifically name the
    // missing-challenge branch.
    expect(JSON.stringify(missing.body)).not.toMatch(
      /no registration in progress/i,
    );

    expect(dbState.insertedPasskey).toBeNull();
    expect(webauthn.verifyRegistrationResponse).not.toHaveBeenCalled();
    // No success audit row written for either rejection.
    expect(
      getAuditCalls().some(
        (a) => a.action === "auth.passkey.register" && a.outcome === "success",
      ),
    ).toBe(false);
  });

  it("on success: persists the new passkey row and audits auth.passkey.register success", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const optsRes = await agent.post("/api/auth/passkey/register/options").send({});
    expect(optsRes.status).toBe(200);
    expect(dbState.challenge).not.toBeNull();

    const verifyRes = await agent
      .post("/api/auth/passkey/register/verify")
      .send({
        id: "new-credential-id",
        response: { attestationObject: "stub" },
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body).toMatchObject({ verified: true });

    expect(dbState.insertedPasskey).not.toBeNull();
    expect(dbState.insertedPasskey).toMatchObject({
      userId: baseUser.id,
      credentialId: "new-credential-id",
    });
    // Counter was stored as a string (route writes String(credential.counter)).
    expect(typeof dbState.insertedPasskey!.counter).toBe("string");

    // Consumed challenge was deleted.
    expect(dbState.deletedChallengeIds.length).toBeGreaterThanOrEqual(1);
    expect(dbState.challenge).toBeNull();

    const audits = getAuditCalls().filter((a) => a.action === "auth.passkey.register");
    expect(audits.filter((a) => a.outcome === "success")).toHaveLength(1);
    expect(audits.filter((a) => a.outcome === "success")[0]).toMatchObject({
      userId: baseUser.id,
    });
    expect(audits.filter((a) => a.outcome === "failure")).toHaveLength(0);
  });

  it("audits auth.passkey.register failure when verifyRegistrationResponse returns verified=false", async () => {
    vi.mocked(webauthn.verifyRegistrationResponse).mockResolvedValueOnce(
      makeVerifiedReg({ verified: false }),
    );

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const optsRes = await agent.post("/api/auth/passkey/register/options").send({});
    expect(optsRes.status).toBe(200);

    const res = await agent
      .post("/api/auth/passkey/register/verify")
      .send({ id: "x", response: {} });

    expect(res.status).toBe(400);
    expect(dbState.insertedPasskey).toBeNull();
    const fail = getAuditCalls().filter(
      (a) => a.action === "auth.passkey.register" && a.outcome === "failure",
    );
    expect(fail).toHaveLength(1);
    expect(fail[0]).toMatchObject({ userId: baseUser.id });
  });
});

// ─── PATCH /passkeys/:id (rename) ───────────────────────────────────────────
describe("PATCH /api/auth/passkeys/:id", () => {
  it("renames a passkey, audits auth.passkey.renamed, and returns the updated row", async () => {
    dbState.passkey = { ...basePasskey, label: null };

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: "  MacBook Pro  " });

    expect(res.status).toBe(200);
    // Server trims surrounding whitespace before persisting.
    expect(res.body).toMatchObject({ id: basePasskey.id, label: "MacBook Pro" });
    expect(dbState.labelUpdate).toEqual({ id: basePasskey.id, label: "MacBook Pro" });

    const audits = getAuditCalls().filter((a) => a.action === "auth.passkey.renamed");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "auth.passkey.renamed",
      outcome: "success",
      userId: baseUser.id,
      details: { passkeyId: basePasskey.id, previousLabel: null, newLabel: "MacBook Pro" },
    });
  });

  it("clears the label when given null or an empty/whitespace string", async () => {
    // Pre-existing label that we then clear with `null`.
    dbState.passkey = { ...basePasskey, label: "Old name" };

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const nullRes = await agent
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: null });
    expect(nullRes.status).toBe(200);
    expect(nullRes.body.label).toBeNull();
    expect(dbState.labelUpdate).toEqual({ id: basePasskey.id, label: null });

    // And the same for an empty/whitespace string.
    dbState.passkey = { ...basePasskey, label: "Another" };
    dbState.labelUpdate = null;
    const blankRes = await agent
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: "   " });
    expect(blankRes.status).toBe(200);
    expect(blankRes.body.label).toBeNull();
    expect(dbState.labelUpdate).toEqual({ id: basePasskey.id, label: null });
  });

  it("rejects labels longer than 64 characters and writes nothing", async () => {
    dbState.passkey = { ...basePasskey, label: null };

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const tooLong = "x".repeat(65);
    const res = await agent
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: tooLong });

    expect(res.status).toBe(400);
    expect(dbState.labelUpdate).toBeNull();
    // No audit row written for a rejected request — `auth.passkey.renamed`
    // means "the rename actually happened".
    expect(
      getAuditCalls().some((a) => a.action === "auth.passkey.renamed"),
    ).toBe(false);
  });

  it("returns 404 (not 403) when the passkey belongs to another user", async () => {
    // Passkey exists but is owned by a different user. Returning 404 (rather
    // than 403) avoids leaking the existence of other users' passkey rows
    // to a probing attacker.
    dbState.passkey = { ...basePasskey, userId: "someone-else", label: null };

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: "Hijack" });

    expect(res.status).toBe(404);
    expect(dbState.labelUpdate).toBeNull();
    expect(
      getAuditCalls().some((a) => a.action === "auth.passkey.renamed"),
    ).toBe(false);
  });

  it("requires authentication", async () => {
    dbState.passkey = { ...basePasskey, label: null };

    const app = makeApp();
    // No /__test/login first — request must be rejected by requireAuth.
    const res = await request(app)
      .patch(`/api/auth/passkeys/${basePasskey.id}`)
      .send({ label: "Anything" });

    expect(res.status).toBe(401);
    expect(dbState.labelUpdate).toBeNull();
  });
});

// ─── DELETE /passkeys/:id (unlink) ──────────────────────────────────────────
describe("DELETE /api/auth/passkeys/:id", () => {
  it("removes the passkey when the user has another passkey, and audits auth.passkey.delete success", async () => {
    // Two passkeys total: deleting one still leaves a sign-in path.
    dbState.passkey = { ...basePasskey };
    dbState.extraPasskeys = [{ ...basePasskey, id: "pk-2", credentialId: "cred-2" }];

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent.delete(`/api/auth/passkeys/${basePasskey.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(dbState.deletedPasskeyIds).toEqual([basePasskey.id]);

    const audits = getAuditCalls().filter((a) => a.action === "auth.passkey.delete");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "auth.passkey.delete",
      outcome: "success",
      userId: baseUser.id,
      details: { passkeyId: basePasskey.id },
    });
  });

  it("removes the passkey when the user has a linked SSO identity instead", async () => {
    // Only one passkey, but an SSO identity remains as the fallback factor.
    dbState.passkey = { ...basePasskey };
    dbState.extraPasskeys = [];
    dbState.ssoIdentities = [{ id: "sso-1", userId: baseUser.id }];

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent.delete(`/api/auth/passkeys/${basePasskey.id}`);

    expect(res.status).toBe(200);
    expect(dbState.deletedPasskeyIds).toEqual([basePasskey.id]);
  });

  it("refuses with 409 last_sign_in_path when removing would leave no passkey and no SSO identity", async () => {
    // Only one passkey, no SSO — this is the user's only sign-in path.
    dbState.passkey = { ...basePasskey };
    dbState.extraPasskeys = [];
    dbState.ssoIdentities = [];

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent.delete(`/api/auth/passkeys/${basePasskey.id}`);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: "last_sign_in_path" });
    // Crucially: the row must NOT have been deleted.
    expect(dbState.deletedPasskeyIds).toEqual([]);

    // A failure audit row pinpoints the reason so admins can see refusals
    // and so any future regression that silently allows the delete shows
    // up as a missing failure row here.
    const audits = getAuditCalls().filter((a) => a.action === "auth.passkey.delete");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      outcome: "failure",
      userId: baseUser.id,
      details: { passkeyId: basePasskey.id, reason: "would_leave_no_sign_in_path" },
    });
  });

  it("returns 404 (not 403) when the passkey belongs to another user", async () => {
    // Mirrors the PATCH handler: don't leak existence of other users' rows.
    dbState.passkey = { ...basePasskey, userId: "someone-else" };

    const app = makeApp();
    const agent = request.agent(app);
    await agent.post("/__test/login");

    const res = await agent.delete(`/api/auth/passkeys/${basePasskey.id}`);

    expect(res.status).toBe(404);
    expect(dbState.deletedPasskeyIds).toEqual([]);
    expect(
      getAuditCalls().some((a) => a.action === "auth.passkey.delete"),
    ).toBe(false);
  });

  it("requires authentication", async () => {
    dbState.passkey = { ...basePasskey };

    const app = makeApp();
    // No /__test/login first — request must be rejected by requireAuth.
    const res = await request(app).delete(`/api/auth/passkeys/${basePasskey.id}`);

    expect(res.status).toBe(401);
    expect(dbState.deletedPasskeyIds).toEqual([]);
  });
});
