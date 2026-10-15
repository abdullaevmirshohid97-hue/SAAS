#!/usr/bin/env bash
# =============================================================================
# Clary — o'zingiz yozib olgan ovozli xabarlarni Asterisk formatiga o'girish
# =============================================================================
# Uchinchi tomon (TTS) kerak emas: iboralarni telefon diktofoniga o'qing
# (matnlar: cd apps/voice-agent && node dist/scripts/gen-sounds.js --list),
# fayllarni serverga shu nomlar bilan qo'ying (kengaytma istalgan: m4a/mp3/ogg/wav/amr):
#
#   /opt/clary-sounds/fallback.m4a        /opt/clary-sounds/vm_prompt.m4a
#   /opt/clary-sounds/transfer_fail.m4a   /opt/clary-sounds/vm_thanks.m4a
#   /opt/clary-sounds/pbx_noanswer.m4a    /opt/clary-sounds/ext_unavailable.m4a
#   /opt/clary-sounds/out_denied.m4a      /opt/clary-sounds/out_busy.m4a
#
# So'ng (root):  bash infra/asterisk/sounds.sh [manba_papka]
# Natija: /var/lib/asterisk/sounds/clary/<nom>.wav (8 kHz, mono, 16-bit, ovoz balandligi
# tekislangan). Qayta ishga tushirish xavfsiz — yangi yozuv eskisining ustiga yoziladi.
# =============================================================================
set -euo pipefail

SRC="${1:-/opt/clary-sounds}"
DST=/var/lib/asterisk/sounds/clary
NAMES=(fallback transfer_fail pbx_noanswer vm_prompt vm_thanks ext_unavailable out_denied out_busy)

command -v ffmpeg >/dev/null || { echo "ffmpeg yo'q: apt-get install -y ffmpeg" >&2; exit 1; }
[ -d "$SRC" ] || { echo "Papka yo'q: $SRC" >&2; exit 1; }
mkdir -p "$DST"

converted=0
for name in "${NAMES[@]}"; do
  f="$(find "$SRC" -maxdepth 1 -type f -name "${name}.*" | head -1 || true)"
  [ -n "$f" ] || continue
  # Telefon liniyasi uchun: 300–3400 Hz, ovoz balandligi tekislanadi, boshidagi jimlik kesiladi
  ffmpeg -nostdin -loglevel error -y -i "$f" \
    -af "silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=200,lowpass=f=3400,loudnorm=I=-16:TP=-2:LRA=11" \
    -ac 1 -ar 8000 -c:a pcm_s16le "$DST/$name.wav"
  echo "✓ $name ← $(basename "$f")"
  converted=$((converted + 1))
done
chown -R asterisk:asterisk "$DST" 2>/dev/null || true

missing=()
for name in "${NAMES[@]}"; do
  [ -f "$DST/$name.wav" ] || missing+=("$name")
done
echo "O'girildi: ${converted} ta. Papka: $DST"
if [ "${#missing[@]}" -gt 0 ]; then
  echo "Hali yo'q: ${missing[*]}"
  exit 3
fi
echo "Hamma ovoz tayyor."
