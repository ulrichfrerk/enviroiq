// Shared runner + helpers for the tiered release test suite.
//
// No external deps: pure Node 20 (built-in fetch, AbortController, process).
// Each tier file imports { run, check, apiFetch, expect, target, env } from
// here and calls `run()` once at the bottom with an array of named checks.

import process from "node:process";

// ── ANSI helpers ───────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY === true;
const c = (n, s) => (isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);
export const colour = {
  red:    (s) => c("31", s),
  green:  (s) => c("32", s),
  yellow: (s) => c("33", s),
  blue:   (s) => c("34", s),
  grey:   (s) => c("90", s),
  bold:   (s) => c("1",  s),
};

// ── Target / env resolution ────────────────────────────────────────────────
// Precedence: --target=<url> CLI flag → RELEASE_TEST_TARGET env →
// REPLIT_DEV_DOMAIN (https) → http://localhost:8080
function resolveTarget() {
  const flag = process.argv.find(a => a.startsWith("--target="));
  if (flag) return flag.slice("--target=".length).replace(/\/$/, "");
  if (process.env.RELEASE_TEST_TARGET) return process.env.RELEASE_TEST_TARGET.replace(/\/$/, "");
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return "http://localhost:8080";
}

export const target = resolveTarget();

// Detect whether `target` points at a local-or-dev environment. Used by
// the journey tier to decide whether it's safe to forge a session by
// directly inserting into the database. We allow:
//   - http(s)://localhost or 127.0.0.1
//   - any *.replit.dev / *.repl.co dev domain (per-developer, not prod)
// We explicitly DO NOT match production .replit.app / custom domains —
// forging a session against prod would be an auth bypass.
function detectLocalTarget(t) {
  try {
    const u = new URL(t);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    if (u.hostname.endsWith(".replit.dev") || u.hostname.endsWith(".repl.co")) return true;
    return false;
  } catch {
    return false;
  }
}

export const env = {
  bearer:      process.env.RELEASE_TEST_BEARER || null,
  databaseUrl: process.env.DATABASE_URL || null,
  isLocalTarget: detectLocalTarget(target),
};

// ── HTTP helper ────────────────────────────────────────────────────────────
// Always prefixes /api unless the path is absolute (starts with http) or
// the caller explicitly passes a non-/api path (starts with /). Pass
// { raw: true } in init to skip prefixing entirely.
export async function apiFetch(path, init = {}) {
  const { timeoutMs = 10_000, raw = false, ...fetchInit } = init;
  let url;
  if (/^https?:\/\//.test(path)) {
    url = path;
  } else if (raw) {
    url = `${target}${path.startsWith("/") ? path : `/${path}`}`;
  } else {
    const p = path.startsWith("/") ? path : `/${path}`;
    url = `${target}/api${p}`;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...fetchInit, signal: ac.signal });
    const elapsed = Date.now() - start;
    return { res, elapsed, url };
  } finally {
    clearTimeout(timer);
  }
}

// ── Assertion helpers ──────────────────────────────────────────────────────
export class CheckError extends Error {
  constructor(msg, detail) {
    super(msg);
    this.detail = detail;
  }
}

// Special error: a 429 came back from the /api/auth/* limiter (20 hits
// per 15 min) during a chatty test run. The runner converts these into
// SKIPs with a clear reason so the suite never *falsely* fails on legit
// rate-limiting. We only treat 429 as "skip-worthy" for paths under
// /auth/* — a 429 anywhere else is a real signal worth surfacing.
export class RateLimitedError extends CheckError {
  constructor(ctx) {
    super(`rate-limited (HTTP 429)${ctx ? ` on ${ctx}` : ""} — restart the api-server or wait 15 min to clear the bucket`);
  }
}

function isAuthLimiterPath(ctx) {
  if (typeof ctx !== "string") return false;
  // Match exactly the prefix the auth limiter is mounted on in app.ts.
  return /(^|\W)\/(api\/)?auth\b/i.test(ctx);
}

