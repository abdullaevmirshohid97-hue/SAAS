#!/usr/bin/env bash
# =============================================================================
# Clary Care — Production deploy (serverda ishlatiladi)
# Arxitektura: host Caddy (statik /var/www/*) + pm2 (clary-api). DOCKER EMAS.
# Server: Hostinger VPS, /opt/clary, Node v20.20.2.
#
# Ishlatish (server SSH):
#   bash /opt/clary/scripts/deploy.sh            # api + clinic + admin (default)
#   bash /opt/clary/scripts/deploy.sh all        # api + clinic + admin + landing
#   bash /opt/clary/scripts/deploy.sh api        # faqat backend
#   bash /opt/clary/scripts/deploy.sh clinic     # faqat web-clinic
#
# DB migration'lar Supabase MCP orqali alohida qo'llanadi — bu skript tegmaydi.
# =============================================================================
set -euo pipefail

REPO="${CLARY_REPO:-/opt/clary}"
TARGET="${1:-default}"   # default | all | api | clinic | admin | landing

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

cd "$REPO"

log "git pull (main)"
git fetch origin
git checkout main
git pull --ff-only origin main

log "pnpm install"
pnpm install

do_api=false; do_clinic=false; do_admin=false; do_landing=false
case "$TARGET" in
  # A3: admin default'ga kiritildi — ilgari tez-tez eski versiyada qolib ketardi.
  default) do_api=true; do_clinic=true; do_admin=true ;;
  all)     do_api=true; do_clinic=true; do_admin=true; do_landing=true ;;
  api)     do_api=true ;;
  clinic)  do_clinic=true ;;
  admin)   do_admin=true ;;
  landing) do_landing=true ;;
  *) echo "Noma'lum target: $TARGET (default|all|api|clinic|admin|landing)"; exit 1 ;;
esac

# --- Frontendlar: build + statik papkaga ko'chirish ------------------------
deploy_static() {
  local filter="$1" dist="$2" www="$3" name="$4"
  log "build $name"
  pnpm --filter "$filter" build
  log "deploy $name → $www"
  mkdir -p "$www"
  rm -rf "${www:?}"/*
  cp -r "$dist"/* "$www"/
}

$do_clinic  && deploy_static "@clary/web-clinic"  "apps/web-clinic/dist"  "/var/www/app"     "web-clinic (app.clary.uz)"
$do_admin   && deploy_static "@clary/web-admin"   "apps/web-admin/dist"   "/var/www/admin"   "web-admin (admin.clary.uz)"
$do_landing && deploy_static "@clary/web-landing" "apps/web-landing/dist" "/var/www/landing" "web-landing (clary.uz)"

# --- Backend: build + pm2 restart ------------------------------------------
if $do_api; then
  log "build API"
  pnpm --filter @clary/api build
  log "pm2 restart clary-api"
  pm2 restart clary-api
  pm2 save || true
fi

log "TAYYOR ✔  (brauzerda Ctrl+Shift+R — eski JS cache uchun)"
log "Smoke-test: docs/DEPLOY-SMOKE-CHECKLIST.md bo'yicha 5 daqiqalik tekshiruv o'tkazing"
