#!/usr/bin/env bash
# =============================================================================
# A0 — RAHBAR HISOBOTLARI TO'G'RILANDI + OBUNA TESHIGI + CHEK MATNI — prod'ga
# =============================================================================
# Nima o'zgardi (bitta commit):
#   • Obuna tekshiruvi: `/patients?x=/auth/` kabi query bilan bloklangan klinika
#     API'dan foydalana olardi — endi faqat yo'l tekshiriladi.
#   • Analitika pul endpoint'lari faqat rahbariyatga (analytics.view_clinic):
#     shifokor/kassir butun klinika foydasini ko'rmaydi.
#   • "Qarzga berilgan" doim 0 edi → patient_ledger'dan (yangi SQL funksiya).
#     Analitikada "Bemorlar qarzi" kartasi, oylik hisobotda undirilgan qarz va
#     davr oxiridagi qarz qatorlari; Telegram/PDF ham shu raqamni oladi.
#   • Yopilgan smenadagi chekni tahrirlash/o'chirish/bekor qilish — faqat rahbar;
#     audit jurnaliga eski va yangi qiymat yoziladi.
#   • "Sof foyda" → "Kassa foydasi" (+ dorixona foydasi, shifokor ulushi);
#     CFO Dashboard kassa tushumini ham ko'rsatadi, buxgalteriya farqi ochiq.
#   • Chek (desktop 0.2.0 matn rejimi): qatorlar web'da o'raladi — uzun nom
#     summani surib yubormaydi, sarlavha so'z o'rtasidan bo'linmaydi.
#     Desktop ilovani qayta o'rnatish SHART EMAS (interfeys serverdan keladi).
#
# Nima qiladi:
#   1) repo'ni yangilaydi (git pull) va A0 commiti borligini tekshiradi
#   2) bazani topadi, oldingi migratsiyalarni tekshiradi
#   3) migratsiya (bitta tranzaksiyada, idempotent, faqat YANGI funksiyalar):
#        20261125000001_finance_debt_flows.sql
#   4) funksiyani haqiqiy bazada sinaydi (faqat o'qiydi)
#   5) api + web-clinic + web-admin (deploy.sh default)
#   6) endpoint, bundle va versiyani tekshiradi
#
# Migratsiya qo'llanmasa ham kod YIQILMAYDI: qarz eski usulda (0) qoladi.
#
# ISHLATISH (serverda, /opt/clary ichida) — KECHQURUN, klinikalar yopilganda:
#
#   bash scripts/deploy-analytics-a0.sh
#
#   Kompyuterdan bitta buyruq: scripts/deploy-analytics-a0.ps1
#   Baza manzili serverdagi env fayllaridan (.env.local, .env, apps/api/.env*,
#   ~/.clary-db) avtomatik olinadi. Qo'lda:
#   DATABASE_URL="postgresql://..." bash scripts/deploy-analytics-a0.sh
#
# Bayroqlar:
#   --db-only     faqat migratsiya + tekshiruv
#   --code-only   faqat kod (migratsiya avval qo'llangan bo'lsa)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=(
  "supabase/migrations/20261125000001_finance_debt_flows.sql"
)
MARKER_FILE="apps/api/src/common/shift-lock.ts"
WWW="/var/www/app"

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
git fetch -q origin main
git checkout -q main
git pull --ff-only -q origin main
HEAD_SHA="$(git rev-parse --short HEAD)"
ok "Repo: $HEAD_SHA — $(git log -1 --pretty=%s)"
[ -f "$MARKER_FILE" ] || die "A0 kodi repo'da yo'q ($MARKER_FILE) — git pull o'tmadimi?"
for m in "${MIGRATIONS[@]}"; do
  [ -f "$m" ] || die "Fayl topilmadi: $m (git pull o'tdimi?)"
done
ok "A0 kodi va migratsiya fayli bor"

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
    warn "Migratsiya bu serverda qo'llangan deb belgilanmagan. Bazada bo'lmasa — hammasi"
    warn "ishlaydi, faqat \"Qarzga berilgan\" eski usulda (0) ko'rinadi."
  fi
