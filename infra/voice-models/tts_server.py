"""
Clary — o'zimizning (BEPUL) TTS server: Meta MMS-TTS (VITS), CPU'da ishlaydi.

  POST /   {"text": "...", "lang": "uz"|"ru", "voice": "...", "speed": 1.0}
  -> audio/wav (16 kHz, mono)

voice-agent:  TTS_PROVIDER=http  TTS_HTTP_URL=http://127.0.0.1:8002/

Modellar:
  uz -> facebook/mms-tts-uzb-script_cyrillic  (kirill yozuvi — lotin matn
        avtomatik kirillga o'giriladi, pastdagi translit())
  ru -> facebook/mms-tts-rus

Sifat: Aisha TTS'dan pastroq (robotroq), lekin bepul va tez (CPU'da ~0.3 s/jumla).
Sifatliroq bepul variant — Aisha'ning ochiq "Navoiy TTS" (CosyVoice2, GPU kerak).

O'rnatish:
  python3 -m venv /opt/clary-tts && . /opt/clary-tts/bin/activate
  pip install -r requirements.txt
  uvicorn tts_server:app --host 127.0.0.1 --port 8002
"""

import io
import re
import wave

import numpy as np
import torch
from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
from transformers import AutoTokenizer, VitsModel

MODELS = {
    "uz": "facebook/mms-tts-uzb-script_cyrillic",
    "ru": "facebook/mms-tts-rus",
}
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


@app.get("/health")
def health():
    return {"ok": True, "models": MODELS}


@app.post("/")
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
