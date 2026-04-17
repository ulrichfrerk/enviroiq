import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, stopScheduler } from "./lib/scheduler";
import { startSupplierAuditScheduler } from "./lib/scheduler-supplier-audits";
import { ensureDefaultSupplierAuditTemplate } from "./lib/supplier-audit-default-template";
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
ensureSessionTable()
  .then(() => ensureSuperAdmin())
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

