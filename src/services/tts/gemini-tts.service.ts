import type { Env } from "../../config/env.js";
import type { AtomLang } from "../lang-detect/lang-detect.js";

const GEMINI_GENERATE =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** Max input length for TTS request body (Gemini TTS preview limits are large; keep atoms bounded). */
const MAX_TTS_CHARS = 12_000;

/**
 * Gemini native TTS (preview) via `generateContent` + AUDIO modality.
 * Stores WAV when the API returns raw PCM (24 kHz mono); passes through if inline audio is already WAV/MP3.
 * Requires GEMINI_API_KEY and GEMINI_TTS_MODEL.
 */
export class GeminiTtsService {
  constructor(private readonly env: Env) {}

  isConfigured(): boolean {
    return (
      !!this.env.GEMINI_API_KEY?.length &&
      !!this.env.GEMINI_TTS_MODEL?.length
    );
  }

  /**
   * Returns audio bytes and MIME type for storage (e.g. audio/wav or audio/mpeg).
   */
  async synthesize(text: string, language: AtomLang = "en"): Promise<{ buffer: Buffer; mime: string; fileExt: string }> {
    const key = this.env.GEMINI_API_KEY;
    const model = this.env.GEMINI_TTS_MODEL;
    if (!key?.length) throw new Error("GEMINI_API_KEY not set");
    if (!model?.length) throw new Error("GEMINI_TTS_MODEL not set");

    const trimmed = text.trim().slice(0, MAX_TTS_CHARS);
    const voice =
      language === "hi"
        ? (this.env.GEMINI_TTS_VOICE_HI?.trim() ||
            this.env.GEMINI_TTS_VOICE?.trim() ||
            "Kore")
        : (this.env.GEMINI_TTS_VOICE?.trim() || "Kore");

    const langLine =
      language === "hi"
        ? "Read the following clearly in Hindi, neutral educational tone:\n\n"
        : "Read the following clearly in English, neutral educational tone:\n\n";

    const url = `${GEMINI_GENERATE}/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `${langLine}${trimmed}`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voice,
              },
            },
          },
        },
      }),
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`Gemini TTS failed: ${String(res.status)} ${raw}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error(`Gemini TTS: invalid JSON response`);
    }

    const errMsg = extractApiError(parsed);
    if (errMsg) throw new Error(`Gemini TTS: ${errMsg}`);

    const inline = extractInlineAudio(parsed);
    if (!inline?.data) {
      throw new Error("Gemini TTS: no audio in response");
    }

    const mime = normalizeMime(inline.mimeType);
    const buf = Buffer.from(inline.data, "base64");

    if (mime.includes("mpeg") || mime === "audio/mp3") {
      return { buffer: buf, mime: "audio/mpeg", fileExt: "mp3" };
    }
    if (mime.includes("wav")) {
      return { buffer: buf, mime: "audio/wav", fileExt: "wav" };
    }

    // Raw PCM (common for Gemini TTS preview): wrap as WAV for playback.
    const sampleRate = parseSampleRateFromMime(mime) ?? 24_000;
    const wav = pcm16MonoToWav(buf, sampleRate);
    return { buffer: wav, mime: "audio/wav", fileExt: "wav" };
  }
}

function extractApiError(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const p = parsed as { error?: { message?: string } };
  return p.error?.message;
}

function extractInlineAudio(parsed: unknown): { mimeType: string; data: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const cands = (parsed as { candidates?: unknown[] }).candidates;
  if (!Array.isArray(cands) || !cands[0]) return null;
  const parts = (cands[0] as { content?: { parts?: unknown[] } }).content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const o = part as {
      inlineData?: { mimeType?: string; data?: string };
      inline_data?: { mime_type?: string; data?: string };
    };
    const id = o.inlineData ?? o.inline_data;
    if (id?.data) {
      const mime =
        "mimeType" in id && id.mimeType
          ? id.mimeType
          : "mime_type" in id && id.mime_type
            ? id.mime_type
            : "application/octet-stream";
      return { mimeType: mime, data: id.data };
    }
  }
  return null;
}

function normalizeMime(m: string): string {
  return m.split(";")[0]?.trim().toLowerCase() ?? "";
}

function parseSampleRateFromMime(m: string): number | undefined {
  const rate = /rate=(\d+)/i.exec(m);
  if (rate?.[1]) return Number.parseInt(rate[1], 10);
  return undefined;
}

/** Wraps little-endian PCM16 mono in a minimal WAV container. */
function pcm16MonoToWav(pcm: Buffer, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(numChannels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitsPerSample, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);
  pcm.copy(out, 44);
  return out;
}
