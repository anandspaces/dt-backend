from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager
from typing import Optional
import asyncio
import io
import json
import logging
import time
import sys

import soundfile as sf
import torch
from aksharamukha import transliterate
from silero import silero_tts

from text_normalizer import TTSTextNormalizer

# Global model variables
device = None
models = {}
normalizer = None

# One synthesis at a time per process (GPU / torch stability). Scale with multiple Uvicorn workers.
inference_lock = asyncio.Lock()


def _setup_logging() -> logging.Logger:
    """Structured-ish key=value lines for ops / log aggregation."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="ts=%(asctime)sZ\tlevel=%(levelname)s\tlogger=%(name)s\t%(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )
    root = logging.getLogger("silero_tts")
    root.setLevel(logging.INFO)
    root.handlers.clear()
    root.addHandler(handler)
    root.propagate = False
    return root


log = _setup_logging()

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

# CORS: allow_credentials=True is incompatible with allow_origins=["*"] per Starlette.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        "text_normalization": "enabled"
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
    """Sync: normalize, optional romanize, Silero apply_tts, encode WAV. Run inside thread pool."""
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
    audio = model.apply_tts(
        text=processed_text,
        speaker=speaker,
        sample_rate=sample_rate,
    )
    if isinstance(audio, torch.Tensor):
        audio = audio.cpu().numpy()
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV")
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