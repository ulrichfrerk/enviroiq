/**
 * Regression tests for `verifyDatabaseSchema()` — the production safety net
 * that prevents the API server from booting against a database that doesn't
 * match the Drizzle schema. See `replit.md` → "Schema changes" for the wider
 * workflow.
 *
 * The contract these tests lock in:
 *   1. Happy path: every declared table + every declared column present in the
 *      database → `ok: true`, `tablesChecked` equals the number of declared
 *      tables, and both `missingTables`/`missingColumns` are empty.
 *   2. A table missing from the database is reported in `missingTables`,
 *      `ok` flips to `false`, and its columns are NOT additionally reported in
 *      `missingColumns` (we early-continue so the operator gets one clear
 *      pointer per missing thing instead of dozens of cascade errors).
 *   3. A column missing from a present table is reported in `missingColumns`
 *      with the correct `{ table, column }` shape and `ok: false`.
 *   4. Extra columns in the database (declared in past migrations but no
 *      longer in code) are ignored — verifyDatabaseSchema only enforces
 *      "everything declared in code exists in the DB", not the reverse,
 *      because production may legitimately carry historical columns.
 *
 * The verifier reads the live database via `db.execute(sql\`SELECT ...
 * information_schema.columns ...\`)`. We mock `./index.js` to return a
 * controlled rowset for that single query, so the test is hermetic and runs
 * without a real PostgreSQL connection.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";

// ─── Module mocks (must be declared before importing the SUT) ───────────────

// `./index.ts` throws at import time if DATABASE_URL is unset (it eagerly
// constructs a pg Pool). Replace it wholesale with a stub `db.execute` that
// returns whatever the current test has staged in `mockRows`.
const mockRows: Array<{ table_name: string; column_name: string }> = [];

vi.mock("./index.js", () => ({
  db: {
    execute: vi.fn(async () => ({ rows: [...mockRows] })),
  },
  pool: { end: vi.fn() },
}));

// Import AFTER the mock so the SUT's `import { db } from "./index.js"` picks
// up the stub.
const { verifyDatabaseSchema } = await import("./verify-schema.js");
const schema = await import("./schema/index.js");

// Helper — collect every (table_name, column_name) pair currently declared in
// the Drizzle schema. The verifier uses the same `is(value, PgTable)` walk to
// pick up declared tables, so this gives us a "perfect" baseline rowset that
// we can selectively delete from to construct the missing-table /
// missing-column scenarios.
function declaredRows(): Array<{ table_name: string; column_name: string }> {
  const rows: Array<{ table_name: string; column_name: string }> = [];
  for (const value of Object.values(schema)) {
    if (is(value as unknown as object, PgTable)) {
      const cfg = getTableConfig(value as unknown as PgTable);
      for (const col of cfg.columns) {
        rows.push({ table_name: cfg.name, column_name: col.name });
      }
    }
  }
  return rows;
}

function declaredTableCount(): number {
  let count = 0;
  for (const value of Object.values(schema)) {
    if (is(value as unknown as object, PgTable)) count++;
  }
  return count;
}

function setMockRows(rows: Array<{ table_name: string; column_name: string }>) {
  mockRows.length = 0;
  mockRows.push(...rows);
}

beforeEach(() => {
  mockRows.length = 0;
});

describe("verifyDatabaseSchema", () => {
  it("returns ok: true when every declared table and column is present", async () => {
    setMockRows(declaredRows());

    const result = await verifyDatabaseSchema();

    expect(result.ok).toBe(true);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toEqual([]);
    expect(result.tablesChecked).toBe(declaredTableCount());
    // Sanity: a non-trivial schema is being checked. If this drops to 0 the
    // mock has masked a regression where schema/index.ts stops exporting
    // tables.
    expect(result.tablesChecked).toBeGreaterThan(0);
  });

  it("reports a missing table in missingTables and flips ok to false", async () => {
    // Drop every row for `users` — the table itself is now "missing" from
    // the live database. (We don't care which table, but `users` is core
    // and cheap to reason about.)
    const rows = declaredRows().filter((r) => r.table_name !== "users");
    setMockRows(rows);

    const result = await verifyDatabaseSchema();

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("users");
    // The verifier early-continues on a missing table, so its columns must
    // NOT also flood `missingColumns` — that would drown the real signal.
    expect(
      result.missingColumns.some((c) => c.table === "users"),
    ).toBe(false);
    expect(result.tablesChecked).toBe(declaredTableCount());
  });

  it("reports a missing column with { table, column } and flips ok to false", async () => {
    // Keep every table present, but drop a single column from `users`.
    const rows = declaredRows().filter(
      (r) => !(r.table_name === "users" && r.column_name === "email"),
    );
    setMockRows(rows);

    const result = await verifyDatabaseSchema();

    expect(result.ok).toBe(false);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toContainEqual({
      table: "users",
      column: "email",
    });
  });

  it("ignores extra columns present in the DB but not declared in code", async () => {
    // Production legitimately carries historical columns from past
    // migrations that have since been removed from the Drizzle schema —
    // they must not flag the verifier.
    const rows = [
      ...declaredRows(),
      { table_name: "users", column_name: "legacy_obsolete_column" },
      { table_name: "users", column_name: "another_dead_field" },
    ];
    setMockRows(rows);

    const result = await verifyDatabaseSchema();

    expect(result.ok).toBe(true);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toEqual([]);
  });

  it("aggregates several missing tables and columns in one pass", async () => {
    // The CLI reports every miss in a single run rather than aborting on the
    // first — verify that contract holds when we strip multiple things at
    // once.
    const rows = declaredRows().filter(
      (r) =>
        r.table_name !== "passkeys" &&
        !(r.table_name === "users" && r.column_name === "email") &&
        !(r.table_name === "users" && r.column_name === "name"),
    );
    setMockRows(rows);

    const result = await verifyDatabaseSchema();

    expect(result.ok).toBe(false);
    expect(result.missingTables).toContain("passkeys");
    expect(result.missingColumns).toContainEqual({
      table: "users",
      column: "email",
    });
    expect(result.missingColumns).toContainEqual({
      table: "users",
      column: "name",
    });
  });
});
