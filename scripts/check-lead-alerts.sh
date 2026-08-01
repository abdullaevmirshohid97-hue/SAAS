#!/usr/bin/env bash
# =============================================================================
# Clary Care — Lid ogohlantirish tashxisi (serverda ishlatiladi)
#
# "Websaytdan lid keldi, lekin menga xabar kelmadi" muammosini uchidan-uchiga
# tekshiradi: env bormi → token haqiqiymi → chat yetib boradimi → DB'da nechta
# lid javobsiz turibdi.
#
# FAQAT O'QIYDI. Hech narsani o'zgartirmaydi, hech kimga xabar yubormaydi.
# Haqiqiy test xabar yuborish uchun --send bayrog'ini qo'shing.
#
# Ishlatish (server SSH):
#   bash /opt/clary/scripts/check-lead-alerts.sh
#   bash /opt/clary/scripts/check-lead-alerts.sh --send    # test xabar ham yuboradi
#
# Sirlar hech qachon to'liq chop etilmaydi — faqat niqoblangan ko'rinishda.
# =============================================================================
set -uo pipefail

APP="${PM2_APP:-clary-api}"
ENV_FILE="${ENV_FILE:-/opt/clary/.env.local}"
SEND_TEST=0
[ "${1:-}" = "--send" ] && SEND_TEST=1

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; BLD=$'\033[1m'; NC=$'\033[0m'
ok()   { echo "  ${GRN}✓${NC} $*"; }
bad()  { echo "  ${RED}✗${NC} $*"; }
warn() { echo "  ${YEL}!${NC} $*"; }
info() { echo "  ${DIM}·${NC} $*"; }
hdr()  { echo; echo "${BLD}$*${NC}"; }

# Sirni niqoblab ko'rsatadi: birinchi 6 + oxirgi 4 belgi.
mask() {
  local v="${1:-}"
  local n=${#v}
  if [ "$n" -eq 0 ]; then echo "(bo'sh)"
  elif [ "$n" -le 12 ]; then echo "***(${n} belgi)"
  else echo "${v:0:6}…${v: -4} (${n} belgi)"
  fi
}

# Placeholder qiymatni aniqlaydi (.env.example'dan ko'chirilgan <KEY> kabi).
is_placeholder() {
  case "${1:-}" in
    *"<"*">"*|"changeme"|"TODO"|"") return 0 ;;
    *) return 1 ;;
  esac
}

echo "${BLD}=== Clary — lid ogohlantirish tashxisi ===${NC}"
echo "${DIM}$(date '+%Y-%m-%d %H:%M:%S %Z') · host: $(hostname)${NC}"

# ---------------------------------------------------------------------------
# 1) pm2 jarayoni tirikmi
# ---------------------------------------------------------------------------
hdr "1) pm2 jarayoni"
if ! command -v pm2 >/dev/null 2>&1; then
  bad "pm2 topilmadi — noto'g'ri serverdamiz yoki PATH buzuq"
  exit 1
fi
PM2_LINE="$(pm2 jlist 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let a=[];try{a=JSON.parse(s)}catch{}
    const p=a.find(x=>x.name===process.argv[1]);
    if(!p){console.log("YOQ");return}
    console.log([p.pm2_env.status,p.pm2_env.restart_time,
      Math.round((Date.now()-p.pm2_env.pm_uptime)/60000)+"min"].join("|"));
  })' "$APP" 2>/dev/null)"
if [ "$PM2_LINE" = "YOQ" ] || [ -z "$PM2_LINE" ]; then
  bad "'$APP' pm2'da topilmadi"
  pm2 list
  exit 1
fi
IFS='|' read -r P_STATUS P_RESTARTS P_UPTIME <<< "$PM2_LINE"
[ "$P_STATUS" = "online" ] && ok "$APP: online (uptime ${P_UPTIME}, restart ${P_RESTARTS})" \
                           || bad "$APP: $P_STATUS ← ishlamayapti!"

