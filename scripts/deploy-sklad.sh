#!/usr/bin/env bash
# =============================================================================
# CLARY Sklad — ALOHIDA jarayonni (pm2: clary-sklad-api) prod'ga chiqarish (C1)
# =============================================================================
# Clinic'ga TEGMAYDI:
#   • clary-api (pm2) qayta ishga tushirilmaydi — skript oxirida restart soni
#     o'zgarmaganini tekshiradi;
#   • Clinic guard/obuna/jadvallari o'zgarmaydi; control-plane migratsiyasi
#     faqat YANGI warehouse_* jadval/funksiyalar qo'shadi;
#   • Caddy'ga avtomatik tegmaydi (5 sayt) — qo'lda qo'shish yo'riqnomasini beradi.
#
# Oldindan kerak (bir marta):
#   1) Alohida PostgreSQL server (Clinic Supabase EMAS) + CREATEDB/CREATEROLE
#      huquqli provisioner roli. /opt/clary/.env.local ga:
#        WAREHOUSE_DATABASE_ADMIN_URL=postgresql://clary_provisioner:...@HOST:5432/postgres
#        WAREHOUSE_DATABASE_SSLMODE=require   (lokal serverda: disable)
#        WAREHOUSE_BASE_DOMAIN=sklad.clary.uz
#        SKLAD_API_PORT=4100
#   2) DNS: sklad A 72.61.88.214 (+ har kompaniyaga <slug>.sklad A, yoki delegatsiya)
#
# ISHLATISH (serverda, /opt/clary):
#   bash scripts/deploy-sklad.sh            # migratsiya + build + pm2 + admin
#   bash scripts/deploy-sklad.sh --no-admin # web-admin'ni qayta yig'masdan
#   DATABASE_URL="postgresql://..." bash scripts/deploy-sklad.sh   # Clinic Supabase (control-plane)
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION="supabase/migrations/20261124000001_warehouse_control_plane.sql"
PM2_NAME="clary-sklad-api"
WITH_ADMIN=true
for arg in "$@"; do
  case "$arg" in
    --no-admin) WITH_ADMIN=false ;;
    *) echo "Nomaʼlum bayroq: $arg" >&2; exit 1 ;;
  esac
done

G='\033[0;32m'; B='\033[0;36m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "\n${B}▶ %s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }
env_val() { grep -E "^(export[[:space:]]+)?$1=" "$REPO/.env.local" 2>/dev/null | tail -1 | cut -d= -f2- \
            | sed -E "s/^[\"']//; s/[\"'][[:space:]]*\$//" || true; }

cd "$REPO"

log "Repo yangilanmoqda"
git fetch -q origin main && git checkout -q main && git pull --ff-only -q origin main
HEAD_SHA="$(git rev-parse --short HEAD)"
ok "Repo: $HEAD_SHA — $(git log -1 --pretty=%s)"
[ -f apps/api/src/sklad-main.ts ] || die "Sklad kodi main'da yo'q (sklad-main.ts) — PR merge qilinganmi?"
[ -f "$MIGRATION" ] || die "Migratsiya fayli yo'q: $MIGRATION"

log "Sklad sozlamalari tekshirilmoqda"
WH_URL="$(env_val WAREHOUSE_DATABASE_ADMIN_URL)"
[ -n "$WH_URL" ] || die "WAREHOUSE_DATABASE_ADMIN_URL .env.local da yo'q"
case "$WH_URL" in
  *supabase.co*|*supabase.com*|*aoubdvlkcatbeifuysau*)
    die "WAREHOUSE_DATABASE_ADMIN_URL Clinic Supabase'ga qarayapti — TAQIQLANGAN (alohida server kerak)" ;;
esac
command -v psql >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql-client; }
export PGCONNECT_TIMEOUT=10
WH_SSL="$(env_val WAREHOUSE_DATABASE_SSLMODE)"
PRIV="$(PGSSLMODE="${WH_SSL:-require}" psql -w "$WH_URL" -tAX -c \
  "SELECT rolcreatedb::int || rolcreaterole::int FROM pg_roles WHERE rolname = current_user" 2>&1)" \
  || die "Sklad Postgres serveriga ulanib bo'lmadi: $(echo "$PRIV" | sed -E 's#postgres(ql)?://[^ ]+#[redacted]#g' | head -2)"
[ "$PRIV" = "11" ] || die "Provisioner rolida CREATEDB va CREATEROLE yo'q (natija: '$PRIV')"
ok "Sklad Postgres: ulanish bor, CREATEDB + CREATEROLE"

log "Control-plane migratsiyasi (Clinic Supabase'ga faqat YANGI warehouse_* obyektlar)"
if [ -z "${DATABASE_URL:-}" ]; then
  for f in "$REPO/.env.local" "$REPO/.env" "$REPO/apps/api/.env.local" "$HOME/.clary-db"; do
    [ -f "$f" ] || continue
    for key in DATABASE_URL_DIRECT DATABASE_URL SUPABASE_DB_URL; do
      val="$(grep -E "^(export[[:space:]]+)?${key}=" "$f" | tail -1 | cut -d= -f2- \
             | sed -E "s/^[\"']//; s/[\"'][[:space:]]*\$//" || true)"
      case "$val" in *aoubdvlkcatbeifuysau*) ;; *) continue ;; esac
      for cand in "${val/:6543\//:5432/}" "$val"; do
        if psql -w "$cand" -tAc 'select 1' >/dev/null 2>&1; then DATABASE_URL="$cand"; break 3; fi
      done
    done
  done
