/**
 * CLI-level test for `verify-schema-cli.ts`. The unit tests in
 * `verify-schema.test.ts` lock in the behaviour of `verifyDatabaseSchema()`
 * itself; this file pins the exit-code contract that `scripts/post-merge.sh`
 * (and any future caller) relies on:
 *
 *   - ok: true   →  process.exitCode stays 0
 *   - ok: false  →  process.exitCode is set to 1
 *
 * Without this, a refactor could swallow the failure (e.g. forgetting to
 * assign `process.exitCode`) and the post-merge gate would silently green.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const verifyResult = {
  ok: true as boolean,
  missingTables: [] as string[],
  missingColumns: [] as Array<{ table: string; column: string }>,
  tablesChecked: 0,
};

vi.mock("./index.js", () => ({
  pool: { end: vi.fn(async () => undefined) },
}));

vi.mock("./verify-schema.js", () => ({
  verifyDatabaseSchema: vi.fn(async () => verifyResult),
}));

let originalExitCode: number | string | undefined;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  originalExitCode = process.exitCode ?? undefined;
  process.exitCode = 0;
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  process.exitCode = originalExitCode;
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

async function runCli(): Promise<void> {
  // Re-import so the top-level `main()` re-runs with the current mock state.
  await import("./verify-schema-cli.js");
  // Wait for the .catch().finally() chain to settle.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("verify-schema-cli", () => {
  it("exits 0 (leaves exitCode untouched) when the schema verifies", async () => {
    verifyResult.ok = true;
    verifyResult.missingTables = [];
    verifyResult.missingColumns = [];
    verifyResult.tablesChecked = 7;

    await runCli();

    expect(process.exitCode).toBe(0);
    // Operator sees the all-clear summary.
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("7 tables verified"),
    );
  });

  it("sets process.exitCode = 1 when a table is missing", async () => {
    verifyResult.ok = false;
    verifyResult.missingTables = ["users"];
    verifyResult.missingColumns = [];
    verifyResult.tablesChecked = 7;

    await runCli();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing table: users"),
    );
  });

  it("sets process.exitCode = 1 when a column is missing", async () => {
    verifyResult.ok = false;
    verifyResult.missingTables = [];
    verifyResult.missingColumns = [{ table: "users", column: "email" }];
    verifyResult.tablesChecked = 7;

    await runCli();

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing column: users.email"),
    );
  });
});
