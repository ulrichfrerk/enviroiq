# Release tests

Tiered post-release smoke suite for the EnviroIQ API server. Pure Node 20 (no
test framework, no extra deps beyond `pg` for the journey tier). Runs against
either the local dev workspace or a deployed `.replit.app` URL.

## Run it

```bash
# All three tiers against localhost
pnpm release:test

# A single tier
pnpm release:test:boot          # Tier 1 only (~5s)
pnpm release:test:smoke         # Tiers 1 + 2 (~30s)
pnpm release:test:journey       # Tier 3 only

# Against a deployed app
pnpm release:test -- --target=https://enviroiq.replit.app
```

Exits non-zero on any failure → drop straight into a deploy gate.

## Tiers

| Tier | What it proves | Auth needed |
|------|----------------|-------------|
| **1 — Boot** | Server is up, healthcheck OK, auth middleware loaded, org-scoped + CRM /v1 routers mounted | none |
| **2 — Smoke** | Magic-link auth contract holds (no enumeration, validation works), every major router answers 401/403 (not 404 = unmounted, not 500 = broken) | none (optional `RELEASE_TEST_BEARER` enables CRM /v1 doc check) |
| **3 — Journey** | Real authenticated user can list orgs, read fleet/energy/emissions/reports/targets/recommendations end-to-end | yes — see below |

## Journey tier auth

Two modes, picked automatically:

- **Local mode** — `DATABASE_URL` set + target is localhost or a Replit dev
  domain. Forges a session by inserting a row directly into the `session`
  table and signing the `eiq.sid` cookie with `SESSION_SECRET` (defaults to
  the dev fallback in `app.ts`). Cleans up the row when the tier finishes.
- **Prod mode** — `RELEASE_TEST_BEARER` set (a CRM `/api/v1` API key with
  `customers:read`). Hits `/v1/openapi.json` and `/v1/customers` to prove
  the deployed server can answer real DB-backed queries with a real key.

If neither is set the tier is skipped with a clear message — Tiers 1 and 2
still run, the suite still exits 0 if they pass.

## Environment variables

| Var | Purpose |
|-----|---------|
| `RELEASE_TEST_TARGET` | Alternative to `--target=<url>` |
| `RELEASE_TEST_BEARER` | Enables prod-mode journey + bonus smoke check |
| `DATABASE_URL` | Required for local-mode journey (uses `pg` to forge a session) |
| `SESSION_SECRET` | Must match the running server's value. Defaults to the dev fallback string. |

## Files

- `shared.mjs` — target resolution, `apiFetch`, assertions, TAP-ish reporter
- `01-boot.mjs` — Tier 1 (boot)
- `02-smoke.mjs` — Tier 2 (smoke); edit `ORG_SCOPED_ROUTERS` when adding a new mounted router
- `03-journey.mjs` — Tier 3 (journey)
- `run.mjs` — orchestrator + CLI flags

## Adding a new router

When you mount a new router under `/api/organisations/:orgId/<name>` in
`artifacts/api-server/src/routes/index.ts`, add it to `ORG_SCOPED_ROUTERS`
in `02-smoke.mjs` with a `probe` path that the router actually handles
(use `""` if it has a `GET /` handler, otherwise a known sub-path like
`/vehicles` or `/summary`).
