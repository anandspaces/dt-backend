import { z } from "zod";

const databaseDriverSchema = z.enum(["sqlite", "postgresql"]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_DRIVER: databaseDriverSchema.default("sqlite"),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z
      .string()
      .min(32)
      .default("development-only-jwt-secret-min-32-chars!"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    GEMINI_API_KEY: z.string().optional(),
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
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./uploads"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    REDIS_URL: z.string().optional(),
    /**
     * `in_memory` — jobs run in the API process (default). `redis` — enqueue to BullMQ (run `bun run worker`).
     */
    JOB_QUEUE_DRIVER: z.enum(["in_memory", "redis"]).default("in_memory"),
    /** BullMQ / worker concurrency for parse-export generation jobs. */
    PARSE_EXPORT_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(20),
    /** SuperTTS HTTP POST URL (JSON body `{ text, language }`). When set, async TTS prefers this over Gemini TTS. */
    SUPERTTS_HTTP_URL: z.string().optional(),
    /** Language code sent to SuperTTS (default `en`). */
    SUPERTTS_LANGUAGE: z.string().default("en"),
    /**
     * Public origin for absolute URLs (`audioUrl`, `fileUrl` for images/HTML). No trailing slash.
     * When unset in **development**, defaults to `http://localhost:<PORT>`. In production, set explicitly (e.g. `https://api.example.com`).
     */
    PUBLIC_API_BASE_URL: z.string().optional(),
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
    if (data.DATABASE_DRIVER === "sqlite") {
      if (
        !data.DATABASE_URL.startsWith("file:") &&
        !data.DATABASE_URL.startsWith("./") &&
        !data.DATABASE_URL.startsWith("/")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "DATABASE_URL for sqlite must be file:path, ./path, or absolute path",
          path: ["DATABASE_URL"],
        });
      }
    }
    if (data.DATABASE_DRIVER === "postgresql") {
      const u = data.DATABASE_URL.toLowerCase();
      if (!u.startsWith("postgres://") && !u.startsWith("postgresql://")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "DATABASE_URL for postgresql must start with postgres:// or postgresql://",
          path: ["DATABASE_URL"],
        });
      }
    }
    if (data.STORAGE_DRIVER === "s3") {
      if (!data.S3_BUCKET || !data.S3_REGION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "S3_BUCKET and S3_REGION required when STORAGE_DRIVER=s3",
          path: ["STORAGE_DRIVER"],
        });
      }
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

function inferDriverFromUrl(url: string): z.infer<typeof databaseDriverSchema> | undefined {
  const u = url.toLowerCase();
  if (u.startsWith("file:") || u.startsWith("./") || (u.startsWith("/") && !u.includes("://"))) {
    return "sqlite";
  }
  if (u.startsWith("postgres://") || u.startsWith("postgresql://")) {
    return "postgresql";
  }
  return undefined;
}

/** Expose Swagger UI and `/api/openapi.json` outside production, or in production when explicitly enabled. */
export function shouldExposeApiDocs(env: Pick<Env, "NODE_ENV" | "ENABLE_API_DOCS">): boolean {
  return env.NODE_ENV !== "production" || env.ENABLE_API_DOCS;
}

export function loadEnv(): Env {
  const raw = process.env;
  const merged = { ...raw };
  if (!merged.DATABASE_URL) {
    merged.DATABASE_URL = "file:./data/app.db";
  }
  if (!merged.DATABASE_DRIVER && merged.DATABASE_URL) {
    const inferred = inferDriverFromUrl(merged.DATABASE_URL);
    if (inferred) merged.DATABASE_DRIVER = inferred;
  }
  const parsed = envSchema.parse(merged);
  const explicitPublicBase = Object.prototype.hasOwnProperty.call(raw, "PUBLIC_API_BASE_URL");
  const base = parsed.PUBLIC_API_BASE_URL?.trim();
  if (!explicitPublicBase && !base?.length && parsed.NODE_ENV === "development") {
    return { ...parsed, PUBLIC_API_BASE_URL: `http://localhost:${parsed.PORT}` };
  }
  return parsed;
}
