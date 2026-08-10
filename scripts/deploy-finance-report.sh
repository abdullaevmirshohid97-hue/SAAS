#!/usr/bin/env bash
# =============================================================================
# MOLIYAVIY HISOBOT MODULI — prod'ga chiqarish (2026-08-10)
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) `20260810000001_finance_report.sql` migratsiyasini qo'llaydi
#   3) SVERTKANI REAL MA'LUMOTDA TEKSHIRADI — bu eng muhim qadam:
#      har klinika uchun  boshlang'ich + aylanma = yakuniy  ayniyati sinaladi.
#      Mos kelmasa skript TO'XTAYDI va kod deploy qilinmaydi.
#   4) API va web-clinic'ni deploy qiladi (mavjud deploy.sh orqali)
#   5) API tirikligini tekshiradi
#
# ISHLATISH (serverdagi ochiq terminalda, /opt/clary ichida):
#
#   DATABASE_URL="postgresql://postgres.xxxx:PAROL@aws-0-...pooler.supabase.com:5432/postgres" \
#     bash scripts/deploy-finance-report.sh
#
# Bayroqlar:
#   --db-only     faqat migratsiya + tekshiruv (kod deploy qilinmaydi)
#   --code-only   faqat kod deploy (DATABASE_URL kerak emas)
#   --skip-check  svertka tekshiruvini o'tkazib yuborish (TAVSIYA ETILMAYDI)
#
# Migratsiya IDEMPOTENT (CREATE OR REPLACE / IF NOT EXISTS) — qayta ishga
# tushirish xavfsiz.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# Tartib MUHIM: 001 asos, keyingilar uni to'ldiradi/almashtiradi.
# Hammasi idempotent — qayta ishga tushirish xavfsiz.
MIGRATIONS=(
  "supabase/migrations/20260810000001_finance_report.sql"
  "supabase/migrations/20260811000001_finance_report_counts.sql"
  "supabase/migrations/20260811000002_finance_rows_settlement_split.sql"
  "supabase/migrations/20260811000003_finance_payroll_by_person.sql"
  "supabase/migrations/20260811000004_noncash_by_class.sql"
  "supabase/migrations/20260811000005_finance_account_ledger.sql"
)

DB_ONLY=false
CODE_ONLY=false
SKIP_CHECK=false
for arg in "$@"; do
  case "$arg" in
    --db-only)    DB_ONLY=true ;;
    --code-only)  CODE_ONLY=true ;;
    --skip-check) SKIP_CHECK=true ;;
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

for m in "${MIGRATIONS[@]}"; do
  [ -f "$m" ] || die "Migratsiya topilmadi: $m (git pull o'tdimi?)"
done

