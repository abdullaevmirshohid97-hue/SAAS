#!/usr/bin/env bash
# =============================================================================
# CLARY CAST — TV reklama videolari — prod'ga chiqarish
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) migratsiya (bitta tranzaksiyada, idempotent):
#        20261114000001_cast_ads.sql — queue_displays.mode (navbat / faqat
#            reklama), cast_ad_videos jadvali, 'cast-ads' storage bucket,
#            tarif limitlari (Starter 5 ta/1 GB, Business 10/2 GB, Enterprise 30/3 GB)
#   3) ustun, jadval va bucket borligini tekshiradi
#   4) api + web-clinic + web-admin'ni deploy qiladi (deploy.sh default)
#   5) yangi endpointlarni tekshiradi
#
# Migratsiya faqat QO'SHIMCHA — eski kod bilan ham mos.
#
# ISHLATISH (serverda, /opt/clary ichida):
#
#   bash scripts/deploy-cast-ads.sh
#
#   Baza manzili serverdagi env fayllaridan (.env.local, .env, apps/api/.env*,
#   ~/.clary-db) avtomatik olinadi. Qo'lda berish ham mumkin:
#   DATABASE_URL="postgresql://..." bash scripts/deploy-cast-ads.sh
#
# Bayroqlar:
#   --db-only     faqat migratsiya + tekshiruv
#   --code-only   faqat kod (migratsiya avval qo'llangan bo'lsa)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "supabase/migrations/20261114000001_cast_ads.sql"
)

DB_ONLY=false
CODE_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --db-only)   DB_ONLY=true ;;
    --code-only) CODE_ONLY=true ;;
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
git pull --ff-only origin main
ok "Repo: $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"
for m in "${MIGRATIONS[@]}"; do
  [ -f "$m" ] || die "Fayl topilmadi: $m (git pull o'tdimi?)"
done

STATE_FILE="$REPO/.migrations-applied"
touch "$STATE_FILE"
PENDING=()
for m in "${MIGRATIONS[@]}"; do
  sig="$(basename "$m") $(sha256sum "$m" | cut -d' ' -f1)"
  grep -qxF "$sig" "$STATE_FILE" || PENDING+=("$m")
done

if [ "$CODE_ONLY" = true ]; then
  warn "Baza o'tkazib yuborildi (--code-only)"
  if [ ${#PENDING[@]} -gt 0 ]; then
    warn "Migratsiya bu serverda qo'llangan deb belgilanmagan. Bazada bo'lmasa — TV navbati ishlaydi,"
    warn "lekin reklama yuklash 'TV reklama hali yoqilmagan' xabarini beradi."
  fi
else
  if ! command -v psql >/dev/null; then
    log "psql o'rnatilmoqda (postgresql-client)"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client \
      || die "psql o'rnatilmadi. Qo'lda: apt-get install -y postgresql-client"
  fi
  export PGCONNECT_TIMEOUT=10

  # DATABASE_URL berilmagan bo'lsa — serverdagi env fayllaridan (faqat shu loyiha
  # bazasi; 6543 tranzaksiya pooleri bo'lsa avval 5432 sessiya rejimi sinaladi).
  if [ -z "${DATABASE_URL:-}" ]; then
    log "Baza manzili serverdagi env fayllaridan qidirilmoqda"
    for f in "$REPO/.env.local" "$REPO/.env" "$REPO/apps/api/.env.local" "$REPO/apps/api/.env" \
             "$REPO/.env.production" "$HOME/.clary-db"; do
      [ -f "$f" ] || continue
      for key in DATABASE_URL_DIRECT DATABASE_URL SUPABASE_DB_URL; do
        val="$(grep -E "^(export[[:space:]]+)?${key}=" "$f" | tail -1 | cut -d= -f2- \
               | sed -E "s/^[\"']//; s/[\"'][[:space:]]*\$//" || true)"
        case "$val" in *aoubdvlkcatbeifuysau*) ;; *) continue ;; esac
        for cand in "${val/:6543\//:5432/}" "$val"; do
          if psql -w "$cand" -tAc 'select 1' >/dev/null 2>&1; then
            DATABASE_URL="$cand"
            ok "Baza: $f ($key)"
            break 3
          fi
        done
        warn "$f ($key) — ulanib bo'lmadi"
      done
    done
  fi
  [ -n "${DATABASE_URL:-}" ] || die "Baza manzili topilmadi. Qo'lda bering:

  DATABASE_URL=\"postgresql://postgres.aoubdvlkcatbeifuysau:PAROL@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres\" \\
    bash scripts/deploy-cast-ads.sh

