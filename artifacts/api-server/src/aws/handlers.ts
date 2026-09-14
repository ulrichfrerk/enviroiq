// AWS Lambda entry points. Built by script/build-aws.mjs into dist/aws/index.mjs.
//   http        API Gateway (REST, Lambda proxy) → the Express app from ./app
//   maintenance EventBridge Scheduler → the jobs that setInterval used to run
//   migrate     one-off: create the database, apply migrations/*.sql, run the
//               runtime schema self-heal chain
import type { Handler, ScheduledEvent } from "aws-lambda";
import serverless from "serverless-http";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

let cachedHttpHandler: ReturnType<typeof serverless> | undefined;

async function getHttpHandler(): Promise<ReturnType<typeof serverless>> {
  if (!cachedHttpHandler) {
    const { default: app } = await import("../app");
    cachedHttpHandler = serverless(app, {
      binary: ["application/pdf", "application/octet-stream", "application/zip", "application/gzip", "image/*", "font/*", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    });
  }
  return cachedHttpHandler;
}

export const http: Handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  return (await getHttpHandler())(event, context);
};

export type MaintenanceJob =
  | "org-metrics"
  | "em6-intensity"
  | "grid-prune"
  | "archive-prune"
  | "notification-digest"
  | "webauthn-prune"
  | "stale-signin-digest"
  | "supplier-audits"
  | "gap-detector"
  | "session-prune";

export const maintenance: Handler<ScheduledEvent<{ job: MaintenanceJob }>> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const job = event.detail.job;
  switch (job) {
    case "org-metrics": {
      const { refreshAllOrgMetrics } = await import("../lib/scheduler");
      await refreshAllOrgMetrics();
      break;
    }
    case "em6-intensity": {
      const { clearIntensityCache, fetchAndStoreEm6Intensity } = await import("../lib/em6");
      clearIntensityCache();
      await fetchAndStoreEm6Intensity();
      break;
    }
    case "grid-prune": {
      const { pruneOldGridSnapshots } = await import("../lib/em6");
      await pruneOldGridSnapshots();
      break;
    }
    case "archive-prune": {
      const { pruneExpiredDocumentArchives } = await import("../lib/documentArchive");
      await pruneExpiredDocumentArchives();
      break;
    }
    case "notification-digest": {
      const { runNotificationDigestTick } = await import("../lib/scheduler");
      await runNotificationDigestTick();
      break;
    }
    case "webauthn-prune": {
      const { pruneExpiredChallenges } = await import("../routes/auth");
      await pruneExpiredChallenges();
      break;
    }
    case "stale-signin-digest": {
      const { runStaleSignInDigestOnce } = await import("../lib/stale-signin-scanner");
      await runStaleSignInDigestOnce({});
      break;
    }
    case "supplier-audits": {
      const { runSupplierAuditTick } = await import("../lib/scheduler-supplier-audits");
      await runSupplierAuditTick();
      break;
    }
    case "gap-detector": {
      const { runGapDetectorTick } = await import("../lib/notification-gap-scanners");
      await runGapDetectorTick();
      break;
    }
    case "session-prune": {
      const { db } = await import("@workspace/db");
      const { sql } = await import("drizzle-orm");
      await db.execute(sql`DELETE FROM "session" WHERE "expire" < now()`);
      break;
    }
    default:
      throw new Error(`Unsupported maintenance job: ${String(job)}`);
  }
  console.log(JSON.stringify({ job, status: "ok" }));
};

export const migrate: Handler<{ skipGuards?: boolean }> = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const target = new URL(process.env.DATABASE_URL!);
  const dbName = target.pathname.slice(1);
  const ssl = process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined;

  const admin = new pg.Client({ connectionString: new URL("/postgres", target).toString(), ssl });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (!exists.rowCount) {
      await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`[migrate] created database ${dbName}`);
    }
  } finally {
    await admin.end();
  }

  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });
  await client.connect();
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of files) {
      const seen = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (seen.rowCount) continue;
      const sqlText = await readFile(path.join(dir, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sqlText);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file}: ${(err as Error).message}`);
      }
      applied.push(file);
    }
  } finally {
    await client.end();
  }

  let guards = "skipped";
  if (!event?.skipGuards) {
    const { ensureRuntimeSchema } = await import("../schema-bootstrap");
    await ensureRuntimeSchema();
    guards = "ok";
  }
  const result = { database: dbName, applied, skipped: files.length - applied.length, guards };
  console.log(JSON.stringify(result));
  return result;
};
