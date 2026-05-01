// CLI entry for `pnpm --filter @workspace/db run verify-schema`. Invoked by
// scripts/post-merge.sh after the schema sync to make absolutely sure the dev
// database is consistent with the Drizzle schema before the merge lands.
// Exits non-zero with a clear, structured error if anything is missing.

import { pool } from "./index.js";
import { verifyDatabaseSchema } from "./verify-schema.js";

async function main(): Promise<void> {
  const result = await verifyDatabaseSchema();
  if (result.ok) {
    console.log(
      `[verify-schema] OK — ${result.tablesChecked} tables verified, no missing columns.`,
    );
    return;
  }
  console.error(
    `[verify-schema] FAILED — database is missing schema declared in lib/db/src/schema. ` +
      `This means the post-merge sync did not run, OR the schema-touching task forgot to add ` +
      `a self-heal in artifacts/api-server/src/index.ts. See replit.md → "Schema changes".`,
  );
  for (const t of result.missingTables) {
    console.error(`  - missing table: ${t}`);
  }
  for (const c of result.missingColumns) {
    console.error(`  - missing column: ${c.table}.${c.column}`);
  }
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[verify-schema] unexpected error:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
