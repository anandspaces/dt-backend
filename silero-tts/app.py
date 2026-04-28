from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from typing import List, Optional
import asyncio
import io
import json
import logging
import os
import re
import time
import sys

import numpy as np
import soundfile as sf
import torch
from aksharamukha import transliterate
from silero import silero_tts

from text_normalizer import TTSTextNormalizer

# Global model variables
device = None
models = {}
normalizer = None

# Concurrency limit for inference per process.
# SILERO_CONCURRENCY=1 (default) serializes inside one process; scale out with --workers N.
# Set SILERO_CONCURRENCY > 1 only if your CPU/GPU has enough parallelism (PyTorch is thread-safe
# for forward-pass inference when model weights are not mutated).
_SILERO_CONCURRENCY = int(os.environ.get("SILERO_CONCURRENCY", "1"))
inference_lock = asyncio.Semaphore(_SILERO_CONCURRENCY)

_LOG_FMT = "ts=%(asctime)sZ\tlevel=%(levelname)s\tlogger=%(name)s\t%(message)s"
_LOG_DATEFMT = "%Y-%m-%dT%H:%M:%S"


def _configure_process_logging() -> None:
    """
    Align uvicorn / FastAPI / app logs on stdout with ISO-style timestamps on every line,
    including exception tracebacks (single formatted record).
    """
    try:
        logging.basicConfig(
            level=logging.INFO,
            format=_LOG_FMT,
            datefmt=_LOG_DATEFMT,
            stream=sys.stdout,
            force=True,
        )
    except TypeError:
        # Python < 3.8
        root = logging.getLogger()
        root.handlers.clear()
        h = logging.StreamHandler(sys.stdout)
        h.setFormatter(logging.Formatter(fmt=_LOG_FMT, datefmt=_LOG_DATEFMT))
        root.addHandler(h)
        root.setLevel(logging.INFO)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True


_configure_process_logging()
log = logging.getLogger("silero_tts")


def _realign_uvicorn_loggers() -> None:
    """Uvicorn may attach handlers after import; keep access/error on our ts= root format."""
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

# --- Chunk sizing (upstream Silero `tts_utils.py` warns at 140 chars on JIT path; packaged v3/v4 models
# typically fail near ~800–1150+ chars depending on speaker/text — see silero-models issues). We treat a
# configurable ceiling and always leave headroom so each `apply_tts` call stays strictly under budget.
_DEFAULT_MODEL_INPUT_CHAR_LIMIT = 700
_DEFAULT_CHUNK_HEADROOM_RATIO = 0.18
_MIN_CHUNK_CHARS = 40
_MAX_MODEL_LIMIT = 4000


def _parse_model_input_char_limit() -> int:
    raw = os.environ.get("SILERO_TTS_MODEL_INPUT_CHAR_LIMIT", "").strip()
    if not raw:
        return _DEFAULT_MODEL_INPUT_CHAR_LIMIT
    try:
        return max(_MIN_CHUNK_CHARS, min(int(raw), _MAX_MODEL_LIMIT))
    except ValueError:
        return _DEFAULT_MODEL_INPUT_CHAR_LIMIT


def _parse_chunk_headroom_ratio() -> float:
    raw = os.environ.get("SILERO_TTS_CHUNK_HEADROOM_RATIO", "").strip()
    if not raw:
        return _DEFAULT_CHUNK_HEADROOM_RATIO
    try:
        r = float(raw)
        return max(0.0, min(r, 0.49))
    except ValueError:
        return _DEFAULT_CHUNK_HEADROOM_RATIO


def _effective_chunk_chars() -> int:
    """
    Max characters per `apply_tts` call after headroom, e.g. limit 100 & 10% headroom → 90 per chunk
    (200 chars → 90 + 90 + 20).
    Optional `SILERO_TTS_MAX_CHUNK_CHARS` caps further (never raises above derived safe size).
    """
    limit = _parse_model_input_char_limit()
    hr = _parse_chunk_headroom_ratio()
    derived = int(limit * (1.0 - hr))
    safe = max(_MIN_CHUNK_CHARS, derived)

    cap_raw = os.environ.get("SILERO_TTS_MAX_CHUNK_CHARS", "").strip()
    if cap_raw:
        try:
            cap = int(cap_raw)
            safe = min(safe, max(_MIN_CHUNK_CHARS, cap))
        except ValueError:
            pass
    return safe