# ---------------------------------------------------------------------------
# 2) Env: fayl vs pm2 xotirasi
#    MUHIM — pm2 env'ni keshlaydi. Faylni tahrirlab restart --update-env
#    qilinmasa, ilova ESKI qiymat bilan ishlashda davom etadi.
# ---------------------------------------------------------------------------
hdr "2) Env manbalari"

read_file_env() {
  [ -f "$ENV_FILE" ] || { echo ""; return; }
  sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n1 | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}
read_pm2_env() {
  pm2 jlist 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let a=[];try{a=JSON.parse(s)}catch{}
      const p=a.find(x=>x.name===process.argv[1]);
      console.log((p&&p.pm2_env&&p.pm2_env[process.argv[2]])||"");
    })' "$APP" "$1" 2>/dev/null
}

if [ -f "$ENV_FILE" ]; then ok "env fayl: $ENV_FILE"; else warn "env fayl topilmadi: $ENV_FILE"; fi

# MUHIM: ilova env'ni pm2'dan EMAS, o'zi fayldan yuklaydi —
# app.module.ts: ConfigModule.forRoot({ envFilePath: '../../.env.local' }).
# Bu yo'l jarayonning cwd'siga nisbatan hisoblanadi, shuning uchun cwd muhim.
PM_CWD="$(pm2 jlist 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let a=[];try{a=JSON.parse(s)}catch{}
    const p=a.find(x=>x.name===process.argv[1]);
    console.log((p&&p.pm2_env&&p.pm2_env.pm_cwd)||"");
  })' "$APP" 2>/dev/null)"
if [ -n "$PM_CWD" ]; then
  RESOLVED="$(cd "$PM_CWD" 2>/dev/null && cd ../.. 2>/dev/null && pwd)/.env.local"
  info "jarayon cwd: $PM_CWD"
  if [ "$RESOLVED" = "$ENV_FILE" ]; then
    ok "ilova '../../.env.local' ni to'g'ri hal qiladi → $RESOLVED"
  else
    bad "ilova boshqa faylni qidiradi: $RESOLVED (kerak: $ENV_FILE)"
    info "→ env fayldagi qiymatlar ilovaga UMUMAN yetib bormaydi"
  fi
fi

VARS="TELEGRAM_LEADS_BOT_TOKEN TELEGRAM_LEADS_CHAT_ID TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID PLATFORM_RESEND_API_KEY PLATFORM_RESEND_FROM SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY"
DRIFT=0
printf "  %-30s %-26s %s\n" "O'ZGARUVCHI" "FAYLDA" "PM2 XOTIRASIDA"
for v in $VARS; do
  fv="$(read_file_env "$v")"; pv="$(read_pm2_env "$v")"
  mark=""
  [ "$fv" != "$pv" ] && { mark=" ${YEL}← FARQ${NC}"; DRIFT=1; }
  printf "  %-30s %-26s %s%s\n" "$v" "$(mask "$fv")" "$(mask "$pv")" "$mark"
done
if [ "$DRIFT" = "1" ]; then
  info "Fayl va pm2 xotirasi farq qiladi. Bu O'Z-O'ZIDAN nosozlik EMAS —"
  info "ilova env'ni ConfigModule orqali fayldan yuklaydi, pm2 injektsiyasidan emas."
  info "Muhimi: FAYLDAGI qiymat to'g'ri bo'lsin va restart qilingan bo'lsin."
  info "Fayl tahrirlangandan keyin: ${BLD}pm2 restart $APP --update-env${NC}"
  info "(pm2 delete QILMANG — barcha env yo'qoladi)"
fi

# ---------------------------------------------------------------------------
# 3) Kod qaysi qiymatni ishlatadi (notify-lead.ts dagi fallback bilan bir xil)
#
# Qiymat ikki manbadan kelishi mumkin: pm2 injektsiyasi YOKI ilovaning o'zi
# yuklagan .env.local. Shuning uchun pm2 bo'sh bo'lsa faylga qaraymiz —
# aks holda "yo'q" deb noto'g'ri xulosa chiqadi.
# ---------------------------------------------------------------------------
hdr "3) Lid xabari uchun amaldagi sozlama"
read_effective() { local v; v="$(read_pm2_env "$1")"; [ -z "$v" ] && v="$(read_file_env "$1")"; echo "$v"; }

