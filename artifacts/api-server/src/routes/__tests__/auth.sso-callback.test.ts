/**
 * Regression tests for the SSO sign-in callback.
 *
 * These tests guard `/api/auth/sso/:provider/callback` and the underlying
 * `lib/oidc.ts` helpers against silent regressions. Network access is
 * mocked at the boundary only:
 *   - `globalThis.fetch` is stubbed to serve a fake OIDC discovery doc,
 *     a JWKS containing our test key, and a token endpoint we control.
 *   - id_tokens are real RS256 JWTs signed by our test key, so
 *     `verifyIdToken` actually runs (signature, iss, aud, iat, exp,
 *     maxTokenAge, nonce, email, email_verified).
 * The database, audit logger, and mailer are stubbed so the suite is
 * fully hermetic.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK, type KeyLike } from "jose";

// ─── Module mocks (must be declared before importing the route) ─────────────
vi.mock("../../lib/audit.js", () => ({
  logAudit: vi.fn(async () => {}),
  SOURCE_SYSTEM: "enviroiq",
  FGC_REASON_CODES: [],
  isFgcReasonCode: () => false,
}));

vi.mock("../../lib/mailer.js", () => ({
  sendMagicLinkEmail: vi.fn(async () => {}),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

// In-memory stand-in for the rows the SSO callback reads/writes.
const dbState: {
  user: Record<string, unknown> | null;
  organisation: Record<string, unknown> | null;
  ssoIdentity: Record<string, unknown> | null;
} = {
  user: null,
  organisation: null,
  ssoIdentity: null,
};

vi.mock("@workspace/db", () => {
  const tables = {
    usersTable: { _t: "users" },
    magicLinksTable: { _t: "magic_links" },
    passkeysTable: { _t: "passkeys" },
    webAuthnChallengesTable: { _t: "webauthn_challenges" },
    organisationsTable: { _t: "organisations" },
    ssoIdentitiesTable: { _t: "sso_identities" },
    auditLogsTable: { _t: "audit_logs" },
  };

  const insertCall = vi.fn((table: { _t: string }) => ({
    values: vi.fn((row: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (table === tables.ssoIdentitiesTable) {
          dbState.ssoIdentity = {
            ...row,
            linkedAt: new Date(),
            lastUsedAt: new Date(),
          };
          return [dbState.ssoIdentity];
        }
        return [row];
      }),
    })),
  }));

  const updateCall = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
  }));

  const deleteCall = vi.fn(() => ({
    where: vi.fn(async () => undefined),
  }));

  const db = {
    query: {
      usersTable: { findFirst: vi.fn(async () => dbState.user) },
      ssoIdentitiesTable: { findFirst: vi.fn(async () => dbState.ssoIdentity) },
      organisationsTable: { findFirst: vi.fn(async () => dbState.organisation) },
      magicLinksTable: { findFirst: vi.fn(async () => null) },
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

// ─── OIDC client env (read by lib/oidc.ts at call time) ─────────────────────
process.env.GOOGLE_OIDC_CLIENT_ID = "test-google-client";
process.env.GOOGLE_OIDC_CLIENT_SECRET = "test-google-secret";
process.env.MICROSOFT_OIDC_CLIENT_ID = "test-microsoft-client";
process.env.MICROSOFT_OIDC_CLIENT_SECRET = "test-microsoft-secret";

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import express, { type Request, type Response } from "express";
import session from "express-session";
import request from "supertest";
import authRouter from "../auth.js";
import * as audit from "../../lib/audit.js";

// ─── Test signing key + fetch boundary stub ─────────────────────────────────
let privateKey: KeyLike;
let publicJwk: JWK;

const GOOGLE_ISS = "https://accounts.google.com";
const MICROSOFT_ISS = "https://login.microsoftonline.com/common/v2.0";

type TokenHandler = (body: URLSearchParams) => Promise<Response> | Response;

let tokenHandler: TokenHandler = () =>
  new Response("not configured", { status: 500 });

beforeAll(async () => {
  const kp = await generateKeyPair("RS256", { extractable: true });
  privateKey = kp.privateKey;
  const jwk = await exportJWK(kp.publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";
  jwk.use = "sig";
  publicJwk = jwk;
});

function discoveryDoc(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
  };
}

function installFetchStub() {
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    if (url.includes("/.well-known/openid-configuration")) {
      const issuer = url.includes("microsoftonline.com") ? MICROSOFT_ISS : GOOGLE_ISS;
      return new Response(JSON.stringify(discoveryDoc(issuer)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/jwks.json") || url.endsWith("/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/oauth/token")) {
      const body = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      return tokenHandler(body);
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

async function signIdToken(args: {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  emailVerified: boolean;
  nonce: string;
  name?: string;
  expiresIn?: string;
  extra?: Record<string, unknown>;
}): Promise<string> {
  return new SignJWT({
    email: args.email,
    email_verified: args.emailVerified,
    nonce: args.nonce,
    name: args.name,
    ...(args.extra ?? {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setIssuer(args.iss)
    .setAudience(args.aud)
    .setSubject(args.sub)
    .setIssuedAt()
    .setExpirationTime(args.expiresIn ?? "5m")
    .sign(privateKey);
}

// ─── App + audit helpers ────────────────────────────────────────────────────
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
  dbState.ssoIdentity = null;
  installFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Drives `/sso/:provider/start` and parses the state+nonce off the Location header. */
