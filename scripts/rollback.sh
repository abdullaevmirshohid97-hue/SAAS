#!/usr/bin/env bash
# =============================================================================
# Clary Care — Production ROLLBACK (serverda ishlatiladi)
# deploy.sh bilan bir xil arxitektura: host Caddy (statik /var/www/*) + pm2.
#
# Ishlatish (server SSH):
#   bash /opt/clary/scripts/rollback.sh                 # oxirgi deploy'dan OLDINGI holatga
#   bash /opt/clary/scripts/rollback.sh <commit-sha>    # aniq commit'ga
#   bash /opt/clary/scripts/rollback.sh <sha> api       # faqat backend'ni qaytarish
#
# Nima qiladi: repo'ni ko'rsatilgan commit'ga (detached HEAD) o'tkazadi va
# deploy.sh dagi build/ko'chirish/pm2 restart qadamlarini takrorlaydi.
# origin/main'ga TEGMAYDI — push qilinmaydi, tarix o'zgarmaydi. Tuzatilgach
# oddiy `deploy.sh` yana main'ga qaytaradi.
#
# DIQQAT: DB migratsiya/backfill'ni bu skript qaytarmaydi — SQL rollback
# alohida: scripts/rollback-2026-08-05-shift-encashment.sql
# =============================================================================
set -euo pipefail

REPO="${CLARY_REPO:-/opt/clary}"

# --- O'ZINI KO'CHIRISH ------------------------------------------------------
# Bu skript repo ICHIDA yotadi, pastda esa `git checkout` repo fayllarini
# almashtiradi. Bash skriptni bo'lak-bo'lak o'qiydi — fayl ostidan o'zgarsa
# yoki o'chsa (eski commit'da bu fayl yo'q) skript o'rtada singan bo'lardi.
# Shuning uchun avval /tmp ga nusxa olib, o'sha nusxadan davom etamiz.
if [ "${CLARY_ROLLBACK_RELOCATED:-}" != "1" ]; then
  _self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  _tmp="$(mktemp /tmp/clary-rollback.XXXXXX.sh)"
  cp "$_self" "$_tmp"
  chmod +x "$_tmp"
  export CLARY_ROLLBACK_RELOCATED=1
  trap 'rm -f "$_tmp"' EXIT
  bash "$_tmp" "$@"
  exit $?
fi

TARGET_SHA="${1:-}"
SCOPE="${2:-default}"   # default | all | api | clinic | admin | landing

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m! %s\033[0m\n' "$*"; }

cd "$REPO"

log "hozirgi holat"
git --no-pager log -1 --oneline

# SHA berilmasa — HEAD'dan oldingi commit (oxirgi deploy'ni bekor qilish).
if [ -z "$TARGET_SHA" ]; then
  TARGET_SHA="$(git rev-parse HEAD~1)"
  warn "SHA berilmadi → HEAD~1 ga qaytamiz: $(git --no-pager log -1 --oneline "$TARGET_SHA")"
fi

git rev-parse --verify "${TARGET_SHA}^{commit}" >/dev/null 2>&1 || {
  echo "Xato: '$TARGET_SHA' commit topilmadi"; exit 1;
}

log "checkout $TARGET_SHA (detached HEAD)"
git fetch origin
git checkout --force "$TARGET_SHA"
git --no-pager log -1 --oneline

log "pnpm install"
pnpm install

do_api=false; do_clinic=false; do_admin=false; do_landing=false
case "$SCOPE" in
  default) do_api=true; do_clinic=true; do_admin=true ;;
  all)     do_api=true; do_clinic=true; do_admin=true; do_landing=true ;;
  api)     do_api=true ;;
  clinic)  do_clinic=true ;;
  admin)   do_admin=true ;;
  landing) do_landing=true ;;
  *) echo "Noma'lum scope: $SCOPE (default|all|api|clinic|admin|landing)"; exit 1 ;;
esac

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

if $do_api; then
  log "build API"
  pnpm --filter @clary/api build
  # --update-env: pm2 keshidagi eski env bilan ishlab ketmasin (server_env_incident).
  log "pm2 restart clary-api"
  pm2 restart clary-api --update-env
  pm2 save || true

  log "API tayyorligini kutamiz"
  for i in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:4000/api/v1/health || true)"
    if [ "$code" = "200" ]; then log "API tayyor (HTTP 200)"; break; fi
    [ "$i" = "30" ] && { warn "API 30s ichida javob bermadi — pm2 logs clary-api"; exit 1; }
    sleep 1
  done
fi

log "ROLLBACK TAYYOR ✔  HEAD: $(git rev-parse --short HEAD) (detached)"
warn "Repo detached HEAD'da. Tuzatgach main'ga qaytish: bash scripts/deploy.sh"