TOKEN="$(read_effective TELEGRAM_LEADS_BOT_TOKEN)"; TOKEN_SRC="TELEGRAM_LEADS_BOT_TOKEN"
[ -z "$TOKEN" ] && { TOKEN="$(read_effective TELEGRAM_BOT_TOKEN)"; TOKEN_SRC="TELEGRAM_BOT_TOKEN (fallback)"; }
CHAT="$(read_effective TELEGRAM_LEADS_CHAT_ID)"; CHAT_SRC="TELEGRAM_LEADS_CHAT_ID"
[ -z "$CHAT" ] && { CHAT="$(read_effective TELEGRAM_CHAT_ID)"; CHAT_SRC="TELEGRAM_CHAT_ID (fallback)"; }

if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
  bad "Token yoki chat ID yo'q → lid DB'ga yoziladi, lekin XABAR KELMAYDI"
  info "Yechim: $ENV_FILE ga TELEGRAM_LEADS_BOT_TOKEN va TELEGRAM_LEADS_CHAT_ID qo'shing,"
  info "keyin: pm2 restart $APP --update-env"
elif is_placeholder "$TOKEN" || is_placeholder "$CHAT"; then
  bad "Qiymat placeholder ko'rinishida (<...>) — haqiqiy emas"
else
  ok "token manbasi: $TOKEN_SRC → $(mask "$TOKEN")"
  ok "chat manbasi:  $CHAT_SRC → $CHAT"
fi

# ---------------------------------------------------------------------------
# 4) Telegram'ni haqiqatda tekshirish (o'qish amallari)
# ---------------------------------------------------------------------------
hdr "4) Telegram tekshiruvi"
tg_ok() { node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j={};try{j=JSON.parse(s)}catch{}
    if(j.ok){console.log("OK|"+(j.result&&(j.result.username||j.result.title||j.result.first_name)||""))}
    else{console.log("ERR|"+(j.description||"nomalum xato"))}
  })'; }

if [ -n "$TOKEN" ] && ! is_placeholder "$TOKEN"; then
  R="$(curl -s --max-time 15 "https://api.telegram.org/bot${TOKEN}/getMe" | tg_ok)"
  if [ "${R%%|*}" = "OK" ]; then ok "bot tirik: @${R#*|}"; else bad "token yaroqsiz: ${R#*|}"; fi

  if [ -n "$CHAT" ] && ! is_placeholder "$CHAT"; then
    R="$(curl -s --max-time 15 "https://api.telegram.org/bot${TOKEN}/getChat?chat_id=${CHAT}" | tg_ok)"
    if [ "${R%%|*}" = "OK" ]; then
      ok "chat yetib boradi: ${R#*|} (id: $CHAT)"
      if [ "$SEND_TEST" = "1" ]; then
        R="$(curl -s --max-time 15 -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
             -H 'Content-Type: application/json' \
             -d "{\"chat_id\":\"${CHAT}\",\"text\":\"🧪 Clary lid ogohlantirish testi — $(date '+%H:%M')\"}" | tg_ok)"
        [ "${R%%|*}" = "OK" ] && ok "TEST XABAR YUBORILDI — Telegram'ni oching" \
                              || bad "test xabar ketmadi: ${R#*|}"
      else
        info "haqiqiy xabar yuborish uchun: bash $0 --send"
      fi
    else
      bad "chat'ga yeta olmaydi: ${R#*|}"
      info "Sabab odatda: botga /start bosilmagan, yoki chat_id xato (guruh uchun manfiy: -100…)"
    fi
  fi
else
  warn "token yo'q — Telegram tekshiruvi o'tkazib yuborildi"
fi

# ---------------------------------------------------------------------------
# 5) Email (Resend) — kalit va domen holati. Email YUBORMAYDI.
# ---------------------------------------------------------------------------
hdr "5) Email (Resend) sozlamasi"
RK="$(read_effective PLATFORM_RESEND_API_KEY)"
[ -z "$RK" ] && RK="$(read_effective RESEND_API_KEY)"
if [ -z "$RK" ]; then
  warn "PLATFORM_RESEND_API_KEY yo'q → super-admin'dagi email yuborish ishlamaydi"
