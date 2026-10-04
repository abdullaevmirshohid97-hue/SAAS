#!/usr/bin/env bash
# =============================================================================
# DORIXONA 2.0 — prod'ga chiqarish (2026-10-05)
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) 5 ta migratsiyani qo'llaydi (har fayl BITTA tranzaksiyada, idempotent)
#   3) obyektlar (jadval/funksiya) haqiqatan yaratilganini tekshiradi
#   4) FUNKSIONAL TEKSHIRUV: prixod → sotuv (qadoq/dona, aralash to'lov) →
#      qaytarish → smena Z → bekor qilish → qadoq hajmi → prixod bekor qilish.
#      Tekshiruv bitta tranzaksiyada va oxirida ATAYLAB bekor qilinadi —
#      bazada test yozuvi QOLMAYDI. Xato bo'lsa kod deploy QILINMAYDI.
#   5) API + web-clinic + web-admin'ni deploy qiladi (mavjud deploy.sh orqali)
#   6) endpointlar tirikligini tekshiradi
#
# TARTIB MUHIM: avval baza, keyin kod. Yangi kod yangi jadval/funksiyalarga
# tayanadi; migratsiyalar esa eski kod bilan ham mos (faqat qo'shimcha) —
# baza yangilanib, kod hali eski tursa ham hech narsa buzilmaydi.
#
# ISHLATISH (serverda, /opt/clary ichida):
#
#   DATABASE_URL="postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres" \
#     bash scripts/deploy-pharmacy-v2.sh
#
#   Parol: D:/1997/PAROLLAR.md (DIRECT ulanish, pooler emas).
#
# Bayroqlar:
#   --db-only       faqat migratsiya + tekshiruv (kod deploy qilinmaydi)
#   --code-only     faqat kod deploy (migratsiyalar avval qo'llangan bo'lsa)
#   --skip-verify   funksional tekshiruvni o'tkazib yuborish (TAVSIYA ETILMAYDI)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

MIGRATIONS=(
  "supabase/migrations/20261004000001_pharmacy_v2_foundation.sql"
  "supabase/migrations/20261004000002_pharmacy_workspace.sql"
  "supabase/migrations/20261004000003_pharmacy_receive_v2.sql"
  "supabase/migrations/20261004000004_pharmacy_sales_v2.sql"
  "supabase/migrations/20261004000005_pharmacy_fiscal.sql"
)
VERIFY_SQL="scripts/verify-pharmacy-v2.sql"

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
    warn "Ular bazada bo'lmasa — dorixona bo'limi ishlamaydi. Ishonchingiz komilmi? [ha/yo'q]"
    read -r ANSWER
    case "$ANSWER" in ha|Ha|HA|y|yes) ;; *) die "To'xtatildi" ;; esac
  fi
else
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL kerak:

  DATABASE_URL=\"postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres\" \\
    bash scripts/deploy-pharmacy-v2.sh

Parol: D:/1997/PAROLLAR.md. Faqat kodni chiqarish uchun: --code-only"
  command -v psql >/dev/null || die "psql topilmadi. O'rnating: apt-get install -y postgresql-client"

  # ------------------------------------------------------------------------
  # 2) Migratsiyalar — faqat hali qo'llanmaganlari, har biri bitta tranzaksiyada
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
      ('clary_search_norm'), ('clary_barcode_norm'), ('pharmacy_search_medications'),
      ('pharmacy_set_pack_size'), ('pharmacy_link_account'), ('pharmacy_receive'),
      ('pharmacy_match_import'), ('pharmacy_void_receipt'), ('pharmacy_sell_v2'),
      ('pharmacy_void_sale'), ('pharmacy_sale_cash_share'), ('pharmacy_return_items_v2'),
      ('pharmacy_void_sale_v2'), ('pharmacy_shift_totals'), ('pharmacy_close_shift'),
      ('trash_delete_pharmacy_sale'), ('trash_restore'))
    SELECT string_agg(w.obj, ', ') FROM want w
    WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = w.obj);")"
  [ -z "$MISSING_FN" ] || die "Funksiyalar yaratilmadi: $MISSING_FN"

  MISSING_TBL="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(obj) AS (VALUES
      ('medication_barcodes'), ('medication_price_history'), ('product_subscriptions'),
      ('product_subscription_events'), ('pharmacy_devices'), ('pharmacy_operators'),
      ('pharmacy_operator_sessions'), ('pharmacy_shifts'), ('pharmacy_cash_movements'),
      ('pharmacy_sale_payments'), ('pharmacy_receipt_drafts'), ('supplier_item_aliases'),
      ('pharmacy_import_profiles'), ('pharmacy_fiscal_settings'), ('fiscal_receipts'))
    SELECT string_agg(w.obj, ', ') FROM want w WHERE to_regclass('public.' || w.obj) IS NULL;")"
  [ -z "$MISSING_TBL" ] || die "Jadvallar yaratilmadi: $MISSING_TBL"

  HAS_COLS="$(psql "$DATABASE_URL" -tAX -c "
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'medication_stock_summary'
      AND column_name IN ('qty_sellable', 'pack_qty', 'search_text', 'mxik_code');")"
  [ "$HAS_COLS" = "4" ] || die "medication_stock_summary yangi ustunlarsiz (topildi: $HAS_COLS/4)"
  ok "17 funksiya, 15 jadval, ombor ko'rinishi joyida"

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
      die "Tekshiruvda hisob mos kelmadi (FAIL[...]) — kod deploy QILINMADI. Baza xavfsiz (eski kod ishlayveradi)."
    else
      printf "%s\n" "$OUT" | tail -15
      die "Tekshiruv oxirigacha yetmadi (yuqoridagi xato) — kod deploy QILINMADI. Baza xavfsiz."
    fi
  else
    warn "Funksional tekshiruv o'tkazib yuborildi (--skip-verify)"
  fi
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

# ==========================================================================
# KOD — API (dorixona modullari, guardlar), web-clinic (POS/prixod/Dorixona
# kirishi), web-admin (klinikaga dorixona biriktirish)
# ==========================================================================
log "Kod deploy qilinmoqda (api + web-clinic + web-admin)"
bash "$REPO/deploy.sh" api
bash "$REPO/deploy.sh" web
bash "$REPO/deploy.sh" admin

# --------------------------------------------------------------------------
# 6) Tirik-tekshiruv
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
check_route GET  /api/v1/pharmacy/pos/catalog
check_route GET  /api/v1/pharmacy-ws/status
check_route GET  /api/v1/pharmacy/shifts/current
check_route GET  /api/v1/pharmacy/fiscal/settings
check_route GET  /api/v1/admin/pharmacy-subscriptions

printf "\n${G}🚀 Dorixona 2.0 tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) admin.clary.uz → Klinikalar → klinika → "Batafsil" → "Dorixona" tabi:
     dorixona Gmail'i + muddat → "Biriktirish va faollashtirish".
  2) Dorixonachi app.clary.uz → "Dorixona" → shu Gmail bilan kiradi →
     kompyuterni ulaydi → admin PIN yaratadi → Sozlamalar → Operatorlar.
  3) Klinika ichidagi dorixona: menyudagi "Dorixona" (o'z holicha, yangi
     kassa/prixod ekranlari bilan).
  4) Brauzerda Ctrl+Shift+R (yangi frontend keshdan chiqishi uchun).
EOF
