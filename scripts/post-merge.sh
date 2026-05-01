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
pnpm --filter @workspace/db run push-force

echo "[post-merge] verifying database matches the declared Drizzle schema"
pnpm --filter @workspace/db run verify-schema

echo "[post-merge] done"
