import rateLimit from "express-rate-limit";
import type { Env } from "../config/env.js";

export function apiRateLimiter(env: Env) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
