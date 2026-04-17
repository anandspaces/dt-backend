import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { runPdfParseExport } from "../../services/ingestion-v2/pdf-parse-export.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 120 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

function parsePositiveInt(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 10_000);
}

function parseNonNegativeInt(v: unknown, fallback: number, max: number): number {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/**
 * Independent PDF → nested chapters/topics/atoms JSON with classification, generation prompts, optional TTS URLs.
 */
export function parseRouter(env: Env) {
  const r = Router();

  r.post(
    "/pdf-export",
    requireAuth(env),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      if (!req.file?.buffer) {
        res.status(400).json({ error: { message: "Missing file field" } });
        return;
      }

      const q = req.query as {
        classifyConcurrency?: string;
        classifyBatchSize?: string;
        ttsConcurrency?: string;
        ttsMaxAtoms?: string;
      };
      const classifyConcurrency = parsePositiveInt(q.classifyConcurrency, 12);
      const classifyBatchSize = parsePositiveInt(q.classifyBatchSize, 16);
      const ttsConcurrency = parsePositiveInt(q.ttsConcurrency, env.INGESTION_TTS_CONCURRENCY);
      const ttsMaxAtoms = parseNonNegativeInt(q.ttsMaxAtoms, 50, 50_000);

      const result = await runPdfParseExport(
        env,
        req.file.buffer,
        u.id,
        req.file.originalname,
        {
          classifyConcurrency,
          classifyBatchSize: Math.min(classifyBatchSize, 48),
          ttsConcurrency,
          ttsMaxAtoms,
        },
      );

      res.status(200).json(result);
    }),
  );

  return r;
}
