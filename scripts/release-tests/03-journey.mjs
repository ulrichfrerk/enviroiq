// Tier 3 — Journey tests.
//
// Walks an authenticated user through the critical product surfaces. Two
// modes, picked automatically:
//
//   LOCAL mode  — `target` is localhost / a Replit dev domain AND `DATABASE_URL`
//                 is set. The runner picks (or seeds) a test user, forges an
//                 express-session row directly in the `session` table, and
//                 issues requests with the signed `eiq.sid` cookie.
//
//   PROD mode   — `RELEASE_TEST_BEARER` is set. Uses the CRM `/api/v1` API
//                 (read-only) to verify the deployed server can answer real
//                 DB-backed queries end-to-end without leaking data.
//
// If neither mode is available, the entire tier is skipped with a clear
// reason. This keeps CI green while still being maximally useful when run
// locally or against a configured prod target.

import process from "node:process";
import crypto from "node:crypto";
import { run, apiFetch, expect, env, target, safeJson, colour } from "./shared.mjs";

const SESSION_COOKIE_NAME = "eiq.sid";
// Must match the fallback in artifacts/api-server/src/app.ts (line ~214).
// Production sets SESSION_SECRET; locally we fall back to the dev string.
const SESSION_SECRET =
  process.env.SESSION_SECRET || "enviroiq-dev-only-secret-do-not-use-in-production";

// ── Cookie signing (matches express-session + cookie-signature) ───────────
// Format: "s:<sid>.<HMAC-SHA256(sid, secret) base64 trimmed>"
function signSid(sid) {
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sid)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${sid}.${sig}`;
}

// ── Local mode: forge a session row + return cookie value ─────────────────
async function setupLocalSession() {
  // Lazy-import drizzle so this file can still be parsed in environments
  // without DATABASE_URL (e.g. someone running just the boot tier).
  const { Client } = await import("pg");
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    // Pick any active user (prefer a super_admin if one exists so the
    // journey can hit the broadest set of endpoints).
    const { rows: users } = await client.query(
      `SELECT u.id, u.email, u.role
         FROM users u
        WHERE u.is_active = true
        ORDER BY (u.role = 'super_admin') DESC,
                 (u.role = 'org_admin')  DESC,
                 u.created_at ASC
        LIMIT 1`,
    );
    if (users.length === 0) {
      throw new Error("no active users in DB — seed the dev database first");
    }
    const user = users[0];

    // Forge a brand-new session sid + insert into the connect-pg-simple
    // table. Sessions live for 7 days; we use 1 hour to keep test debris
    // short-lived.
    const sid = crypto.randomBytes(24).toString("base64url");
    const expire = new Date(Date.now() + 60 * 60 * 1000); // 1h from now
    const sess = {
      cookie: {
        originalMaxAge: 60 * 60 * 1000,
        expires: expire.toISOString(),
        httpOnly: true,
        path: "/",
        sameSite: "lax",
      },
      userId: user.id,
    };
    await client.query(
      `INSERT INTO session (sid, sess, expire) VALUES ($1, $2, $3)`,
      [sid, JSON.stringify(sess), expire],
    );

    return {
      user,
      sid,
      cookieHeader: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSid(sid))}`,
      cleanup: async () => {
        try { await client.query(`DELETE FROM session WHERE sid = $1`, [sid]); }
        finally { await client.end(); }
      },
    };
  } catch (err) {
    await client.end().catch(() => {});
    throw err;
  }
}

// ── Mode resolution ───────────────────────────────────────────────────────
// SAFETY: local mode forges a session by inserting directly into the DB
// — that's an auth bypass by design. We REFUSE to do this against a
// non-local target even if DATABASE_URL is set. Prod mode (bearer key)
// is fine against any target.
function chooseMode() {
  if (env.bearer && !env.isLocalTarget) return "prod";
  if (env.databaseUrl && env.isLocalTarget) return "local";
  if (env.bearer) return "prod"; // bearer wins if both configured
  // databaseUrl alone is NOT enough for local mode against a non-local
  // target — fall through to "no mode" with a clear skip message.
  return null;
}

