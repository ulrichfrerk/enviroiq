# EnviroIQ — ESG Sustainability Platform

## Overview

EnviroIQ is a real-time multi-tenant ESG sustainability measurement platform. It enables companies to track CO2 emissions from fleet vehicles and energy consumption. The platform features custom passwordless authentication, a super-admin portal, generates board-ready PDF reports, includes an embeddable public widget, incorporates full audit logging for SOC 2 compliance, and supports role-based access.

Key capabilities include:
- **ESG Intelligence**: Maturity Scoring, Emission Target management, and Scenario Modelling for emission reduction.
- **Data Ingestion**: Integration with GPS providers (Navman, Blackhawk) for fleet data and PDF/email parsing for energy bills.
- **Reporting & Analytics**: Dashboard widgets for maturity and target progress, detailed emission tracking, and concrete, ranked decarbonisation recommendations.

The project aims to provide comprehensive ESG data and actionable insights to facilitate sustainable practices and drive environmental impact.

## User Preferences

I prefer iterative development with clear communication on significant changes. Before making any major architectural changes or introducing new external dependencies, please ask for approval. For code, I prefer modern TypeScript with a focus on maintainability and scalability. All documentation should be clear, concise, and kept up-to-date with the codebase.

## System Architecture

The EnviroIQ platform is built as a pnpm monorepo using Node.js 24 and TypeScript 5.9.

### UI/UX Decisions
- **Color Scheme**: Utilizes a specific brand palette: Charcoal (`#0B0D0F`), Electric Green (`#22C55E`), IQ Blue (`#0EA5E8`), Steel (`#64748B`), Mist (`#F3F4F6`), and White (`#FFFFFF`).
- **Typography**: Employs the Inter font family across various weights.
- **Branding**: The logo mark features a 'Q' with a waveform and data point, symbolizing intelligence and real-time data. Specific logo variants are used for dark vs. light backgrounds and app vs. marketing contexts.
- **Application Theme**: The main application (`enviroiq`) uses a dark charcoal theme, while the marketing site uses a white/light theme. Electric Green serves as the primary accent and CTA color across both.
- **Frontend**: Developed with React, Vite, TanStack Query, Wouter, Recharts, and shadcn/ui.

### Technical Implementations
- **API Framework**: Express 5, secured with Helmet and express-rate-limit.
- **Database**: PostgreSQL with Drizzle ORM. The schema includes tables for organisations, users, fleet, energy, goals, reports, widgets, and audit logs.
- **Authentication**: Custom passwordless system using `express-session` for session management. It supports four sign-in methods: magic links (via Resend), WebAuthn passkeys (using `@simplewebauthn/server` and `@simplewebauthn/browser`), Google SSO and Microsoft SSO (native OIDC + PKCE via `jose`, no Clerk/Auth0/WorkOS). SSO never creates accounts (no JIT) — the user must already exist; the first successful sign-in links a row in `sso_identities`. Org admins can configure per-org policy in **Settings → Sign-in & SSO**: enable/disable each provider, restrict the list of allowed sign-in methods, optionally require one specific SSO provider for non-admin users. Org admins always retain a magic-link break-glass path (audited as `auth.break_glass_magic_link`). All SSO and policy events are written to the audit log (`sso.sign_in.success`, `sso.sign_in.rejected`, `sso.identity.linked`, `sso.policy.changed`).
- **Validation**: Zod is used for schema validation.
- **API Codegen**: Orval generates API client code from an OpenAPI specification.
- **Monorepo Structure**: Organized into `artifacts` (API server and frontend), `lib` (API spec, generated clients, database schema), and `scripts`.
- **Roles**: `super_admin`, `org_admin`, and `org_viewer` with distinct access levels.
- **Emission Factors**: Pre-defined factors for Diesel, Petrol, Electricity, and Gas are used for CO2e calculations.
- **Compliance Document Archive**: Ingested documents are archived in the `document_archives` table with a 6-month retention policy, aligned with NZ Privacy Act, GDPR, and SOC 2. Metadata is retained indefinitely for audit purposes.
- **Security Features**: Includes a runtime security status check (`/security/status`) available to admins, assessing various security configurations and practices. Public compliance snapshots are also available.

### Feature Specifications
- **ESG Intelligence**:
    - **Maturity Scoring**: A 4-dimensional system (Foundation, Coverage, Quality, Governance) resulting in grades: Foundation, Developing, Advanced, Leader.
    - **Emission Targets**: CRUD operations for defining reduction targets with baselines, target years, percentage reductions, and frameworks (SBTi, Paris).
    - **Scenario Modelling**: An interactive engine for modeling emission reductions through levers like EV transition, distance reduction, modal shifts, renewables, efficiency, and offsets.
- **Decarbonisation Recommendations**: Concrete, ranked, NZ-specific actions generated from live fleet, energy, and target data, including CO₂e savings, capex, payback, scope, and effort.
- **CRM Integration API (`/api/v1/*`)**: A bearer-key authenticated API for customer operations, fully aligned with the FGC Customer Operations API Standard v1. It handles customer provisioning, contact/user management, subscriptions, billing, and pulls audit/ESG metrics. This API enforces specific response envelopes, error structures, correlation IDs, and idempotency keys. Lifecycle endpoints require specific `reason_code` values.

## External Dependencies

- **Email Service**: Resend (for sending magic links)
- **GPS Telematics**: Navman, Blackhawk GPS (for fleet data integration)
- **Database**: PostgreSQL
- **WebAuthn Libraries**: `@simplewebauthn/server`, `@simplewebauthn/browser`
- **Frontend Libraries**: TanStack Query, Wouter, Recharts, shadcn/ui
- **CRM System**: FGC (sister CRM integrated via `/api/v1` endpoints)