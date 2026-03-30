# EnviroIQ — ESG Sustainability Platform

## Overview

Real-time multi-tenant ESG sustainability measurement platform. Companies track CO2 emissions from fleet vehicles (Navman, Blackhawk GPS integration) and energy consumption (PDF upload + inbound email bill parsing). Features passkey/WebAuthn authentication, super-admin portal, board-ready PDF reports, an embeddable public widget, full audit logging (SOC 2 mindset), and role-based access.

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
- `GET/PUT /organisations/:orgId/widget`
- `GET /widget/:widgetKey/data` — public (no auth)
- `GET /organisations/:orgId/audit-logs`
- `GET /admin/stats` — super_admin only

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

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` with `composite: true`. Root `tsconfig.json` lists all packages as references. Always typecheck from root: `pnpm run typecheck`.

- `emitDeclarationOnly` — only .d.ts files via typecheck; actual JS by esbuild/vite
- Run codegen: `pnpm --filter @workspace/api-spec run codegen`
- Push DB schema: `pnpm --filter @workspace/db run push`