fi
[ -n "${DATABASE_URL:-}" ] || die "Clinic Supabase manzili topilmadi — DATABASE_URL=... bilan bering (D:/1997/PAROLLAR.md)"
STATE_FILE="$REPO/.migrations-applied"; touch "$STATE_FILE"
SIG="$(basename "$MIGRATION") $(sha256sum "$MIGRATION" | cut -d' ' -f1)"
if grep -qxF "$SIG" "$STATE_FILE"; then
  ok "Migratsiya allaqachon qo'llangan"
else
  psql -w "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 -f "$MIGRATION"
  echo "$SIG" >> "$STATE_FILE"
  ok "$(basename "$MIGRATION") qo'llandi"
fi
CHECK="$(psql -w "$DATABASE_URL" -tAX -c "
  SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'warehouse\_%')
      || '/' || (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname IN ('create_warehouse_tenant','claim_warehouse_provisioning',
                       'upsert_warehouse_db_secret','get_warehouse_db_secret'));")"
[ "$CHECK" = "5/4" ] || die "Control-plane tekshiruvi o'tmadi: '$CHECK' (kutilgan 5/4)"
ok "5 jadval, 4 funksiya bor"

CLINIC_RESTARTS_BEFORE="$(pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s||'[]').find(x=>x.name==='clary-api');console.log(p?p.pm2_env.restart_time:'-')})")"

# Clinic API'ning dist/ papkasiga TEGILMAYDI: Sklad ALOHIDA papkaga (dist-sklad)
# yig'iladi. `nest build` dist/ ni o'chirib qayta yozardi — ishlab turgan clary-api
# keyingi restartgacha aralash fayllar bilan qolardi.
log "Sklad build → apps/api/dist-sklad (Clinic dist/ ga tegilmaydi)"
pnpm -r --filter "./packages/**" run build >/dev/null
rm -rf apps/api/dist-sklad.new
(cd apps/api && NODE_OPTIONS="--max-old-space-size=${CLARY_BUILD_HEAP_MB:-3072}" \
  ./node_modules/.bin/tsc -p tsconfig.json --outDir dist-sklad.new)
[ -f apps/api/dist-sklad.new/sklad-main.js ] || die "dist-sklad.new/sklad-main.js yaratilmadi"
rm -rf apps/api/dist-sklad && mv apps/api/dist-sklad.new apps/api/dist-sklad
ok "apps/api/dist-sklad/sklad-main.js tayyor"

log "pm2: $PM2_NAME"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_NAME" --update-env >/dev/null
else
  (cd apps/api && pm2 start dist-sklad/sklad-main.js --name "$PM2_NAME" --time >/dev/null)
fi
pm2 save >/dev/null
ok "$PM2_NAME ishga tushdi (pm2 save)"

PORT="$(env_val SKLAD_API_PORT)"; PORT="${PORT:-4100}"
for i in $(seq 1 20); do
  curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/v1/health" | grep -q clary-sklad-api \
  || die "Sklad API javob bermadi — pm2 logs $PM2_NAME --lines 50"
ok "Sklad API: http://127.0.0.1:$PORT/api/v1/health"
ST="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/tls-allowed?domain=begona-$$.sklad.clary.uz")"
[ "$ST" = "404" ] || die "tls-allowed begona domenga $ST qaytardi (kutilgan 404) — sertifikat limiti xavfi"
ok "TLS 'ask': ro'yxatda yo'q domen → 404"
ST="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/admin/warehouses")"
[ "$ST" = "401" ] || warn "admin/warehouses token'siz $ST qaytardi (kutilgan 401)"

CLINIC_RESTARTS_AFTER="$(pm2 jlist 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s||'[]').find(x=>x.name==='clary-api');console.log(p?p.pm2_env.restart_time:'-')})")"
[ "$CLINIC_RESTARTS_BEFORE" = "$CLINIC_RESTARTS_AFTER" ] \
  || warn "clary-api restart soni o'zgardi ($CLINIC_RESTARTS_BEFORE → $CLINIC_RESTARTS_AFTER) — pm2 logs clary-api"
ok "Clinic API'ga tegilmadi (clary-api restart: $CLINIC_RESTARTS_AFTER)"

if $WITH_ADMIN; then
  log "web-admin (Super Admin → CLARY Sklad sahifasi)"
  bash "$REPO/scripts/deploy.sh" admin
fi

printf "\n${G}📦 CLARY Sklad API ishlayapti (%s)${N}\n" "$HEAD_SHA"
cat <<EOF

Caddy (QO'LDA, bir marta) — infra/caddy/sklad.Caddyfile.snippet:
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-\$(date +%F-%H%M)
  # global {...} ichiga on_demand_tls { ask http://127.0.0.1:$PORT/api/v1/tls-allowed }
  # oxiriga sklad.clary.uz va *.sklad.clary.uz bloklari
  caddy validate --config /etc/caddy/Caddyfile && systemctl restart caddy
Tekshirish: curl -s https://sklad.clary.uz/api/v1/health
EOF