export const expect = {
  status(res, expected, ctx = "") {
    const ok = Array.isArray(expected)
      ? expected.includes(res.status)
      : res.status === expected;
    if (!ok) {
      // Surface 429 from /api/auth/* distinctly so the runner can
      // downgrade to SKIP rather than fail the whole tier on a legit
      // rate-limit response. 429 from any other path = real failure.
      const expects429 = Array.isArray(expected) ? expected.includes(429) : expected === 429;
      if (res.status === 429 && !expects429 && isAuthLimiterPath(ctx)) {
        throw new RateLimitedError(ctx);
      }
      throw new CheckError(
        `expected status ${Array.isArray(expected) ? expected.join("/") : expected}, got ${res.status}${ctx ? ` (${ctx})` : ""}`,
      );
    }
  },
  // Asserts JSON shape — only checks that listed keys exist (and types match
  // when a primitive type string is given, e.g. {status: "string"}).
  jsonShape(body, shape, ctx = "") {
    if (!body || typeof body !== "object") {
      throw new CheckError(`expected JSON object, got ${typeof body}${ctx ? ` (${ctx})` : ""}`);
    }
    for (const [k, v] of Object.entries(shape)) {
      if (!(k in body)) {
        throw new CheckError(`missing key "${k}"${ctx ? ` (${ctx})` : ""}`, body);
      }
      if (typeof v === "string" && typeof body[k] !== v) {
        throw new CheckError(
          `key "${k}" expected ${v}, got ${typeof body[k]}${ctx ? ` (${ctx})` : ""}`,
          body,
        );
      }
      if (typeof v === "function" && !v(body[k])) {
        throw new CheckError(`key "${k}" failed predicate${ctx ? ` (${ctx})` : ""}`, body);
      }
    }
  },
  // Catches "the route exists, just locked" vs "route is missing/server is
  // broken / accidentally public". The contract for an org-scoped or
  // top-level authed router hit *without credentials* is exactly 401 or
  // 403 — anything else is a regression worth surfacing:
  //   200/2xx = auth bypass leak (the smoke tier's whole point)
  //   404     = router unmounted
  //   429     = rate-limited (caller should re-throw via status() if they
  //             want SKIP behaviour)
  //   5xx     = server error
  authedRoute(res, ctx = "") {
    if (res.status === 401 || res.status === 403) return;
    if (res.status === 404) {
      throw new CheckError(`route returned 404 — likely unmounted (${ctx})`);
    }
    if (res.status >= 500) {
      throw new CheckError(`route returned ${res.status} 5xx — server error (${ctx})`);
    }
    if (res.status >= 200 && res.status < 300) {
      throw new CheckError(
        `route returned ${res.status} without credentials — auth bypass leak (${ctx})`,
      );
    }
    throw new CheckError(`route returned unexpected ${res.status} (${ctx})`);
  },
  fasterThan(elapsedMs, budgetMs, ctx = "") {
    if (elapsedMs > budgetMs) {
      throw new CheckError(`took ${elapsedMs}ms, expected < ${budgetMs}ms${ctx ? ` (${ctx})` : ""}`);
    }
  },
};

// ── Runner ─────────────────────────────────────────────────────────────────
// Each check is { name: string, fn: async () => void, skip?: string }.
// Returns { passed, failed, skipped, durationMs, results: [...] }.
export async function run(tierName, checks) {
  const banner = colour.bold(colour.blue(`\n━━ ${tierName} ━━`));
  process.stdout.write(`${banner}  ${colour.grey(`target=${target}`)}\n`);

  const results = [];
  const tierStart = Date.now();
  for (const chk of checks) {
    const t0 = Date.now();
    if (chk.skip) {
      process.stdout.write(`  ${colour.yellow("○ SKIP")}  ${chk.name}  ${colour.grey(`(${chk.skip})`)}\n`);
      results.push({ name: chk.name, status: "skipped", reason: chk.skip });
      continue;
    }
    try {
      await chk.fn();
      const ms = Date.now() - t0;
      process.stdout.write(`  ${colour.green("✓ PASS")}  ${chk.name}  ${colour.grey(`${ms}ms`)}\n`);
      results.push({ name: chk.name, status: "passed", durationMs: ms });
    } catch (err) {
      const ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      // Legit 429 from the auth limiter — downgrade to SKIP, don't fail.
      if (err instanceof RateLimitedError) {
        process.stdout.write(`  ${colour.yellow("○ SKIP")}  ${chk.name}  ${colour.grey(`(${msg})`)}\n`);
        results.push({ name: chk.name, status: "skipped", reason: msg, durationMs: ms });
        continue;
      }
      process.stdout.write(`  ${colour.red("✗ FAIL")}  ${chk.name}  ${colour.grey(`${ms}ms`)}\n`);
      process.stdout.write(`         ${colour.red(msg)}\n`);
      if (err instanceof CheckError && err.detail) {
        const detail = typeof err.detail === "string"
          ? err.detail
          : JSON.stringify(err.detail).slice(0, 200);
        process.stdout.write(`         ${colour.grey(detail)}\n`);
      }
      results.push({ name: chk.name, status: "failed", durationMs: ms, error: msg });
    }
  }

  const passed  = results.filter(r => r.status === "passed").length;
  const failed  = results.filter(r => r.status === "failed").length;
  const skipped = results.filter(r => r.status === "skipped").length;
  const durationMs = Date.now() - tierStart;
  const verdict = failed === 0
    ? colour.green(`✓ ${tierName} OK`)
    : colour.red(`✗ ${tierName} FAILED`);
  process.stdout.write(
    `  ${verdict}  ${colour.grey(`${passed} passed, ${failed} failed, ${skipped} skipped, ${durationMs}ms total`)}\n`,
  );

  return { tier: tierName, passed, failed, skipped, durationMs, results };
}

// Pretty print the helper used as default JSON parser in checks; returns
// null on any error so checks can decide whether parse failure is fatal.
export async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}
