# EnviroIQ — ESG Sustainability Platform

## Overview

EnviroIQ is a real-time multi-tenant ESG sustainability measurement platform designed to help companies track and manage CO2 emissions from fleet vehicles and energy consumption. It provides comprehensive ESG data and actionable insights to facilitate sustainable practices and drive environmental impact. Key features include custom passwordless authentication, a super-admin portal, board-ready PDF reports, an embeddable public widget, full audit logging for SOC 2 compliance, and role-based access.

The platform offers:
- **ESG Intelligence**: Maturity Scoring, Emission Target management, and Scenario Modelling for emission reduction.
- **Data Ingestion**: Integrates with GPS providers (Navman, Blackhawk) for fleet data and parses PDFs/emails for energy bills.
- **Reporting & Analytics**: Provides dashboard widgets for maturity and target progress, detailed emission tracking, and concrete, ranked decarbonisation recommendations.

## User Preferences

I prefer iterative development with clear communication on significant changes. Before making any major architectural changes or introducing new external dependencies, please ask for approval. For code, I prefer modern TypeScript with a focus on maintainability and scalability. All documentation should be clear, concise, and kept up-to-date with the codebase.

## System Architecture

The EnviroIQ platform is built as a pnpm monorepo using Node.js 24 and TypeScript 5.9.

### UI/UX Decisions
- **Color Scheme**: Uses Charcoal, Electric Green, IQ Blue, Steel, Mist, and White. Electric Green is the primary accent and CTA color.
- **Typography**: Employs the Inter font family.
- **Branding**: The logo features a 'Q' with a waveform and data point.
- **Application Theme**: The main application uses a dark charcoal theme, while the marketing site uses a white/light theme.

### Technical Implementations
- **Frontend**: Developed with React, Vite, TanStack Query, Wouter, Recharts, and shadcn/ui.
- **API Framework**: Express 5, secured with Helmet and express-rate-limit.
- **Database**: PostgreSQL with Drizzle ORM.
- **Authentication**: Custom passwordless system using `express-session`, supporting magic links, WebAuthn passkeys, Google SSO, and Microsoft SSO. SSO requires existing user accounts.
- **Validation**: Zod for schema validation.
- **API Codegen**: Orval generates API client code from an OpenAPI specification.
- **Monorepo Structure**: Organized into `artifacts` (API server and frontend), `lib` (API spec, generated clients, database schema), and `scripts`.
- **Roles**: `super_admin`, `org_admin`, and `org_viewer`.
- **Emission Factors**: Pre-defined factors for Diesel, Petrol, Electricity, and Gas for CO2e calculations.
- **Compliance Document Archive**: Ingested documents are archived with a 6-month retention policy for compliance (NZ Privacy Act, GDPR, SOC 2).
- **Security Features**: Runtime security status checks and public compliance snapshots.
- **Notifications**: A two-table system for events and recipients, with batched email dispatch and per-org digests. Includes a nightly gap detector for missing bills, stale telematics, and overdue reports, designed to be idempotent and audit-anchored.
- **Schema Management**: Uses Drizzle ORM with forced pushes for dev, self-healing `ALTER TABLE IF NOT EXISTS` on production startup, and schema verification tests.

### Feature Specifications
- **ESG Intelligence**:
    - **Maturity Scoring**: 4-dimensional system (Foundation, Coverage, Quality, Governance) with grades Foundation, Developing, Advanced, Leader.
    - **Emission Targets**: CRUD operations for reduction targets, with progress computed server-side against an annualised trailing-12-month figure.
    - **Scenario Modelling**: Interactive engine for modeling emission reductions through various levers.
- **Decarbonisation Recommendations**: Concrete, ranked, NZ-specific actions generated from live data, including CO₂e savings, capex, payback, scope, and effort.
- **ESG Board Pack PDF**: Server-rendered HTML to PDF reports, storing data snapshots. Includes safeguards for incomplete data and estimated fuel costs.
- **CRM Integration API**: Bearer-key authenticated API (`/api/v1/*`) for customer operations, provisioning, user management, subscriptions, billing, and pulling audit/ESG metrics, adhering to FGC Customer Operations API Standard v1.

### Release Test Suite
A tiered post-release smoke suite run via `pnpm release:test`.
- **Tier 1 — Boot**: Verifies basic API health and router responsiveness.
- **Tier 2 — Smoke**: Checks authentication contracts and ensures all major routers respond correctly (401/403, not 404/500).
- **Tier 3 — Journey**: Tests end-to-end user flows, with separate modes for local development (forged session) and production (bearer token).

## External Dependencies

- **Email Service**: Resend
- **GPS Telematics**: Navman, Blackhawk GPS
- **Database**: PostgreSQL
- **WebAuthn Libraries**: `@simplewebauthn/server`, `@simplewebauthn/browser`
- **Frontend Libraries**: TanStack Query, Wouter, Recharts, shadcn/ui
- **CRM System**: FGC (integrated via `/api/v1` endpoints)