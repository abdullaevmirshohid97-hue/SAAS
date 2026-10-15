#!/usr/bin/env bash
# =============================================================================
# AI QABULXONA + NAVBAT DVIGATELI — prod'ga chiqarish
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) migratsiyalarni qo'llaydi (har biri BITTA tranzaksiyada, idempotent):
#        20261014000001_ai_reception.sql — shifokor jadvali, navbat, AI qo'ng'iroqlar
#        20261015000001_cloud_pbx.sql    — bulutli ATS: trunk, ichki raqamlar, qo'ng'iroqlar
#   3) obyektlarni va FUNKSIONAL tekshiruvni o'tkazadi (scripts/verify-ai-reception.sql):
#      navbat yoziladi, AYNI vaqtga ikkinchisi rad etiladi, o'tgan vaqt rad etiladi.
#      Tranzaksiya oxirida ATAYLAB bekor qilinadi — bazada test yozuvi QOLMAYDI.
#   4) API + web-clinic + web-admin'ni deploy qiladi (scripts/deploy.sh)
#   5) yangi endpointlar ro'yxatdaligini tekshiradi
#
# TARTIB MUHIM: avval baza, keyin kod. Migratsiya faqat QO'SHIMCHA (yangi
# jadvallar + appointments'ga 3 ta ixtiyoriy ustun) — eski kod bilan ham mos.
#
# ISHLATISH (serverda, /opt/clary ichida, KECHQURUN):
#
#   DATABASE_URL="postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres" \
#     bash scripts/deploy-ai-reception.sh
#
#   Parol: D:/1997/PAROLLAR.md (DIRECT ulanish, pooler emas).
#
# Bayroqlar:
#   --db-only       faqat migratsiya + tekshiruv
#   --code-only     faqat kod (migratsiya avval qo'llangan bo'lsa)
#   --skip-verify   funksional tekshiruvsiz (TAVSIYA ETILMAYDI)
#
# Telefon qismi (Asterisk + voice-agent) ALOHIDA: bash infra/asterisk/install.sh
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "supabase/migrations/20261014000001_ai_reception.sql"
  "supabase/migrations/20261015000001_cloud_pbx.sql"
)
VERIFY_SQL="scripts/verify-ai-reception.sql"

DB_ONLY=false
CODE_ONLY=false
SKIP_VERIFY=false
for arg in "$@"; do
  case "$arg" in
    --db-only)     DB_ONLY=true ;;
    --code-only)   CODE_ONLY=true ;;
    --skip-verify) SKIP_VERIFY=true ;;
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
for m in "${MIGRATIONS[@]}" "$VERIFY_SQL"; do
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
    warn "Migratsiya bu serverda qo'llangan deb belgilanmagan. Bazada bo'lmasa — AI qabulxona va"
    warn "shifokor jadvali sahifalari 'migratsiya qo'llanmagan' xatosini beradi (boshqa modullar ishlaydi)."
    warn "Davom etilsinmi? [ha/yo'q]"
    read -r ANSWER
    case "$ANSWER" in ha|Ha|HA|y|yes) ;; *) die "To'xtatildi" ;; esac
  fi
else
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL kerak:

  DATABASE_URL=\"postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres\" \\
    bash scripts/deploy-ai-reception.sh

Parol: D:/1997/PAROLLAR.md. Faqat kodni chiqarish uchun: --code-only"
  command -v psql >/dev/null || die "psql topilmadi. O'rnating: apt-get install -y postgresql-client"

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

  log "Obyektlar tekshirilmoqda"
  MISSING_TBL="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(obj) AS (VALUES ('doctor_booking_profiles'), ('doctor_schedule_rules'), ('doctor_time_off'),
                              ('ai_reception_settings'), ('ai_phone_lines'), ('ai_calls'),
                              ('pbx_tenants'), ('pbx_extensions'), ('pbx_calls'))
    SELECT string_agg(w.obj, ', ') FROM want w WHERE to_regclass('public.' || w.obj) IS NULL;")"
  [ -z "$MISSING_TBL" ] || die "Jadvallar yaratilmadi: $MISSING_TBL"
  HAS_FN="$(psql "$DATABASE_URL" -tAX -c "
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'booking_reserve';")"
  [ "$HAS_FN" -ge 1 ] || die "booking_reserve() yaratilmadi"
  ok "9 jadval (AI qabulxona + bulutli ATS), booking_reserve(), call-recordings bucket"

  if [ "$SKIP_VERIFY" = false ]; then
    log "Funksional tekshiruv (test yozuvlari saqlanmaydi)"
    OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f "$VERIFY_SQL" 2>&1 || true)"
    LINE="$(printf '%s\n' "$OUT" | grep -m1 'TEST_RESULT' || true)"
    if printf '%s' "$LINE" | grep -q 'TEST_RESULT OK'; then
      ok "Zanjir o'tdi"
      printf "  %s\n" "${LINE#*TEST_RESULT OK | }"
    elif [ -n "$LINE" ]; then
      printf "%s\n" "$LINE"
      die "Tekshiruv mos kelmadi — kod deploy QILINMADI. Baza xavfsiz (eski kod ishlayveradi)."
    else
      printf "%s\n" "$OUT" | tail -15
      die "Tekshiruv oxirigacha yetmadi — kod deploy QILINMADI."
    fi
  else
    warn "Funksional tekshiruv o'tkazib yuborildi (--skip-verify)"
  fi
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

