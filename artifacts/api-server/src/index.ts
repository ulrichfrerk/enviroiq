import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, stopScheduler } from "./lib/scheduler";
import { startSupplierAuditScheduler } from "./lib/scheduler-supplier-audits";
import { startGapDetector, stopGapDetector } from "./lib/notification-gap-scanners";
import { ensureDefaultSupplierAuditTemplate } from "./lib/supplier-audit-default-template";
import { ensureCrmApiKeyTables } from "./lib/crm-api-keys";
import { db } from "@workspace/db";
import { verifyDatabaseSchema } from "@workspace/db/verify-schema";
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
  // Per-org compliance archive retention (months). Applied at capture time
  // to derive expires_at on document_archives. Default matches the original
  // platform-wide 6mo policy; admins can raise it (e.g. 84 for 7-year audit
  // requirements) via PATCH /organisations/:orgId/document-archive-policy.
  await db.execute(
    sql`ALTER TABLE organisations ADD COLUMN IF NOT EXISTS document_archive_retention_months integer NOT NULL DEFAULT 6`,
  );
  // Per-user sign-in policy override columns (lib/db/src/schema/users.ts).
  // Added as part of the per-user "Sign-in restrictions" feature; required by
  // both the per-user PATCH /:userId/sign-in-policy endpoint and the bulk
  // POST /users/sign-in-policy/bulk endpoint.
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS required_sign_in_provider text`,
  );
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_sign_in_methods jsonb`,
  );
  // Per-user opt-in for system-generated email notifications. Default OFF —
  // admins enable from their Account page when they want EnviroIQ to start
  // emailing them. Bell-icon notifications are unaffected.
  await db.execute(
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT false`,
  );
  // last_used_at on passkeys (lib/db/src/schema/users.ts) — bumped on each
  // successful passkey login. Nullable so existing rows stay "Never used"
  // until the next sign-in rather than back-dating to the migration moment.
  await db.execute(
    sql`ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS last_used_at timestamptz`,
  );
  // User-supplied friendly name for a passkey (lib/db/src/schema/users.ts).
  // Nullable — pre-existing rows stay un-labelled and the UI falls back to
  // the deviceType-derived default until the user renames the device.
  await db.execute(
    sql`ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS label text`,
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
  logger.info("SSO schema ready");
}

/**
 * Idempotent self-heal for the supplier audit question overrides table and the
 * `questions_snapshot` column on supplier_audits. Lets buyers turn audit
 * questions off org-wide / per-supplier with a full audit trail. Snapshot
 * column is JSONB array of effective question IDs; null = use full template
 * (back-compat for audits sent before overrides existed).
 */
async function ensureSupplierAuditOverrideSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS supplier_audit_question_overrides (
      id                    text PRIMARY KEY,
      organisation_id       text NOT NULL,
      template_id           text NOT NULL,
      question_id           text NOT NULL,
      supplier_id           text,
      enabled               boolean NOT NULL,
      rationale_snapshot    text NOT NULL,
      reason                text NOT NULL,
      created_by_user_id    text,
      created_by_email      text,
      created_at            timestamptz NOT NULL DEFAULT now(),
      updated_at            timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS supplier_q_overrides_org_scope_idx ON supplier_audit_question_overrides (organisation_id, template_id, supplier_id)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS supplier_q_overrides_question_idx ON supplier_audit_question_overrides (organisation_id, template_id, question_id)`,
  );
  // Unique guard at each scope. NULLs are not equal in standard B-tree
  // unique indexes, so we use COALESCE-based expressions for org-level rows.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_q_overrides_unique_org_idx
    ON supplier_audit_question_overrides (organisation_id, template_id, question_id)
    WHERE supplier_id IS NULL
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS supplier_q_overrides_unique_supplier_idx
    ON supplier_audit_question_overrides (organisation_id, template_id, question_id, supplier_id)
    WHERE supplier_id IS NOT NULL
  `);
  await db.execute(
    sql`ALTER TABLE supplier_audits ADD COLUMN IF NOT EXISTS questions_snapshot jsonb`,
  );
  logger.info("Supplier audit override schema ready");
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

/**
 * Idempotent self-heal for the notifications schema
 * (lib/db/src/schema/notifications.ts). Two tables:
 *   - notification_events: one row per upstream domain event, with a UNIQUE
 *     dedupeKey so repeat fires of `notify()` no-op.
 *   - notifications: per-recipient fan-out drives the bell icon + email.
 */
async function ensureNotificationsSchema(): Promise<void> {
  // Step 1: CREATE TABLE IF NOT EXISTS for both tables.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notification_events (
      id                 text PRIMARY KEY,
      organisation_id    text NOT NULL,
      category           text NOT NULL,
      severity           text NOT NULL,
      title              text NOT NULL,
      body               text NOT NULL,
      link_url           text,
      source_audit_id    text,
      context            jsonb,
      dedupe_key         text NOT NULL,
      created_at         timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id                  text PRIMARY KEY,
      organisation_id     text NOT NULL,
      recipient_user_id   text NOT NULL,
      category            text NOT NULL,
      severity            text NOT NULL,
      title               text NOT NULL,
      body                text NOT NULL,
      link_url            text,
      source_audit_id     text,
      source_event_id     text NOT NULL,
      read_at             timestamptz,
      dismissed_at        timestamptz,
      email_sent_at       timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Step 2: ADD COLUMN IF NOT EXISTS guards heal partial-deploy drift before
  // any index that depends on a column tries to create itself.
  for (const stmt of [
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS organisation_id text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info'`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS link_url text`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS source_audit_id text`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS context jsonb`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS dedupe_key text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS organisation_id text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_user_id text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info'`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_url text`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_audit_id text`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source_event_id text NOT NULL DEFAULT ''`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at timestamptz`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS email_sent_at timestamptz`,
    sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
  ]) {
    await db.execute(stmt);
  }
  // Step 3: indexes (after columns are guaranteed to exist).
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS notification_events_dedupe_key_uq ON notification_events (dedupe_key)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS notification_events_org_created_idx ON notification_events (organisation_id, created_at)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx ON notifications (recipient_user_id, created_at)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS notifications_org_created_idx ON notifications (organisation_id, created_at)`,
  );
  logger.info("Notifications schema ready");
}