def _split_oversized_segment(segment: str, max_chars: int) -> List[str]:
    """Break a segment that exceeds max_chars using word boundaries, then hard-split long tokens."""
    segment = segment.strip()
    if not segment:
        return []
    if len(segment) <= max_chars:
        return [segment]

    words = segment.split()
    if not words:
        return [segment[:max_chars]]

    chunks: List[str] = []
    buf: List[str] = []
    cur_len = 0

    def flush() -> None:
        nonlocal buf, cur_len
        if buf:
            chunks.append(" ".join(buf))
            buf = []
            cur_len = 0

    for w in words:
        sep_len = 1 if buf else 0
        if cur_len + sep_len + len(w) <= max_chars:
            buf.append(w)
            cur_len += sep_len + len(w)
            continue
        flush()
        if len(w) <= max_chars:
            buf = [w]
            cur_len = len(w)
        else:
            for i in range(0, len(w), max_chars):
                chunks.append(w[i : i + max_chars])
            buf = []
            cur_len = 0
    flush()
    return [c for c in chunks if c]


def _split_for_tts(text: str, max_chars: int) -> List[str]:
    """
    Split at sentence boundaries, merge small sentences into chunks <= max_chars, then word-split
    any piece that still exceeds max_chars. Guarantees len(c) <= max_chars for every chunk.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    # Hindi danda, Latin/European stops, ellipsis, newline
    raw_parts = re.split(r"(?<=[।.!?…\n])\s+", text)
    sentences = [p.strip() for p in raw_parts if p.strip()]
    if not sentences:
        return _split_oversized_segment(text, max_chars)

    merged: List[str] = []
    buf = ""

    for s in sentences:
        sep = " " if buf else ""
        candidate = buf + sep + s if buf else s
        if len(candidate) <= max_chars:
            buf = candidate
            continue
        if buf:
            merged.append(buf)
        if len(s) <= max_chars:
            buf = s
        else:
            merged.extend(_split_oversized_segment(s, max_chars))
            buf = ""

    if buf:
        merged.append(buf)

    final: List[str] = []
    for piece in merged:
        if len(piece) <= max_chars:
            final.append(piece)
        else:
            final.extend(_split_oversized_segment(piece, max_chars))

    return _ensure_chunks_under_limit([c for c in final if c], max_chars)


def _ensure_chunks_under_limit(parts: List[str], max_chars: int) -> List[str]:
    """Defensive pass: no chunk may exceed max_chars (word-split / hard-split)."""
    flat: List[str] = []
    for p in parts:
        if len(p) <= max_chars:
            flat.append(p)
        else:
            flat.extend(_split_oversized_segment(p, max_chars))
    return [x for x in flat if x]


def _tensor_to_mono_float(audio) -> np.ndarray:
    if isinstance(audio, torch.Tensor):
        arr = audio.detach().cpu().numpy()
    else:
        arr = np.asarray(audio)
    arr = np.squeeze(arr)
    if arr.ndim > 1:
        arr = arr.mean(axis=-1)
    return arr.astype(np.float32, copy=False)


def _apply_tts_chunk_or_split(
    model,
    speaker: str,
    sample_rate: int,
    chunk: str,
    min_piece: int = 48,
) -> np.ndarray:
    """
    Run apply_tts; if Silero still errors on length, bisect the chunk and concatenate audio.
    """
    chunk = chunk.strip()
    if not chunk:
        raise ValueError("empty chunk for apply_tts")
    try:
        audio = model.apply_tts(text=chunk, speaker=speaker, sample_rate=sample_rate)
        return _tensor_to_mono_float(audio)
    except Exception as e:
        el = str(e).lower()
        if len(chunk) <= min_piece * 2:
            raise
        if not any(s in el for s in ("too long", "couldn't generate", "could not generate", "couldn")):
            raise
        mid = max(min_piece, len(chunk) // 2)
        left = chunk[:mid].strip()
        right = chunk[mid:].strip()
        if not left or not right:
            raise
        log.warning(
            "tts_chunk_split_retry\ttotal_len=%d\tleft=%d\tright=%d\terror=%s",
            len(chunk),
            len(left),
            len(right),
            str(e)[:160],
        )
        a1 = _apply_tts_chunk_or_split(model, speaker, sample_rate, left, min_piece)
        gap = np.zeros(max(1, int(sample_rate * 0.04)), dtype=np.float32)
        a2 = _apply_tts_chunk_or_split(model, speaker, sample_rate, right, min_piece)
        return np.concatenate([a1, gap, a2])


# Language configuration with ISO 639-1 codes
LANGUAGE_CONFIG = {
    "hi": {  # Hindi
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["hindi_male", "hindi_female"],
        "romanization": lambda text: transliterate.process('Devanagari', 'ISO', text),
        "default_speaker": "hindi_male",
        "name": "Hindi"
    },
    "ml": {  # Malayalam
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["malayalam_male", "malayalam_female"],
        "romanization": lambda text: transliterate.process('Malayalam', 'ISO', text),
        "default_speaker": "malayalam_male",
        "name": "Malayalam"
    },
    "mni": {  # Manipuri
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["manipuri_female"],
        "romanization": lambda text: transliterate.process('Bengali', 'ISO', text),
        "default_speaker": "manipuri_female",
        "name": "Manipuri"
    },
    "bn": {  # Bengali
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["bengali_male", "bengali_female"],
        "romanization": lambda text: transliterate.process('Bengali', 'ISO', text),
        "default_speaker": "bengali_male",
        "name": "Bengali"
    },
    "raj": {  # Rajasthani
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["rajasthani_female"],
        "romanization": lambda text: transliterate.process('Devanagari', 'ISO', text),
        "default_speaker": "rajasthani_female",
        "name": "Rajasthani"
    },
    "ta": {  # Tamil
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["tamil_male", "tamil_female"],
        "romanization": lambda text: transliterate.process('Tamil', 'ISO', text, pre_options=['TamilTranscribe']),
        "default_speaker": "tamil_male",
        "name": "Tamil"
    },
    "te": {  # Telugu
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["telugu_male", "telugu_female"],
        "romanization": lambda text: transliterate.process('Telugu', 'ISO', text),
        "default_speaker": "telugu_male",
        "name": "Telugu"
    },
    "gu": {  # Gujarati
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["gujarati_male", "gujarati_female"],
        "romanization": lambda text: transliterate.process('Gujarati', 'ISO', text),
        "default_speaker": "gujarati_male",
        "name": "Gujarati"
    },
    "kn": {  # Kannada
        "model_lang": "indic",
        "model_speaker": "v4_indic",
        "speakers": ["kannada_male", "kannada_female"],
        "romanization": lambda text: transliterate.process('Kannada', 'ISO', text),
        "default_speaker": "kannada_male",
        "name": "Kannada"
    },
    "en": {  # English
        "model_lang": "en",
        "model_speaker": "v3_en",
        "speakers": ["en_0", "en_1", "en_2", "en_3", "en_4", "en_5", "en_6", "en_7", "en_8", "en_9",
                     "en_10", "en_11", "en_12", "en_13", "en_14", "en_15", "en_16", "en_17", "en_18",
                     "en_19", "en_20", "en_21", "en_22", "en_23", "en_24", "en_25", "en_26", "en_27",
                     "en_28", "en_29", "en_30", "en_31", "en_32", "en_33", "en_34", "en_35", "en_36",
                     "en_37", "en_38", "en_39", "en_40", "en_41", "en_42", "en_43", "en_44", "en_45",
                     "en_46", "en_47", "en_48", "en_49", "en_50", "en_51", "en_52", "en_53", "en_54",
                     "en_55", "en_56", "en_57", "en_58", "en_59", "en_60", "en_61", "en_62", "en_63",
                     "en_64", "en_65", "en_66", "en_67", "en_68", "en_69", "en_70", "en_71", "en_72",
                     "en_73", "en_74", "en_75", "en_76", "en_77", "en_78", "en_79", "en_80", "en_81",
                     "en_82", "en_83", "en_84", "en_85", "en_86", "en_87", "en_88", "en_89", "en_90",
                     "en_91", "en_92", "en_93", "en_94", "en_95", "en_96", "en_97", "en_98", "en_99",
                     "en_100", "en_101", "en_102", "en_103", "en_104", "en_105", "en_106", "en_107",
                     "en_108", "en_109", "en_110", "en_111", "en_112", "en_113", "en_114", "en_115",
                     "en_116", "en_117"],
        "romanization": None,
        "default_speaker": "en_0",
        "name": "English"
    }
}

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler for startup and shutdown"""
    global device, models, normalizer

    _realign_uvicorn_loggers()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    log.info("startup\tdevice=%s", device)

    normalizer = TTSTextNormalizer()
    log.info("startup\ttext_normalizer=ok")

    unique_models = {}
    for lang_code, config in LANGUAGE_CONFIG.items():
        model_key = f"{config['model_lang']}_{config['model_speaker']}"
        if model_key not in unique_models:
            log.info("startup\tloading_model=%s", model_key)
            model, _ = silero_tts(
                language=config["model_lang"],
                speaker=config["model_speaker"],
            )
            model.to(device)
            unique_models[model_key] = model
            log.info("startup\tmodel_loaded=%s", model_key)

    for lang_code, config in LANGUAGE_CONFIG.items():
        model_key = f"{config['model_lang']}_{config['model_speaker']}"
        models[lang_code] = unique_models[model_key]

    log.info("startup\tlanguages=%s", list(models.keys()))
    log.info("startup\tinference_concurrency=%d", _SILERO_CONCURRENCY)

    yield

    log.info("shutdown\tclearing_models")
    for m in unique_models.values():
        del m
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

