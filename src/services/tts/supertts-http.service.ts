import { randomUUID } from "node:crypto";
import type { Env } from "../../config/env.js";
import type { AtomLang } from "../lang-detect/lang-detect.js";
import { logDebug, logInfo, logWarn } from "../../common/logger.js";
import { getOutboundLimit } from "../utils/outbound-limit.js";

const MAX_TTS_CHARS = 12_000;
/** Scales fetch timeout with input size — many Silero chunks arrive in one streaming POST. */
const TIMEOUT_MS_PER_500_CHARS = 28_000;
/** Extra headroom per retry after abort / slow responses. */
const TIMEOUT_MS_PER_ATTEMPT_EXTRA = 10_000;
const MAX_TRUNCATE_STEPS = 10;
const MIN_TRUNCATE_CHARS = 180;

/**
 * Text-to-speech over HTTP: POST `{ text, language }` to the local Silero FastAPI microservice.
 * Configured entirely via `TTS_HTTP_URL` / `TTS_*` env vars — no remote fallback.
 */
export class TtsHttpService {
  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return (this.env.TTS_HTTP_URL ?? "").trim().length > 0;
  }

  /**
   * Synthesize `text` via Silero. Retries on transient failures; truncates on "too-long" responses.
   * @param language BCP-47-ish code (`en`, `hi`, …). Falls back to `TTS_LANGUAGE` env var.
   */
  async synthesize(text: string, language?: AtomLang): Promise<{ buffer: Buffer; mime: string; fileExt: string }> {
    const url = (this.env.TTS_HTTP_URL ?? "").trim();
    if (!url.length) throw new Error("TTS_HTTP_URL is not set — start the Silero microservice and set TTS_HTTP_URL");

    const lang = ((language ?? this.env.TTS_LANGUAGE) || "en").trim();
    let trimmed = text.trim().slice(0, MAX_TTS_CHARS);
    let truncateStep = 0;

    const baseTimeoutMs = this.env.TTS_BASE_TIMEOUT_MS;
    const maxTimeoutMs = this.env.TTS_MAX_TIMEOUT_MS;
    const maxAttempts = this.env.TTS_MAX_ATTEMPTS;
    const limit = getOutboundLimit(this.env);
    const requestId = randomUUID();

    logDebug("tts.synthesize_start", {
      requestId,
      url,
      language: lang,
      textChars: trimmed.length,
    });

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const lengthBoost = Math.min(
        maxTimeoutMs - baseTimeoutMs,
        Math.floor(trimmed.length / 500) * TIMEOUT_MS_PER_500_CHARS,
      );
      const timeoutMs = Math.min(
        maxTimeoutMs,
        baseTimeoutMs + Math.max(0, lengthBoost) + attempt * TIMEOUT_MS_PER_ATTEMPT_EXTRA,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await limit(() =>
          fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "audio/*, application/json",
              "X-Request-Id": requestId,
            },
            body: JSON.stringify({ text: trimmed, language: lang }),
            signal: controller.signal,
          }),
        );

        const raw = await res.arrayBuffer();
        const buf = Buffer.from(raw);

        if (!res.ok) {
          const errSnippet = buf.toString("utf8").slice(0, 500);
          const status = res.status;
          const retriableHttp = status === 408 || status === 429 || status >= 500;
          const maybeTooLong =
            (status === 400 || status === 413 || status === 422 || status === 500) &&
            /too\s*long|text\s*too\s*long|length|maximum|exceed|couldn'?t generate|probably it'?s too long|input too large|token/i.test(
              errSnippet,
            );

          if (maybeTooLong && truncateStep < MAX_TRUNCATE_STEPS && trimmed.length > MIN_TRUNCATE_CHARS) {
            truncateStep += 1;
            trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.5));
            attempt -= 1;
            logDebug("tts.truncate", { requestId, truncateStep, newChars: trimmed.length, status });
            continue;
          }

          if (retriableHttp && attempt < maxAttempts - 1) {
            await sleepMs(600 * 2 ** Math.min(attempt, 5));
            continue;
          }

          logWarn("tts.http_final_error", {
            requestId,
            status,
            url,
            textChars: trimmed.length,
            language: lang,
            bodyPreview: errSnippet.slice(0, 240),
          });
          throw new Error(`TTS HTTP ${String(status)}: ${errSnippet}`);
        }

        const ct = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() || "";
        if (ct.startsWith("audio/")) {
          logInfo("tts.ok", { requestId, mime: ct, bytes: buf.length, textChars: trimmed.length, attempt });
          return { buffer: buf, mime: ct, fileExt: mimeToExt(ct) };
        }

        if (ct.includes("json") || looksLikeJson(buf)) {
          const parsed = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
          const b64 =
            (typeof parsed.audio === "string" && parsed.audio) ||
            (typeof parsed.data === "string" && parsed.data) ||
            (typeof parsed.audioBase64 === "string" && parsed.audioBase64) ||
            (typeof parsed.base64 === "string" && parsed.base64);
          if (!b64) throw new Error("TTS JSON response: no base64 audio field");
          const decoded = Buffer.from(b64, "base64");
          const mimeRaw =
            (typeof parsed.mimeType === "string" && parsed.mimeType) ||
            (typeof parsed.mime === "string" && parsed.mime) ||
            "audio/mpeg";
          const mimeNorm = mimeRaw.split(";")[0]?.trim() || "audio/mpeg";
          logInfo("tts.ok_json", { requestId, mime: mimeNorm, bytes: decoded.length, textChars: trimmed.length, attempt });
          return { buffer: decoded, mime: mimeNorm, fileExt: mimeToExt(mimeNorm) };
        }

        // Detect MP3 / WAV by magic bytes
        if (buf.length > 0 && buf[0] === 0xff && (buf[1] ?? 0) >= 0xe0) {
          return { buffer: buf, mime: "audio/mpeg", fileExt: "mp3" };
        }
        if (buf.subarray(0, 4).toString("ascii") === "RIFF") {
          return { buffer: buf, mime: "audio/wav", fileExt: "wav" };
        }
        return { buffer: buf, mime: "application/octet-stream", fileExt: "bin" };
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        if (isAbort && attempt < maxAttempts - 1) {
          logDebug("tts.timeout_retry", { requestId, attempt, timeoutMs });
          await sleepMs(800 * 2 ** Math.min(attempt, 5));
          continue;
        }
        if (isAbort) {
          logWarn("tts.timeout_abort", { requestId, attempt, timeoutMs, textChars: trimmed.length });
          throw e;
        }
        const retriable =
          isLikelyNetworkError(e) ||
          (e instanceof Error && /TTS HTTP (408|429|5\d\d)/.test(e.message));
        if (retriable && attempt < maxAttempts - 1) {
          await sleepMs(600 * 2 ** Math.min(attempt, 5));
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    logWarn("tts.exhausted", { requestId, url, textChars: trimmed.length, language: lang, maxAttempts });
    throw new Error(`TTS: exhausted ${String(maxAttempts)} attempts for requestId=${requestId}`);
  }
}

