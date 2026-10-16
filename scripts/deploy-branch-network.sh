#!/usr/bin/env bash
# =============================================================================
# FILIAL TARMOG'I (1 HQ + 10 tagacha filial) — prod'ga chiqarish
# =============================================================================
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull)
#   2) migratsiyalarni qo'llaydi (har biri BITTA tranzaksiyada, idempotent):
#        20261016000001_branch_network_foundation.sql — Faza 0 + 2: kompaniya
#            avtomatik, yetim kompaniyalar tozalash, 1 HQ + limit, audit,
#            filial almashtirish (JWT)
#        20261016000002_branch_network_admin.sql      — Faza 1: super-admin
#            ulash/ajratish/HQ (atomik RPC)
#        20261016000003_branch_network_ops.sql        — Faza 3–5: tarmoq markazi,
#            katalog tarqatish, dori/pul transferi, yo'llanma, dublikatlar
#   3) obyektlar va FUNKSIONAL tekshiruv (scripts/verify-branch-network.sql) —
#      tranzaksiya oxirida ATAYLAB bekor qilinadi, bazada test yozuvi QOLMAYDI
#   4) api + web-clinic + web-admin + web-landing'ni deploy qiladi (deploy.sh all)
#   5) yangi endpointlar ro'yxatdaligini tekshiradi
#
# TARTIB MUHIM: avval baza, keyin kod. Migratsiya faqat QO'SHIMCHA — eski kod
# bilan ham mos (yangi ustunlar default qiymatli, eski jadvallar o'zgarmaydi).
#
# ISHLATISH (serverda, /opt/clary ichida, KECHQURUN):
#
#   DATABASE_URL="postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres" \
#     bash scripts/deploy-branch-network.sh
#
#   Parol: D:/1997/PAROLLAR.md (DIRECT ulanish, pooler emas).
#   Kompyuterdan bitta buyruq: D:\1997\deploy-branch-network.ps1
#
# Bayroqlar:
#   --db-only       faqat migratsiya + tekshiruv
#   --code-only     faqat kod (migratsiya avval qo'llangan bo'lsa)
#   --skip-verify   funksional tekshiruvsiz (TAVSIYA ETILMAYDI)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "supabase/migrations/20261016000001_branch_network_foundation.sql"
  "supabase/migrations/20261016000002_branch_network_admin.sql"
  "supabase/migrations/20261016000003_branch_network_ops.sql"
)
VERIFY_SQL="scripts/verify-branch-network.sql"

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
    warn "Migratsiya bu serverda qo'llangan deb belgilanmagan. Bazada bo'lmasa — /company,"
    warn "filial almashtirgich va admin 'Filial tarmoqlari' sahifasi xato beradi (boshqa modullar ishlaydi)."
    warn "Davom etilsinmi? [ha/yo'q]"
    read -r ANSWER
    case "$ANSWER" in ha|Ha|HA|y|yes) ;; *) die "To'xtatildi" ;; esac
  fi
else
  [ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL kerak:

  DATABASE_URL=\"postgresql://postgres:PAROL@db.aoubdvlkcatbeifuysau.supabase.co:5432/postgres\" \\
    bash scripts/deploy-branch-network.sh

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
    WITH want(obj) AS (VALUES ('company_audit_log'), ('network_stock_transfers'),
                              ('network_stock_transfer_items'), ('network_cash_transfers'))
    SELECT string_agg(w.obj, ', ') FROM want w WHERE to_regclass('public.' || w.obj) IS NULL;")"
  [ -z "$MISSING_TBL" ] || die "Jadvallar yaratilmadi: $MISSING_TBL"
  MISSING_FN="$(psql "$DATABASE_URL" -tAX -c "
    WITH want(fn) AS (VALUES ('network_switch_branch'), ('network_my_branches'),
                             ('admin_network_link_branch'), ('admin_network_unlink_branch'),
                             ('admin_network_set_hq'), ('admin_network_preview'),
                             ('network_live_snapshot'), ('network_period_compare'),
                             ('network_push_catalog'), ('network_transfer_send'),
                             ('network_transfer_receive'), ('network_transfer_cancel'),
                             ('network_cash_send'), ('network_cash_receive'), ('network_cash_cancel'),
                             ('network_duplicate_patients'), ('network_merge_patients'))
    SELECT string_agg(w.fn, ', ') FROM want w
     WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        WHERE n.nspname = 'public' AND p.proname = w.fn);")"
  [ -z "$MISSING_FN" ] || die "Funksiyalar yaratilmadi: $MISSING_FN"
  ok "4 jadval, 17 funksiya"

  STATS="$(psql "$DATABASE_URL" -tAX -c "
    SELECT (SELECT count(*) FROM clinics WHERE deleted_at IS NULL) || ' jonli klinika, ' ||
           (SELECT count(*) FROM companies) || ' kompaniya, ' ||
           (SELECT count(*) FROM clinics WHERE company_id IS NULL) || ' ta company_id yo''q';")"
  ok "Holat: $STATS"

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

log "Kod deploy qilinmoqda (api + web-clinic + web-admin + web-landing)"
bash "$REPO/scripts/deploy.sh" all

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
check_route GET  /api/v1/company/access          '401|403'
check_route GET  /api/v1/company/live            '401|403'
check_route POST /api/v1/company/switch          '401|403'
check_route GET  /api/v1/company/transfers/stock '401|403'
check_route GET  /api/v1/admin/networks          '401|403'

printf "\n${G}🚀 Filial tarmog'i tayyor${N}\n"
cat <<'EOF'

Keyingi qadamlar:
  1) Brauzerda Ctrl+Shift+R.
  2) Super admin: admin.clary.uz → "Filial tarmoqlari" → asosiy klinikani oching
     (filtrdan "Faqat tarmoqlar" belgisini oling) → limitni (2–10) va obuna turini
     saqlang → "Mavjud klinikani ulash" (oldindan ko'rish bilan) yoki "Yangi filial".
  3) "Tarmoq rahbariyati"ga egani "Tarmoq egasi" qilib qo'shing (email bo'yicha) —
     shundan keyin unda header'da filial almashtirgich va /company "Tarmoq markazi" chiqadi.
  4) Ulangan klinikalarda bemor dublikatlari bo'lsa: Tarmoq markazi → Dublikatlar.
  5) Har kuni 23:58 da HQ'ning Telegram chatiga tarmoq hisoboti keladi (HQ bot bog'langan bo'lsa).
EOF
