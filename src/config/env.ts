import { z } from "zod";

const databaseDriverSchema = z.enum(["sqlite", "postgresql"]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_DRIVER: databaseDriverSchema.default("sqlite"),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z
      .string()
      .min(32)
      .default("development-only-jwt-secret-min-32-chars!"),
    JWT_EXPIRES_IN: z.string().default("7d"),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./uploads"),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    REDIS_URL: z.string().optional(),
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
  return envSchema.parse(merged);
}
