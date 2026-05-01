// Database schema verification — introspects the live PostgreSQL database
// against the Drizzle schema definitions and returns the set of tables and
// columns that are declared in code but missing from the database.
//
// This is the safety net behind the post-merge schema sync and the api-server
// startup check. The pattern is: every schema-touching task either commits a
// migration that the post-merge script applies, or adds an idempotent self-
// heal in `artifacts/api-server/src/index.ts`. Either way, this verification
// catches regressions before traffic is served — see README in `replit.md`.

import { sql, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { db } from "./index.js";
import * as schema from "./schema/index.js";

export interface SchemaVerifyResult {
  ok: boolean;
  /** Tables declared in the Drizzle schema that don't exist in the database. */
  missingTables: string[];
  /** Columns declared in the Drizzle schema that don't exist on their table. */
  missingColumns: Array<{ table: string; column: string }>;
  /** Total number of tables checked. */
  tablesChecked: number;
}

function collectDeclaredTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    // Drizzle's `is(value, PgTable)` is the supported runtime check; it walks
    // the entityKind chain rather than relying on `instanceof`, which can
    // misfire across module realms.
    if (is(value as unknown as object, PgTable)) {
      tables.push(value as unknown as PgTable);
    }
  }
  return tables;
}

export async function verifyDatabaseSchema(): Promise<SchemaVerifyResult> {
  const declared = collectDeclaredTables();
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string }> = [];

  // One bulk read of every column in the public schema is dramatically
  // cheaper than a query per table (we have ~30 tables and growing).
  const colsResult = await db.execute<{ table_name: string; column_name: string }>(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const colsByTable = new Map<string, Set<string>>();
  for (const row of colsResult.rows) {
    let bucket = colsByTable.get(row.table_name);
    if (!bucket) {
      bucket = new Set();
      colsByTable.set(row.table_name, bucket);
    }
    bucket.add(row.column_name);
  }

  for (const tbl of declared) {
    const cfg = getTableConfig(tbl);
    const tableName = cfg.name;
    const expected = cfg.columns.map((c) => c.name);
    const actual = colsByTable.get(tableName);
    if (!actual) {
      missingTables.push(tableName);
      continue;
    }
    for (const col of expected) {
      if (!actual.has(col)) missingColumns.push({ table: tableName, column: col });
    }
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
    tablesChecked: declared.length,
  };
}