async function startSso(
  agent: ReturnType<typeof request.agent>,
  provider: "google" | "microsoft" = "google",
): Promise<{ state: string; nonce: string }> {
  const start = await agent.get(`/api/auth/sso/${provider}/start`).redirects(0);
  expect(start.status).toBe(302);
  const loc = new URL(start.headers.location);
  const state = loc.searchParams.get("state");
  const nonce = loc.searchParams.get("nonce");
  expect(state).toBeTruthy();
  expect(nonce).toBeTruthy();
  return { state: state!, nonce: nonce! };
}

describe("GET /api/auth/sso/:provider/callback", () => {
  it("succeeds: establishes a session and writes sso.identity.linked exactly once", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const { state, nonce } = await startSso(agent);

    tokenHandler = async () => {
      const id_token = await signIdToken({
        iss: GOOGLE_ISS,
        aud: "test-google-client",
        sub: "google-sub-1",
        email: "user@example.com",
        emailVerified: true,
        nonce,
        name: "Test User",
      });
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/dashboard$/);

    const auditCalls = getAuditCalls();
    const linked = auditCalls.filter((a) => a.action === "sso.identity.linked");
    expect(linked).toHaveLength(1);
    expect(linked[0]).toMatchObject({
      outcome: "success",
      organisationId: "org-1",
      userId: "user-1",
      userEmail: "user@example.com",
      details: { provider: "google" },
    });

    const success = auditCalls.filter((a) => a.action === "sso.sign_in.success");
    expect(success).toHaveLength(1);
    expect(auditCalls.some((a) => a.action === "sso.sign_in.rejected")).toBe(false);

    const me = await agent.get("/__test/whoami");
    expect(me.body).toMatchObject({
      userId: "user-1",
      email: "user@example.com",
      role: "org_user",
    });
  });

  it("does NOT re-link an existing identity on subsequent sign-ins for the same (provider, sub)", async () => {
    const app = makeApp();

    // First sign-in — creates the identity.
    const agent1 = request.agent(app);
    {
      const { state, nonce } = await startSso(agent1);
      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: GOOGLE_ISS,
          aud: "test-google-client",
          sub: "google-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      await agent1.get(`/api/auth/sso/google/callback?code=c1&state=${state}`).redirects(0);
    }
    expect(getAuditCalls().filter((a) => a.action === "sso.identity.linked")).toHaveLength(1);

    // Second sign-in — identity exists, so no new link.
    (audit.logAudit as unknown as { mock: { calls: unknown[] } }).mock.calls.length = 0;

    const agent2 = request.agent(app);
    const { state, nonce } = await startSso(agent2);
    tokenHandler = async () => {
      const id_token = await signIdToken({
        iss: GOOGLE_ISS,
        aud: "test-google-client",
        sub: "google-sub-1",
        email: "user@example.com",
        emailVerified: true,
        nonce,
      });
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await agent2.get(`/api/auth/sso/google/callback?code=c2&state=${state}`).redirects(0);

    const second = getAuditCalls();
    expect(second.filter((a) => a.action === "sso.identity.linked")).toHaveLength(0);
    expect(second.filter((a) => a.action === "sso.sign_in.success")).toHaveLength(1);
  });

  it("redirects with ?error=sso_unknown_email and audits sso.sign_in.rejected when the email is not registered", async () => {
    dbState.user = null;

    const app = makeApp();
    const agent = request.agent(app);
    const { state, nonce } = await startSso(agent);

    tokenHandler = async () => {
      const id_token = await signIdToken({
        iss: GOOGLE_ISS,
        aud: "test-google-client",
        sub: "google-sub-1",
        email: "nobody@example.com",
        emailVerified: true,
        nonce,
      });
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_unknown_email$/);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    const last = rejected[rejected.length - 1];
    expect(last).toMatchObject({
      outcome: "failure",
      userEmail: "nobody@example.com",
      details: { provider: "google", reason: "unknown_email" },
    });

    expect(getAuditCalls().some((a) => a.action === "sso.identity.linked")).toBe(false);
    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("rejects state mismatch with ?error=sso_state and never calls the token endpoint", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    await startSso(agent);

    let tokenCalled = false;
    tokenHandler = () => {
      tokenCalled = true;
      return new Response("should not be called", { status: 500 });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=NOT-THE-REAL-STATE`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_state$/);
    expect(tokenCalled).toBe(false);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    expect(rejected[0]).toMatchObject({
      outcome: "failure",
      details: { provider: "google", reason: "state_mismatch" },
    });

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("rejects an id_token with the wrong nonce (verifyIdToken signature path) and establishes no session", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const { state } = await startSso(agent);

    tokenHandler = async () => {
      const id_token = await signIdToken({
        iss: GOOGLE_ISS,
        aud: "test-google-client",
        sub: "google-sub-1",
        email: "user@example.com",
        emailVerified: true,
        nonce: "this-is-not-the-real-nonce",
      });
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_token$/);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    expect(rejected[0]).toMatchObject({
      outcome: "failure",
      details: { provider: "google", reason: "id_token_nonce_mismatch" },
    });

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("rejects an id_token signed by an untrusted key (signature failure)", async () => {
    // Sign with a fresh, unpublished keypair → JWKS lookup will not find the
    // matching kid and verification fails. Catches regressions where a future
    // change weakens signature enforcement.
    const otherKp = await generateKeyPair("RS256", { extractable: true });
    const app = makeApp();
    const agent = request.agent(app);
    const { state, nonce } = await startSso(agent);

    tokenHandler = async () => {
      const id_token = await new SignJWT({
        email: "user@example.com",
        email_verified: true,
        nonce,
      })
        .setProtectedHeader({ alg: "RS256", kid: "rogue-key" })
        .setIssuer(GOOGLE_ISS)
        .setAudience("test-google-client")
        .setSubject("google-sub-1")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(otherKp.privateKey);
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_token$/);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    expect(rejected[0]).toMatchObject({
      outcome: "failure",
      details: { provider: "google" },
    });
    expect(String(rejected[0].details?.reason)).toMatch(/^id_token_/);

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("rejects PKCE / token exchange failure (token endpoint 400) and never calls verifyIdToken", async () => {
    // PKCE mismatch surfaces as the provider's token endpoint rejecting the
    // exchange (since code_verifier doesn't hash to code_challenge).
    const app = makeApp();
    const agent = request.agent(app);
    const { state } = await startSso(agent);

    tokenHandler = () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_token$/);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    expect(rejected[0]).toMatchObject({
      outcome: "failure",
      details: { provider: "google", reason: "token_exchange_failed" },
    });

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  it("redirects with ?error=sso_email_unverified when email_verified is false", async () => {
    const app = makeApp();
    const agent = request.agent(app);
    const { state, nonce } = await startSso(agent);

    tokenHandler = async () => {
      const id_token = await signIdToken({
        iss: GOOGLE_ISS,
        aud: "test-google-client",
        sub: "google-sub-1",
        email: "user@example.com",
        emailVerified: false,
        nonce,
      });
      return new Response(JSON.stringify({ id_token }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const res = await agent
      .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/app\/sign-in\?error=sso_email_unverified$/);

    const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
    expect(rejected[0]).toMatchObject({
      outcome: "failure",
      userEmail: "user@example.com",
      details: { provider: "google", reason: "email_not_verified" },
    });

    const me = await agent.get("/__test/whoami");
    expect(me.body.userId).toBeNull();
  });

  describe("required SSO provider policy", () => {
    it("rejects an org_user signing in via the wrong provider", async () => {
      dbState.organisation = { ...baseOrg, requiredSsoProvider: "microsoft" };
      dbState.user = { ...baseUser, role: "org_user" };

      const app = makeApp();
      const agent = request.agent(app);
      const { state, nonce } = await startSso(agent, "google");

      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: GOOGLE_ISS,
          aud: "test-google-client",
          sub: "google-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const res = await agent
        .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(
        /\/app\/sign-in\?error=sso_required_provider_mismatch&source=org$/,
      );

      const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
      expect(rejected[0]).toMatchObject({
        outcome: "failure",
        organisationId: "org-1",
        userId: "user-1",
        details: { provider: "google", reason: "required_provider_mismatch", source: "org" },
      });

      const me = await agent.get("/__test/whoami");
      expect(me.body.userId).toBeNull();
    });

    it("redirects with source=user when a per-user override forces the wrong provider", async () => {
      // Per-user requiredSignInProvider overrides org policy. The redirect
      // must include source=user so the sign-in page can phrase the message
      // as "your account" rather than "your organisation".
      dbState.organisation = { ...baseOrg, requiredSsoProvider: null };
      dbState.user = {
        ...baseUser,
        role: "org_user",
        requiredSignInProvider: "microsoft",
      };

      const app = makeApp();
      const agent = request.agent(app);
      const { state, nonce } = await startSso(agent, "google");

      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: GOOGLE_ISS,
          aud: "test-google-client",
          sub: "google-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const res = await agent
        .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(
        /\/app\/sign-in\?error=sso_required_provider_mismatch&source=user$/,
      );

      const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
      expect(rejected[0]).toMatchObject({
        details: { source: "user" },
      });
    });

    it("redirects with source=org when the org allow-list excludes the chosen provider", async () => {
      // Org-level allow-list refusal — the user has no per-user override, so
      // source must be "org".
      dbState.organisation = {
        ...baseOrg,
        requiredSsoProvider: null,
        allowedSignInMethods: ["magic_link", "microsoft_sso"],
      };
      dbState.user = { ...baseUser, role: "org_user" };

      const app = makeApp();
      const agent = request.agent(app);
      const { state, nonce } = await startSso(agent, "google");

      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: GOOGLE_ISS,
          aud: "test-google-client",
          sub: "google-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const res = await agent
        .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(
        /\/app\/sign-in\?error=sso_method_not_allowed&source=org$/,
      );

      const rejected = getAuditCalls().filter((a) => a.action === "sso.sign_in.rejected");
      expect(rejected[0]).toMatchObject({
        details: { provider: "google", reason: "method_not_allowed", source: "org" },
      });
    });

    it("allows an org_admin signing in via the required provider (no policy bypass needed)", async () => {
      // The admin uses the REQUIRED provider — the policy gate passes.
      // (Break-glass for required_provider_mismatch is magic_link only and
      // is verified via the magic-link flow, not via SSO callback.)
      dbState.organisation = { ...baseOrg, requiredSsoProvider: "microsoft" };
      dbState.user = { ...baseUser, role: "org_admin" };

      const app = makeApp();
      const agent = request.agent(app);
      const { state, nonce } = await startSso(agent, "microsoft");

      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: MICROSOFT_ISS,
          aud: "test-microsoft-client",
          sub: "ms-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const res = await agent
        .get(`/api/auth/sso/microsoft/callback?code=auth-code&state=${state}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/\/app\/dashboard$/);

      const linked = getAuditCalls().filter((a) => a.action === "sso.identity.linked");
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({
        userId: "user-1",
        details: { provider: "microsoft" },
      });

      const me = await agent.get("/__test/whoami");
      expect(me.body.userId).toBe("user-1");
      expect(me.body.role).toBe("org_admin");
    });

    it("rejects an org_admin who tries to bypass the required provider via SSO (break-glass is magic-link only)", async () => {
      // Documents the security guarantee: there is no SSO break-glass for
      // required_provider_mismatch. Admins who lock themselves out of the
      // required provider must use the magic-link break-glass path.
      dbState.organisation = { ...baseOrg, requiredSsoProvider: "microsoft" };
      dbState.user = { ...baseUser, role: "org_admin" };

      const app = makeApp();
      const agent = request.agent(app);
      const { state, nonce } = await startSso(agent, "google");

      tokenHandler = async () => {
        const id_token = await signIdToken({
          iss: GOOGLE_ISS,
          aud: "test-google-client",
          sub: "google-sub-1",
          email: "user@example.com",
          emailVerified: true,
          nonce,
        });
        return new Response(JSON.stringify({ id_token }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };

      const res = await agent
        .get(`/api/auth/sso/google/callback?code=auth-code&state=${state}`)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(
        /\/app\/sign-in\?error=sso_required_provider_mismatch&source=org$/,
      );

      const me = await agent.get("/__test/whoami");
      expect(me.body.userId).toBeNull();
    });
  });
});