app = FastAPI(
    title="Multi-Language Silero TTS API",
    description="Text-to-Speech API supporting Indian languages and English with ISO 639-1 language codes",
    lifespan=lifespan
)


class RequestLogMiddleware(BaseHTTPMiddleware):
    """Timestamped lines on every request start and finish (visible during long /tts synthesis)."""

    async def dispatch(self, request: Request, call_next):
        rid = (request.headers.get("x-request-id") or request.headers.get("X-Request-Id") or "-").strip()
        t0 = time.perf_counter()
        log.info(
            "http\trequest_id=%s\tevent=request_in\tmethod=%s\tpath=%s",
            rid,
            request.method,
            request.url.path,
        )
        try:
            response = await call_next(request)
        except Exception:
            log.exception(
                "http\trequest_id=%s\tevent=request_failed\tpath=%s\tduration_ms=%.1f",
                rid,
                request.url.path,
                (time.perf_counter() - t0) * 1000.0,
            )
            raise
        dur_ms = (time.perf_counter() - t0) * 1000.0
        log.info(
            "http\trequest_id=%s\tevent=request_out\tpath=%s\tstatus=%d\tduration_ms=%.1f",
            rid,
            request.url.path,
            response.status_code,
            dur_ms,
        )
        return response


# CORS: allow_credentials=True is incompatible with allow_origins=["*"] per Starlette.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Registered last → runs first on incoming requests (logs every hit before route work).
app.add_middleware(RequestLogMiddleware)

