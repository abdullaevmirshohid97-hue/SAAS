#!/usr/bin/env bash
# =============================================================================
# Clary — Asterisk + voice-agent (+ bulutli ATS) o'rnatish (Ubuntu 22.04 / 24.04)
# =============================================================================
# Ishlatish (root, repo /opt/clary da):
#   Faqat AI qabulxona (GoIP / qo'lda trunk):
#     cd /opt/clary && git pull && bash infra/asterisk/install.sh
#   Bulutli ATS bilan (klinikalarning IP-telefoniyasi + softfon):
#     cd /opt/clary && git pull && PBX_DOMAIN=pbx.clary.uz bash infra/asterisk/install.sh
#
# Nima qiladi:
#   1) asterisk, curl, fail2ban (+ ATS: coturn, Caddy), Node 20 + pnpm + pm2
#   2) /etc/asterisk/{pjsip,extensions,rtp,http}.conf — ZAXIRA olib, repo'dagisini qo'yadi
#      pjsip_local.conf (GoIP parollari) — faqat yo'q bo'lsa yaratadi, keyin TEGMAYDI
#   3) modullarni tekshiradi (AudioSocket, CURL, MixMonitor, WebSocket, SRTP ...)
#   4) firewall (ufw) va fail2ban (SIP skanerlardan himoya)
#   5) ATS: coturn (TURN), Caddy (wss://PBX_DOMAIN/ws), PBX_ENABLED=true
#   6) voice-agent'ni yig'adi va pm2'da ishga tushiradi (clary-voice)
# Takroran ishga tushirish xavfsiz. Batafsil: docs/ai-reception/02-*.md, 05-bulut-ats.md
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PBX_DOMAIN="${PBX_DOMAIN:-}"
G='\033[0;32m'; B='\033[0;36m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "\n${B}▶ %s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "root sifatida ishga tushiring (sudo)"
command -v apt-get >/dev/null || die "Faqat Ubuntu/Debian"
if [ -n "$PBX_DOMAIN" ] && ! [[ "$PBX_DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  die "PBX_DOMAIN noto'g'ri: $PBX_DOMAIN (masalan: pbx.clary.uz)"
fi
STAMP="$(date +%F-%H%M%S)"

# ---------------------------------------------------------------------------
log "Paketlar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
PKGS=(asterisk curl fail2ban openssl ca-certificates gnupg)
[ -n "$PBX_DOMAIN" ] && PKGS+=(coturn)
apt-get install -y -qq "${PKGS[@]}" >/dev/null
ok "asterisk $(asterisk -V 2>/dev/null | awk '{print $2}')"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  log "Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"
if ! command -v pnpm >/dev/null; then
  corepack enable >/dev/null 2>&1 || npm install -g corepack >/dev/null
  corepack prepare pnpm@9.12.0 --activate >/dev/null
fi
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null
ok "pnpm $(pnpm -v), pm2 $(pm2 -v 2>/dev/null | tail -1)"

# ---------------------------------------------------------------------------
log "Asterisk konfiguratsiyasi (zaxira bilan)"
for f in pjsip.conf extensions.conf rtp.conf http.conf; do
  if [ -f "/etc/asterisk/$f" ]; then
    cp "/etc/asterisk/$f" "/etc/asterisk/$f.bak-$STAMP"
  fi
  cp "$REPO/infra/asterisk/$f" "/etc/asterisk/$f"
  ok "$f"
done

# pjsip_local.conf — GoIP/qo'lda trunk. Bir marta yaratiladi; eski pjsip.conf'dagi
# GoIP parollari (avvalgi o'rnatishdan) saqlanadi — shlyuzlar uzilib qolmasin.
old_secret() { # $1 = bo'lim nomi (goip1-auth), $2 = fayl → password qiymati
  awk -v sec="[$1]" '$0==sec{f=1;next} /^\[/{f=0} f && /^password=/{sub(/^password=/,"");print;exit}' "$2" 2>/dev/null || true
}
if [ ! -f /etc/asterisk/pjsip_local.conf ]; then
  cp "$REPO/infra/asterisk/pjsip_local.conf" /etc/asterisk/pjsip_local.conf
  OLD="/etc/asterisk/pjsip.conf.bak-$STAMP"
  NEW_GOIP=""
  for n in 1 2; do
    P=""
    [ -f "$OLD" ] && P="$(old_secret "goip${n}-auth" "$OLD")"
    if [ -z "$P" ] || [[ "$P" == \<* ]]; then
      P="$(openssl rand -hex 12)"
      NEW_GOIP="${NEW_GOIP}    goip${n} / ${P}\n"
    fi
    sed -i "s/<GOIP${n}_PAROL>/${P}/" /etc/asterisk/pjsip_local.conf
  done
  ok "pjsip_local.conf yaratildi"
  if [ -n "$NEW_GOIP" ]; then
    warn "GoIP parollari yaratildi (shlyuz ishlatsangiz, panelida shularni kiriting):"
    printf "%b" "$NEW_GOIP"
  fi
else
  ok "pjsip_local.conf (mavjud — tegilmadi)"
fi

mkdir -p /var/lib/asterisk/sounds/clary /var/spool/asterisk/monitor/clary
chown -R asterisk:asterisk /etc/asterisk /var/lib/asterisk/sounds/clary /var/spool/asterisk/monitor/clary
chmod 750 /var/spool/asterisk/monitor/clary
chmod 640 /etc/asterisk/pjsip_local.conf

# fail2ban uchun alohida log (NOTICE: noto'g'ri parol / noma'lum endpoint)
if ! grep -q '^clary_fail2ban' /etc/asterisk/logger.conf 2>/dev/null; then
  sed -i 's/^\[logfiles\]/[logfiles]\nclary_fail2ban => notice,warning,error,security/' /etc/asterisk/logger.conf || true
fi
touch /var/log/asterisk/clary_fail2ban
chown asterisk:asterisk /var/log/asterisk/clary_fail2ban

# ---------------------------------------------------------------------------
log "Asterisk qayta ishga tushirilmoqda"
systemctl enable asterisk >/dev/null 2>&1 || true
systemctl restart asterisk
sleep 4
MISSING=""
for m in res_pjsip res_pjsip_outbound_registration res_audiosocket app_audiosocket func_curl \
         func_shell func_uri func_groupcount app_mixmonitor res_http_websocket \
         res_pjsip_transport_websocket res_srtp; do
  if asterisk -rx "module show like $m" | grep -q "$m"; then ok "modul: $m"; else warn "modul YO'Q: $m"; MISSING="$MISSING $m"; fi
done
[ -n "$MISSING" ] && warn "Yetishmayotgan modullar:$MISSING — apt install asterisk-modules (yoki asterisk-dev) va qayta urinib ko'ring"
if [ -n "$PBX_DOMAIN" ] && ! asterisk -rx "http show status" | grep -qi "enabled"; then
  warn "Asterisk HTTP (WebSocket) yoqilmadi — /etc/asterisk/http.conf ni tekshiring"
fi

# ---------------------------------------------------------------------------
log "Firewall (ufw)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 5060/udp comment 'Clary SIP' >/dev/null
  ufw allow 5060/tcp comment 'Clary SIP' >/dev/null
  ufw allow 10000:10999/udp comment 'Clary RTP' >/dev/null
  if [ -n "$PBX_DOMAIN" ]; then
    ufw allow 80/tcp comment 'Caddy ACME' >/dev/null
    ufw allow 443/tcp comment 'Clary softfon wss' >/dev/null
    ufw allow 3478/udp comment 'Clary TURN' >/dev/null
    ufw allow 3478/tcp comment 'Clary TURN' >/dev/null
    ufw allow 50000:50999/udp comment 'Clary TURN relay' >/dev/null
  fi
  ok "portlar ochildi"
else
  warn "ufw faol emas — provayder firewall'ida oching: 5060/udp+tcp, 10000-10999/udp$( [ -n "$PBX_DOMAIN" ] && printf ', 80+443/tcp, 3478/udp+tcp, 50000-50999/udp')"
fi

log "fail2ban (SIP skanerlardan himoya)"
cat > /etc/fail2ban/jail.d/asterisk-clary.conf <<'EOF'
[asterisk]
enabled  = true
logpath  = /var/log/asterisk/clary_fail2ban
maxretry = 5
findtime = 600
bantime  = 86400
EOF
asterisk -rx "logger reload" >/dev/null 2>&1 || true
if systemctl restart fail2ban; then ok "fail2ban asterisk jail"; else warn "fail2ban qayta ishga tushmadi (journalctl -u fail2ban)"; fi

# ---------------------------------------------------------------------------
TURN_SECRET=""
if [ -n "$PBX_DOMAIN" ]; then
  log "Bulutli ATS: coturn (TURN)"
  SECRET_FILE=/etc/clary-turn-secret
  if [ ! -s "$SECRET_FILE" ]; then
    openssl rand -hex 32 > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
  fi
  TURN_SECRET="$(cat "$SECRET_FILE")"
  [ -f /etc/turnserver.conf ] && cp /etc/turnserver.conf "/etc/turnserver.conf.bak-$STAMP"
  sed -e "s/<TURN_SECRET>/${TURN_SECRET}/" -e "s/<PBX_DOMAIN>/${PBX_DOMAIN}/" \
    "$REPO/infra/asterisk/turnserver.conf" > /etc/turnserver.conf
  chmod 640 /etc/turnserver.conf
  chgrp turnserver /etc/turnserver.conf 2>/dev/null || true
  if [ -f /etc/default/coturn ]; then
    sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
  fi
  systemctl enable coturn >/dev/null 2>&1 || true
  if systemctl restart coturn; then ok "coturn 3478"; else warn "coturn ishga tushmadi (journalctl -u coturn)"; fi

  log "Bulutli ATS: Caddy (wss://${PBX_DOMAIN}/ws)"
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
  fi
  CF=/etc/caddy/Caddyfile
  BLOCK="$(sed "s/<PBX_DOMAIN>/${PBX_DOMAIN}/" "$REPO/infra/asterisk/Caddyfile.pbx")"
  if [ -f "$CF" ] && grep -qF "$PBX_DOMAIN" "$CF"; then
    ok "Caddyfile'da ${PBX_DOMAIN} allaqachon bor"
  elif [ ! -s "$CF" ] || grep -q '/usr/share/caddy' "$CF"; then
    # Yangi server: standart Caddyfile — almashtiramiz
    [ -f "$CF" ] && cp "$CF" "$CF.bak-$STAMP"
    printf '%s\n' "$BLOCK" > "$CF"
    if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then
      systemctl enable caddy >/dev/null 2>&1 || true
      systemctl restart caddy
      ok "Caddy: https://${PBX_DOMAIN} (TLS sertifikat avtomatik)"
    else
      warn "Caddyfile xato — caddy validate --config $CF"
    fi
  else
    warn "Mavjud $CF da boshqa saytlar bor — TEGMADIM. Quyidagi blokni qo'lda qo'shing,"
    warn "keyin: caddy validate --config $CF && systemctl restart caddy"
    printf '%s\n' "$BLOCK"
  fi
  if ! getent hosts "$PBX_DOMAIN" >/dev/null 2>&1; then
    warn "DNS: ${PBX_DOMAIN} hali hech qayerga ko'rsatmaydi — A-yozuvini shu server IP'siga qo'ying (TLS shundan keyin)"
  fi
fi

# ---------------------------------------------------------------------------
log "voice-agent (pm2: clary-voice)"
cd "$REPO"
pnpm install --filter @clary/voice-agent... >/dev/null
pnpm --filter @clary/voice-agent build >/dev/null
ok "yig'ildi"

ENVF="apps/voice-agent/.env"
if [ ! -f "$ENVF" ]; then
  cp apps/voice-agent/.env.example "$ENVF"
  chmod 600 "$ENVF"
  warn "$ENVF yaratildi — AISHA_API_KEY ni kiriting (AI ovozi uchun)"
fi
env_get() { grep -E "^$1=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true; }
env_set() { # kalit qiymat (qiymatda | bo'lmasin)
  if grep -qE "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else printf '%s=%s\n' "$1" "$2" >> "$ENVF"; fi
}

SECRET_NOTE=""
CUR_SECRET="$(env_get VOICE_AGENT_SECRET)"
if [ "${#CUR_SECRET}" -lt 24 ] || [[ "$CUR_SECRET" == \<* ]]; then
  API_SECRET=""
  [ -f "$REPO/.env.local" ] && API_SECRET="$(grep -E '^VOICE_AGENT_SECRET=' "$REPO/.env.local" | head -1 | cut -d= -f2- | tr -d '"' || true)"
  if [ "${#API_SECRET}" -ge 24 ]; then
    env_set VOICE_AGENT_SECRET "$API_SECRET"
    ok "VOICE_AGENT_SECRET API (.env.local) dan olindi"
  else
    CUR_SECRET="$(openssl rand -hex 24)"
    env_set VOICE_AGENT_SECRET "$CUR_SECRET"
    SECRET_NOTE="VOICE_AGENT_SECRET=${CUR_SECRET}"
    warn "VOICE_AGENT_SECRET yaratildi — API serverining .env.local ga ham AYNAN shuni yozing"
  fi
fi
if [ -n "$PBX_DOMAIN" ]; then
  env_set PBX_ENABLED true
  env_set PBX_RECORDINGS_DIR /var/spool/asterisk/monitor/clary
  ok "PBX_ENABLED=true"
fi

cd apps/voice-agent
if pm2 describe clary-voice >/dev/null 2>&1; then
  pm2 restart clary-voice --update-env >/dev/null
else
  pm2 start ecosystem.config.cjs >/dev/null
fi
pm2 save >/dev/null
ok "clary-voice ishga tushdi (pm2 logs clary-voice)"

log "Zaxira ovozlar (Asterisk Playback)"
if node dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary --missing; then
  chown -R asterisk:asterisk /var/lib/asterisk/sounds/clary
  ok "ovozlar tayyor"
else
  warn "ovozlar yaratilmadi (AISHA_API_KEY yo'qmi?) — keyin: cd $REPO/apps/voice-agent && node dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary --missing"
fi
cd "$REPO"

# ---------------------------------------------------------------------------
printf "\n${G}🚀 Tayyor.${N} Tekshirish:\n"
cat <<'EOF'
  curl -s http://127.0.0.1:7071/health          # voice-agent holati (api.ok = true; pbx.error = null)
  asterisk -rx "pjsip show registrations"       # klinika trunk'lari — Registered
  asterisk -rx "pjsip show contacts"            # onlayn telefonlar / softfonlar
  pm2 logs clary-voice                          # qo'ng'iroq jurnali
EOF
if [ -n "$PBX_DOMAIN" ] || [ -n "$SECRET_NOTE" ]; then
  printf "\n${Y}API serverida${N} (/opt/clary/.env.local), keyin: pm2 restart clary-api --update-env\n"
  [ -n "$SECRET_NOTE" ] && printf "  %s\n" "$SECRET_NOTE"
  if [ -n "$PBX_DOMAIN" ]; then
    printf "  PBX_SIP_DOMAIN=%s\n  PBX_WSS_URL=wss://%s/ws\n  TURN_SECRET=%s\n" "$PBX_DOMAIN" "$PBX_DOMAIN" "$TURN_SECRET"
  fi
fi
