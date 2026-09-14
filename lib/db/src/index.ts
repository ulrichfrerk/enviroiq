import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // On Lambda every warm container holds its own pool and ap-southeast-6 has
  // no RDS Proxy, so keep it small there. Aurora requires TLS.
  max: Number(process.env.DATABASE_POOL_MAX || (process.env.AWS_SERVERLESS === "true" ? 2 : 10)),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 10_000),
  ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