class TTSRequest(BaseModel):
    text: str
    language: str
    speaker: Optional[str] = None
    sample_rate: Optional[int] = None
    normalize: Optional[bool] = True  # Enable normalization by default

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "running",
        "device": str(device),
        "supported_languages": {code: config["name"] for code, config in LANGUAGE_CONFIG.items()},
        "models_loaded": len(models),
        "text_normalization": "enabled",
        "tts_model_input_char_limit": _parse_model_input_char_limit(),
        "tts_chunk_headroom_ratio": _parse_chunk_headroom_ratio(),
        "tts_effective_chunk_chars": _effective_chunk_chars(),
        "tts_note": "Chunks are sequential per process; parallel apply_tts on one Torch model is unsafe — scale with multiple Uvicorn workers.",
    }

@app.get("/languages")
async def get_languages():
    """Get list of supported languages and their speakers"""
    language_info = {}
    for lang_code, config in LANGUAGE_CONFIG.items():
        language_info[lang_code] = {
            "name": config["name"],
            "speakers": config["speakers"],
            "default_speaker": config["default_speaker"]
        }
    return language_info

@app.get("/languages/{language}/speakers")
async def get_language_speakers(language: str):
    """Get speakers for a specific language"""
    if language not in LANGUAGE_CONFIG:
        raise HTTPException(
            status_code=404,
            detail=f"Language code '{language}' not supported. Available: {list(LANGUAGE_CONFIG.keys())}"
        )

    config = LANGUAGE_CONFIG[language]
    return {
        "language_code": language,
        "language_name": config["name"],
        "speakers": config["speakers"],
        "default_speaker": config["default_speaker"]
    }