# Kalit tekshiruvi (faqat ogohlantirish — deploy'ni to'xtatmaydi).
# DIQQAT: `set -euo pipefail` ostida topilmagan grep pipeline'ni yiqitadi va
# skript JIMGINA chiqib ketadi (2026-10-15 hodisasi) — shuning uchun `|| true`.
ENV_FILE="$REPO/.env.local"
if [ -f "$ENV_FILE" ]; then
  SECRET_VAL="$(grep -E '^VOICE_AGENT_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
  if [ "${#SECRET_VAL}" -lt 24 ]; then
    warn "VOICE_AGENT_SECRET .env.local da yo'q — telefon qismi ishlamaydi (Telegram va jadval ishlaydi)"
  fi
  if ! grep -qE '^ANTHROPIC_API_KEY=.{20,}' "$ENV_FILE" 2>/dev/null; then
    warn "ANTHROPIC_API_KEY yo'q — AI suhbat ishlamaydi (klinika o'z kalitini Integratsiyalarda kiritishi mumkin)"
  fi
  if ! grep -qE '^PBX_SIP_DOMAIN=.+' "$ENV_FILE" 2>/dev/null; then
    warn "PBX_SIP_DOMAIN yo'q — bulutli ATS (softfon) hali o'chiq. ATS serveri o'rnatilgach qo'shing: docs/ai-reception/05-bulut-ats.md"
  fi
fi

log "Kod deploy qilinmoqda (api + web-clinic + web-admin)"
bash "$REPO/scripts/deploy.sh" default

log "Endpointlar tekshirilmoqda"
API="http://127.0.0.1:${API_PORT:-4000}"
check_route() {
  local method="$1" path="$2" want="$3"
  local st
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X "$method" \
        -H 'Content-Type: application/json' -d '{}' "$API$path" || true)"
  if [[ "$st" =~ ^($want)$ ]]; then
    ok "$path → $st"
  elif [ "$st" = "404" ]; then
    die "$path YO'Q (404). API build eskimi? pm2 restart clary-api --update-env"
  else
    warn "$path kutilmagan status: $st (kutilgan: $want)"
  fi
}
check_route GET  /api/v1/ai-reception/settings '401|403'
check_route GET  /api/v1/ai-reception/doctors  '401|403'
check_route POST /api/v1/ai-reception/voice/start '401|503'
check_route GET  /api/v1/telephony/settings '401|403'
check_route GET  /api/v1/telephony/agent/config '401|503'

printf "\n${G}🚀 AI qabulxona (kod) tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) Brauzerda Ctrl+Shift+R.
  2) Klinika: Sozlamalar → "Shifokorlar jadvali (navbat)" — har shifokorga kun/soat,
     toifa, narx; "Online navbat" belgisi. → Telegram bot navbati DARHOL ishlaydi (bepul).
  3) Super admin: admin.clary.uz → klinika → "AI qabulxona" → Premium ruxsat (AI rejimi).
  4) Klinika: Sozlamalar → "AI qabulxona" → "Sinov suhbati" bilan sinash (bazaga yozmaydi).
  5) Telefon: bash infra/asterisk/install.sh (Asterisk + voice-agent) va
     docs/ai-reception/01-operator-va-pereadresatsiya.md bo'yicha raqamni ulash.
  6) Bulutli ATS (klinikaning Uztelecom IP-telefoniyasi + stol telefonlari + softfon):
     PBX_DOMAIN=pbx.clary.uz bash infra/asterisk/install.sh (ATS serverida), keyin
     API .env.local: PBX_SIP_DOMAIN, PBX_WSS_URL, TURN_SECRET → pm2 restart clary-api --update-env.
     Klinika: Sozlamalar → "IP-telefoniya (ATS)". Batafsil: docs/ai-reception/05-bulut-ats.md
EOF
