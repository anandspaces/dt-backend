import pLimit, { type LimitFunction } from "p-limit";
import type { Env } from "../../config/env.js";

let cached: { limit: LimitFunction; size: number } | null = null;

/**
 * Process-wide ceiling on concurrent outbound HTTP calls to Gemini text/image and SuperTTS.
 * Driven by `PARSE_EXPORT_OUTBOUND_CONCURRENCY`. Cached so all callers share one queue —
 * that's what prevents 20 active jobs × 6 inner thunks from saturating the event loop and
 * starving the BullMQ lock-renewal heartbeat.
 */
export function getOutboundLimit(env: Env): LimitFunction {
  const size = Math.max(1, env.PARSE_EXPORT_OUTBOUND_CONCURRENCY);
  if (!cached || cached.size !== size) {
    cached = { limit: pLimit(size), size };
  }
  return cached.limit;
}
