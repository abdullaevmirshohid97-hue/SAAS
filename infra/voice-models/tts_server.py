"""
Clary — o'zimizning (BEPUL, uchinchi tomonsiz) TTS server: Meta MMS-TTS (VITS), CPU'da ishlaydi.

  GET  /health
  POST /   {"text": "...", "lang": "uz"|"ru", "voice": "...", "speed": 1.0}
  -> audio/wav (16 kHz, mono)
  Kalit: TTS_API_KEY o'rnatilgan bo'lsa — "Authorization: Bearer <kalit>" shart.

voice-agent:  TTS_PROVIDER=http  TTS_HTTP_URL=http://127.0.0.1:8002/  TTS_HTTP_KEY=<kalit>

Modellar:
  uz -> facebook/mms-tts-uzb-script_cyrillic  (kirill yozuvi — lotin matn
        avtomatik kirillga o'giriladi, pastdagi translit())
  ru -> facebook/mms-tts-rus

Sifat: tabiiy inson ovozidan robotroq, lekin bepul va tez (CPU'da ~0.3 s/jumla).
Doimiy iboralarni (ovozli xabar, salomlashuv) o'zingiz yozib olishingiz mumkin —
infra/asterisk/sounds.sh.

O'rnatish: bash infra/voice-models/install.sh (venv + systemd: clary-tts, 127.0.0.1:8002)
"""

import io
import os
import re
import wave

import numpy as np
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoTokenizer, VitsModel

MODELS = {
    "uz": "facebook/mms-tts-uzb-script_cyrillic",
    "ru": "facebook/mms-tts-rus",
}
API_KEY = os.environ.get("TTS_API_KEY", "").strip()
_cache = {}


def load(lang: str):
    if lang not in _cache:
        name = MODELS.get(lang, MODELS["uz"])
        _cache[lang] = (VitsModel.from_pretrained(name), AutoTokenizer.from_pretrained(name))
    return _cache[lang]


# O'zbek lotin -> kirill (MMS uzb modeli kirillda o'qitilgan)
PAIRS = [
    ("o‘", "ў"), ("o'", "ў"), ("oʻ", "ў"), ("g‘", "ғ"), ("g'", "ғ"), ("gʻ", "ғ"),
    ("sh", "ш"), ("ch", "ч"), ("yo", "ё"), ("yu", "ю"), ("ya", "я"), ("ye", "е"),
]
SINGLE = {
    "a": "а", "b": "б", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "ҳ", "i": "и",
    "j": "ж", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о", "p": "п", "q": "қ",
    "r": "р", "s": "с", "t": "т", "u": "у", "v": "в", "x": "х", "y": "й", "z": "з",
    "'": "ъ", "’": "ъ", "ʼ": "ъ",
}


def translit(text: str) -> str:
    s = text.lower()
    # So'z boshidagi "e" -> "э" (ertaga -> эртага)
    s = re.sub(r"(^|[\s\-«\"(])e", lambda m: m.group(1) + "э", s)
    for a, b in PAIRS:
        s = s.replace(a, b)
    return "".join(SINGLE.get(ch, ch) for ch in s)


class Req(BaseModel):
    text: str
    lang: str = "uz"
    voice: str | None = None
    speed: float = 1.0


app = FastAPI(title="Clary TTS")


def check_key(authorization: str | None = Header(default=None)) -> None:
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(401, "kalit noto'g'ri")


@app.get("/health")
def health():
    return {"ok": True, "models": MODELS}


@app.post("/", dependencies=[Depends(check_key)])
def synth(req: Req):
    lang = "ru" if req.lang == "ru" else "uz"
    model, tok = load(lang)
    text = translit(req.text) if lang == "uz" else req.text
    model.speaking_rate = max(0.5, min(2.0, req.speed or 1.0))
    inputs = tok(text, return_tensors="pt")
    with torch.no_grad():
        audio = model(**inputs).waveform[0].cpu().numpy()
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(model.config.sampling_rate)
        w.writeframes(pcm.tobytes())
    return Response(buf.getvalue(), media_type="audio/wav")
