#!/usr/bin/env bash
# =============================================================================
# Clary — hisobot botini serverga o'rnatish + deploy (bitta urinishda)
# =============================================================================
# Nima qiladi (shu tartibda, har qadamda tekshirib):
#   1. Tokenni Telegram'da tasdiqlaydi (getMe) — xato token bilan deploy qilmaydi
#   2. Botda boshqa webhook bor-yo'qligini tekshiradi (bir botda faqat bittasi)
#   3. TELEGRAM_APP_BOT_TOKEN ni /opt/clary/.env.local ga yozadi (zaxira bilan)
#   4. deploy.sh ni ishga tushiradi
#   5. API tayyor bo'lguncha kutadi
#   6. Webhook + bot ichki sozlamalarini o'rnatadi
#   7. Yakuniy tekshiruv: webhook o'rnatilganini tasdiqlaydi
#
# Ishlatish (server SSH):
#   bash /opt/clary/scripts/setup-bot.sh                 # token so'raladi
#   bash /opt/clary/scripts/setup-bot.sh <TOKEN>         # token argument bilan
#   bash /opt/clary/scripts/setup-bot.sh <TOKEN> api     # faqat backend deploy
#   SKIP_DEPLOY=1 bash /opt/clary/scripts/setup-bot.sh   # deploy'siz (token yangilash)
#
# Token EKRANGA CHIQARILMAYDI va bash tarixiga tushmasligi uchun argumentsiz
# ishlatish tavsiya etiladi.
# =============================================================================
set -euo pipefail

REPO="${CLARY_REPO:-/opt/clary}"
ENV_FILE="${CLARY_ENV_FILE:-$REPO/.env.local}"
SCOPE="${2:-default}"

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

command -v curl >/dev/null || die "curl topilmadi"
command -v node >/dev/null || die "node topilmadi"

# --- 1) Token ---------------------------------------------------------------
TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  printf 'Bot tokenini kiriting (ekranda ko‘rinmaydi): '
  read -r -s TOKEN
  printf '\n'
fi
[ -n "$TOKEN" ] || die "Token bo‘sh"

# Telegram javobidan maydon olish — token log'ga tushmasin deb node bilan.
tg() { # tg <method> [json-body]
  local method="$1" body="${2:-}"
  if [ -n "$body" ]; then
    curl -s --max-time 25 -H 'Content-Type: application/json; charset=utf-8' \
      -d "$body" "https://api.telegram.org/bot${TOKEN}/${method}"
  else
    curl -s --max-time 25 "https://api.telegram.org/bot${TOKEN}/${method}"
  fi
}
jget() { node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
    try{const j=JSON.parse(d);
      if(process.argv[1]==="__ok__"){console.log(j.ok?"1":"0");return;}
      if(process.argv[1]==="__err__"){console.log(j.description||"");return;}
      const v=process.argv[1].split(".").reduce((a,k)=>a&&a[k],j);
      console.log(v===undefined||v===null?"":String(v));
    }catch{console.log("")}
  })' "$1"; }

log "1/7 Tokenni tekshirish"
ME="$(tg getMe)"
[ "$(printf '%s' "$ME" | jget __ok__)" = "1" ] \
  || die "Token yaroqsiz: $(printf '%s' "$ME" | jget __err__)"
BOT_USERNAME="$(printf '%s' "$ME" | jget result.username)"
ok "Bot: @${BOT_USERNAME}"

# --- 2) Mavjud webhook ------------------------------------------------------
log "2/7 Mavjud webhook"
WH="$(tg getWebhookInfo)"
CUR_URL="$(printf '%s' "$WH" | jget result.url)"
API_URL="$(grep -E '^API_PUBLIC_URL=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)"
API_URL="${API_URL:-https://api.clary.uz}"
TARGET_WH="${API_URL%/}/api/v1/telegram-reports/app-webhook"

if [ -n "$CUR_URL" ] && [ "$CUR_URL" != "$TARGET_WH" ]; then
  warn "Botda BOSHQA webhook bor: $CUR_URL"
  warn "Davom etsak, o‘sha oqim ishlamay qoladi (bir botda faqat bitta webhook)."
  printf '  Davom etilsinmi? (ha/yo‘q): '
  read -r ANSWER
  case "$ANSWER" in ha|HA|y|yes) ;; *) die "Bekor qilindi" ;; esac
elif [ -n "$CUR_URL" ]; then
  ok "Webhook allaqachon shu serverda"
else
  ok "Webhook bo‘sh — xavfsiz"
fi

# --- 3) Env ----------------------------------------------------------------
log "3/7 Tokenni env faylga yozish"
[ -d "$REPO" ] || die "Repo topilmadi: $REPO"
if [ ! -f "$ENV_FILE" ]; then
  warn "$ENV_FILE yo‘q edi — yaratildi"
  touch "$ENV_FILE"
else
  BACKUP="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BACKUP"
  ok "Zaxira: $BACKUP"
fi

