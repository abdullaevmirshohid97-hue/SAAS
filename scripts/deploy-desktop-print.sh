#!/usr/bin/env bash
# =============================================================================
# DESKTOP CHOP ETISH TUZATISHI (f12b2a0) — prod'ga chiqarish
# =============================================================================
# Muammo: desktop 0.2.0 qobig'ida "Sinov" (va boshqa HTML cheklar) chek
# printeriga chiqmay, jimgina A4/standart printerga ketardi.
#
# Nima qiladi:
#   1) repo'ni yangilaydi, tuzatish commiti borligini tekshiradi
#   2) web-clinic'ni yig'ib /var/www/app ga joylaydi (deploy.sh clinic)
#      — desktop ilova interfeysni app.clary.uz'dan oladi, shuning uchun
#        qobiqni qayta o'rnatish SHART EMAS
#   3) joylangan versiya va yangi kod haqiqatan serverda ekanini tekshiradi
#
# Migratsiya YO'Q. API'ga tegmaydi (default).
#
# ISHLATISH (serverda, /opt/clary ichida):
#
#   bash scripts/deploy-desktop-print.sh
#
# Kompyuterdan bitta buyruq bilan: scripts/deploy-desktop-print.ps1
#
# Bayroqlar:
#   --with-api   API'ni ham yangilaydi (LAN printer matnida "×" → "x").
#                Shart emas — kichik kosmetik farq; pm2 restart bo'ladi.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
FIX_COMMIT="f12b2a0"
WWW="/var/www/app"

WITH_API=false
for arg in "$@"; do
  case "$arg" in
    --with-api) WITH_API=true ;;
    *) echo "Nomaʼlum bayroq: $arg" >&2; exit 1 ;;
  esac
done

G='\033[0;32m'; B='\033[0;36m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "\n${B}▶ %s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }

cd "$REPO"

log "Repo yangilanmoqda"
git fetch -q origin main
git checkout -q main
git pull --ff-only -q origin main
HEAD_SHA="$(git rev-parse --short HEAD)"
ok "Repo: $HEAD_SHA — $(git log -1 --pretty=%s)"
git merge-base --is-ancestor "$FIX_COMMIT" HEAD \
  || die "Tuzatish commiti ($FIX_COMMIT) repo'da yo'q — git pull o'tmadimi?"
[ -f apps/web-clinic/src/lib/receipt-text.ts ] || die "receipt-text.ts topilmadi"
ok "Tuzatish ($FIX_COMMIT) repo'da bor"

OLD_SHA="$(sed -nE 's/.*"sha":"([^"]+)".*/\1/p' "$WWW/version.json" 2>/dev/null || true)"
[ -n "$OLD_SHA" ] && ok "Hozir joylangan: $OLD_SHA"

log "web-clinic deploy (app.clary.uz)"
bash "$REPO/scripts/deploy.sh" clinic

if $WITH_API; then
  log "API deploy (--with-api)"
  bash "$REPO/scripts/deploy.sh" api
fi

log "Tekshirilmoqda"
NEW_SHA="$(sed -nE 's/.*"sha":"([^"]+)".*/\1/p' "$WWW/version.json" 2>/dev/null || true)"
[ "$NEW_SHA" = "$HEAD_SHA" ] \
  || die "$WWW/version.json sha='$NEW_SHA', kutilgan '$HEAD_SHA' — build joylanmadi"
ok "$WWW/version.json → $NEW_SHA"

# Yangi kod bundle'da bormi (sinov tugmasi matni + HTML→matn konvertori).
grep -rqF "Rasmli chek uchun desktop ilovani yangilang" "$WWW/assets" \
  || die "Yangi sinov tugmasi kodi bundle'da topilmadi"
grep -rqF "text only" "$WWW/assets" \
  || die "Yangi termal printer nomlari (Generic / Text Only) bundle'da topilmadi"
ok "Yangi chop etish kodi bundle'da bor"

PUBLIC_SHA="$(curl -fsS --max-time 10 "https://app.clary.uz/version.json?ts=$(date +%s)" \
  | sed -nE 's/.*"sha":"([^"]+)".*/\1/p' || true)"
if [ "$PUBLIC_SHA" = "$HEAD_SHA" ]; then
  ok "https://app.clary.uz/version.json → $PUBLIC_SHA (Caddy yangi versiyani bermoqda)"
else
  warn "https://app.clary.uz/version.json → '${PUBLIC_SHA:-javob yo‘q}' (kutilgan $HEAD_SHA) — Cloudflare/CDN keshi bo'lishi mumkin, 1–2 daqiqadan keyin qayta tekshiring"
fi

printf "\n${G}🖨  Desktop chop etish tuzatishi joylandi (%s → %s)${N}\n" "${OLD_SHA:-?}" "$HEAD_SHA"
cat <<'EOF'

Keyingi qadamlar (klinika kompyuterida, desktop ilovada):
  1) "Yangi versiya joylandi → Yangilash" bannerini bosing (yoki ilovani qayta oching).
  2) Sozlamalar → Termal printerlar → "Desktop printer (silent)" → Chek printer'ni
     tanlang → Sinov.
  3) Natija xabarda yoziladi:
       "Sinov chek → XP-80C · Termal printer — matnli ESC/POS"  → chek chiqishi kerak
       "... Oddiy printer (PDF)"   → tanlangan printer chek printeri emas
       "... oflayn / to'xtatilgan" → printer o'chiq yoki USB uzilgan (Windows navbatida turibdi)
     Chek baribir chiqmasa — xabar matni va printer nomini yuboring.
EOF
