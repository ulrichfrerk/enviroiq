# EnviroIQ — ESG Sustainability Platform

## Overview

Real-time multi-tenant ESG sustainability measurement platform. Companies track CO2 emissions from fleet vehicles (Navman, Blackhawk GPS integration) and energy consumption (PDF upload + inbound email bill parsing). Features passkey/WebAuthn authentication, super-admin portal, board-ready PDF reports, an embeddable public widget, full audit logging (SOC 2 mindset), and role-based access.

### ESG Intelligence Features
- **Maturity Scoring**: 4-dimension scoring (Foundation 40pt, Coverage 30pt, Quality 20pt, Governance 10pt) — grades: Foundation / Developing / Advanced / Leader
- **Emission Targets**: CRUD for reduction targets with baseline/target year, % reduction, framework (SBTi, Paris, etc.)
- **Scenario Modelling**: Lever-based emission reduction engine (EV transition, km reduction, modal shift, renewables, efficiency, offsets) with live preview
- **Dashboard widgets**: Maturity ring chart + Targets progress bars on the main dashboard

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js**: 24
- **Package manager**: pnpm
- **TypeScript**: 5.9
- **API framework**: Express 5 + Helmet + express-rate-limit + express-session
- **Database**: PostgreSQL + Drizzle ORM
- **Auth**: WebAuthn/Passkeys (@simplewebauthn/server) + magic link fallback
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + TanStack Query + Wouter + Recharts + shadcn/ui
- **Build**: esbuild (ESM bundle for API), Vite (frontend)

## Roles

- `super_admin` — platform management, create/manage organisations
- `org_admin` — manage their organisation, users, vehicles, energy, reports
- `org_viewer` — read-only access

## Demo Data

The database has been seeded with:
- **Super Admin**: `admin@enviroiq.app`
- **Org Admin**: `sarah@acmelogistics.co.nz`
- **Viewer**: `james@acmelogistics.co.nz`
- **Organisation**: Acme Logistics Ltd (4 vehicles, 30 fleet events, 12 energy readings, 3 goals, 1 report)

Login via "Continue with Email" → magic link flow (tokens are logged in API server console in dev)

## Emission Factors

- Diesel: 2.68 kg CO2e per litre
- Petrol: 2.31 kg CO2e per litre
- Electricity: 0.0977 kg CO2e per kWh
- Gas: 0.0535 kg CO2e per MJ

## Structure

```
.
├── artifacts/
│   ├── api-server/         # Express API (port 8080)
│   │   ├── src/app.ts      # Helmet, CORS, session, rate-limit
│   │   ├── src/routes/     # auth, organisations, users, fleet, energy, emissions, goals, reports, widget, audit, admin
│   │   ├── src/lib/        # auth.ts (middleware), audit.ts, emissions.ts, logger.ts
│   │   └── src/seed.ts     # Demo data seeder
│   └── enviroiq/           # React/Vite frontend (previewPath /)
│       ├── src/pages/      # login, dashboard, fleet, energy, goals, reports, users, widget, audit, admin
│       ├── src/components/ # layout (AppLayout, AppSidebar), ui (shadcn)
│       ├── src/hooks/      # use-auth.ts (WebAuthn flow), use-toast, use-mobile
│       └── src/lib/        # webauthn.ts, queryClient.ts
├── lib/
│   ├── api-spec/           # OpenAPI 3.1 spec + Orval config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle schema + DB connection
│       └── src/schema/     # organisations, users, fleet, energy, goals, reports, widget, audit
└── scripts/                # Utility scripts
```

## API Routes

All under `/api`:
- `GET /healthz` — health check
- `GET/POST /auth/session|passkey/*|magic-link/*|logout`
- `GET/POST/PATCH/DELETE /organisations/:orgId`
- `GET /organisations/:orgId/summary` — ESG summary dashboard
- `GET/POST /organisations/:orgId/users`
- `GET/POST/DELETE /organisations/:orgId/fleet/vehicles`
- `GET /organisations/:orgId/fleet/events`
- `POST /webhooks/fleet/navman|blackhawk|generic` — authenticated via per-org `webhookSecret` from `organisations.webhook_secret`
- `GET /organisations/:orgId/energy/readings`
- `POST /organisations/:orgId/energy/upload` — PDF bill upload
- `GET /organisations/:orgId/energy/email-address` — inbound email
- `POST /webhooks/energy/inbound-email`
- `GET /organisations/:orgId/emissions` — with period and groupBy
- `GET/POST/PATCH /organisations/:orgId/goals`
- `GET/POST /organisations/:orgId/reports`
- `GET /organisations/:orgId/recommendations` — concrete, ranked NZ-specific
  decarbonisation actions generated from live fleet, energy, and target data.
  Returns `{ baseline, totals, targetGap, items[] }`. Items include vehicle
  EV/PHEV swaps (BYD Shark 6, Atto 3, MG4, LDV eDeliver, Kia EV9), right-sized
  rooftop solar (SEANZ benchmarks), renewable supplier switches (Ecotricity
  lead), building measures (LED, HVAC schedule, heat-pump HWC, sub-metering),
  and operational changes (telematics coaching, fleet right-sizing, hybrid WFH).
  Each rec carries CO₂e saving, capex, payback, scope, effort, and links.
  Frontend: `/recommendations` page with category filter chips and target-gap
  callout. Catalogue lives in `lib/recommendations-catalogue.ts`.