def _synthesize_to_buffer(
    language: str,
    text: str,
    speaker: str,
    sample_rate: int,
    do_normalize: bool,
) -> io.BytesIO:
    """Sync: normalize, optional romanize, Silero apply_tts (chunked), encode WAV."""
    if normalizer is None:
        raise RuntimeError("normalizer not initialized")
    config = LANGUAGE_CONFIG[language]
    model = models[language]
    if do_normalize:
        normalized_text = normalizer.normalize(text, language)
    else:
        normalized_text = text
    if config["romanization"]:
        processed_text = config["romanization"](normalized_text)
    else:
        processed_text = normalized_text

    max_c = _effective_chunk_chars()
    chunks = _split_for_tts(processed_text, max_c)
    if not chunks:
        chunks = [processed_text[:max_c]]

    if len(chunks) > 1:
        log.info(
            "tts_chunks\tlanguage=%s\tchunks=%d\tmax_chunk_chars=%d\ttotal_chars=%d",
            language,
            len(chunks),
            max_c,
            len(processed_text),
        )

    silence_len = max(1, int(sample_rate * 0.06))
    silence = np.zeros(silence_len, dtype=np.float32)

    pieces: list[np.ndarray] = []
    for idx, chunk in enumerate(chunks):
        arr = _apply_tts_chunk_or_split(model, speaker, sample_rate, chunk)
        pieces.append(arr)
        if idx < len(chunks) - 1:
            pieces.append(silence)

    merged = np.concatenate(pieces) if len(pieces) > 1 else pieces[0]

    buffer = io.BytesIO()
    sf.write(buffer, merged, sample_rate, format="WAV")
    buffer.seek(0)
    return buffer


