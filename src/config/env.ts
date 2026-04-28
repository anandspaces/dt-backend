import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    /** PostgreSQL connection string (`postgres://` or `postgresql://`). */
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z
      .string()
      .min(32)
      .default("development-only-jwt-secret-min-32-chars!"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    GEMINI_API_KEY: z.string().optional(),
    /**
     * Optional separate API key for Gemini image REST (`generateContent` image modalities).
     * When unset, image generation uses `GEMINI_API_KEY` (same as text).
     */
    GEMINI_API_KEY_IMAGE: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    /**
     * Gemini TTS model id (e.g. `gemini-2.5-flash-preview-tts`). When unset, full-PDF TTS is skipped.
     */
    GEMINI_TTS_MODEL: z.string().optional(),
    /** Prebuilt voice name for Gemini TTS (default Kore). */
    GEMINI_TTS_VOICE: z.string().optional(),
    /** Optional voice for Hindi TTS; falls back to GEMINI_TTS_VOICE then Kore. */
    GEMINI_TTS_VOICE_HI: z.string().optional(),
    /**
     * Gemini image-generation model id (e.g. `gemini-2.0-flash-preview-image-generation`).
     * When set, parse-export generates one illustration image per atom / topic / chapter.
     * When unset, the illustration prompt is stored in `image.payload` for external use.
     */
    GEMINI_IMAGE_MODEL: z.string().optional(),
    /** Gemini image aspect ratio for `imageConfig`. `4:5` ≈ portrait document / near A4 among API presets; override if needed. */
    GEMINI_IMAGE_ASPECT_RATIO: z.string().default("4:5"),
    /**
     * Max output tokens for image generation. Gemini 3 image models spend tokens on reasoning;
     * too low a limit yields only `text` + `thoughtSignature` with no image. Default 32768.
     */
    GEMINI_IMAGE_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(2048).max(65536).default(32_768),
    INGESTION_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(8),
    INGESTION_TTS_CONCURRENCY: z.coerce.number().int().positive().default(4),
    /** Max atoms to synthesize TTS for per upload (large PDFs) */
    TTS_MAX_ATOMS: z.coerce.number().int().nonnegative().default(300),
    /** Directory for uploaded PDFs and parse-export blobs (local filesystem only). */
    STORAGE_LOCAL_DIR: z.string().default("./uploads"),
    REDIS_URL: z.string().optional(),
    /**
     * `in_memory` — jobs run in the API process (default). `redis` — enqueue to BullMQ (run `bun run worker`).
     */
    JOB_QUEUE_DRIVER: z.enum(["in_memory", "redis"]).default("in_memory"),
    /** BullMQ / worker concurrency for parse-export generation jobs. */
    PARSE_EXPORT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
    /**
     * BullMQ job lock duration (ms). Default 10 min — gives the heartbeat plenty of headroom
     * even when the event loop is briefly busy with many concurrent upstream calls.
     * Must be >> typical job runtime; pair with `PARSE_EXPORT_CELL_TIMEOUT_MS` so jobs always
     * return well before this expires.
     */
    PARSE_EXPORT_JOB_LOCK_DURATION_MS: z.coerce.number().int().positive().default(600_000),
    /** BullMQ stalled-job watcher interval (ms). Default 30s. */
    PARSE_EXPORT_JOB_STALLED_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
    /** Times a job may be flagged stalled before BullMQ throws `UnrecoverableError`. Default 2. */
    PARSE_EXPORT_JOB_MAX_STALLED_COUNT: z.coerce.number().int().nonnegative().default(2),
    /**
     * Per-cell soft deadline (ms) for parse-export atom/topic thunks (Gemini text/image, Silero TTS,
     * HTML verification). On expiry the cell is recorded as `failed: cell_deadline_exceeded` and
     * the job continues. Must be `< PARSE_EXPORT_JOB_LOCK_DURATION_MS`.
     */
    PARSE_EXPORT_CELL_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    /**
     * Per-cell soft deadline (ms) for parse-export chapter thunks. Higher than
     * `PARSE_EXPORT_CELL_TIMEOUT_MS` because the chapter `comicStory` thunk generates a plan plus
     * up to `PARSE_EXPORT_COMIC_CHAPTER_MAX_PAGES` images. Default 5 min.
     */
    PARSE_EXPORT_CHAPTER_CELL_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
    /**
     * Soft deadline (ms) only for parse-export **`tts`** synthesis (Silero HTTP). Higher than
     * `PARSE_EXPORT_CELL_TIMEOUT_MS` because long atoms are synthesized in chunks end-to-end in one HTTP call.
     * Must be `< PARSE_EXPORT_JOB_LOCK_DURATION_MS`. Default 9 min.
     */
    PARSE_EXPORT_TTS_CELL_TIMEOUT_MS: z.coerce.number().int().positive().default(540_000),
    /**
     * Process-wide ceiling on concurrent outbound HTTP calls (Gemini text/image, Silero TTS).
     * Prevents pathological event-loop saturation that starves BullMQ's lock-renewal heartbeat.
     * Defaults to 60 — well above healthy `WORKER_CONCURRENCY × ATOM_INTERNAL_CONCURRENCY`.
     */
    PARSE_EXPORT_OUTBOUND_CONCURRENCY: z.coerce.number().int().positive().default(60),
    /** Per-call timeout (ms) for `GeminiClient.generateText`. Default 60s. */
    GEMINI_TEXT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    /** Per-call timeout (ms) for `GeminiImageService.generate` `fetch`. Default 90s. */
    GEMINI_IMAGE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /**
     * Local Silero TTS FastAPI endpoint (e.g. `http://127.0.0.1:4001/tts`).
     * Required for TTS generation in parse-export. When unset, TTS cells are skipped.
     */
    TTS_HTTP_URL: z.string().optional(),
    /** Language code sent to Silero TTS (default `en`). */
    TTS_LANGUAGE: z.string().default("en"),
    /** Initial per-attempt timeout (ms) for Silero TTS HTTP. Scales up with input length. Default 90s. */
    TTS_BASE_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
    /** Max per-attempt timeout (ms) for Silero TTS HTTP (long chunked synthesis). Default 8 min. */
    TTS_MAX_TIMEOUT_MS: z.coerce.number().int().positive().default(480_000),
    /** Max retry attempts for Silero TTS HTTP. Default 4. */
    TTS_MAX_ATTEMPTS: z.coerce.number().int().positive().default(4),
    /**
     * Public origin for absolute URLs outside parse-export artifacts. No trailing slash.
     * When unset in **development**, defaults to `http://localhost:<PORT>`. In production, set explicitly when needed.
     */
    PUBLIC_API_BASE_URL: z.string().optional(),
    /**
     * Optional override for **parse-export generated file URLs** (`fileUrl`, `audioUrl`, `htmlUrl`).
     * When set, wins over `PUBLIC_API_BASE_URL`. Use when the API is behind a different public host (e.g. `https://api.example.com`).
     * No trailing slash.
     */
    PUBLIC_ARTIFACT_BASE_URL: z.string().optional(),
    /**
     * HMAC secret for public file URLs (`sig` query param). Defaults to `JWT_SECRET` when unset.
     * Set a dedicated value in production if you rotate JWT secrets independently of stored links.
     */
    FILE_URL_SIGNING_SECRET: z.string().optional(),
    /** Seconds until signed file URLs expire (default ~10 years). Lower for stricter link lifetime. */
    FILE_URL_PUBLIC_TTL_SECONDS: z.coerce.number().int().positive().max(999_999_999).default(315_360_000),
    /** `relaxed` (default) allows SVG/MathML xmlns in games; `strict` also blocks most `http(s)://` substrings after namespace strip. */
    PARSE_EXPORT_HTML_VERIFY_MODE: z.enum(["strict", "relaxed"]).default("relaxed"),
    /** Max HTML bytes for generated games when verifying (parse-export uses env + mode). */
    PARSE_EXPORT_HTML_MAX_BYTES: z.coerce.number().int().positive().default(600_000),
    /** Concurrent Gemini/HTML sub-tasks inside one parse-export atom job. */
    PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY: z.coerce.number().int().positive().default(6),
    /** Maximum pages for chapter-level comic story output. */
    PARSE_EXPORT_COMIC_CHAPTER_MAX_PAGES: z.coerce.number().int().min(1).max(12).default(4),
    /** Parallel page image generation inside one chapter comic job. */
    PARSE_EXPORT_COMIC_PAGE_CONCURRENCY: z.coerce.number().int().positive().default(3),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    ENABLE_API_DOCS: z
      .preprocess((val) => {
        if (val === undefined || val === "") return false;
        if (typeof val === "boolean") return val;
        if (typeof val === "string") {
          const v = val.toLowerCase();
          return v === "true" || v === "1" || v === "yes";
        }
        return false;
      }, z.boolean())
      .default(false),
  })
  .superRefine((data, ctx) => {
    const u = data.DATABASE_URL.toLowerCase();
    if (!u.startsWith("postgres://") && !u.startsWith("postgresql://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DATABASE_URL must start with postgres:// or postgresql://",
        path: ["DATABASE_URL"],
      });
    }
    if (data.JOB_QUEUE_DRIVER === "redis") {
      if (!data.REDIS_URL?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "REDIS_URL is required when JOB_QUEUE_DRIVER=redis",
          path: ["JOB_QUEUE_DRIVER"],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Expose Swagger UI and `/api/openapi.json` outside production, or in production when explicitly enabled. */
export function shouldExposeApiDocs(env: Pick<Env, "NODE_ENV" | "ENABLE_API_DOCS">): boolean {
  return env.NODE_ENV !== "production" || env.ENABLE_API_DOCS;
}

export function loadEnv(): Env {
  const raw = process.env;
  const merged = { ...raw };
  if (!merged.DATABASE_URL) {
    merged.DATABASE_URL = "postgresql://postgres@localhost:5432/dt_backend_db";
  }
  const parsed = envSchema.parse(merged);
  const explicitPublicBase = Object.prototype.hasOwnProperty.call(raw, "PUBLIC_API_BASE_URL");
  const explicitArtifactBase = Object.prototype.hasOwnProperty.call(raw, "PUBLIC_ARTIFACT_BASE_URL");
  const base = parsed.PUBLIC_API_BASE_URL?.trim();
  const artifactBase = parsed.PUBLIC_ARTIFACT_BASE_URL?.trim();
  if (
    !explicitPublicBase &&
    !base?.length &&
    !explicitArtifactBase &&
    !artifactBase?.length &&
    parsed.NODE_ENV === "development"
  ) {
    return { ...parsed, PUBLIC_API_BASE_URL: `http://localhost:${parsed.PORT}` };
  }
  return parsed;
}
