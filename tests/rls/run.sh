#!/usr/bin/env bash
# =============================================================================
# Clary v2 — pgTAP RLS negative tests
# Usage: pnpm test:rls
# Requires: pgtap extension + psql
# =============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/clary_test}"

echo "[rls] Running pgTAP RLS negative tests against $DATABASE_URL"

psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pgtap;"

pg_prove --ext .sql --recurse tests/rls/specs/ \
  --dbname "${DATABASE_URL#postgresql://*/}" \
  --username "$(echo $DATABASE_URL | sed -n 's|.*://\([^:]*\):.*|\1|p')"
