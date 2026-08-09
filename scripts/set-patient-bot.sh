#!/usr/bin/env bash
# =============================================================================
# Bemor Telegram botini sozlash — TELEGRAM_PATIENT_BOT_TOKEN
# =============================================================================
# Ishlatish (serverda):
#   bash /opt/clary/scripts/set-patient-bot.sh <BOT_TOKEN>
#
# Token ARGUMENT sifatida beriladi — hech qachon repoga yozilmaydi.
# Skript .env.local ning ZAXIRASINI oladi va FAQAT TELEGRAM_PATIENT_BOT_TOKEN
# qatoriga tegadi.
#
# ⚠️ pm2 delete QILMAYDI — `--update-env` bilan restart qiladi. (Ilgari
# `pm2 delete` qilinganda ilova keshdagi eski env'ni yo'qotib, "Invalid API key"
# bilan turib qolgan edi.)
# =============================================================================
set -euo pipefail

TOKEN="${1:-}"
ENV_FILE="${CLARY_ENV:-/opt/clary/.env.local}"
APP="${CLARY_PM2_APP:-clary-api}"

red()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
inf()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

if [ -z "$TOKEN" ]; then
  red "Token berilmadi."
  echo "Ishlatish: bash $0 <BOT_TOKEN>"
  exit 1
fi

[ -f "$ENV_FILE" ] || { red "$ENV_FILE topilmadi"; exit 1; }

# --- 1. Token haqiqiyligini tekshirish -------------------------------------
inf "Telegram'da tokenni tekshirish (getMe)"
ME="$(curl -s --max-time 15 "https://api.telegram.org/bot${TOKEN}/getMe" || true)"
case "$ME" in
  *'"ok":true'*) : ;;
  *) red "Token yaroqsiz. Telegram javobi: $ME"; exit 1 ;;
esac
USERNAME="$(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"
# DIQQAT: ${VAR:-...} ichida apostrof QO'YMANG — bash uni ochiq qo'shtirnoq
# deb o'qib, butun skriptni "unexpected EOF" bilan yiqitadi.
grn "Bot: @${USERNAME:-?}"

# --- 2. Klinika boti bilan to'qnashuv tekshiruvi ---------------------------
# Bu ENG MUHIM tekshiruv: TELEGRAM_APP_BOT_TOKEN klinika boti va unga klinika
# chatlari bog'langan. Agar bir xil bot bo'lsa, webhook almashib, klinikalarning
# hisobot/kassa boti ishdan chiqadi.
APP_TOKEN="$(sed -n 's/^TELEGRAM_APP_BOT_TOKEN=//p' "$ENV_FILE" | head -1 | tr -d "\"' \r")"
if [ -n "$APP_TOKEN" ] && [ "$APP_TOKEN" = "$TOKEN" ]; then
  red "TO'XTA: bu token allaqachon TELEGRAM_APP_BOT_TOKEN (klinika boti) sifatida ishlatilyapti."
  red "Bir bot ikkala rolda ishlay olmaydi — bemor uchun @BotFather'dan ALOHIDA bot oching."
  exit 1
fi

# --- 3. Zaxira + yozish ----------------------------------------------------
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
inf "Zaxira: $BACKUP"

# Mavjud qatorni olib tashlab, yangisini qo'shamiz (faqat shu kalitga tegadi).
TMP="$(mktemp)"
grep -v '^TELEGRAM_PATIENT_BOT_TOKEN=' "$ENV_FILE" > "$TMP" || true
printf 'TELEGRAM_PATIENT_BOT_TOKEN=%s\n' "$TOKEN" >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"
grn "TELEGRAM_PATIENT_BOT_TOKEN yozildi"

# PUBLIC_API_URL busiz webhook o'rnatilmaydi — ogohlantiramiz.
if ! grep -q '^PUBLIC_API_URL=' "$ENV_FILE"; then
  red "DIQQAT: PUBLIC_API_URL yo'q — webhook o'rnatilmaydi."
  red "Qo'shing: echo 'PUBLIC_API_URL=https://api.clary.uz' >> $ENV_FILE"
fi

# --- 4. Restart ------------------------------------------------------------
inf "pm2 restart $APP --update-env"
pm2 restart "$APP" --update-env
pm2 save || true

# --- 5. Tasdiqlash ---------------------------------------------------------
inf "Webhook o'rnatilishini kutamiz (ilova ko'tarilgach avtomatik)"
for i in $(seq 1 20); do
  sleep 2
  WH="$(curl -s --max-time 10 "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" || true)"
  case "$WH" in
    *'telegram-patient/webhook'*)
      grn "Webhook tayyor ✔"
      printf '%s\n' "$WH"
      echo
      grn "Endi Telegram'da @${USERNAME} ni oching va /start bosing."
      exit 0 ;;
  esac
done

red "Webhook 40 soniyada o'rnatilmadi. Tekshiring:"
echo "  pm2 logs $APP --lines 50 | grep -i 'bemor boti'"
echo "  (kod deploy qilinganmi? PUBLIC_API_URL bormi?)"
exit 1