// ── Tier entry point ──────────────────────────────────────────────────────
export async function journeyChecks() {
  const mode = chooseMode();

  if (!mode) {
    // Distinguish "neither set" from "DATABASE_URL set but target is prod"
    // — the latter is intentionally refused for safety.
    const reason = env.databaseUrl && !env.isLocalTarget
      ? `DATABASE_URL set but target ${target} is non-local — refusing to forge session against prod. Use RELEASE_TEST_BEARER instead.`
      : "set DATABASE_URL + run against localhost/dev domain, OR set RELEASE_TEST_BEARER";
    return run("Tier 3: Journey", [
      { name: "journey requires DATABASE_URL (local) or RELEASE_TEST_BEARER (prod)",
        skip: reason,
        fn: () => {} },
    ]);
  }

  if (mode === "prod") {
    return run("Tier 3: Journey (prod / bearer)", [
      {
        name: "GET /api/v1/openapi.json returns OpenAPI document",
        fn: async () => {
          const { res } = await apiFetch("/v1/openapi.json", {
            headers: { authorization: `Bearer ${env.bearer}` },
          });
          expect.status(res, 200);
          const body = await safeJson(res);
          expect.jsonShape(body ?? {}, { openapi: "string", paths: "object" });
        },
      },
      {
        name: "GET /api/v1/customers returns a list (DB query end-to-end)",
        fn: async () => {
          const { res } = await apiFetch("/v1/customers?limit=1", {
            headers: { authorization: `Bearer ${env.bearer}` },
          });
          expect.status(res, 200);
          const body = await safeJson(res);
          if (!body || (!Array.isArray(body.data) && !Array.isArray(body.items) && !Array.isArray(body))) {
            throw new Error(`expected list-shaped response, got ${JSON.stringify(body).slice(0, 100)}`);
          }
        },
      },
    ]);
  }

  // ── Local mode ──────────────────────────────────────────────────────────
  let session;
  try {
    session = await setupLocalSession();
  } catch (err) {
    return run("Tier 3: Journey (local)", [
      {
        name: "set up forged session in local DB",
        fn: () => { throw err; },
      },
    ]);
  }

  process.stdout.write(
    colour.grey(`  forged session for ${session.user.email} (${session.user.id.slice(0, 8)}…)\n`),
  );

  const auth = { headers: { cookie: session.cookieHeader } };
  let orgId = null;

  try {
    return await run("Tier 3: Journey (local / forged session)", [
      {
        name: "GET /api/auth/session returns the forged user",
        fn: async () => {
          const { res } = await apiFetch("/auth/session", auth);
          // /auth ctx → auth-limiter 429 downgrades to SKIP.
          expect.status(res, 200, "/auth/session");
          const body = await safeJson(res);
          // /auth/session shape: { userId, email, role, ... isAuthenticated }
          if (body?.userId !== session.user.id) {
            throw new Error(`expected userId ${session.user.id}, got ${body?.userId}`);
          }
          if (body?.isAuthenticated !== true) {
            throw new Error(`expected isAuthenticated:true, got ${body?.isAuthenticated}`);
          }
        },
      },
      {
        name: "GET /api/organisations returns at least one org",
        fn: async () => {
          const { res } = await apiFetch("/organisations", auth);
          expect.status(res, 200);
          const body = await safeJson(res);
          const list = Array.isArray(body) ? body : (body?.data ?? body?.items ?? []);
          if (!Array.isArray(list) || list.length === 0) {
            throw new Error(`expected non-empty org list, got ${JSON.stringify(body).slice(0, 100)}`);
          }
          orgId = list[0].id;
        },
      },
      {
        name: "GET /api/organisations/:id/fleet/vehicles returns 200",
        fn: async () => {
          if (!orgId) throw new Error("no orgId — previous check did not set it");
          const { res } = await apiFetch(`/organisations/${orgId}/fleet/vehicles`, auth);
          expect.status(res, [200, 204]);
        },
      },
      {
        name: "GET /api/organisations/:id/energy/readings returns 200",
        fn: async () => {
          if (!orgId) throw new Error("no orgId");
          const { res } = await apiFetch(`/organisations/${orgId}/energy/readings`, auth);
          expect.status(res, [200, 204]);
        },
      },
      {
        name: "GET /api/organisations/:id/emissions returns 200 (dashboard data path)",
        fn: async () => {
          if (!orgId) throw new Error("no orgId");
          const { res } = await apiFetch(`/organisations/${orgId}/emissions`, auth);
          expect.status(res, [200, 204]);
        },
      },
      {
        name: "GET /api/organisations/:id/reports returns 200 (board pack list)",
        fn: async () => {
          if (!orgId) throw new Error("no orgId");
          const { res } = await apiFetch(`/organisations/${orgId}/reports`, auth);
          expect.status(res, 200);
        },
      },
      {
        name: "GET /api/organisations/:id/targets returns 200",
        fn: async () => {
          if (!orgId) throw new Error("no orgId");
          const { res } = await apiFetch(`/organisations/${orgId}/targets`, auth);
          expect.status(res, [200, 204]);
        },
      },
      {
        name: "GET /api/organisations/:id/recommendations returns 200",
        fn: async () => {
          if (!orgId) throw new Error("no orgId");
          const { res } = await apiFetch(`/organisations/${orgId}/recommendations`, auth);
          expect.status(res, [200, 204]);
        },
      },
    ]);
  } finally {
    await session.cleanup();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await journeyChecks();
  process.exit(r.failed > 0 ? 1 : 0);
}
