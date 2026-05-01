// Tier 2 — Smoke tests.
//
// Walks the major mounted routers asserting each returns the *correct*
// non-success status (401/403/404) when called without auth — the goal
// is to catch silent regressions where a route stops being mounted (404),
// returns 500, or accidentally becomes public (200 to unauthenticated).
//
// Plus a small set of behaviour-correctness checks for the few public
// endpoints that real users hit pre-login (magic-link request, public
// audit report viewer).
//
// Runs in <30s. No auth required for the core list; the bonus CRM /v1
// checks activate when RELEASE_TEST_BEARER is set.

import { run, apiFetch, expect, env, safeJson } from "./shared.mjs";

// Major org-scoped routers under /api/organisations/:orgId/* — calling
// any of them without a session must return 401 (or 403), never 404
// (= unmounted) or 500 (= broken middleware).
//
// `probe` is a known sub-path the router actually exposes. Some routers
// have a `GET /` handler (use `""`); others only register sub-paths like
// `/vehicles`, `/readings`, `/config` — probing `/` against those returns
// 404 and looks like a regression when it isn't. Keep this list aligned
// with the actual route definitions.
const ORG_SCOPED_ROUTERS = [
  { name: "users",                     probe: "" },
  { name: "fleet",                     probe: "/vehicles" },
  { name: "energy",                    probe: "/readings" },
  { name: "emissions",                 probe: "" },
  { name: "goals",                     probe: "" },
  { name: "reports",                   probe: "" },
  { name: "widget",                    probe: "/config" },
  { name: "audit-logs",                probe: "" },
  { name: "targets",                   probe: "" },
  { name: "maturity",                  probe: "" },
  { name: "scenarios",                 probe: "" },
  { name: "recommendations",           probe: "" },
  { name: "social",                    probe: "" },
  { name: "governance",                probe: "" },
  { name: "projects",                  probe: "" },
  { name: "waste",                     probe: "/records" },
  { name: "subcontractors",            probe: "" },
  { name: "advisor",                   probe: "/insights" },
  { name: "compliance",                probe: "/summary" },
  { name: "document-archives",         probe: "" },
  { name: "suppliers",                 probe: "" },
  { name: "supplier-audits",           probe: "" },
  { name: "supplier-reports",          probe: "/summary" },
  { name: "audit-overrides",           probe: "" },
  { name: "supplier-audit-templates",  probe: "" },
];

// Top-level routers (not org-scoped). `probe` follows the same convention.
const TOP_LEVEL_ROUTERS = [
  { path: "/admin",                     statuses: [401, 403] },
  { path: "/admin/audit-logs",          statuses: [401, 403] },
  { path: "/crm-keys",                  statuses: [401, 403] },
  { path: "/management/tenants",        statuses: [401, 403] },
  { path: "/security/passkeys",         statuses: [401, 403, 404] },
  { path: "/v1/customers",              statuses: [401, 403] },
];

export async function smokeChecks() {
  const checks = [];

  // ── Behaviour correctness for unauthenticated public endpoints ──────────
  checks.push({
    name: "POST /api/auth/magic-link/request with bogus email returns 200 (no enumeration)",
    fn: async () => {
      const { res } = await apiFetch("/auth/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "release-test-noreply@example.invalid" }),
      });
      // Generic 200 even for unknown emails — the contract that prevents
      // user enumeration. Anything else is a regression worth catching.
      // /auth ctx → auth-limiter 429 downgrades to SKIP.
      expect.status(res, 200, "/auth/magic-link/request");
    },
  });

  checks.push({
    name: "POST /api/auth/magic-link/request with malformed body returns 400",
    fn: async () => {
      const { res } = await apiFetch("/auth/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not_an_email: 42 }),
      });
      expect.status(res, 400, "/auth/magic-link/request");
    },
  });

  checks.push({
    name: "GET /api/public/audits/__bogus__ returns 404 (not 500)",
    fn: async () => {
      const { res } = await apiFetch("/public/audits/__release_test_bogus__");
      expect.status(res, [400, 404]);
    },
  });

  // ── Org-scoped router mount check ───────────────────────────────────────
  // Use a stable bogus orgId; we expect 401/403 because no session, NOT 404
  // (which would mean the router itself is unmounted) and never 500.
  const bogusOrg = "00000000-0000-0000-0000-000000000000";
  for (const r of ORG_SCOPED_ROUTERS) {
    const url = `/organisations/${bogusOrg}/${r.name}${r.probe}`;
    checks.push({
      name: `GET /api/organisations/:orgId/${r.name}${r.probe} mounted (401/403 not 404/500)`,
      fn: async () => {
        const { res } = await apiFetch(url);
        expect.authedRoute(res, url);
      },
    });
  }

  // ── Mission router (POST-only, can't be GET-probed) ────────────────────
  // Mounted at /api/organisations/:orgId/mission with a single POST
  // /generate handler — a GET would always 404 even when the router is
  // mounted, so we verify mount via a credential-less POST instead.
  checks.push({
    name: "POST /api/organisations/:orgId/mission/generate mounted (401/403 not 404/500)",
    fn: async () => {
      const { res } = await apiFetch(`/organisations/${bogusOrg}/mission/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect.authedRoute(res, "/mission/generate");
    },
  });

  // ── Top-level router mount check ────────────────────────────────────────
  for (const r of TOP_LEVEL_ROUTERS) {
    checks.push({
      name: `GET /api${r.path} mounted (${r.statuses.join("/")})`,
      fn: async () => {
        const { res } = await apiFetch(r.path);
        expect.status(res, r.statuses, r.path);
      },
    });
  }

  // ── Optional: CRM /v1 read endpoints when bearer key is provided ────────
  const bearerSkip = env.bearer ? null : "set RELEASE_TEST_BEARER to enable";
  checks.push({
    name: "GET /api/v1/openapi.json returns OpenAPI doc (with bearer)",
    skip: bearerSkip,
    fn: async () => {
      const { res } = await apiFetch("/v1/openapi.json", {
        headers: { authorization: `Bearer ${env.bearer}` },
      });
      expect.status(res, 200);
      const body = await safeJson(res);
      expect.jsonShape(body ?? {}, { openapi: "string", paths: "object" }, "openapi.json");
    },
  });

  return run("Tier 2: Smoke", checks);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await smokeChecks();
  process.exit(r.failed > 0 ? 1 : 0);
}
