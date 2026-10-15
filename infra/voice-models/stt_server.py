"""
Clary — o'zimizning (BEPUL, uchinchi tomonsiz) o'zbekcha STT server, OpenAI-mos API.

  GET  /health
  POST /v1/audio/transcriptions   (multipart: file, model?, language?)
  -> {"text": "..."}
  Kalit: STT_API_KEY o'rnatilgan bo'lsa — "Authorization: Bearer <kalit>" shart.

voice-agent:  STT_PROVIDER=openai  STT_OPENAI_URL=http://127.0.0.1:8001  STT_OPENAI_KEY=<kalit>
Clary API (Telegram ovozli xabar, ATS ovozli xabar matni):
  AI_STT_PROVIDER=openai  STT_OPENAI_URL=https://pbx.clary.uz/stt  STT_OPENAI_KEY=<kalit>

Model (HuggingFace, Whisper asosida, o'zbek tiliga o'qitilgan):
  STT_MODEL=islomov/rubaistt_v2_medium   (GPU bo'lsa standart — o'rta, tez)
  STT_MODEL=BuzzASR/uzbek                (whisper-large-v3 asosida — eng aniq, GPU SHART)
  STT_MODEL=aslon1213/whisper-small-uz   (GPU bo'lmasa standart — kichik, CPU'da ishlaydi)

O'rnatish: bash infra/voice-models/install.sh (venv + systemd: clary-stt, 127.0.0.1:8001)

Eslatma: jonli telefon suhbati uchun bitta gap 1–1.5 s ichida tanilishi kerak — buning
uchun NVIDIA GPU (T4 / RTX 3060+) kerak. CPU'da ovozli xabar matni va Telegram ovozli
xabari uchun yaroqli. Natijani apps/voice-agent scripts/stt-benchmark bilan o'lchang.
"""

import os
import subprocess
import time

import numpy as np
import torch
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from transformers import pipeline

GPU = torch.cuda.is_available()
MODEL = os.environ.get("STT_MODEL") or (
    "islomov/rubaistt_v2_medium" if GPU else "aslon1213/whisper-small-uz"
)
API_KEY = os.environ.get("STT_API_KEY", "").strip()
DEVICE = 0 if GPU else -1
DTYPE = torch.float16 if GPU else torch.float32

asr = pipeline(
    "automatic-speech-recognition",
    model=MODEL,
    device=DEVICE,
    torch_dtype=DTYPE,
)
app = FastAPI(title="Clary STT")


def check_key(authorization: str | None = Header(default=None)) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(401, "kalit noto'g'ri")


def decode(data: bytes) -> np.ndarray:
    """Istalgan audio (wav/ogg/mp3) -> 16 kHz mono float32 (ffmpeg)."""
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", "pipe:0",
         "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"],
        input=data,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise HTTPException(400, f"audio o'qilmadi: {proc.stderr.decode()[:200]}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL, "gpu": GPU}


@app.post("/v1/audio/transcriptions", dependencies=[Depends(check_key)])
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(None),
    language: str = Form("uz"),
    response_format: str = Form("json"),
    temperature: float = Form(0.0),
):
    started = time.time()
    audio = decode(await file.read())
    if audio.size == 0:
        return {"text": ""}
    lang = {"uz": "uzbek", "ru": "russian", "en": "english"}.get(language, "uzbek")
    out = asr(
        {"raw": audio, "sampling_rate": 16000},
        generate_kwargs={"language": lang, "task": "transcribe"},
        chunk_length_s=30,
    )
    text = (out.get("text") or "").strip()
    return {"text": text, "duration_ms": int((time.time() - started) * 1000)}
