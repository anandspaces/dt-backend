/**
 * Gemini image-generation service.
 *
 * Uses the REST API directly (model: GEMINI_IMAGE_MODEL env var, e.g.
 * `gemini-2.0-flash-preview-image-generation`) so it works independently of
 * which @google/generative-ai SDK version is installed.
 *
 * Returns a PNG/JPEG Buffer + mime type on success.
 * Returns null only when the image model is not configured.
 * On HTTP 200 with no inline image, logs diagnostics and throws an Error (callers persist `error`).
 *
 * Notes (Gemini 3 image / “Nano Banana” family):
 * - Gemini 3 uses `thinkingLevel`, not `thinkingBudget`. Sending `thinkingBudget` with a Gemini 3
 *   model conflicts with docs and can yield broken responses.
 * - Image models may emit multiple `inlineData` parts (draft thoughts vs final). Parts with
 *   `thought: true` are reasoning drafts; we prefer the last non-thought image, then fall back to
 *   the last image part.
 * - If the output token budget is too small, the model may STOP after reasoning with only
 *   `text` + `thoughtSignature`. Use `GEMINI_IMAGE_MAX_OUTPUT_TOKENS` (default 32768).
 */

import { logWarn } from "../../common/logger.js";
import type { Env } from "../../config/env.js";

const MAX_ATTEMPTS = 2;
const BASE_DELAY_MS = 600;

export type GeneratedImage = {
  buffer: Buffer;
  mime: string;
  fileExt: string;
};

function truncate(str: unknown, max: number): string {
  const s = typeof str === "string" ? str : JSON.stringify(str);
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Collect every non-inline part key from all candidates (diagnostics). */
function collectPartKeySummary(apiJson: unknown): string[] {
  const j = apiJson as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };
  const keys: string[] = [];
  for (const cand of j.candidates ?? []) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (!p || typeof p !== "object") keys.push("?");
      else keys.push(Object.keys(p as object).join("+"));
    }
  }
  return keys;
}

function decodeInlinePart(part: Record<string, unknown>): { mime: string; buffer: Buffer } | null {
  const raw = part.inlineData ?? part.inline_data;
  if (!raw || typeof raw !== "object") return null;
  const id = raw as Record<string, unknown>;
  const data = id.data;
  if (typeof data !== "string" || !data.length) return null;
  const mime =
    (typeof id.mimeType === "string" && id.mimeType) ||
    (typeof id.mime_type === "string" && id.mime_type) ||
    "image/png";
  return { mime, buffer: Buffer.from(data, "base64") };
}

/**
 * Prefer the last non-thought inline image (Gemini 3 may emit draft images with `thought: true`).
 * Fall back to the last inline image if every part is marked thought.
 */
function extractBestInlineImage(apiJson: unknown): { mime: string; buffer: Buffer } | null {
  const j = apiJson as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };

  const nonThought: { mime: string; buffer: Buffer }[] = [];
  const anyInline: { mime: string; buffer: Buffer }[] = [];

  for (const cand of j.candidates ?? []) {
    const parts = cand?.content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      if (!p || typeof p !== "object") continue;
      const part = p as Record<string, unknown>;
      const decoded = decodeInlinePart(part);
      if (!decoded) continue;
      anyInline.push(decoded);
      if (part.thought !== true) nonThought.push(decoded);
    }
  }

  if (nonThought.length) return nonThought[nonThought.length - 1]!;
  if (anyInline.length) return anyInline[anyInline.length - 1]!;
  return null;
}

/** Build a short error when the API omits inline image data (often safety / text-only). */
function summarizeNoInlineImage(apiJson: unknown, modelId: string): string {
  const j = apiJson as Record<string, unknown>;
  const errBlock = j.error as Record<string, unknown> | undefined;
  const topErr = errBlock?.message ?? errBlock?.status;
  const cand0 = Array.isArray(j.candidates)
    ? (j.candidates[0] as Record<string, unknown> | undefined)
    : undefined;
  const finishReason = cand0?.finishReason ?? cand0?.finish_reason;
  const partTypes = collectPartKeySummary(apiJson);
  const promptFb = j.promptFeedback as Record<string, unknown> | undefined;
  const safety = cand0?.safetyRatings ?? cand0?.safety_ratings;
  const bits: string[] = [`no_image_inline`, `model=${modelId}`];
  if (finishReason != null) bits.push(`finishReason=${String(finishReason)}`);
  if (topErr != null) bits.push(`apiError=${truncate(topErr, 120)}`);
  if (promptFb?.blockReason != null || promptFb?.block_reason != null) {
    bits.push(`blockReason=${String(promptFb.blockReason ?? promptFb.block_reason)}`);
  }
  if (safety != null) bits.push(`safety=${truncate(safety, 200)}`);
  if (partTypes.length) bits.push(`parts=${partTypes.slice(0, 16).join(";")}`);
  logWarn("gemini.image.no_inline_image", {
    modelId,
    finishReason: finishReason ?? null,
    partSummary: partTypes.slice(0, 16),
    promptBlockReason: promptFb?.blockReason ?? promptFb?.block_reason ?? null,
  });
  return bits.join(" ");
}

