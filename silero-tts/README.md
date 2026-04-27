# Silero TTS microservice (port 4001)

Self-contained FastAPI service for **POST `/tts`** (`audio/wav`). Lives at repo root in **`silero-tts/`** so the Node backend keeps only TypeScript clients under `src/services/tts/`.

## Run locally

From this directory:

```bash
cd silero-tts
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m silero_tts
```

Health: `GET http://127.0.0.1:4001/`

### Uvicorn (optional)

```bash
uvicorn silero_tts.app:app --host 0.0.0.0 --port 4001
```

(requires `PYTHONPATH` pointing at the parent of `silero_tts`, e.g. run from `silero-tts/`)

## Docker

From repository root:

```bash
docker compose --profile silero build silero-tts
docker compose --profile silero up silero-tts
```

Point workers at **`SILERO_TTS_HTTP_URL=http://silero-tts:4001/tts`** (Compose network) or **`http://127.0.0.1:4001/tts`** on the host.

## Node backend env

Either variable is accepted; **Silero URL wins** if both are set:

```bash
SILERO_TTS_HTTP_URL=http://127.0.0.1:4001/tts
# or legacy:
SUPERTTS_HTTP_URL=http://127.0.0.1:4001/tts
```

The Bun worker uses **`SuperTtsHttpService`** with JSON `{"text","language",...}` compatible with **`POST /tts`**.

## Concurrency

Inference uses an **`asyncio.Lock`**: one synthesis at a time **per process**. Scale with multiple Uvicorn workers or replicas (each loads models — plan RAM/VRAM).

## Logging

Structured lines to stdout; send **`X-Request-Id`** from callers to correlate with parse-export logs.
