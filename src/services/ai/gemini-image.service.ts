/**
 * Gemini image-generation service.
 *
 * Uses the REST API directly (model: GEMINI_IMAGE_MODEL env var, e.g.
 * `gemini-2.0-flash-preview-image-generation`) so it works independently of
 * which @google/generative-ai SDK version is installed.
 *
 * Returns a PNG/JPEG Buffer + mime type on success.
 * Returns null when the model is not configured or the API returns no image part.
 */

import type { Env } from "../../config/env.js";

const MAX_ATTEMPTS = 2;
const BASE_DELAY_MS = 600;

export type GeneratedImage = {
  buffer: Buffer;
  mime: string;
  fileExt: string;
};

export class GeminiImageService {
  private readonly apiKey: string | undefined;
  private readonly modelId: string | undefined;

  constructor(env: Env) {
    this.apiKey = env.GEMINI_API_KEY;
    this.modelId = env.GEMINI_IMAGE_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey?.trim() && this.modelId?.trim());
  }

  async generate(imagePrompt: string): Promise<GeneratedImage | null> {
    if (!this.isConfigured()) return null;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId!}:generateContent?key=${this.apiKey!}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    });

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText);
          if (res.status === 429 || res.status >= 500) {
            lastErr = new Error(`Gemini image API ${res.status}: ${msg}`);
            await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
            continue;
          }
          throw new Error(`Gemini image API ${res.status}: ${msg}`);
        }

        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
          }>;
        };

        const parts = json.candidates?.[0]?.content?.parts ?? [];
        const imgPart = parts.find((p) => p.inlineData?.data);
        if (!imgPart?.inlineData?.data) return null;

        const mime = imgPart.inlineData.mimeType ?? "image/png";
        const fileExt = mime === "image/jpeg" ? "jpg" : "png";
        const buffer = Buffer.from(imgPart.inlineData.data, "base64");
        return { buffer, mime, fileExt };
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_ATTEMPTS && shouldRetry(e)) {
          await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        throw e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function shouldRetry(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status?: number }).status;
    return s === 429 || (typeof s === "number" && s >= 500);
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
