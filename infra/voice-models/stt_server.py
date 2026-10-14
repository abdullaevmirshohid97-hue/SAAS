"""
Clary — o'zimizning (BEPUL) o'zbekcha STT server, OpenAI-mos API.

  POST /v1/audio/transcriptions   (multipart: file, model?, language?)
  -> {"text": "..."}

voice-agent:  STT_PROVIDER=openai  STT_OPENAI_URL=http://127.0.0.1:8001
Clary API (Telegram ovozli xabar): AI_STT_PROVIDER=openai STT_OPENAI_URL=http://<ip>:8001

Model (HuggingFace, Whisper asosida, o'zbek tiliga o'qitilgan):
  STT_MODEL=islomov/rubaistt_v2_medium   (default — o'rta, GPU'da tez)
  STT_MODEL=BuzzASR/uzbek                (whisper-large-v3 asosida — eng aniq, GPU SHART)
  STT_MODEL=aslon1213/whisper-small-uz   (kichik — CPU'da ham sekin-asta ishlaydi)

O'rnatish (Ubuntu, Python 3.10+, ffmpeg):
  apt-get install -y ffmpeg python3-venv
  python3 -m venv /opt/clary-stt && . /opt/clary-stt/bin/activate
  pip install -r requirements.txt
  STT_MODEL=islomov/rubaistt_v2_medium uvicorn stt_server:app --host 127.0.0.1 --port 8001

Eslatma: telefon suhbati uchun bitta gap 1–1.5 s ichida tanilishi kerak — buning
uchun NVIDIA GPU (T4 / RTX 3060+) kerak. CPU'da faqat Telegram ovozli xabari
yoki Faza 0 sinovi uchun yaroqli. Natijani scripts/stt-benchmark bilan o'lchang.
"""

import io
import os
import subprocess
import time

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from transformers import pipeline

MODEL = os.environ.get("STT_MODEL", "islomov/rubaistt_v2_medium")
DEVICE = 0 if torch.cuda.is_available() else -1
DTYPE = torch.float16 if torch.cuda.is_available() else torch.float32

asr = pipeline(
    "automatic-speech-recognition",
    model=MODEL,
    device=DEVICE,
    torch_dtype=DTYPE,
)
app = FastAPI(title="Clary STT")


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
    return {"ok": True, "model": MODEL, "gpu": torch.cuda.is_available()}


@app.post("/v1/audio/transcriptions")
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