- `GET/PUT /organisations/:orgId/widget`
- `GET /widget/:widgetKey/data` — public (no auth)
- `GET /organisations/:orgId/audit-logs`
- `GET /admin/stats` — super_admin only
- `GET /security/status` — admin-only (super_admin / org_admin); runs ~17 runtime
  security checks (TLS, headers, CORS, session, auth rate-limit, passkey store,
  CRM key hashing + indexed prefix lookup, fleet webhook secrets per org,
  public-audit token hashing, audit-log activity, CRM call ledger, etc.).
  Returns `{ overall: pass|warn|fail, counts, checks[] }`. Surfaced in the UI
  via the floating shield button at the bottom-right of every authenticated
  page (`SecurityStatusWidget`). Polls every 5 min idle / 1 min while open;
  hidden entirely for non-admin roles.
- `GET /security/pack.txt` — admin-only; downloadable plaintext "Internal
  Security Pack" with every check + detail + SHA-256 self-checksum. Confidential.
- `GET /api/compliance/public` — **PUBLIC**, no auth, open CORS. Returns a
  sanitised aggregate snapshot: overall status, passing/total counts, 8 high-level
  category buckets (no check IDs, no env names, no infra detail). 60s in-memory
  cache. Powers the live `<ComplianceWidget>` on the marketing site (front page
  + /trust hero).
- `GET /api/compliance/public/pack.txt` — **PUBLIC** downloadable text "Trust
  Pack" with the same sanitised data plus framework alignment claims (SOC 2,
  ISO 27001, NZ Privacy Act, GDPR, GHG Protocol, FIDO2) and SHA-256 checksum.
  Safe for boards, prospects, and procurement.

### CRM Integration API (`/api/v1/*`) — FGC Customer Operations API Standard v1
Bearer-key authenticated surface for the sister CRM (FGC, also on Replit) to provision
EnviroIQ customers, manage contacts/users/subscriptions/billing/provisioning/tickets,
and pull audit + ESG metrics. **Fully aligned to the FGC Customer Operations API Standard
v1** — every payload is snake_case, every response uses the standard envelope.