# Eski qatorni olib tashlab, yangisini qo'shamiz (sed EMAS — tokendagi maxsus
# belgilar sed ifodasini buzishi mumkin).
TMP="$(mktemp)"
grep -v -E '^[[:space:]]*TELEGRAM_APP_BOT_TOKEN=' "$ENV_FILE" > "$TMP" || true
# Fayl oxirida yangi qator bo'lishini kafolatlaymiz.
[ -s "$TMP" ] && [ "$(tail -c1 "$TMP" | wc -l)" -eq 0 ] && printf '\n' >> "$TMP"
{
  printf '\n# Clary hisobot boti (@%s) — setup-bot.sh %s\n' "$BOT_USERNAME" "$(date +%F)"
  printf 'TELEGRAM_APP_BOT_TOKEN=%s\n' "$TOKEN"
} >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "TELEGRAM_APP_BOT_TOKEN yozildi (fayl huquqi 600)"

# --- 4) Deploy --------------------------------------------------------------
if [ "${SKIP_DEPLOY:-}" = "1" ]; then
  log "4/7 Deploy o‘tkazib yuborildi (SKIP_DEPLOY=1)"
  # Token o'zgargani uchun API baribir qayta yuklanishi kerak.
  pm2 restart clary-api >/dev/null && ok "clary-api qayta ishga tushdi"
else
  log "4/7 Deploy ($SCOPE)"
  bash "$REPO/scripts/deploy.sh" "$SCOPE"
fi

# --- 5) API tayyorligi ------------------------------------------------------
log "5/7 API tayyorligini kutish"
READY=0
for _ in $(seq 1 45); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:4000/api/v1/health || true)"
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
[ "$READY" = "1" ] || die "API 45 soniyada javob bermadi — 'pm2 logs clary-api' ni ko‘ring"
ok "API tayyor"

# --- 6) Webhook + bot sozlamalari ------------------------------------------
log "6/7 Webhook va bot sozlamalari"
# Webhook secret serverdagi kod bilan BIR XIL hisoblanadi:
# sha256(token) hex, birinchi 32 belgi (telegram-reports appSecret()).
SECRET="$(printf '%s' "$TOKEN" | node -e '
  const c=require("crypto");let d="";
  process.stdin.on("data",x=>d+=x).on("end",()=>
    console.log(c.createHash("sha256").update(d).digest("hex").slice(0,32)));')"

BODY="$(node -e '
  console.log(JSON.stringify({
    url: process.argv[1],
    secret_token: process.argv[2],
    allowed_updates: ["message","callback_query"],
    drop_pending_updates: true,
  }));' "$TARGET_WH" "$SECRET")"
R="$(tg setWebhook "$BODY")"
[ "$(printf '%s' "$R" | jget __ok__)" = "1" ] \
  || die "setWebhook xato: $(printf '%s' "$R" | jget __err__)"
ok "Webhook: $TARGET_WH"

CMDS='{"commands":[
 {"command":"start","description":"Boshlash / menyu"},
 {"command":"royxat","description":"Royxatdan otish"},
 {"command":"hisobot","description":"Hisobot"},
 {"command":"kassa","description":"Kassadagi joriy pul"},
 {"command":"holat","description":"Ulanish holati"},
 {"command":"uzish","description":"Ulanishni uzish"}]}'
tg setMyCommands "$CMDS" >/dev/null && ok "Buyruqlar ro‘yxati o‘rnatildi"
tg setChatMenuButton '{"menu_button":{"type":"commands"}}' >/dev/null && ok "Menyu tugmasi yoqildi"

# --- 7) Yakuniy tekshiruv ---------------------------------------------------
log "7/7 Tekshiruv"
WH2="$(tg getWebhookInfo)"
NEW_URL="$(printf '%s' "$WH2" | jget result.url)"
LAST_ERR="$(printf '%s' "$WH2" | jget result.last_error_message)"
[ "$NEW_URL" = "$TARGET_WH" ] || die "Webhook o‘rnatilmadi (hozirgi: '$NEW_URL')"
ok "Webhook tasdiqlandi"
[ -z "$LAST_ERR" ] || warn "Telegram oxirgi xatosi: $LAST_ERR"

if pm2 logs clary-api --lines 80 --nostream 2>/dev/null | grep -qi 'platforma backup jadvali'; then
  ok "Yangi kod ishlayapti (backup jadvali log'da)"
else
  warn "Log'da 'platforma backup jadvali' topilmadi — kod eski bo‘lishi mumkin"
fi

printf '\n\033[1;32m✔ TAYYOR — @%s ishga tushdi\033[0m\n' "$BOT_USERNAME"
cat <<EOF

Keyingi qadamlar:
  1. Telegram'da @${BOT_USERNAME} ni oching va /start yuboring — menyu chiqishi kerak
  2. admin.clary.uz → Telegram botlar → "Botga super-admin ulanish"
     (shundan keyin har bir yangi ro'yxatdan o'tish darhol sizga tushadi)
  3. Klinikada: Sozlamalar → Integratsiyalar → "Clary hisobot boti" → kod olish

Token almashtirish kerak bo'lsa (@BotFather → /revoke):
  SKIP_DEPLOY=1 bash $REPO/scripts/setup-bot.sh
EOF
