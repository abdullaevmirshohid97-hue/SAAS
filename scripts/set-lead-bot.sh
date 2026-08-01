#!/usr/bin/env bash
# =============================================================================
# Clary Care — lid ogohlantirish botini sozlash (serverda ishlatiladi)
#
# Telegram tokenni oladi, chat ID'ni AVTOMATIK topadi (siz botga /start
# bosgan bo'lishingiz kerak), .env.local ga yozadi, pm2 restart qiladi va
# test xabar yuboradi.
#
# XAVFSIZLIK: .env.local avval zaxiralanadi (.env.local.bak-<vaqt>).
# Faqat TELEGRAM_LEADS_* qatorlari o'zgaradi, boshqasiga tegilmaydi.
#
# Ishlatish:
#   bash scripts/set-lead-bot.sh <BOT_TOKEN>
#   bash scripts/set-lead-bot.sh <BOT_TOKEN> <CHAT_ID>   # chat ID'ni o'zingiz bersangiz
# =============================================================================
set -uo pipefail

APP="${PM2_APP:-clary-api}"
ENV_FILE="${ENV_FILE:-/opt/clary/.env.local}"
TOKEN="${1:-}"
CHAT="${2:-}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; BLD=$'\033[1m'; NC=$'\033[0m'
ok(){ echo "  ${GRN}✓${NC} $*"; }; bad(){ echo "  ${RED}✗${NC} $*"; }
warn(){ echo "  ${YEL}!${NC} $*"; }; info(){ echo "  ${DIM}·${NC} $*"; }

[ -z "$TOKEN" ] && { echo "Ishlatish: bash $0 <BOT_TOKEN> [CHAT_ID]"; exit 1; }
[ -f "$ENV_FILE" ] || { bad "env fayl topilmadi: $ENV_FILE"; exit 1; }

echo "${BLD}=== Lid boti sozlash ===${NC}"

# --- 1. Token haqiqiymi ----------------------------------------------------
BOT="$(curl -s --max-time 20 "https://api.telegram.org/bot${TOKEN}/getMe" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j={};try{j=JSON.parse(s)}catch{}
    console.log(j.ok?("OK|@"+j.result.username):("ERR|"+(j.description||"nomalum")));
  })')"
if [ "${BOT%%|*}" != "OK" ]; then bad "token yaroqsiz: ${BOT#*|}"; exit 1; fi
ok "bot: ${BOT#*|}"

# --- 2. Chat ID (berilmagan bo'lsa getUpdates'dan topamiz) -----------------
if [ -z "$CHAT" ]; then
  RES="$(curl -s --max-time 20 "https://api.telegram.org/bot${TOKEN}/getUpdates" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j={};try{j=JSON.parse(s)}catch{console.log("ERR|javob o‘qilmadi");return}
      if(!j.ok){console.log("ERR|"+j.description);return}
      const m=new Map();
      for(const x of (j.result||[])){
        const c=(x.message||x.channel_post||{}).chat;
        if(c) m.set(c.id,(c.title||[c.first_name,c.last_name].filter(Boolean).join(" "))+" ["+c.type+"]");
      }
      if(!m.size){console.log("BOSH");return}
      // Har chat alohida qatorda: "<id> <nom>" — bash uchun eng ishonchli shakl.
      for(const [i,n] of m) console.log(i+" "+n);
    })')"
  case "${RES%%|*}" in
    BOSH)
      bad "Botga hech kim yozmagan — chat ID topilmadi"
      info "Telegram'da ${BOT#*|} ni oching va ${BLD}START${NC} tugmasini bosing,"
      info "keyin shu skriptni qayta ishga tushiring. Hech narsa o'zgartirilmadi."
      exit 1 ;;
    ERR) bad "getUpdates xatosi: ${RES#*|}"; exit 1 ;;
  esac
  COUNT="$(printf '%s\n' "$RES" | grep -c .)"
  if [ "$COUNT" -gt 1 ]; then
    warn "Bir nechta chat topildi — qaysi biriga yuborilsin?"
    printf '%s\n' "$RES" | sed 's/^/    /'
    info "Tanlab qayta ishga tushiring: bash $0 <TOKEN> <CHAT_ID>"
    exit 1
  fi
  CHAT="$(printf '%s\n' "$RES" | awk '{print $1}')"
  CHAT_NAME="$(printf '%s\n' "$RES" | cut -d' ' -f2-)"
  ok "chat topildi: $CHAT ($CHAT_NAME)"
