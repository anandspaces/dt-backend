import type { Env } from "../../config/env.js";
import type { AtomLang } from "../lang-detect/lang-detect.js";

const MAX_TTS_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FETCH_ATTEMPTS = 3;
const MIN_TRUNCATE_CHARS = 2_000;

/**
 * SuperTTS HTTP API: POST JSON `{ text, language }`.
 * Accepts raw `audio/*` body, or JSON with base64 in `audio` / `data` / `audioBase64`.
 */
export class SuperTtsHttpService {
  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return (this.env.SUPERTTS_HTTP_URL ?? "").trim().length > 0;
  }

  /**
   * @param language BCP-47-ish code sent to SuperTTS (`en`, `hi`, …). Falls back to `SUPERTTS_LANGUAGE`.
   */
  async synthesize(text: string, language?: AtomLang): Promise<{ buffer: Buffer; mime: string; fileExt: string }> {
    const url = (this.env.SUPERTTS_HTTP_URL ?? "").trim();
    if (!url.length) throw new Error("SUPERTTS_HTTP_URL not set");

    let trimmed = text.trim().slice(0, MAX_TTS_CHARS);
    const fallbackLang = this.env.SUPERTTS_LANGUAGE.trim() || "en";
    const lang = (language ?? fallbackLang).trim() || "en";
    let didTruncateRetry = false;

    for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, DEFAULT_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/*, application/json" },
          body: JSON.stringify({ text: trimmed, language: lang }),
          signal: controller.signal,
        });
        const raw = await res.arrayBuffer();
        const buf = Buffer.from(raw);
        if (!res.ok) {
          const errSnippet = buf.toString("utf8").slice(0, 500);
          const status = res.status;
          const retriableHttp = status === 429 || status >= 500;
          const maybeTooLong =
            (status === 400 || status === 500) &&
            /too\s*long|text\s*too\s*long|length|maximum|exceed/i.test(errSnippet);

          if (maybeTooLong && !didTruncateRetry && trimmed.length > MIN_TRUNCATE_CHARS) {
            didTruncateRetry = true;
            trimmed = trimmed.slice(0, Math.floor(trimmed.length * 0.55));
            attempt -= 1;
            continue;
          }

          if (retriableHttp && attempt < MAX_FETCH_ATTEMPTS - 1) {
            await sleepMs(500 * 2 ** attempt);
            continue;
          }

          throw new Error(`SuperTTS HTTP ${String(status)}: ${errSnippet}`);
        }

        const ct = (res.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() || "";
        if (ct.startsWith("audio/")) {
          return { buffer: buf, mime: ct, fileExt: mimeToExt(ct) };
        }

        if (ct.includes("json") || looksLikeJson(buf)) {
          const parsed = JSON.parse(buf.toString("utf8")) as Record<string, unknown>;
          const b64 =
            (typeof parsed.audio === "string" && parsed.audio) ||
            (typeof parsed.data === "string" && parsed.data) ||
            (typeof parsed.audioBase64 === "string" && parsed.audioBase64) ||
            (typeof parsed.base64 === "string" && parsed.base64);
          if (!b64) throw new Error("SuperTTS JSON: no base64 audio field");
          const decoded = Buffer.from(b64, "base64");
          const mimeRaw =
            (typeof parsed.mimeType === "string" && parsed.mimeType) ||
            (typeof parsed.mime === "string" && parsed.mime) ||
            "audio/mpeg";
          const mimeNorm = mimeRaw.split(";")[0]?.trim() || "audio/mpeg";
          const ext = mimeToExt(mimeNorm);
          return { buffer: decoded, mime: mimeNorm, fileExt: ext };
        }

        if (buf.length > 0 && buf[0] === 0xff && (buf[1] ?? 0) >= 0xe0) {
          return { buffer: buf, mime: "audio/mpeg", fileExt: "mp3" };
        }
        if (buf.subarray(0, 4).toString("ascii") === "RIFF") {
          return { buffer: buf, mime: "audio/wav", fileExt: "wav" };
        }
        return { buffer: buf, mime: "application/octet-stream", fileExt: "bin" };
      } catch (e) {
        const isAbort = e instanceof Error && e.name === "AbortError";
        if (isAbort) throw e;
        const retriable =
          isLikelyNetworkError(e) ||
          (e instanceof Error && /SuperTTS HTTP (429|5\d\d)/.test(e.message));
        if (retriable && attempt < MAX_FETCH_ATTEMPTS - 1) {
          await sleepMs(500 * 2 ** attempt);
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("SuperTTS: exhausted retries");
  }
}

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
