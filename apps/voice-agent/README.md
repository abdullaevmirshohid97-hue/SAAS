# @clary/voice-agent

Telefon ko'prigi: **Asterisk AudioSocket ↔ VAD ↔ STT ↔ Clary API (AI miya) ↔ TTS**.
Asterisk bilan bitta serverda ishlaydi va pm2'da `clary-voice` nomi bilan yuritiladi.

```bash
pnpm --filter @clary/voice-agent build
cp .env.example .env            # VOICE_AGENT_SECRET, AISHA_API_KEY
pm2 start ecosystem.config.cjs
curl -s http://127.0.0.1:7071/health
```

| Fayl                             | Nima                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/call-session.ts`            | Bitta qo'ng'iroq: salomlashuv, tinglash, barge-in, "bir daqiqa", jimlik, ovozli xabar, yozuv |
| `src/vad.ts`                     | Nutqni aniqlash (moslashuvchan shovqin darajasi)                                             |
| `src/audio.ts`                   | WAV, chastota o'zgartirish (sinc), telefon taqlidi                                           |
| `src/audiosocket.ts`             | Asterisk AudioSocket protokoli                                                               |
| `src/providers/stt.ts`, `tts.ts` | Aisha AI / OpenAI-mos Whisper / o'zimizning TTS + disk keshi                                 |
| `scripts/stt-benchmark.ts`       | **Faza 0**: provayderlarning WER/CER va kechikishini o'lchash                                |
| `scripts/simulate-call.ts`       | Asterisk'siz sinov (klaviatura → AI → ovoz fayli)                                            |
| `scripts/gen-sounds.ts`          | Asterisk uchun zaxira ovozlar                                                                |

Testlar: `pnpm --filter @clary/voice-agent test` (audio, VAD, protokol va qo'ng'iroqning to'liq sikli).

Batafsil: [docs/ai-reception](../../docs/ai-reception/README.md).
