// Tier 1 — Boot tests.
//
// "Is the app on?" — fastest possible signal that the API server is up,
// the database is reachable, the auth middleware is loaded, and the
// frontend is being served. Should run in <5s. No auth required.
//
// Catches: dead server, port-binding regression, schema-init failure,
// route-mount typos, broken middleware order.

import { run, apiFetch, expect, safeJson } from "./shared.mjs";

export async function bootChecks() {
  return run("Tier 1: Boot", [
    {
      name: "GET /api/healthz returns 200 {status:\"ok\"}",
      fn: async () => {
        const { res } = await apiFetch("/healthz", { timeoutMs: 5_000 });
        expect.status(res, 200);
        const body = await safeJson(res);
        expect.jsonShape(body ?? {}, { status: "string" }, "/api/healthz");
        if (body.status !== "ok") {
          throw new Error(`status field is "${body.status}", expected "ok"`);
        }
      },
    },
    {
      name: "GET /api/healthz responds in under 2s (cold-start budget)",
      fn: async () => {
        const { res, elapsed } = await apiFetch("/healthz");
        expect.status(res, 200);
        expect.fasterThan(elapsed, 2_000, "/api/healthz");
      },
    },
    {
      name: "GET /api/auth/session returns 401 when unauthenticated (auth middleware loaded)",
      fn: async () => {
        const { res } = await apiFetch("/auth/session");
        // 401 is the contract; anything else means either auth is missing
        // (200 = leaked) or the route was renamed (404 = silent break).
        // Pass /auth ctx so a 429 from the auth limiter downgrades to SKIP.
        expect.status(res, 401, "/auth/session");
      },
    },
    {
      name: "GET /api/auth/sso/providers returns 200 (auth router mounted, public endpoint)",
      fn: async () => {
        // Public endpoint inside the auth router — proves the whole auth
        // surface is wired, not just middleware.
        const { res } = await apiFetch("/auth/sso/providers");
        expect.status(res, 200, "/auth/sso/providers");
      },
    },
    {
      name: "GET /api/organisations returns 401 (org-scoped routes mounted)",
      fn: async () => {
        const { res } = await apiFetch("/organisations");
        expect.authedRoute(res, "/api/organisations");
      },
    },
    {
      name: "GET /api/v1/customers without bearer returns 401 (CRM API auth wired)",
      fn: async () => {
        const { res } = await apiFetch("/v1/customers");
        // CRM bearer-auth must reject. 401/403 acceptable; 200/404/500 = bad.
        expect.status(res, [401, 403]);
      },
    },
  ]);
}

// Allow running this tier file directly: `node scripts/release-tests/01-boot.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await bootChecks();
  process.exit(r.failed > 0 ? 1 : 0);
}