/** Probe the TTS endpoint with a minimal request. Throws if unreachable. */
export async function probeTts(env: Env): Promise<void> {
  const url = (env.TTS_HTTP_URL ?? "").trim();
  if (!url.length) return; // TTS disabled — skip probe
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Request-Id": "probe" },
      body: JSON.stringify({ text: "hi", language: env.TTS_LANGUAGE || "en" }),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 400 && res.status !== 422) {
      throw new Error(`TTS probe returned HTTP ${String(res.status)}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`TTS endpoint unreachable at ${url}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Backwards-compat alias ───────────────────────────────────────────────────
/** @deprecated Use `TtsHttpService` directly. */
export const SuperTtsHttpService = TtsHttpService;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isLikelyNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const codes = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);
  const any = e as { cause?: { code?: string }; code?: string };
  if (any.code && codes.has(any.code)) return true;
  if (any.cause?.code && codes.has(any.cause.code)) return true;
  return e.message === "fetch failed";
}

function looksLikeJson(buf: Buffer): boolean {
  const s = buf.toString("utf8", 0, Math.min(80, buf.length)).trim();
  return s.startsWith("{") || s.startsWith("[");
}

function mimeToExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("webm")) return "webm";
  if (m.includes("mp4") || m.includes("aac")) return "m4a";
  return "audio";
}
