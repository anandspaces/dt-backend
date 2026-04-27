import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Env } from "../../config/env.js";
import { HttpError } from "../../common/http-error.js";
import { getOutboundLimit } from "../utils/outbound-limit.js";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

export class GeminiClient {
  private readonly genAI: GoogleGenerativeAI | null;
  private readonly modelId: string;
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
    const key = env.GEMINI_API_KEY;
    const model = env.GEMINI_MODEL;
    if (!key || !model) {
      this.genAI = null;
      this.modelId = "";
      return;
    }
    this.genAI = new GoogleGenerativeAI(key);
    this.modelId = model;
  }

  isConfigured(): boolean {
    return this.genAI !== null && this.modelId.length > 0;
  }

  async generateText(prompt: string): Promise<string> {
    if (!this.genAI || !this.modelId) {
      throw HttpError.badRequest("Gemini is not configured (GEMINI_API_KEY / GEMINI_MODEL)");
    }
    const model = this.genAI.getGenerativeModel({ model: this.modelId });
    const limit = getOutboundLimit(this.env);
    const timeoutMs = this.env.GEMINI_TEXT_TIMEOUT_MS;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await limit(() => {
          const controller = new AbortController();
          const timer = setTimeout(() => {
            controller.abort();
          }, timeoutMs);
          return model
            .generateContent(prompt, { signal: controller.signal, timeout: timeoutMs })
            .finally(() => {
              clearTimeout(timer);
            });
        });
        return result.response.text();
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
