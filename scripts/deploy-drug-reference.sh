#!/usr/bin/env bash
# =============================================================================
# DAVLAT DORI KATALOGI (MXIK) + DAVLAT REESTRI — prod'ga chiqarish
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) 2 ta migratsiyani qo'llaydi (har biri BITTA tranzaksiyada, idempotent):
#        20261006000001_drug_reference.sql  — katalog, qidiruv, dorini qo'shish
#        20261006000002_drug_registry.sql   — davlat reestri importi va moslash
#   3) obyektlar yaratilganini tekshiradi
#   4) FUNKSIONAL TEKSHIRUV (scripts/verify-drug-reference.sql): sinxron →
#      qidiruv → klinikaga qo'shish → shtrix-kod o'rganish → reestr moslash.
#      Tranzaksiya oxirida ATAYLAB bekor qilinadi — bazada test yozuvi QOLMAYDI.
#   5) serverdan tasnif.soliq.uz (MXIK API) ochiqligini tekshiradi
#   6) API + web-clinic + web-admin'ni deploy qiladi (deploy.sh orqali)
#   7) yangi endpointlar ro'yxatdaligini tekshiradi
#
# TARTIB MUHIM: avval baza, keyin kod. Migratsiyalar faqat QO'SHIMCHA — eski
# kod bilan ham mos; kod esa yangi jadval/funksiyalarga tayanadi.
#
# ISHLATISH (serverda, /opt/clary ichida):
#
#   DATABASE_URL="postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres" \
#     bash scripts/deploy-drug-reference.sh
#
#   Parol: D:/1997/PAROLLAR.md (DIRECT ulanish, pooler emas).
#
# Bayroqlar:
#   --db-only       faqat migratsiya + tekshiruv (kod deploy qilinmaydi)
#   --code-only     faqat kod deploy (migratsiyalar avval qo'llangan bo'lsa)
#   --skip-verify   funksional tekshiruvni o'tkazib yuborish (TAVSIYA ETILMAYDI)
#
# Deploy'dan keyin: admin.clary.uz → "Dori katalogi (MXIK)" → "MXIK'dan yangilash"
# (≈50 ming yozuv, 3–6 daqiqa). Keyin har kuni 04:10 da o'zi tekshiriladi.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

MIGRATIONS=(
  "supabase/migrations/20261006000001_drug_reference.sql"
  "supabase/migrations/20261006000002_drug_registry.sql"
)
VERIFY_SQL="scripts/verify-drug-reference.sql"

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

# --------------------------------------------------------------------------
# 1) Repo
# --------------------------------------------------------------------------
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

# ==========================================================================
# BAZA
# ==========================================================================
if [ "$CODE_ONLY" = true ]; then
  warn "Baza o'tkazib yuborildi (--code-only)"
  if [ ${#PENDING[@]} -gt 0 ]; then
    warn "Diqqat: ${#PENDING[@]} ta migratsiya bu serverda qo'llangan deb belgilanmagan."
    warn "Ular bazada bo'lmasa — katalog qidiruvi va prixod skaneri xato beradi. Ishonchingiz komilmi? [ha/yo'q]"
    read -r ANSWER
    case "$ANSWER" in ha|Ha|HA|y|yes) ;; *) die "To'xtatildi" ;; esac
  fi
else
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL kerak:

  DATABASE_URL=\"postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres\" \\
    bash scripts/deploy-drug-reference.sh

