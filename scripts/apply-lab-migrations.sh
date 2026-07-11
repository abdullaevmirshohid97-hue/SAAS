#!/usr/bin/env bash
# =============================================================================
# Lab katalog migratsiyalarini prod Supabase'ga qo'llash (idempotent).
# deploy.sh DB'ga tegmaydi — bu skript alohida ishlaydi.
#
# Ishlatish:
#   DATABASE_URL="postgresql://...pooler...:5432/postgres" bash scripts/apply-lab-migrations.sh
#
# DATABASE_URL = prod Supabase connection string (Session/Transaction pooler).
# Har fayl ON CONFLICT/IF NOT EXISTS bilan — qayta ishga tushirish xavfsiz.
# =============================================================================
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL kerak (prod Supabase connection string)}"

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIG="$REPO/supabase/migrations"

FILES=(
  "20260716000001_lab_global_content.sql"
  "20260716000002_lab_templates.sql"
  "20260716000003_lab_reference_ranges.sql"
)

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

for f in "${FILES[@]}"; do
  log "apply $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIG/$f"
done

log "PostgREST sxema keshini yangilash (NOTIFY pgrst)"
psql "$DATABASE_URL" -c "NOTIFY pgrst, 'reload schema';"

log "TAYYOR ✔  lab_test_templates / lab_panel_templates / lab_reference_ranges qo'llandi"
