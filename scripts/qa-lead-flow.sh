#!/usr/bin/env bash
# =============================================================================
# Clary Care — lid oqimi QA testi (uchidan-uchiga)
#
# Saytdagi HAR BIR lid yo'lini jonli API'da sinaydi: formalar aynan qanday
# payload yuborsa, shundayligicha. Keyin lid DB'ga tushganini tekshiradi va
# test yozuvlarini O'ZI TOZALAYDI.
#
# Har `bash deploy.sh api` yoki `landing` dan keyin ishlating.
#
# Ishlatish:
#   bash scripts/qa-lead-flow.sh
#   API_BASE=http://localhost:4000 bash scripts/qa-lead-flow.sh   # to'g'ridan-to'g'ri
#   SKIP_CLEANUP=1 bash scripts/qa-lead-flow.sh                   # yozuvlar qolsin
#
# ESLATMA: /demo/spawn (instant demo) SINALMAYDI — u haqiqiy demo klinika va
# auth foydalanuvchi yaratadi, test uchun juda og'ir yon ta'sir.
# =============================================================================
set -uo pipefail

API_BASE="${API_BASE:-https://api.clary.uz}"
ENV_FILE="${ENV_FILE:-/opt/clary/.env.local}"
MARKER="QA-AVTO"          # test yozuvlari shu prefiks bilan belgilanadi
THROTTLE_LIMIT=3          # demo-request: 3 so'rov / 60 soniya

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; DIM=$'\033[2m'; BLD=$'\033[1m'; NC=$'\033[0m'
PASS=0; FAIL=0
ok(){ echo "  ${GRN}✓${NC} $*"; PASS=$((PASS+1)); }
bad(){ echo "  ${RED}✗${NC} $*"; FAIL=$((FAIL+1)); }
info(){ echo "  ${DIM}·${NC} $*"; }
hdr(){ echo; echo "${BLD}$*${NC}"; }

TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
CALLS=0

# UTF-8 buzilmasligi uchun payload FAYLGA yoziladi va --data-binary bilan
# yuboriladi. (Shell orqali to'g'ridan-to'g'ri yuborilsa tire "–" buziladi.)
post() {                     # post <yo'l> <fayl> → "<status>|<tana>"
  local path="$1" file="$2"
  local out; out="$(curl -s -w $'\n%{http_code}' -X POST "${API_BASE}${path}" \
    -H 'content-type: application/json; charset=utf-8' \
    --data-binary "@${file}" --max-time 25 2>/dev/null)"
  echo "$(echo "$out" | tail -n1)|$(echo "$out" | sed '$d' | tr -d '\n')"
}

# demo-request throttle'iga urilmaslik uchun har 3 so'rovdan keyin kutamiz.
throttle_guard() {
  CALLS=$((CALLS+1))
  if [ $((CALLS % THROTTLE_LIMIT)) -eq 0 ]; then
    info "throttle chegarasi (${THROTTLE_LIMIT}/60s) — 62 soniya kutilmoqda…"
    sleep 62
  fi
}

expect() {                   # expect <nom> <kutilgan> <natija>
  local nom="$1" kut="$2" res="$3"
  local st="${res%%|*}" tana="${res#*|}"
  if [ "$st" = "$kut" ]; then
    ok "$nom → HTTP $st"
  elif [ "$st" = "429" ]; then
    bad "$nom → 429 (throttle). Bir daqiqa kutib qayta ishga tushiring."
  else
    bad "$nom → HTTP $st (kutilgan $kut)"
    info "javob: $(echo "$tana" | cut -c1-160)"
  fi
}

echo "${BLD}=== Lid oqimi QA testi ===${NC}"
echo "${DIM}$(date '+%Y-%m-%d %H:%M:%S') · API: $API_BASE${NC}"

# ---------------------------------------------------------------------------
# Payloadlar — jonli formalar AYNAN shu maydonlarni yuboradi
# ---------------------------------------------------------------------------
cat > "$TMPD/book-demo.json" <<EOF
{"name":"$MARKER book-demo","clinic_name":"Shifo–Nur klinikasi","phone":"+998900000001","email":"","size":"1–5 xodim","notes":"avtomatik test","time_pref":"10:00"}
EOF
cat > "$TMPD/clinics.json" <<EOF
{"name":"$MARKER clinics","clinic_name":"QA Klinika","phone":"+998900000002","email":"","size":"6–20 xodim","source":"clinics-page","turnstileToken":"dev-skip"}
EOF
cat > "$TMPD/no-name.json" <<'EOF'
{"clinic_name":"Ismsiz","phone":"+998900000009"}
EOF
cat > "$TMPD/no-contact.json" <<EOF
{"name":"$MARKER aloqasiz","clinic_name":"X"}
EOF
cat > "$TMPD/contact.json" <<EOF
{"fullName":"$MARKER contact","email":"qa-avto@clary.uz","phone":"+998900000003","clinicName":"QA Regressiya","message":"Avtomatik regressiya testi — contact formasi ishlayaptimi.","turnstileToken":"dev-skip"}
EOF
cat > "$TMPD/exit-intent.json" <<EOF
{"name":"$MARKER exit","phone":"+998900000004","clinicName":"QA Exit","source":"exit_intent"}
EOF