else
  if ! command -v psql >/dev/null; then
    log "psql o'rnatilmoqda (postgresql-client)"
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client \
      || die "psql o'rnatilmadi. Qo'lda: apt-get install -y postgresql-client"
  fi
  export PGCONNECT_TIMEOUT=10

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
    bash scripts/deploy-analytics-a0.sh

Parol: D:/1997/PAROLLAR.md — DATABASE_URL_DIRECT qatorida 'postgres:' bilan '@' orasidagi qism
(eyJ... bilan boshlanadigan kalit EMAS). Bir marta ~/.clary-db ga saqlansa, boshqa so'ralmaydi.
Faqat kodni chiqarish uchun: --code-only"
  psql -w "$DATABASE_URL" -tAc 'select 1' >/dev/null 2>&1 || die "Bazaga ulanib bo'lmadi (parol yoki manzil xato)"

  log "Oldingi migratsiyalar tekshirilmoqda"
  PREREQ="$(psql -w "$DATABASE_URL" -tAX -c "
    SELECT concat_ws(', ',
      CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'finance_period_flows')
           THEN 'oylik hisobot (20260810000001)' END,
      CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public' AND p.proname = 'analytics_doctors')
           THEN 'analitika (20261017000001)' END);")"
  [ -z "$PREREQ" ] || die "Bazada oldingi migratsiyalar YO'Q: $PREREQ — avval ularni qo'llang. Hech narsa o'zgartirilmadi."
  ok "Oldingi migratsiyalar bor"

  # Boshqa (shu deploy'ga aloqasiz) kutilayotgan migratsiya — faqat ogohlantirish.
  if [ "$(psql -w "$DATABASE_URL" -tAX -c "SELECT (to_regclass('public.referral_accruals') IS NULL)::int")" = "1" ]; then
    warn "Agentlar (yo'llanma) migratsiyasi 20261104000001 bazada YO'Q — Agentlar sahifasi xato beradi."
    warn "Alohida: bash scripts/deploy-referral-agents.sh --db-only"
  fi

  if [ ${#PENDING[@]} -eq 0 ]; then ok "Migratsiya allaqachon qo'llangan"; fi
  for m in ${PENDING[@]+"${PENDING[@]}"}; do
    log "Migratsiya: $(basename "$m")"
    psql -w "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$m"
    echo "$(basename "$m") $(sha256sum "$m" | cut -d' ' -f1)" >> "$STATE_FILE"
    ok "$(basename "$m") qo'llandi"
  done

  log "PostgREST sxema keshi yangilanmoqda"
  psql -w "$DATABASE_URL" -q -c "NOTIFY pgrst, 'reload schema';"
  ok "NOTIFY pgrst yuborildi"

  log "Tekshirilmoqda"
  CHECK="$(psql -w "$DATABASE_URL" -tAX -c "
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('finance_debt_flows', 'finance_debt_rows');")"
  [ "$CHECK" = "2" ] || die "Funksiyalar topilmadi: '$CHECK' (kutilgan 2) — kod deploy QILINMADI"
  ok "finance_debt_flows + finance_debt_rows bor"

  # Haqiqiy klinikada ishga tushirib ko'ramiz (STABLE — hech narsa yozmaydi).
  SAMPLE="$(psql -w "$DATABASE_URL" -tAX -v ON_ERROR_STOP=1 -c "
    SELECT c.name || ' → berilgan ' || (r->>'given_uzs') || ', undirilgan ' || (r->>'collected_uzs')
           || ', qoldiq ' || (r->>'outstanding_end_uzs') || ' (' || (r->>'debtors_end') || ' bemor)'
      FROM (SELECT id, name FROM clinics WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1) c,
           LATERAL (SELECT public.finance_debt_flows(c.id, (now() AT TIME ZONE 'Asia/Tashkent')::date - 30,
                                                     (now() AT TIME ZONE 'Asia/Tashkent')::date) AS r) x;" 2>&1)" \
    || die "finance_debt_flows ishlamadi: $SAMPLE — kod deploy QILINMADI"
  ok "Sinov (30 kun): $SAMPLE"
fi

$DB_ONLY && { ok "🗄  Baza tayyor (--db-only). Kod deploy qilinmadi."; exit 0; }

OLD_SHA="$(sed -nE 's/.*"sha":"([^"]+)".*/\1/p' "$WWW/version.json" 2>/dev/null || true)"

log "Kod deploy qilinmoqda (api + web-clinic + web-admin)"
bash "$REPO/scripts/deploy.sh" default

log "Endpointlar tekshirilmoqda"
API="http://127.0.0.1:${API_PORT:-4000}"
check_route() {
  local path="$1" want="$2" st
  st="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$API$path" || true)"
  if [[ "$st" =~ ^($want)$ ]]; then ok "$path → $st"
  elif [ "$st" = "404" ]; then die "$path YO'Q (404). API build eskimi? pm2 restart clary-api --update-env"
  else warn "$path kutilmagan status: $st (kutilgan: $want)"; fi
}
check_route /api/v1/analytics/overview '401|403'
check_route /api/v1/accounting/executive '401|403'
# Obuna teshigi yopilganini tashqi tomondan tekshirib bo'lmaydi (token kerak) —
# u unit testda (subscription.guard.spec.ts) isbotlangan.

log "Bundle va versiya tekshirilmoqda"
NEW_SHA="$(sed -nE 's/.*"sha":"([^"]+)".*/\1/p' "$WWW/version.json" 2>/dev/null || true)"
[ "$NEW_SHA" = "$HEAD_SHA" ] || die "$WWW/version.json sha='$NEW_SHA', kutilgan '$HEAD_SHA' — build joylanmadi"
ok "$WWW/version.json → $NEW_SHA (avval: ${OLD_SHA:-?})"
grep -rqF "Kassa foydasi" "$WWW/assets" || die "Yangi analitika kartalari bundle'da topilmadi"
grep -rqF "Bemorlar qarzi" "$WWW/assets" || die "\"Bemorlar qarzi\" kartasi bundle'da topilmadi"
ok "Yangi analitika va chek kodi bundle'da bor"

PUBLIC_SHA="$(curl -fsS --max-time 10 "https://app.clary.uz/version.json?ts=$(date +%s)" \
  | sed -nE 's/.*"sha":"([^"]+)".*/\1/p' || true)"
if [ "$PUBLIC_SHA" = "$HEAD_SHA" ]; then
  ok "https://app.clary.uz/version.json → $PUBLIC_SHA"
else
  warn "https://app.clary.uz/version.json → '${PUBLIC_SHA:-javob yo‘q}' (kutilgan $HEAD_SHA) — kesh bo'lishi mumkin, 1–2 daqiqadan keyin qayta tekshiring"
fi

printf "\n${G}📊 A0 joylandi (%s → %s)${N}\n" "${OLD_SHA:-?}" "$HEAD_SHA"
cat <<'EOF'

Tekshirish (brauzerda Ctrl+Shift+R, keyin):
  1) Rahbar akkaunti → Analitika: "Kassa foydasi", "Bemorlar qarzi", "Shifokor ulushi"
     kartalari. Qarz kartasidagi raqam Kassa → Qarzdorlar jami bilan mos kelishi kerak.
  2) Hisobot quruvchi → Moliyaviy hisobot: "Qarzga berilgan" endi 0 emas, ostida
     "Qarz to'lovi olindi" va "Bemorlar qarzi davr oxirida" qatorlari.
  3) Shifokor akkaunti: menyuda "Analitika" YO'Q (o'z statistikasi shifokor sahifasida).
  4) Kassir akkaunti → Jurnal → kechagi (yopilgan smena) chekni tahrirlash:
     "Bu yozuv yopilgan smenaga tegishli…" xabari. Rahbar esa tahrirlay oladi.
  5) CFO Dashboard: "Kassa tushumi" = Analitikadagi "Tushum".
  6) Desktop ilovada "Yangilash" banneri → chek chop eting: uzun xizmat nomi
     o'raladi, summa doim o'ng chetda.
EOF
