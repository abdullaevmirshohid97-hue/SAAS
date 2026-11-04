#!/usr/bin/env bash
# =============================================================================
# AGENTLAR — statsionarga yo'llanma (shifokor taklifi / agent) bilan kelgan
# bemor + xona to'lovidan ulush — prod'ga chiqarish
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) OLDINGI migratsiyalar bazada borligini tekshiradi (filial tarmog'i,
#      tarif imkoniyatlari, analitika, TV ovozi). Yo'q bo'lsa — TO'XTAYDI:
#      deploy.sh barcha kodni chiqaradi, ular migratsiyasiz ishlamaydi.
#   3) migratsiya (bitta tranzaksiyada, idempotent):
#        20261104000001_inpatient_referral_agents.sql — referral_partners
#            kengaytmasi, inpatient_stays yo'llanma ustunlari, referral_accruals,
#            referral_payouts, accrue_inpatient_referral_shares()
#   4) obyektlarni tekshiradi va ulush funksiyasini ROLLBACK ichida sinaydi
#   5) api + web-clinic + web-admin'ni deploy qiladi (deploy.sh default)
#   6) yangi endpointlarni tekshiradi
#
# Migratsiya faqat QO'SHIMCHA — eski kod bilan ham mos (yangi ustunlar NULL
# bo'la oladi, eski kod ularni ishlatmaydi).
#
# ISHLATISH (serverda, /opt/clary ichida):
#
#   bash scripts/deploy-referral-agents.sh
#
#   Baza manzili serverdagi env fayllaridan (.env.local, .env, apps/api/.env*,
#   ~/.clary-db) avtomatik olinadi. Qo'lda berish ham mumkin:
#   DATABASE_URL="postgresql://..." bash scripts/deploy-referral-agents.sh
#
# Bayroqlar:
#   --db-only     faqat migratsiya + tekshiruv
#   --code-only   faqat kod (migratsiya avval qo'llangan bo'lsa)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "supabase/migrations/20261104000001_inpatient_referral_agents.sql"
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
    warn "Migratsiya bu serverda qo'llangan deb belgilanmagan. Bazada bo'lmasa — statsionar"
    warn "ishlayveradi, lekin 'Kelish turi: Shifokor yo'llanmasi' va Agentlar sahifasi xato beradi."
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
    bash scripts/deploy-referral-agents.sh

Parol: D:/1997/PAROLLAR.md — DATABASE_URL_DIRECT qatorida 'postgres:' bilan '@' orasidagi qism
(eyJ... bilan boshlanadigan kalit EMAS). Bir marta ~/.clary-db ga saqlansa, boshqa so'ralmaydi.
Faqat kodni chiqarish uchun: --code-only"
  psql -w "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1 || die "Bazaga ulanib bo'lmadi (parol yoki manzil xato)"

  # Kod deploy.sh orqali BUTUNLAY chiqadi — avvalgi bosqichlar migratsiyasi
  # bazada bo'lmasa, ularning kodi buziladi. Avval o'sha skriptlar.
  log "Oldingi migratsiyalar tekshirilmoqda"
  PREREQ="$(psql "$DATABASE_URL" -tAX -c "
    SELECT concat_ws(', ',
      CASE WHEN to_regclass('public.clinic_entitlements') IS NULL
           THEN 'tarif imkoniyatlari (20261018000001)' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'network_switch_branch')
           THEN 'filial tarmog''i (20261016*)' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'analytics_doctors')
           THEN 'analitika (20261017000001)' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns
                             WHERE table_schema = 'public' AND table_name = 'profiles'
                               AND column_name = 'room_label')
           THEN 'TV xona/ovoz (20261018000002)' END);")"
  if [ -n "$PREREQ" ]; then
    die "Bazada oldingi migratsiyalar YO'Q: $PREREQ
Avval (shu tartibda):
  bash scripts/deploy-branch-network.sh   # filial + analitika + tarif
  bash scripts/deploy-cast-voice.sh       # TV xona/ovoz
so'ng shu skriptni qayta ishga tushiring. Hech narsa o'zgartirilmadi."
  fi
  ok "Oldingi migratsiyalar bor"

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
    SELECT concat(
      (to_regclass('public.referral_accruals') IS NOT NULL)::int,
      (to_regclass('public.referral_payouts') IS NOT NULL)::int,
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'inpatient_stays'
          AND column_name IN ('admission_channel', 'referring_doctor_id',
                              'referring_doctor_percent', 'agent_id', 'agent_percent')),
      (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'referral_partners'
          AND column_name IN ('specialty', 'workplace', 'phone2', 'notes')),
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'accrue_inpatient_referral_shares'));")"
  [ "$CHECK" = "11541" ] || die "Tekshiruv o'tmadi (jadval/ustun/funksiya): '$CHECK' (kutilgan 11541)"
  ok "2 jadval, 5 + 4 ustun, ulush funksiyasi bor"

  # Funksiyani haqiqiy bazada ishga tushirib ko'ramiz — natija saqlanmaydi.
  RUN="$(psql "$DATABASE_URL" -qtAX -v ON_ERROR_STOP=1 -c 'BEGIN' \
          -c 'SELECT public.accrue_inpatient_referral_shares()' -c 'ROLLBACK' 2>&1 \
        | grep -E '^[0-9]+$' || true)"
  [ -n "$RUN" ] || die "accrue_inpatient_referral_shares() ishlamadi — kod deploy QILINMADI"
  ok "Ulush funksiyasi ishlaydi (sinov, saqlanmadi)"
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
check_route GET /api/v1/referral-partners         '401|403'
check_route GET /api/v1/referral-partners/summary '401|403'

printf "\n${G}🚀 Agentlar (yo'llanma ulushi) tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) Brauzerda Ctrl+Shift+R.
  2) Sozlamalar → "Agentlar (yo'llanma)": agentlar va yo'llanma bergan
     shifokorlarni qo'shing, har biriga xona to'lovidan foizni belgilang.
  3) Statsionarga yotqizishda "Kelish turi" → "Shifokor yo'llanmasi" → shifokor
     va (bo'lsa) agentni tanlang. Ulush har kuni xona to'lovi bilan hisoblanadi.
  4) To'lash: Statsionar → "Agentlar hisobi" → sherik → "To'lash" (statsionar
     kassasidan xarajat; smena ochiq bo'lishi kerak).
EOF