# ==========================================================================
# BAZA
# ==========================================================================
if [ "$CODE_ONLY" = false ]; then
  : "${DATABASE_URL:?DATABASE_URL kerak — prod Supabase connection string (pooler, 5432)}"
  command -v psql >/dev/null || die "psql topilmadi. O'rnating: apt-get install -y postgresql-client"

  # ------------------------------------------------------------------------
  # 2) Migratsiya
  # ------------------------------------------------------------------------
  for m in "${MIGRATIONS[@]}"; do
    log "Migratsiya qo'llanmoqda: $(basename "$m")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$m"
    ok "$(basename "$m") qo'llandi"
  done

  log "PostgREST sxema keshi yangilanmoqda"
  psql "$DATABASE_URL" -q -c "NOTIFY pgrst, 'reload schema';"
  ok "NOTIFY pgrst yuborildi"

  # Obyektlar haqiqatan yaratilganini tasdiqlash (jimgina o'tib ketmasin).
  log "Obyektlar tekshirilmoqda"
  MISSING="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(obj) AS (VALUES
      ('finance_method_class'), ('finance_balances_asof'),
      ('finance_period_flows'), ('finance_period_rows'),
      ('finance_period_locked'))
    SELECT string_agg(w.obj, ', ')
    FROM want w
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = w.obj);")"
  [ -z "$MISSING" ] || die "Bu funksiyalar yaratilmadi: $MISSING"

  TBL="$(psql "$DATABASE_URL" -tAX -c "SELECT to_regclass('public.period_closings');")"
  [ -n "$TBL" ] || die "period_closings jadvali yaratilmadi"

  # Hisoblagich ustunlari (2026-08-11 tuzatishi) haqiqatan bormi. Busiz
  # hisobotda "Soni" ustuni bo'sh qolib, PDF'da 0 bo'lib chiqadi.
  HAS_COUNTS="$(psql "$DATABASE_URL" -tAX -c "
    SELECT CASE WHEN pg_get_function_result(p.oid) LIKE '%rev_cash_count%'
                THEN 'yes' ELSE 'no' END
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'finance_period_flows';")"
  [ "$HAS_COUNTS" = "yes" ] || die \
    "finance_period_flows da usul kesimidagi hisoblagichlar yo'q — 20260811000001 qo'llanmagan"

  ok "5 funksiya + period_closings jadvali + hisoblagichlar joyida"

  # ------------------------------------------------------------------------
  # 3) SVERTKA TEKSHIRUVI — real ma'lumotda
  # ------------------------------------------------------------------------
  # Nega bu shart: hisobotning butun ishonchliligi bitta ayniyatga tayanadi —
  #     boshlang'ich qoldiq + kirim − chiqim = yakuniy qoldiq
  # Chap tomon `finance_period_flows` dan, o'ng tomon `finance_balances_asof`
  # dan MUSTAQIL hisoblanadi. Ular mos kelmasa, hisobotni ochish mumkin emas.
  # Shuning uchun kodni deploy qilishdan OLDIN, barcha faol klinikalarda
  # oxirgi 60 kun bo'yicha sinaymiz.
  if [ "$SKIP_CHECK" = false ]; then
    log "Svertka tekshiruvi (oxirgi 60 kun, barcha faol klinikalar)"

    CHECK_SQL="
    WITH per AS (SELECT (current_date - 60) AS f, current_date AS t),
    cl AS (
      SELECT c.id, c.name FROM clinics c
      WHERE c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.clinic_id = c.id AND t.is_void = false)
    ),
    v AS (
      SELECT cl.name,
        (o.cash_uzs + fl.rev_cash_uzs + GREATEST(fl.adj_cash_uzs, 0)
          - fl.ref_cash_uzs - fl.exp_cash_uzs - fl.pay_cash_uzs - fl.encashed_uzs
          - GREATEST(-fl.adj_cash_uzs, 0) - e.cash_uzs)                       AS d_kassa,
        (o.safe_uzs + fl.encashed_uzs + fl.safe_deposit_uzs + fl.settled_safe_uzs
          - fl.safe_out_tx_uzs - fl.exp_safe_uzs - fl.pay_safe_uzs - e.safe_uzs) AS d_seyf,
        (o.pending_uzs + fl.rev_card_uzs + fl.rev_transfer_uzs + fl.rev_other_uzs
          - fl.ref_card_uzs - fl.ref_transfer_uzs - fl.ref_other_uzs
          - fl.settled_bank_uzs - fl.settled_safe_uzs - e.pending_uzs)        AS d_yoldagi,
        (o.bank_uzs + fl.settled_bank_uzs - fl.exp_noncash_uzs - fl.pay_noncash_uzs
          - e.bank_uzs)                                                       AS d_bank
      FROM cl CROSS JOIN per
      JOIN LATERAL finance_balances_asof(cl.id, per.f - 1, 'reception') o  ON true
      JOIN LATERAL finance_balances_asof(cl.id, per.t,     'reception') e  ON true
      JOIN LATERAL finance_period_flows(cl.id, per.f, per.t, 'reception') fl ON true
    )
    SELECT name, d_kassa, d_seyf, d_yoldagi, d_bank FROM v
    WHERE d_kassa <> 0 OR d_seyf <> 0 OR d_yoldagi <> 0 OR d_bank <> 0
    ORDER BY abs(d_kassa) + abs(d_seyf) + abs(d_yoldagi) + abs(d_bank) DESC
    LIMIT 20;"

    BAD="$(psql "$DATABASE_URL" -tAX -F ' | ' -c "$CHECK_SQL")"
    TOTAL="$(psql "$DATABASE_URL" -tAX -c "
      SELECT count(*) FROM clinics c WHERE c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.clinic_id = c.id AND t.is_void = false);")"

    if [ -z "$BAD" ]; then
      ok "Svertka toza: ${TOTAL} ta klinikada 4 ta hisob ham ayniyatni qanoatlantiradi"
    else
      printf "\n${Y}Quyidagi klinikalarda svertka mos kelmadi${N}\n"
      printf "  (klinika | kassa | seyf | yo'ldagi | bank — farq so'mda)\n\n"
      printf "%s\n\n" "$BAD"
      warn "Bu YANGI bag bo'lmasligi mumkin — mavjud ma'lumotdagi nomuvofiqlik"
      warn "endi oshkor bo'ldi (ilgari uni ko'rsatadigan joy yo'q edi)."
      warn "Hisobot ekranida ham aynan shu farqlar qizil bilan ko'rinadi."
      printf "\nDavom etasizmi? Kod deploy qilinsinmi? [ha/yo'q]: "
      read -r ANSWER
      case "$ANSWER" in
        ha|Ha|HA|y|yes) ok "Davom etilmoqda" ;;
        *) die "To'xtatildi. Baza allaqachon yangilangan (bu xavfsiz — eski kod yangi funksiyalarga tegmaydi)." ;;
      esac
    fi
  else
    warn "Svertka tekshiruvi o'tkazib yuborildi (--skip-check)"
  fi
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