Parol: D:/1997/PAROLLAR.md. Faqat kodni chiqarish uchun: --code-only"
  command -v psql >/dev/null || die "psql topilmadi. O'rnating: apt-get install -y postgresql-client"

  # Dorixona 2.0 poydevori (clary_search_norm, medication_barcodes) bo'lishi shart
  HAS_BASE="$(psql "$DATABASE_URL" -tAX -c "
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('clary_search_norm', 'clary_barcode_norm');")"
  [ "$HAS_BASE" -ge 2 ] || die "Dorixona 2.0 migratsiyalari (20261004000001…) qo'llanmagan — avval scripts/deploy-pharmacy-v2.sh"
  [ "$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.medication_barcodes') IS NOT NULL;")" = "t" ] \
    || die "medication_barcodes jadvali yo'q — avval Dorixona 2.0 migratsiyalari"

  # ------------------------------------------------------------------------
  # 2) Migratsiyalar
  # ------------------------------------------------------------------------
  if [ ${#PENDING[@]} -eq 0 ]; then
    ok "Barcha migratsiya allaqachon qo'llangan"
  fi
  for m in ${PENDING[@]+"${PENDING[@]}"}; do
    log "Migratsiya: $(basename "$m")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$m"
    echo "$(basename "$m") $(sha256sum "$m" | cut -d' ' -f1)" >> "$STATE_FILE"
    ok "$(basename "$m") qo'llandi"
  done

  log "PostgREST sxema keshi yangilanmoqda"
  psql "$DATABASE_URL" -q -c "NOTIFY pgrst, 'reload schema';"
  ok "NOTIFY pgrst yuborildi"

  # ------------------------------------------------------------------------
  # 3) Obyektlar
  # ------------------------------------------------------------------------
  log "Obyektlar tekshirilmoqda"
  MISSING_FN="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(obj) AS (VALUES
      ('drug_reference_upsert'), ('drug_reference_deactivate_stale'), ('drug_reference_search'),
      ('pharmacy_adopt_reference'), ('drug_reference_learn_backfill'), ('drug_reference_stats'),
      ('tg_drug_reference_learn_barcode'), ('tg_drug_reference_learn_mxik'),
      ('clary_try_date'), ('drug_registry_import_rows'), ('drug_registry_reset_matches'),
      ('drug_registry_match'), ('drug_registry_finish'), ('drug_registry_discard'))
    SELECT string_agg(w.obj, ', ') FROM want w
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = w.obj);")"
  [ -z "$MISSING_FN" ] || die "Funksiyalar yaratilmadi: $MISSING_FN"

  MISSING_TBL="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(obj) AS (VALUES
      ('drug_reference'), ('drug_reference_barcodes'), ('drug_reference_sync_log'), ('drug_registry'))
    SELECT string_agg(w.obj, ', ') FROM want w WHERE to_regclass('public.' || w.obj) IS NULL;")"
  [ -z "$MISSING_TBL" ] || die "Jadvallar yaratilmadi: $MISSING_TBL"

  HAS_TRG="$(psql "$DATABASE_URL" -tAX -c "
    SELECT count(*) FROM pg_trigger
     WHERE tgname IN ('tg_drug_reference_learn_barcode', 'tg_drug_reference_learn_mxik') AND NOT tgisinternal;")"
  [ "$HAS_TRG" = "2" ] || die "Shtrix-kod o'rganish triggerlari yo'q (topildi: $HAS_TRG/2)"
  ok "14 funksiya, 4 jadval, 2 trigger joyida"

  # ------------------------------------------------------------------------
  # 4) Funksional tekshiruv (tranzaksiya oxirida bekor qilinadi)
  # ------------------------------------------------------------------------
  if [ "$SKIP_VERIFY" = false ]; then
    log "Funksional tekshiruv (test yozuvlari saqlanmaydi)"
    OUT="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -q -f "$VERIFY_SQL" 2>&1 || true)"
    LINE="$(printf '%s\n' "$OUT" | grep -m1 'TEST_RESULT' || true)"
    if printf '%s' "$LINE" | grep -q 'TEST_RESULT OK'; then
      ok "Zanjir to'liq o'tdi"
      printf "  %s\n" "${LINE#*TEST_RESULT OK | }"
    elif [ -n "$LINE" ]; then
      printf "%s\n" "$LINE"
      die "Tekshiruvda natija mos kelmadi (FAIL[...]) — kod deploy QILINMADI. Baza xavfsiz (eski kod ishlayveradi)."
    else
      printf "%s\n" "$OUT" | tail -15
      die "Tekshiruv oxirigacha yetmadi (yuqoridagi xato) — kod deploy QILINMADI. Baza xavfsiz."
    fi
  else
    warn "Funksional tekshiruv o'tkazib yuborildi (--skip-verify)"
  fi
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