/**
 * Verify the live database matches every table and column declared in
 * `lib/db/src/schema`. Runs after the existing `ensure*` self-heal chain so
 * inline backfills get a chance first; on any missing object we log a
 * structured error naming the table/column and exit non-zero. This is the
 * production safety net behind the post-merge schema sync — a deployed
 * server with a missing column will refuse to start instead of returning
 * 500s on the first request that touches it. See replit.md → "Schema
 * changes" for the workflow.
 */
async function verifyAndStart(): Promise<void> {
  const result = await verifyDatabaseSchema();
  if (!result.ok) {
    logger.fatal(
      {
        missingTables: result.missingTables,
        missingColumns: result.missingColumns,
      },
      "Database schema verification failed — server will not start. " +
        "Either the post-merge schema sync did not run, or this schema-touching " +
        "task forgot to add a self-heal in artifacts/api-server/src/index.ts. " +
        "See replit.md → \"Schema changes\".",
    );
    process.exit(1);
  }
  logger.info({ tablesChecked: result.tablesChecked }, "Database schema verified");
}

/**
 * One-shot data fix: correct Acme Ltd contract signed-at timestamp.
 * Target: 15 May 2026 1:38 PM NZT (= 2026-05-15T01:38:00Z, NZ = UTC+12 in May).
 * Idempotent via IS DISTINCT FROM predicate. Runs on every boot; once the
 * prod row matches, subsequent runs are no-ops. Safe to remove later.
 */
async function applyOneShotContractFix(): Promise<void> {
  try {
    const target = "2026-05-15T01:38:00.000Z";
    const result = await db.execute(sql`
      update subscriptions
      set entitlements = jsonb_set(entitlements, '{signerMeta,signedAt}', to_jsonb(${target}::text))
      where id = 'dc036d92-3504-4242-8aec-e72b71bae39c'
        and entitlements->'signerMeta'->>'signedAt' is distinct from ${target}
    `);
    const rows = (result as { rowCount?: number | null }).rowCount ?? 0;
    if (rows > 0) {
      logger.info({ rows, target }, "One-shot fix applied: acme-plumbing contract signedAt");
    }
  } catch (err) {
    logger.error({ err }, "One-shot contract fix failed (non-fatal, continuing)");
  }
}

ensureSessionTable()
  .then(() => ensureSuperAdmin())
  .then(() => applyOneShotContractFix())
  .then(() => ensureOrgBillingColumns())
  .then(() => ensureSsoSchema())
  .then(() => ensureDocumentArchiveSchema())
  .then(() => ensureSupplierAuditOverrideSchema())
  .then(() => ensureNotificationsSchema())
  .then(() => ensureCrmApiKeyTables())
  .then(() => ensureDefaultSupplierAuditTemplate())
  .then(() => verifyAndStart())
  .then(() => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
      startSupplierAuditScheduler();
      startGapDetector();
    });

    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, shutting down gracefully");
      stopScheduler();
      stopGapDetector();
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
    });

    process.on("SIGINT", () => {
      stopScheduler();
      stopGapDetector();
      server.close(() => process.exit(0));
    });
  })
  .catch((err) => {
    logger.error(
      { err },
      "Startup failed — one of the ensure*/verify-schema steps threw before the server could bind",
    );
    process.exit(1);
  });

