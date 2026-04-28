# Silero TTS microservice (port 4001)

Self-contained FastAPI service for **POST `/tts`** (`audio/wav`). Lives at repo root in **`silero-tts/`** so the Node backend keeps only TypeScript clients under `src/services/tts/`.

## Run locally

From this directory:

```bash
cd silero-tts
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 4001
```

Health: `GET http://127.0.0.1:4001/` — shows `tts_effective_chunk_chars` and related tuning.

### Uvicorn module path

Run from **`silero-tts/`** so `app` resolves (`uvicorn app:app`).

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

## Long text / chunk limits

Upstream Silero (packaged v3/v4) does not publish one fixed character cap; failures often occur near **~800–1150+** characters depending on speaker and text. The helper in `silero/tts_utils.py` warns at **140** symbols on older JIT paths. We treat a **soft model ceiling** and always stay **below** it:

| Env | Meaning | Default |
|-----|---------|--------|
| `SILERO_TTS_MODEL_INPUT_CHAR_LIMIT` | Approximate max single-pass length before Silero often errors | `950` |
| `SILERO_TTS_CHUNK_HEADROOM_RATIO` | Fraction kept empty, e.g. `0.12` → use at most **88%** of the limit per chunk | `0.12` |
| `SILERO_TTS_MAX_CHUNK_CHARS` | Optional hard cap **lower** than the derived size (stricter safety) | unset |

**Effective chunk size** ≈ `floor(MODEL_INPUT_CHAR_LIMIT × (1 - HEADROOM))`, then optionally capped by `MAX_CHUNK_CHARS`. Example: limit **100** and headroom **0.1** → **90** chars per chunk; **200** chars of input → **90 + 90 + 20**.

Splitting order: **sentence boundaries** (`।` `.` `!` `?` …) → **merge** short sentences into chunks under the limit → **word** packing → **hard** split for pathological tokens.

## Concurrency vs “multithreading”

**Do not** run parallel `apply_tts` on the **same** Torch model from multiple threads (racey / unstable). This service processes chunks **sequentially** under one **`asyncio.Lock`** per process.

For higher throughput, run **multiple Uvicorn worker processes** (each loads its own model — high RAM/VRAM) or separate replicas behind a load balancer—not threads inside one worker.

## Logging

Logs use **`ts=`** timestamps on stdout (including **`uvicorn`** lines and Python tracebacks). Send **`X-Request-Id`** from callers to correlate with parse-export logs.

On each HTTP request you get **`http … event=request_in`** immediately and **`request_out`** when the response is sent (long **`POST /tts`** stays “in flight” until synthesis finishes). The **`POST /tts`** handler also logs **`tts_http … event=begin`**, **`event=synth_start`** (just before inference), and **`event=ok`** on success.

The **`--reload`** parent process may still print a few plain **`INFO:`** lines without `ts=`; the worker process uses the structured format.

If timestamps disappear, ensure you did not attach a separate `--log-config` that overrides root logging.