# --------------------------------------------------------------------------
# 5) MXIK API serverdan ochiqmi (katalogni server o'zi yig'adi)
# --------------------------------------------------------------------------
log "tasnif.soliq.uz (MXIK API) tekshirilmoqda"
MX="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      'https://tasnif.soliq.uz/api/cls-api/attribute/web-katalog?classCode=09018&pageNo=0&pageSize=1&lang=ru' || true)"
if [ "$MX" = "200" ]; then
  ok "MXIK API ochiq — katalogni server yig'a oladi"
else
  warn "MXIK API javob bermadi (status: ${MX:-none}). Katalog sinxroni ishlamasligi mumkin —"
  warn "keyinroq admin panelda 'MXIK'dan yangilash' bilan qayta urinib ko'ring."
fi

# ==========================================================================
# KOD — API (katalog moduli, prixod skaneri), web-clinic (prixod, yangi dori
# formasi), web-admin ("Dori katalogi (MXIK)" sahifasi)
# ==========================================================================
log "Kod deploy qilinmoqda (api + web-clinic + web-admin)"
bash "$REPO/deploy.sh" api
bash "$REPO/deploy.sh" web
bash "$REPO/deploy.sh" admin

# --------------------------------------------------------------------------
# 7) Tirik-tekshiruv
# --------------------------------------------------------------------------
log "Endpointlar tekshirilmoqda"
API="http://127.0.0.1:${API_PORT:-4000}"
ST="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API/api/v1/status" || true)"
[ "$ST" = "200" ] || die "API javob bermayapti (status $ST). pm2 logs clary-api --lines 50"
ok "API tirik"

check_route() {
  local method="$1" path="$2"
  local st
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X "$method" \
        -H 'Content-Type: application/json' -d '{}' "$API$path" || true)"
  case "$st" in
    401|403) ok "$path ro'yxatda (auth talab qilyapti — to'g'ri)" ;;
    404)     die "$path YO'Q (404). API build eskimi? pm2 restart clary-api --update-env" ;;
    *)       warn "$path kutilmagan status: $st (401/403 kutilgandi)" ;;
  esac
}
check_route GET  "/api/v1/pharmacy/reference/search?q=pa"
check_route POST /api/v1/pharmacy/reference/adopt
check_route GET  /api/v1/admin/drug-reference/stats
check_route POST /api/v1/admin/drug-reference/sync

printf "\n${G}🚀 Davlat dori katalogi tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) admin.clary.uz → "Dori katalogi (MXIK)" → "MXIK'dan yangilash"
     (≈50 ming yozuv, 3–6 daqiqa; sahifada sinflar bo'yicha jarayon ko'rinadi).
  2) Davlat reestri: uzpharm-control.uz → Reestr → "Yuklab olish" (captcha) →
     Excel'ni shu sahifadagi "Excel yuklash"ga tashlang → ustunlarni tekshiring →
     "Import qilish". Ro'yxat holati va "retsept bilan" belgisi katalogga moslanadi.
  3) Dorixona → Prixod → "Dori qo'shish": nomning 1–2 harfi → bazadagi va
     katalogdagi dorilar. Katalogdan tanlansa — nomi, ishlab chiqaruvchi, MXIK,
     qadoq soni, QQS o'zi to'ladi. Qutini skanerlang — shtrix-kod doriga biriktiriladi.
  4) Brauzerda Ctrl+Shift+R (yangi frontend keshdan chiqishi uchun).
EOF
