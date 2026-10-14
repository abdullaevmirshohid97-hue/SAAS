#!/usr/bin/env bash
# =============================================================================
# Clary AI qabulxona — Asterisk + voice-agent o'rnatish (Ubuntu 22.04 / 24.04)
# =============================================================================
# Ishlatish (root):
#   cd /opt/clary && git pull && bash infra/asterisk/install.sh
#
# Nima qiladi:
#   1) asterisk, curl, fail2ban o'rnatadi
#   2) /etc/asterisk/{pjsip,extensions,rtp}.conf — ZAXIRA olib, repo'dagisini qo'yadi
#   3) kerakli modullarni tekshiradi (AudioSocket, CURL, SHELL)
#   4) firewall (ufw): 5060/udp + 10000-10200/udp
#   5) voice-agent'ni yig'adi va pm2'da ishga tushiradi (clary-voice)
#
# Keyin QO'LDA:
#   - /etc/asterisk/pjsip.conf dagi <...> parollarni almashtiring, asterisk -rx "core reload"
#   - apps/voice-agent/.env ni to'ldiring (namuna: .env.example), pm2 restart clary-voice
#   - node apps/voice-agent/dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary
# Batafsil: docs/ai-reception/02-server-asterisk.md
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
G='\033[0;32m'; B='\033[0;36m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "\n${B}▶ %s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "root sifatida ishga tushiring (sudo)"
command -v apt-get >/dev/null || die "Faqat Ubuntu/Debian"

log "Paketlar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq asterisk curl fail2ban >/dev/null
ok "asterisk $(asterisk -V 2>/dev/null | awk '{print $2}')"

log "Konfiguratsiya (zaxira bilan)"
STAMP="$(date +%F-%H%M)"
for f in pjsip.conf extensions.conf rtp.conf; do
  if [ -f "/etc/asterisk/$f" ]; then
    cp "/etc/asterisk/$f" "/etc/asterisk/$f.bak-$STAMP"
  fi
  cp "$REPO/infra/asterisk/$f" "/etc/asterisk/$f"
  ok "$f (eski: $f.bak-$STAMP)"
done
mkdir -p /var/lib/asterisk/sounds/clary
chown -R asterisk:asterisk /var/lib/asterisk/sounds/clary /etc/asterisk

if grep -q '<GOIP1_PAROL>' /etc/asterisk/pjsip.conf; then
  P1="$(openssl rand -hex 12)"; P2="$(openssl rand -hex 12)"
  sed -i "s/<GOIP1_PAROL>/$P1/; s/<GOIP2_PAROL>/$P2/" /etc/asterisk/pjsip.conf
  warn "GoIP parollari yaratildi (shlyuz panelida shularni kiriting):"
  printf "    goip1 / %s\n    goip2 / %s\n" "$P1" "$P2"
fi

log "Asterisk qayta ishga tushirilmoqda"
systemctl enable asterisk >/dev/null 2>&1 || true
systemctl restart asterisk
sleep 3
for m in res_audiosocket app_audiosocket func_curl func_shell func_uri res_pjsip; do
  if asterisk -rx "module show like $m" | grep -q "$m"; then ok "modul: $m"; else warn "modul YO'Q: $m"; fi
done

log "Firewall (ufw)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 5060/udp comment 'Clary SIP' >/dev/null
  ufw allow 10000:10200/udp comment 'Clary RTP' >/dev/null
  ok "5060/udp va 10000-10200/udp ochildi"
  warn "Imkon bo'lsa 5060'ni faqat GoIP/operator IP'lariga cheklang: ufw allow from <IP> to any port 5060 proto udp"
else
  warn "ufw faol emas — 5060/udp va 10000-10200/udp ni provayder firewall'ida oching"
fi

log "fail2ban (SIP skanerlardan himoya)"
cat > /etc/fail2ban/jail.d/asterisk-clary.conf <<'EOF'
[asterisk]
enabled  = true
port     = 5060
protocol = udp
logpath  = /var/log/asterisk/messages
maxretry = 5
bantime  = 86400
EOF
grep -q '^messages' /etc/asterisk/logger.conf 2>/dev/null || \
  sed -i 's/^\[logfiles\]/[logfiles]\nmessages => notice,warning,error,security/' /etc/asterisk/logger.conf || true
asterisk -rx "logger reload" >/dev/null 2>&1 || true
systemctl restart fail2ban || warn "fail2ban qayta ishga tushmadi"
ok "fail2ban asterisk jail"

log "voice-agent (pm2: clary-voice)"
cd "$REPO"
command -v pnpm >/dev/null || die "pnpm yo'q (Node 20 + pnpm kerak)"
pnpm install --filter @clary/voice-agent... >/dev/null
pnpm --filter @clary/voice-agent build
if [ ! -f apps/voice-agent/.env ]; then
  cp apps/voice-agent/.env.example apps/voice-agent/.env
  warn "apps/voice-agent/.env yaratildi — VOICE_AGENT_SECRET va AISHA_API_KEY ni kiriting!"
fi
cd apps/voice-agent
if pm2 describe clary-voice >/dev/null 2>&1; then
  pm2 restart clary-voice --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save >/dev/null
ok "clary-voice ishga tushdi (pm2 logs clary-voice)"

printf "\n${G}🚀 Tayyor.${N} Tekshirish:\n"
cat <<'EOF'
  curl -s http://127.0.0.1:7071/health          # voice-agent holati (api.ok = true bo'lsin)
  asterisk -rx "pjsip show endpoints"           # goip1 — Avail (shlyuz ulangan)
  asterisk -rx "pjsip show registrations"       # operator trunk — Registered
  pm2 logs clary-voice                          # qo'ng'iroq jurnali
Keyin ilovada: Sozlamalar → AI qabulxona → liniya qo'shing (kalit: goip1) va
klinika raqamida pereadresatsiyani yoqing (kodlar o'sha sahifada).
EOF