# ---------------------------------------------------------------------------
# 1) Demo formalari (/book-demo, /clinics)
# ---------------------------------------------------------------------------
hdr "1) Demo so'rovi formalari"
expect "book-demo payload (snake_case, email bo'sh)" 201 "$(post /api/v1/public/demo-request "$TMPD/book-demo.json")"; throttle_guard
expect "clinics payload"                             201 "$(post /api/v1/public/demo-request "$TMPD/clinics.json")";   throttle_guard
expect "RAD: ism yo'q"                               422 "$(post /api/v1/public/demo-request "$TMPD/no-name.json")";   throttle_guard
expect "RAD: telefon/email yo'q"                     422 "$(post /api/v1/public/demo-request "$TMPD/no-contact.json")"

# ---------------------------------------------------------------------------
# 2) Kontakt formasi + ExitIntent
# ---------------------------------------------------------------------------
hdr "2) Kontakt formasi va ExitIntent"
expect "/contact (regressiya)" 201 "$(post /api/v1/public/contact "$TMPD/contact.json")"
expect "ExitIntent → /leads"   201 "$(post /api/v1/leads "$TMPD/exit-intent.json")"

# ---------------------------------------------------------------------------
# 3) DB tekshiruvi — lidlar haqiqatan tushdimi va UTF-8 buzilmadimi
# ---------------------------------------------------------------------------
hdr "3) DB tekshiruvi"
read_env(){ sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" 2>/dev/null | tail -n1 | tr -d '"'"'"; }
SB_URL="$(read_env SUPABASE_URL)"; SB_KEY="$(read_env SUPABASE_SERVICE_ROLE_KEY)"

if [ -z "$SB_URL" ] || [ -z "$SB_KEY" ]; then
  info "SUPABASE kalitlari topilmadi ($ENV_FILE) — DB tekshiruvi o'tkazib yuborildi"
  info "(serverdan tashqarida ishlatyapsizmi? ENV_FILE=... bilan ko'rsating)"
else
  for T in sales_leads leads; do
    FLD="full_name"; [ "$T" = "leads" ] && FLD="name"
    curl -s --max-time 20 "${SB_URL}/rest/v1/${T}?${FLD}=like.${MARKER}*&select=*" \
      -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" \
    | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const t=process.argv[1], kut=Number(process.argv[2]);
        let a=[];try{a=JSON.parse(s)}catch{console.log("  ✗ "+t+": javob o‘qilmadi");process.exit(1)}
        if(!Array.isArray(a)){console.log("  ✗ "+t+": "+(a.message||"xato"));process.exit(1)}
        if(a.length!==kut){console.log("  ✗ "+t+": "+a.length+" yozuv (kutilgan "+kut+")");process.exit(1)}
        console.log("  ✓ "+t+": "+a.length+" yozuv tushdi");
        // UTF-8 nazorati — tire (U+2013) saqlanganmi
        const bad=a.filter(r=>/�/.test(JSON.stringify(r)));
        if(bad.length){console.log("  ✗ "+t+": UTF-8 buzilgan matn topildi");process.exit(1)}
        console.log("  ✓ "+t+": UTF-8 toza (tire/belgilar saqlangan)");
      })' "$T" "$([ "$T" = "sales_leads" ] && echo 3 || echo 1)"
    [ $? -eq 0 ] && PASS=$((PASS+2)) || FAIL=$((FAIL+1))
  done
fi

# ---------------------------------------------------------------------------
# 4) Tozalash
# ---------------------------------------------------------------------------
hdr "4) Tozalash"
if [ "${SKIP_CLEANUP:-0}" = "1" ]; then
  info "SKIP_CLEANUP=1 — test yozuvlari DB'da qoldirildi"
  info "qo'lda: full_name/name LIKE '${MARKER}%' bo'yicha o'chiring"
elif [ -n "${SB_KEY:-}" ]; then
  for T in sales_leads leads; do
    FLD="full_name"; [ "$T" = "leads" ] && FLD="name"
    curl -s -o /dev/null -w "" --max-time 20 -X DELETE \
      "${SB_URL}/rest/v1/${T}?${FLD}=like.${MARKER}*" \
      -H "apikey: ${SB_KEY}" -H "Authorization: Bearer ${SB_KEY}" -H "Prefer: return=minimal"
    ok "$T tozalandi"
  done
else
  info "kalit yo'q — tozalash o'tkazib yuborildi"
fi

# ---------------------------------------------------------------------------
hdr "Natija"
echo "  ${GRN}o'tdi: $PASS${NC}   ${RED}yiqildi: $FAIL${NC}"
echo
if [ "$FAIL" -eq 0 ]; then
  echo "  ${GRN}${BLD}Zanjir butun:${NC} forma → API → DB"
  echo "  Telegram'ni O'ZINGIZ taskhiring — chiquvchi xabarni skript ko'ra olmaydi."
  echo "  ${MARKER} nomli xabarlar kelgan bo'lsa, ogohlantirish ham ishlayapti."
else
  echo "  ${YEL}Sabab qidirish:${NC} pm2 logs clary-api --lines 80 | grep -iE 'NotifyLead|Lid|Validation'"
fi
echo
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