**Conventions enforced platform-wide on `/api/v1`:**
- Response envelope: `{ success, data, meta:{timestamp,version,requestId}, [pagination] }`.
- Error envelope: `{ success:false, error:{ code, message, details? }, meta }` with
  SCREAMING_SNAKE_CASE codes (`BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
  `CONFLICT`, `UNPROCESSABLE`, `RATE_LIMITED`, `INTERNAL_ERROR`, `UPSTREAM_ERROR`).
- Per-request `X-Correlation-ID` (auto-minted if absent) — echoed back, persisted on
  every audit row (`audit_logs.correlation_id`), and threaded through inner calls.
- `Idempotency-Key` header on POST/PATCH/DELETE — 24h replay window via
  `idempotency_keys` table (returns cached body + `Idempotent-Replay: true` header;
  same key + different body = `409 CONFLICT`).
- Lifecycle endpoints (suspend/reactivate/archive/cancel/credit-hold/escalate) **require**
  a `reason_code` from the FGC enum: `customer_request`, `billing_non_payment`,
  `security_event`, `compliance_issue`, `duplicate_record`, `internal_admin_change`,
  `failed_verification`, `contract_end`, `fraud_review`.
- Webhook event names (emitted in `audit_logs.details.event`): `customer.created`,
  `customer.suspended`, `customer.reactivated`, `customer.archived`, `contact.*`,
  `user.suspended`, `subscription.created`, `subscription.cancelled`,
  `billing_profile.credit_hold_applied`, `billing_profile.credit_hold_released`,
  `provisioning.requested`, `ticket.escalated`, etc.

**Entity surface** (all under `/api/v1`):
- `customers` (formerly organisations) — full CRUD + `/suspend`, `/reactivate`, `/archive`
- `customers/:cid/contacts` — CRUD
- `customers/:cid/users` — invite + `/suspend`, `/reactivate`
- `customers/:cid/subscriptions` — create + `/cancel`
- `customers/:cid/billing-profile` — GET, PUT, `/credit-hold`
- `customers/:cid/provisioning-requests` — create + list
- `customers/:cid/tickets` — CRUD + `/escalate`
- `audit` — global query with filters (customer_id, action, actor_type, reason_code, correlation_id, …)

**Scopes** (each key has explicit subset; enforced per route):
`customers|contacts|users|subscriptions|billing|provisioning|tickets|audit|metrics × read|write`.

**Key infra:**
- `lib/api-response.ts` — `ok`, `created`, `paginated`, `noContent`, `Errors.*`,
  `fgcErrorHandler` (last middleware on `/v1`), `asyncRoute`.
- `lib/api-context.ts` — `correlationMiddleware` (binds `X-Correlation-ID`).
- `lib/idempotency.ts` — replay + body-hash conflict detection.
- `lib/audit.ts` — extended with `actor_type`, `previous_value`, `new_value`,
  `reason_code`, `correlation_id`; `FGC_REASON_CODES` allow-list.
- Keys issued from Super Admin → "CRM API & Keys" (`/api-keys`); SHA-256 hashed only,
  shown to operator exactly once at creation; per-call audit log (`crm_api_key_usage`).
- Auth flow: lookup by indexed public prefix → constant-time hash compare. All auth
  failures route through the FGC envelope (`UNAUTHORIZED`/`FORBIDDEN`).
- Suspending a customer immediately blocks all logins for that org's users via
  `lib/org-active-guard.ts` (called from session, passkey-authenticate, magic-link verify).
- Spec: `GET /api/v1/openapi.json` (OpenAPI 3.1, includes `x-fgc-standard` extension
  listing all reason codes + webhook events) + `/crm-api-spec.md` (human brief).

## Key Environment Variables

- `DATABASE_URL` — PostgreSQL connection (auto-set by Replit)
- `SESSION_SECRET` — express-session secret (defaults to dev value)
- `RP_ID` — WebAuthn relying party ID (defaults to `localhost`)
- `ORIGIN` — WebAuthn expected origin (defaults to `http://localhost`)
- `INBOUND_EMAIL_DOMAIN` — email domain for energy bill forwarding (defaults to `bills.enviroiq.app`)
- `PORT` — server port (auto-set per artifact)

## Running Seed

```bash
node_modules/.bin/tsx artifacts/api-server/src/seed.ts
```

## Brand Guidelines (Official)

### Colours
| Name | Hex | RGB |
|---|---|---|
| Charcoal | `#0B0D0F` | 11 13 15 |
| Electric Green | `#22C55E` | 34 197 94 |
| IQ Blue | `#0EA5E8` | 14 165 233 |
| Steel | `#64748B` | 100 116 139 |
| Mist | `#F3F4F6` | 243 244 246 |
| White | `#FFFFFF` | 255 255 255 |

### Typography
- **Font**: Inter only — Light, Regular, Medium, SemiBold, Bold
- Wordmark: "Enviro" in regular/medium weight, "IQ" in bold + Electric Green

### Logo Mark Anatomy
The Q mark comprises three elements:
1. **System / World** — Bold Q ring (circle with arrow tail = magnifying glass/search)
2. **Signal / Pulse** — Green ECG/mountain waveform inside the Q ring = Intelligence in motion
3. **Data Point** — Green dot at top-right of the ring = Live, connected, real-time

### Logo Variants & Usage
| Variant | File | Usage |
|---|---|---|
| Primary lockup (dark bg) | `mark-white.svg` + CSS wordmark | App sidebar, login page, dark surfaces |
| Primary lockup (light bg) | `mark-dark.svg` + CSS wordmark | Marketing navbar/footer, light surfaces |
| Icon only | `favicon.svg` | Browser tab only (charcoal rounded-square bg) |

### Logo Rules
- Clear space around logo = height of the green dot
- Never crowd or distort the logo
- On dark: white Q ring + white tail + green ECG + green dot
- On light: charcoal Q ring + charcoal tail + green ECG + green dot
- "IQ" is always Electric Green in the wordmark

### App vs Marketing Theme
- **App (enviroiq)**: Dark charcoal theme — `#0B0D0F` background, white foreground
- **Marketing site**: White/light theme — white background, charcoal foreground
- Primary green `#22C55E` is used on both as the accent/CTA colour

### Taglines
- "Real Time ESG Intelligence"
- "Data. Decisions. Impact."
- "Know Now. Act Now."

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` with `composite: true`. Root `tsconfig.json` lists all packages as references. Always typecheck from root: `pnpm run typecheck`.

- `emitDeclarationOnly` — only .d.ts files via typecheck; actual JS by esbuild/vite
- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Push DB schema: `pnpm --filter @workspace/db run push`
