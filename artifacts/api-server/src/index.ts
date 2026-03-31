import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler, stopScheduler } from "./lib/scheduler";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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
  .then(() => {
    const server = app.listen(port, () => {
      logger.info({ port }, "Server listening");
      startScheduler();
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