Parol: D:/1997/PAROLLAR.md — DATABASE_URL_DIRECT qatorida 'postgres:' bilan '@' orasidagi qism
(eyJ... bilan boshlanadigan kalit EMAS). Bir marta ~/.clary-db ga saqlansa, boshqa so'ralmaydi.
Faqat kodni chiqarish uchun: --code-only"
  psql -w "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1 || die "Bazaga ulanib bo'lmadi (parol yoki manzil xato)"

  if [ ${#PENDING[@]} -eq 0 ]; then ok "Migratsiya allaqachon qo'llangan"; fi
  for m in ${PENDING[@]+"${PENDING[@]}"}; do
    log "Migratsiya: $(basename "$m")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$m"
    echo "$(basename "$m") $(sha256sum "$m" | cut -d' ' -f1)" >> "$STATE_FILE"
    ok "$(basename "$m") qo'llandi"
  done

  log "PostgREST sxema keshi yangilanmoqda"
  psql "$DATABASE_URL" -q -c "NOTIFY pgrst, 'reload schema';"
  ok "NOTIFY pgrst yuborildi"

  log "Tekshirilmoqda"
  CHECK="$(psql "$DATABASE_URL" -tAX -c "
    SELECT (SELECT count(*) FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'queue_displays' AND column_name = 'mode')
        || ' ' ||
           (SELECT count(*) FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'cast_ad_videos')
        || ' ' ||
           (SELECT count(*) FROM storage.buckets WHERE id = 'cast-ads' AND public);")"
  [ "$CHECK" = "1 1 1" ] || die "Tekshiruv o'tmadi (queue_displays.mode / cast_ad_videos / cast-ads bucket): '$CHECK'"
  ok "queue_displays.mode + cast_ad_videos + cast-ads bucket bor"
  psql "$DATABASE_URL" -tAX -c \
    "SELECT '   ' || code || ': ' || COALESCE((entitlements -> 'cast_ads')::text, '— (30 ta / 3 GB)') FROM plans ORDER BY code;"
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

log "Kod deploy qilinmoqda (api + web-clinic + web-admin)"
bash "$REPO/scripts/deploy.sh" default

log "Endpointlar tekshirilmoqda"
API="http://127.0.0.1:${API_PORT:-4000}"
check_route() {
  local method="$1" path="$2" want="$3"
  local st
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X "$method" "$API$path" || true)"
  if [[ "$st" =~ ^($want)$ ]]; then
    ok "$path → $st"
  elif [ "$st" = "404" ]; then
    die "$path YO'Q (404). API build eskimi? pm2 restart clary-api --update-env"
  else
    warn "$path kutilmagan status: $st (kutilgan: $want)"
  fi
}
check_route GET /api/v1/public/cast/ads?device_id=deploy-check '200'
check_route GET /api/v1/cast/ads                               '401|403'

printf "\n${G}🚀 Clary Cast — TV reklama tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) Brauzerda Ctrl+Shift+R, TV'da sahifani yangilang (F5).
  2) Videolar: app.clary.uz → Sozlamalar → "Navbat ekrani (TV)" → "Reklama videolari"
     → "Video yuklash" (MP4, H.264 tavsiya).
  3) Faqat reklama TV: Navbat → 📺 TV → kod → "🎬 Faqat reklama uchun". Bog'langan
     TV rejimini ro'yxatdagi tugma bilan almashtirish mumkin.
  4) ⚠️ Supabase Dashboard → Storage → Settings → "Upload file size limit" kamida
     500 MB bo'lsin (standart 50 MB — undan katta video "juda katta" xatosi beradi).
EOF