export class GeminiImageService {
  private readonly apiKey: string | undefined;
  private readonly modelId: string | undefined;
  private readonly aspectRatio: string;
  private readonly maxOutputTokens: number;

  constructor(env: Env) {
    const imageKey = env.GEMINI_API_KEY_IMAGE?.trim();
    const fallback = env.GEMINI_API_KEY?.trim();
    this.apiKey = imageKey || fallback;
    this.modelId = env.GEMINI_IMAGE_MODEL;
    this.aspectRatio = env.GEMINI_IMAGE_ASPECT_RATIO.trim() || "3:4";
    this.maxOutputTokens = env.GEMINI_IMAGE_MAX_OUTPUT_TOKENS;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey?.trim() && this.modelId?.trim());
  }

  /** Gemini 3 models use thinkingLevel; gemini-2.5 uses thinkingBudget (do not mix). */
  private isGemini3Model(): boolean {
    return /^gemini-3/i.test(this.modelId ?? "");
  }

  /** Vertex docs: Gemini 3 Pro Image supports a narrower thinking-level set than Flash Image. */
  private isGemini3ProImageModel(): boolean {
    const m = this.modelId ?? "";
    return /^gemini-3/i.test(m) && m.includes("pro-image");
  }

  private withMaxTokens(base: Record<string, unknown>): Record<string, unknown> {
    return { ...base, maxOutputTokens: this.maxOutputTokens };
  }

  /**
   * Ordered request strategies. Gemini 3: never send thinkingBudget.
   * Gemini 2.5: thinkingBudget 0 remains a valid way to reduce reasoning-only responses.
   */
  private imageGenerationStrategies(): Record<string, unknown>[] {
    const ar = this.aspectRatio;

    if (this.isGemini3Model()) {
      const list: Record<string, unknown>[] = [
        this.withMaxTokens({
          responseModalities: ["TEXT", "IMAGE"],
          imageConfig: { aspectRatio: ar },
        }),
        this.withMaxTokens({
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: ar },
        }),
      ];
      // Flash Image etc.: try lower reasoning cost before stripping imageConfig.
      if (!this.isGemini3ProImageModel()) {
        list.push(
          this.withMaxTokens({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: ar },
            thinkingConfig: { thinkingLevel: "LOW" },
          }),
        );
      }
      list.push(this.withMaxTokens({ responseModalities: ["TEXT", "IMAGE"] }));
      // Pro Image: Vertex may only document HIGH; LOW sometimes works on AI Studio — last resort before fail.
      if (this.isGemini3ProImageModel()) {
        list.push(
          this.withMaxTokens({
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: ar },
            thinkingConfig: { thinkingLevel: "LOW" },
          }),
        );
      }
      return list;
    }

    return [
      this.withMaxTokens({
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: ar },
        thinkingConfig: { thinkingBudget: 0 },
      }),
      this.withMaxTokens({
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: ar },
        thinkingConfig: { thinkingBudget: 0 },
      }),
      this.withMaxTokens({
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: ar },
      }),
      this.withMaxTokens({
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: ar },
      }),
      this.withMaxTokens({ responseModalities: ["TEXT", "IMAGE"] }),
    ];
  }

  async generate(imagePrompt: string): Promise<GeneratedImage | null> {
    if (!this.isConfigured()) return null;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId!}:generateContent?key=${this.apiKey!}`;
    let lastOkJson: unknown | undefined;

    for (const generationConfig of this.imageGenerationStrategies()) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const body = JSON.stringify({
          contents: [{ role: "user", parts: [{ text: imagePrompt }] }],
          generationConfig,
        });

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText);
          if (res.status === 429 || res.status >= 500) {
            if (attempt >= MAX_ATTEMPTS) {
              throw new Error(`Gemini image API ${res.status} after retries: ${msg}`);
            }
            await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
            continue;
          }
          if (res.status === 400) {
            logWarn("gemini.image.strategy_400", {
              modelId: this.modelId,
              detail: truncate(msg, 280),
            });
            break;
          }
          throw new Error(`Gemini image API ${res.status}: ${msg}`);
        }

        const json = await res.json();
        lastOkJson = json;
        const extracted = extractBestInlineImage(json);
        if (extracted) {
          const mime = extracted.mime;
          const fileExt = mime === "image/jpeg" ? "jpg" : "png";
          return { buffer: extracted.buffer, mime, fileExt };
        }
        break;
      }
    }

    throw new Error(summarizeNoInlineImage(lastOkJson ?? {}, this.modelId!));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