# ==========================================================================
# KOD
# ==========================================================================
# API — yangi `finance-report` moduli va Telegram botdagi hisobot oqimi.
# web-clinic — Hisobot quruvchidagi yangi "Moliyaviy hisobot" yorlig'i.
# Boshqa frontendlarga tegilmagan, shuning uchun `all` emas.
log "Kod deploy qilinmoqda (api + web-clinic)"
bash "$REPO/deploy.sh" api
bash "$REPO/deploy.sh" web

# --------------------------------------------------------------------------
# 5) Tirik-tekshiruv
# --------------------------------------------------------------------------
log "Endpoint tekshirilmoqda"
API="http://127.0.0.1:${API_PORT:-4000}"

ST="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API/api/v1/status" || true)"
[ "$ST" = "200" ] || die "API javob bermayapti (status $ST). pm2 logs clary-api --lines 50"
ok "API tirik"

# Autentifikatsiyasiz 401 kutiladi — 404 bo'lsa modul ro'yxatdan o'tmagan.
ST="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
      -X POST -H 'Content-Type: application/json' \
      -d '{"from":"2026-08-01","to":"2026-08-10"}' \
      "$API/api/v1/finance-report/build" || true)"
case "$ST" in
  401|403) ok "finance-report endpoint ro'yxatda (auth talab qilyapti — to'g'ri)" ;;
  404)     die "finance-report endpoint YO'Q (404). API build eskimi? pm2 restart clary-api --update-env" ;;
  *)       warn "finance-report kutilmagan status: $ST (401/403 kutilgandi)" ;;
esac

printf "\n${G}🚀 Tayyor${N}\n"
cat <<'EOF'

Endi tekshiring:
  1. app.clary.uz → Moliya → Hisobot quruvchi → "Moliyaviy hisobot"
  2. Davr: "Yopish davri (11→10)" tugmasi — yopish kunini o'zgartirish mumkin
  3. Eng tepadagi SVERTKA jadvali yashil bo'lsa — hisobot ishonchli
  4. Har bir summani bosing — ortidagi hujjatlar ochilishi kerak
  5. PDF tugmasi
  6. Telegram botda: "📑 Hisobot tayyorlash"

"Oy yopish" tugmasini BIRINCHI MARTA test klinikada sinang — u kassadagi
naqdni seyfga o'tkazadi va davrni qulflaydi (orqaga yozuv taqiqlanadi).

Orqaga qaytarish kerak bo'lsa:
  git revert HEAD && bash deploy.sh api && bash deploy.sh web
  (bazani qaytarish SHART EMAS — yangi funksiyalar eski kodga xalaqit bermaydi)
EOF
