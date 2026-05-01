import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, stopScheduler } from "./lib/scheduler";
import { startSupplierAuditScheduler } from "./lib/scheduler-supplier-audits";
import { ensureDefaultSupplierAuditTemplate } from "./lib/supplier-audit-default-template";
import { ensureCrmApiKeyTables } from "./lib/crm-api-keys";
import { db } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { usersTable } from "@workspace/db/schema";

/**
 * Ensure the connect-pg-simple session table exists.
 * We do this from inline SQL rather than relying on connect-pg-simple's
 * createTableIfMissing option, which reads a 'table.sql' file that doesn't
 * exist in the bundled production build.
 */
async function ensureSessionTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "session" (
      "sid"    varchar        NOT NULL COLLATE "default",
      "sess"   json           NOT NULL,
      "expire" timestamp(6)   NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
  `);
  logger.info("Session table ready");
}

/**
 * Ensure the user identified by SUPER_ADMIN_EMAIL always has the super_admin role.
 * This is idempotent — safe to run on every startup. It prevents a situation where
 * the super admin was created with the wrong role (e.g. org_viewer) due to a race
 * condition or manual seed discrepancy.
 */
async function ensureSuperAdmin(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) return;
  const result = await db
    .update(usersTable)
    .set({ role: "super_admin", updatedAt: new Date() })
    .where(eq(usersTable.email, email))
    .returning({ id: usersTable.id, email: usersTable.email });
  if (result.length > 0) {
    logger.info({ email }, "Super admin role confirmed");
  } else {
    logger.warn({ email }, "SUPER_ADMIN_EMAIL set but no matching user found — user must log in first to be created");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Ensure all DB prerequisites exist, then start listening
async function ensureOrgBillingColumns(): Promise<void> {
  // Idempotent — adds plan + billing_status columns used by the CRM API.
  await db.execute(sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS plan text`);
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'active'`,
  );
  logger.info("Organisation billing columns ready");
}

/**
 * Idempotent self-heal for the SSO schema (lib/db/src/schema/sso-identities.ts
 * + new columns on organisations). Required because production rolls forward
 * via `drizzle-kit push` on the dev DB only — production DDL must be applied
 * here at startup.
 */
async function ensureSsoSchema(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS google_sso_enabled boolean NOT NULL DEFAULT true`,
  );
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS microsoft_sso_enabled boolean NOT NULL DEFAULT true`,
  );
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS allowed_sign_in_methods jsonb NOT NULL DEFAULT '["magic_link","passkey","google_sso","microsoft_sso"]'::jsonb`,
  );
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS required_sso_provider text`,
  );
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sso_identities (
      id              text PRIMARY KEY,
      user_id         text NOT NULL,
      provider        text NOT NULL,
      provider_sub    text NOT NULL,
      provider_email  text NOT NULL,
      linked_at       timestamptz NOT NULL DEFAULT now(),
      last_used_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS sso_identities_provider_sub_uq ON sso_identities (provider, provider_sub)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS sso_identities_user_idx ON sso_identities (user_id)`,
  );
  // Per-user sign-in policy override columns (Task #9). When set on a user
  // row these supersede the org-level policy.
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS required_sign_in_provider text`,
  );
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_sign_in_methods jsonb`,
  );
  logger.info("SSO schema ready");
}

/**
 * Idempotent self-heal for the compliance document archive
 * (lib/db/src/schema/document-archives.ts). Stores raw analytics PDFs as bytea
 * with a 6-month retention; metadata is retained after content purge.
 */
async function ensureDocumentArchiveSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS document_archives (
      id                    text PRIMARY KEY,
      organisation_id       text NOT NULL,
      source_type           text NOT NULL,
      source_id             text,
      original_filename     text NOT NULL,
      content_type          text NOT NULL,
      size_bytes            integer NOT NULL,
      sha256                text NOT NULL,
      content               bytea,
      captured_at           timestamptz NOT NULL DEFAULT now(),
      expires_at            timestamptz NOT NULL,
      captured_by_user_id   text,
      captured_by_email     text,
      retention_policy      text NOT NULL DEFAULT '6mo_default',
      sender_email          text,
      purged_at             timestamptz,
      notes                 text
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS doc_archives_org_idx ON document_archives (organisation_id, captured_at)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS doc_archives_expires_idx ON document_archives (expires_at)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS doc_archives_source_idx ON document_archives (source_type, source_id)`,
  );
  logger.info("Document archive schema ready");
}

ensureSessionTable()
  .then(() => ensureSuperAdmin())
  .then(() => ensureOrgBillingColumns())
  .then(() => ensureSsoSchema())
  .then(() => ensureDocumentArchiveSchema())
  .then(() => ensureCrmApiKeyTables())
  .then(() => ensureDefaultSupplierAuditTemplate())
  .then(() => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
      startSupplierAuditScheduler();
    });

    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, shutting down gracefully");
      stopScheduler();
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", () => {
      stopScheduler();
      server.close(() => process.exit(0));
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup failed — could not ensure session table");
    process.exit(1);
  });