else
  ok "chat ID berildi: $CHAT"
fi

# --- 3. Chat haqiqatan yetib boradimi --------------------------------------
REACH="$(curl -s --max-time 20 "https://api.telegram.org/bot${TOKEN}/getChat?chat_id=${CHAT}" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j={};try{j=JSON.parse(s)}catch{}
    console.log(j.ok?"OK|":"ERR|"+(j.description||"nomalum"));
  })')"
[ "${REACH%%|*}" = "OK" ] || { bad "chat'ga yetib bo'lmaydi: ${REACH#*|}"; exit 1; }
ok "chat yetib boradi"

# --- 4. Zaxira + env yozish ------------------------------------------------
BAK="${ENV_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
cp -p "$ENV_FILE" "$BAK" || { bad "zaxira olinmadi — to'xtatildi"; exit 1; }
ok "zaxira: $BAK"

TMP="$(mktemp)"
# Eski TELEGRAM_LEADS_* qatorlarini olib tashlaymiz, qolganiga TEGILMAYDI.
grep -vE '^[[:space:]]*TELEGRAM_LEADS_(BOT_TOKEN|CHAT_ID)=' "$ENV_FILE" > "$TMP"
{
  echo ""
  echo "# Lid ogohlantirishi — set-lead-bot.sh ($(date +%Y-%m-%d))"
  echo "TELEGRAM_LEADS_BOT_TOKEN=${TOKEN}"
  echo "TELEGRAM_LEADS_CHAT_ID=${CHAT}"
} >> "$TMP"

# Faylni almashtirishdan oldin qator sonini solishtiramiz (xavfsizlik).
OLD_N="$(wc -l < "$ENV_FILE")"; NEW_N="$(wc -l < "$TMP")"
if [ "$NEW_N" -lt "$OLD_N" ]; then
  bad "yangi fayl kichrayib ketdi ($OLD_N → $NEW_N) — to'xtatildi, zaxira joyida"
  rm -f "$TMP"; exit 1
fi
cat "$TMP" > "$ENV_FILE" && rm -f "$TMP"
chmod 600 "$ENV_FILE"
ok "env yozildi ($OLD_N → $NEW_N qator)"

# --- 5. Restart ------------------------------------------------------------
pm2 restart "$APP" --update-env >/dev/null 2>&1 && ok "$APP qayta ishga tushdi" \
  || { bad "pm2 restart bajarilmadi"; info "qo'lda: pm2 restart $APP --update-env"; }

# --- 6. Test xabar ---------------------------------------------------------
SENT="$(curl -s --max-time 20 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "{\"chat_id\":\"${CHAT}\",\"text\":\"✅ Clary — lid ogohlantirishi yoqildi. Bundan buyon saytdan kelgan har bir lid shu yerga tushadi.\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j={};try{j=JSON.parse(s)}catch{};console.log(j.ok?"OK|":"ERR|"+(j.description||"nomalum"))})')"
if [ "${SENT%%|*}" = "OK" ]; then
  ok "${BLD}TEST XABAR YUBORILDI — Telegram'ni oching${NC}"
else
  bad "test xabar ketmadi: ${SENT#*|}"
fi

echo
echo "  Tekshirish: bash /opt/clary/scripts/check-lead-alerts.sh"
echo "  Qaytarish:  cp $BAK $ENV_FILE && pm2 restart $APP --update-env"
echo