@app.post("/tts")
async def text_to_speech(req: Request, body: TTSRequest):
    """
    Convert text to speech in multiple languages

    Args:
        text: Text in the specified language (required)
        language: ISO 639-1 language code (required) - en, hi, ta, bn, etc.
        speaker: Speaker voice (optional, uses default if not specified)
        sample_rate: Audio sample rate (optional, default: 48000)
        normalize: Enable text normalization for numbers/units (default: True)

    Returns:
        Audio file in WAV format
    """
    request_id = (req.headers.get("x-request-id") or req.headers.get("X-Request-Id") or "-").strip()
    t0 = time.perf_counter()
    log.info(
        "tts_http\trequest_id=%s\tevent=begin\tpath=/tts\tlanguage=%s\ttext_len=%d",
        request_id,
        body.language,
        len(body.text or ""),
    )
    if body.language not in LANGUAGE_CONFIG:
        log.warning(
            "tts_http\trequest_id=%s\tevent=bad_language\tlanguage=%s",
            request_id,
            body.language,
        )
        raise HTTPException(
            status_code=400,
            detail=f"Language code '{body.language}' not supported. Available: {list(LANGUAGE_CONFIG.keys())}",
        )

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    config = LANGUAGE_CONFIG[body.language]
    if models.get(body.language) is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    speaker = body.speaker if body.speaker else config["default_speaker"]
    sample_rate = body.sample_rate if body.sample_rate else 48000

    if speaker not in config["speakers"]:
        raise HTTPException(
            status_code=400,
            detail=f"Speaker '{speaker}' not available for {config['name']} ({body.language}). Available: {config['speakers']}",
        )

    do_norm = bool(body.normalize) if body.normalize is not None else True
    try:
        loop = asyncio.get_event_loop()

        def _work() -> io.BytesIO:
            return _synthesize_to_buffer(
                body.language,
                body.text,
                speaker,
                sample_rate,
                do_norm,
            )

        log.info(
            "tts_http\trequest_id=%s\tevent=synth_start\tlanguage=%s\ttext_len=%d\tspeaker=%s",
            request_id,
            body.language,
            len(body.text),
            speaker,
        )
        async with inference_lock:
            buffer = await loop.run_in_executor(None, _work)
        duration_ms = (time.perf_counter() - t0) * 1000.0
        log.info(
            "tts_http\trequest_id=%s\tevent=ok\tlanguage=%s\ttext_len=%d\tsample_rate=%d\tduration_ms=%.1f",
            request_id,
            body.language,
            len(body.text),
            sample_rate,
            duration_ms,
        )
        return StreamingResponse(
            buffer,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f"attachment; filename={body.language}_output.wav",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        duration_ms = (time.perf_counter() - t0) * 1000.0
        log.exception(
            "tts_http\trequest_id=%s\tevent=error\tlanguage=%s\tduration_ms=%.1f\terror=%s",
            request_id,
            body.language,
            duration_ms,
            str(e),
        )
        raise HTTPException(status_code=500, detail=f"Error generating audio: {str(e)}") from e

@app.websocket("/ws/tts")
async def websocket_tts(websocket: WebSocket):
    """
    WebSocket endpoint for streaming text-to-speech

    Expected message format:
    {
        "text": "Text in the specified language",  // required
        "language": "hi",  // required - ISO 639-1 code (en, hi, ta, bn, etc.)
        "speaker": "hindi_male",  // optional, uses default if not provided
        "sample_rate": 48000,  // optional, default is 48000
        "normalize": true  // optional, enable text normalization (default: true)
    }

    Response format:
    - Binary audio data (WAV format)
    - Or JSON error message: {"error": "error message"}
    """
    await websocket.accept()
    log.info("tts_ws\tevent=connected")

    try:
        while True:
            data = await websocket.receive_text()
            t0 = time.perf_counter()

            try:
                message = json.loads(data)
                text = message.get("text", "")
                language = message.get("language")
                speaker = message.get("speaker")
                sample_rate = message.get("sample_rate", 48000)
                normalize = message.get("normalize", True)

                if not text.strip():
                    await websocket.send_json({"error": "Text cannot be empty"})
                    continue

                if not language:
                    await websocket.send_json({
                        "error": "Language code is required",
                        "available_languages": {code: c["name"] for code, c in LANGUAGE_CONFIG.items()},
                    })
                    continue

                if language not in LANGUAGE_CONFIG:
                    await websocket.send_json({
                        "error": f"Language code '{language}' not supported",
                        "available_languages": {code: c["name"] for code, c in LANGUAGE_CONFIG.items()},
                    })
                    continue

                config = LANGUAGE_CONFIG[language]
                if models.get(language) is None:
                    await websocket.send_json({"error": "Model not loaded"})
                    continue

                if not speaker:
                    speaker = config["default_speaker"]

                if speaker not in config["speakers"]:
                    await websocket.send_json({
                        "error": f"Speaker '{speaker}' not available for {config['name']} ({language})",
                        "available_speakers": config["speakers"],
                    })
                    continue

                do_norm = bool(normalize) if normalize is not None else True
                loop = asyncio.get_event_loop()

                def _work() -> io.BytesIO:
                    return _synthesize_to_buffer(
                        language, text, speaker, int(sample_rate), do_norm
                    )

                async with inference_lock:
                    buffer = await loop.run_in_executor(None, _work)
                audio_bytes = buffer.read()
                duration_ms = (time.perf_counter() - t0) * 1000.0
                log.info(
                    "tts_ws\tevent=ok\tlanguage=%s\tbytes=%d\ttext_len=%d\tduration_ms=%.1f",
                    language,
                    len(audio_bytes),
                    len(text),
                    duration_ms,
                )
                await websocket.send_bytes(audio_bytes)

            except json.JSONDecodeError:
                await websocket.send_json({"error": "Invalid JSON format"})
            except Exception as e:
                error_msg = f"Error generating audio: {str(e)}"
                log.exception("tts_ws\tevent=error\terror=%s", str(e))
                await websocket.send_json({"error": error_msg})

    except WebSocketDisconnect:
        log.info("tts_ws\tevent=disconnected")
    except Exception as e:
        log.exception("tts_ws\tevent=fatal\terror=%s", str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=4001, reload=False)