elif is_placeholder "$RK"; then
  bad "Resend kaliti placeholder ($(mask "$RK")) — haqiqiy emas"
else
  curl -s --max-time 15 -H "Authorization: Bearer ${RK}" https://api.resend.com/domains | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j={};try{j=JSON.parse(s)}catch{console.log("  ✗ javob o‘qilmadi");return}
      // "restricted to only send emails" = kalit YAROQLI, shunchaki domenlarni
      // o‘qish huquqi yo‘q (sending-only). Bu to‘g‘ri va xavfsiz sozlama.
      if(j.message&&/restricted/i.test(j.message)){
        console.log("  ✓ kalit yaroqli — yuborish huquqi bor (sending-only, to‘g‘ri sozlama)");
        console.log("  · domen holatini bu kalit bilan tekshirib bo‘lmaydi — resend.com/domains ga qarang");
        return;
      }
      if(j.message&&!j.data){console.log("  ✗ kalit rad etildi: "+j.message);return}
      const ds=j.data||[];
      if(!ds.length){console.log("  ! kalit ishlaydi, lekin domen qo‘shilmagan — jo‘natish bloklanadi");return}
      console.log("  ✓ kalit ishlaydi");
      for(const d of ds){
        const good=d.status==="verified";
        console.log("    "+(good?"✓":"✗")+" "+d.name+" — "+d.status+(good?"":"  ← tasdiqlanmagan, email ketmaydi"));
      }
    })'
fi

# ---------------------------------------------------------------------------
# 6) DB: javobsiz turgan lidlar
# ---------------------------------------------------------------------------
hdr "6) Javobsiz lidlar (DB)"
SB_URL="$(read_effective SUPABASE_URL)"; SB_KEY="$(read_effective SUPABASE_SERVICE_ROLE_KEY)"
if [ -z "$SB_URL" ] || [ -z "$SB_KEY" ]; then
  warn "SUPABASE_URL / SERVICE_ROLE_KEY yo'q — DB tekshiruvi o'tkazib yuborildi"
else
  for T in sales_leads leads; do
    curl -s --max-time 20 \
      "${SB_URL}/rest/v1/${T}?status=eq.new&select=*&order=created_at.desc&limit=10" \
      -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const t=process.argv[1];
        let a=[];try{a=JSON.parse(s)}catch{console.log("  ✗ "+t+": javob o‘qilmadi");return}
        if(!Array.isArray(a)){console.log("  ✗ "+t+": "+(a.message||"xato"));return}
        if(!a.length){console.log("  ✓ "+t+": javobsiz lid yo‘q");return}
        console.log("  ! "+t+": "+a.length+" ta javobsiz (status=new)");
        for(const r of a){
          const kun=Math.floor((Date.now()-new Date(r.created_at))/864e5);
          console.log("     · "+(r.full_name||r.name||"—")+" · "+(r.phone||r.email||"—")
            +" · "+(r.source||"—")+" · "+kun+" kun oldin");
        }
      })' "$T"
  done
fi

# ---------------------------------------------------------------------------
# 7) Log'da lid izlari
# ---------------------------------------------------------------------------
hdr "7) So'nggi log'lardagi lid izlari"
HITS="$(pm2 logs "$APP" --lines 400 --nostream 2>/dev/null \
        | grep -iE "NotifyLead|Lid keldi|lead insert|telegram" | tail -n 10)"
if [ -n "$HITS" ]; then echo "$HITS" | sed 's/^/  /'; else info "so'nggi 400 qatorda lidga oid yozuv yo'q"; fi

hdr "Xulosa"
echo "  Xabar kelmasa eng ko'p uchraydigan 3 sabab:"
echo "    1. env yo'q yoki pm2 keshida eski → pm2 restart $APP --update-env"
echo "    2. botga hech kim /start bosmagan → 4-bo'limda 'chat'ga yeta olmaydi'"
echo "    3. kod eski (fallback'siz versiya) → bash deploy.sh api"
echo
