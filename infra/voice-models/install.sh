#!/usr/bin/env bash
# =============================================================================
# Clary — o'zimizning nutq serverlari (uchinchi tomonsiz, bepul)
# =============================================================================
#   clary-stt — nutq → matn (Whisper, o'zbekcha)  127.0.0.1:8001
#   clary-tts — matn → nutq (Meta MMS)            127.0.0.1:8002
# Ishlatish (root, ATS serverida, repo /opt/clary da):
#   bash infra/voice-models/install.sh
#
# Nima qiladi: python venv (/opt/clary-voice-models), torch (GPU bo'lsa CUDA, aks holda
# CPU), systemd xizmatlari, kalitlar (/etc/clary-voice-models.env), voice-agent .env ni
# shu serverlarga ulaydi. Takroran ishga tushirish xavfsiz (kalitlar saqlanadi).
#
# Qachon kerak: AI qabulxona ovozli suhbati (jonli suhbat uchun GPU tavsiya etiladi —
# CPU'da javob sekin), ovozli xabarlarni matnga o'girish, Telegram ovozli xabarlari.
# Faqat ATS (telefonlar + softfon + ovozli xabar yozuvi) uchun KERAK EMAS.
# =============================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BASE=/opt/clary-voice-models
ENVF=/etc/clary-voice-models.env
G='\033[0;32m'; B='\033[0;36m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { printf "\n${B}▶ %s${N}\n" "$*"; }
ok()   { printf "${G}✓${N} %s\n" "$*"; }
warn() { printf "${Y}⚠${N} %s\n" "$*"; }
die()  { printf "\n${R}✗ %s${N}\n" "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "root sifatida ishga tushiring (sudo)"
command -v apt-get >/dev/null || die "Faqat Ubuntu/Debian"

GPU=no
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then GPU=yes; fi
RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
log "Server: GPU=${GPU}, RAM=${RAM_MB} MB"
if [ "$GPU" = "no" ]; then
  warn "GPU yo'q — STT kichik model bilan CPU'da ishlaydi: ovozli xabar matni va Telegram uchun yetadi,"
  warn "lekin jonli AI telefon suhbati sekin bo'ladi (har gapga bir necha soniya)."
fi
[ "$RAM_MB" -ge 3500 ] || warn "RAM kam (${RAM_MB} MB) — STT modeli uchun kamida 4 GB tavsiya etiladi"

log "Paketlar"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip ffmpeg >/dev/null
ok "python $(python3 -V 2>&1 | awk '{print $2}')"

log "Python muhit (${BASE})"
id -u clary-voice >/dev/null 2>&1 || useradd --system --home "$BASE" --shell /usr/sbin/nologin clary-voice
mkdir -p "$BASE/hf-cache"
[ -x "$BASE/venv/bin/python" ] || python3 -m venv "$BASE/venv"
"$BASE/venv/bin/pip" install -q --upgrade pip
if [ "$GPU" = "yes" ]; then
  "$BASE/venv/bin/pip" install -q torch
else
  "$BASE/venv/bin/pip" install -q torch --index-url https://download.pytorch.org/whl/cpu
fi
"$BASE/venv/bin/pip" install -q -r "$REPO/infra/voice-models/requirements.txt"
cp "$REPO/infra/voice-models/stt_server.py" "$REPO/infra/voice-models/tts_server.py" "$BASE/"
chown -R clary-voice:clary-voice "$BASE"
ok "kutubxonalar o'rnatildi"

log "Kalitlar (${ENVF})"
if [ ! -f "$ENVF" ]; then
  STT_MODEL_DEFAULT="aslon1213/whisper-small-uz"
  [ "$GPU" = "yes" ] && STT_MODEL_DEFAULT="islomov/rubaistt_v2_medium"
  cat > "$ENVF" <<EOF
# Clary nutq serverlari — kalitlar voice-agent va API bilan bir xil bo'lsin
STT_MODEL=${STT_MODEL_DEFAULT}
STT_API_KEY=$(openssl rand -hex 24)
TTS_API_KEY=$(openssl rand -hex 24)
HF_HOME=${BASE}/hf-cache
EOF
  chmod 600 "$ENVF"
  ok "yaratildi"
else
  ok "mavjud (tegilmadi)"
fi
STT_API_KEY="$(grep -E '^STT_API_KEY=' "$ENVF" | head -1 | cut -d= -f2- || true)"
TTS_API_KEY="$(grep -E '^TTS_API_KEY=' "$ENVF" | head -1 | cut -d= -f2- || true)"

log "systemd xizmatlari"
unit() { # nom fayl port
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=Clary $1 (o'zimizning nutq serveri)
After=network-online.target

[Service]
User=clary-voice
WorkingDirectory=${BASE}
EnvironmentFile=${ENVF}
ExecStart=${BASE}/venv/bin/uvicorn $2:app --host 127.0.0.1 --port $3
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
}
unit clary-stt stt_server 8001
unit clary-tts tts_server 8002
systemctl daemon-reload
systemctl enable clary-stt clary-tts >/dev/null 2>&1
systemctl restart clary-stt clary-tts
ok "clary-stt (8001), clary-tts (8002) ishga tushirildi"

log "Modellar yuklanmoqda (birinchi marta bir necha daqiqa — HuggingFace)"
ready=no
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:8001/health >/dev/null && curl -sf http://127.0.0.1:8002/health >/dev/null; then
    ready=yes
    break
  fi
  sleep 10
done
if [ "$ready" = "yes" ]; then
  ok "ikkala server javob beryapti"
else
  warn "hali tayyor emas — kuzating: journalctl -u clary-stt -f  /  journalctl -u clary-tts -f"
fi

VA_ENV="$REPO/apps/voice-agent/.env"
if [ -f "$VA_ENV" ]; then
  log "voice-agent .env → o'zimizning serverlar"
  env_set() {
    if grep -qE "^$1=" "$VA_ENV"; then sed -i "s|^$1=.*|$1=$2|" "$VA_ENV"; else printf '%s=%s\n' "$1" "$2" >> "$VA_ENV"; fi
  }
  env_set STT_PROVIDER openai
  env_set STT_OPENAI_URL http://127.0.0.1:8001
  env_set STT_OPENAI_KEY "$STT_API_KEY"
  env_set TTS_PROVIDER http
  env_set TTS_HTTP_URL http://127.0.0.1:8002/
  env_set TTS_HTTP_KEY "$TTS_API_KEY"
  if command -v pm2 >/dev/null && pm2 describe clary-voice >/dev/null 2>&1; then
    pm2 restart clary-voice --update-env >/dev/null && ok "clary-voice qayta ishga tushirildi"
  fi
else
  warn "apps/voice-agent/.env yo'q — avval infra/asterisk/install.sh"
fi

printf "\n${G}🚀 Tayyor.${N}\n"
cat <<EOF
Tekshirish:
  curl -s http://127.0.0.1:8001/health      # STT
  curl -s http://127.0.0.1:8002/health      # TTS
  curl -s http://127.0.0.1:7071/health      # voice-agent: "speech_ok": true

Clary API (/opt/clary/.env.local) — Telegram ovozli xabarlari va ovozli xabar matni uchun
(ATS serveridagi Caddy /stt yo'li orqali; keyin pm2 restart clary-api --update-env):
  AI_STT_PROVIDER=openai
  STT_OPENAI_URL=https://<PBX_DOMAIN>/stt
  STT_OPENAI_KEY=${STT_API_KEY}

Zaxira ovozlarni shu TTS bilan yaratish (o'zingiz yozib olmagan bo'lsangiz):
  cd ${REPO}/apps/voice-agent && node dist/scripts/gen-sounds.js --out /var/lib/asterisk/sounds/clary --missing
EOF
