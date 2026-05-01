#!/usr/bin/env node
// Orchestrator for the tiered release test suite.
//
// Runs Tier 1 (boot) → Tier 2 (smoke) → Tier 3 (journey) in order. Later
// tiers run even when earlier ones fail so a single execution gives you
// the full picture of what's broken — but the process exits non-zero if
// ANY tier had a failure, so it's safe to wire into CI / a deploy gate.
//
// Usage:
//   node scripts/release-tests/run.mjs                           # local
//   node scripts/release-tests/run.mjs --target=https://my.app   # prod
//   node scripts/release-tests/run.mjs --tier=boot               # one tier
//   node scripts/release-tests/run.mjs --tier=boot,smoke         # subset
//
// Environment variables:
//   RELEASE_TEST_TARGET   alternative to --target=
//   RELEASE_TEST_BEARER   CRM /api/v1 bearer key (enables prod journey)
//   DATABASE_URL          local dev DB (enables local journey)
//   SESSION_SECRET        match the running server's value (defaults to
//                         the dev fallback in app.ts)

import process from "node:process";
import { bootChecks }    from "./01-boot.mjs";
import { smokeChecks }   from "./02-smoke.mjs";
import { journeyChecks } from "./03-journey.mjs";
import { colour, target } from "./shared.mjs";

const TIERS = {
  boot:    bootChecks,
  smoke:   smokeChecks,
  journey: journeyChecks,
};

function parseTiers() {
  const flag = process.argv.find(a => a.startsWith("--tier="));
  if (!flag) return Object.keys(TIERS);
  const requested = flag.slice("--tier=".length).split(",").map(s => s.trim()).filter(Boolean);
  for (const t of requested) {
    if (!(t in TIERS)) {
      process.stderr.write(`Unknown tier "${t}". Valid: ${Object.keys(TIERS).join(", ")}\n`);
      process.exit(2);
    }
  }
  return requested;
}

const selected = parseTiers();
process.stdout.write(
  colour.bold(`\nRelease test suite — ${selected.join(" → ")} → ${target}\n`),
);

const summaries = [];
const overallStart = Date.now();
for (const tier of selected) {
  const summary = await TIERS[tier]();
  summaries.push(summary);
}
const overallMs = Date.now() - overallStart;

// ── Final summary ──────────────────────────────────────────────────────────
process.stdout.write(`\n${colour.bold("━━ Summary ━━")}\n`);
let anyFailed = false;
for (const s of summaries) {
  const verdict = s.failed === 0
    ? colour.green("PASS")
    : colour.red("FAIL");
  if (s.failed > 0) anyFailed = true;
  process.stdout.write(
    `  ${verdict}  ${s.tier.padEnd(36)} ${s.passed}p ${s.failed}f ${s.skipped}s  ${colour.grey(`${s.durationMs}ms`)}\n`,
  );
}
process.stdout.write(`  ${colour.grey(`total: ${overallMs}ms\n\n`)}`);

process.exit(anyFailed ? 1 : 0);
