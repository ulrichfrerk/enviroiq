#!/bin/bash
# Post-merge schema sync. Runs unattended after a task merges into main.
#
# Strategy: a fully non-interactive `drizzle-kit push --force` brings the
# database in line with `lib/db/src/schema`, then `verify-schema` introspects
# the live database and confirms every declared table and column actually
# exists. The verify step is the safety net — if it fails, the merge fails
# loudly here instead of producing a "looks fine" deployment that 500s on the
# first request to a missing column.
#
# When this script runs against the dev database the result is the same as
# any local `pnpm --filter @workspace/db run push-force`. The matching check
# at api-server startup (see `artifacts/api-server/src/index.ts`) catches the
# production case where the post-merge script never ran.
set -euo pipefail

echo "[post-merge] installing dependencies"
pnpm install --frozen-lockfile

echo "[post-merge] syncing database schema (drizzle-kit push --force)"
# drizzle-kit still prompts for confirmation when adding a unique constraint
# to a table that already has rows ("Do you want to truncate?"), even with
# --force. With stdin closed (the post-merge env) the prompt sees EOF and
# drizzle-kit silently aborts ALL pending changes and exits 0 — so a new
# column added in the same migration also gets dropped on the floor, and
# verify-schema is the only thing that catches the regression. Pipe a bounded
# stream of newlines so it always selects the highlighted default option
# (which is the safe "No, don't truncate" choice for unique-constraint
# warnings). Using `yes ""` would work too but exits with SIGPIPE (141) once
# drizzle-kit closes stdin, which trips `set -o pipefail`.
printf '\n%.0s' $(seq 1 200) | pnpm --filter @workspace/db run push-force

echo "[post-merge] verifying database matches the declared Drizzle schema"
pnpm --filter @workspace/db run verify-schema

# One-shot data fix: correct Acme Ltd contract signed-at timestamp to
# 15 May 2026 1:38 PM NZT (= 01:38 UTC on 15 May; NZ is UTC+12 in May).
# Idempotent — safe to re-run. A missing target row naturally yields UPDATE 0
# (success); real psql/connection failures are NOT swallowed so they fail the
# post-merge loudly.
echo "[post-merge] applying one-shot data fix: acme-plumbing contract signedAt"
if [ -n "${DATABASE_URL:-}" ]; then
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "update subscriptions set entitlements = jsonb_set(entitlements, '{signerMeta,signedAt}', '\"2026-05-15T01:38:00.000Z\"'::jsonb) where id = 'dc036d92-3504-4242-8aec-e72b71bae39c' and entitlements->'signerMeta'->>'signedAt' is distinct from '2026-05-15T01:38:00.000Z';"
fi

echo "[post-merge] done"
