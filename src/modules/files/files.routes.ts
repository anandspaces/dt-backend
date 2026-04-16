import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { FilesService } from "./files.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      cb(new Error("Only PDF uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

/** Large textbooks (e.g. 600 pages) — same validation, higher memory cap. */
const uploadLarge = multer({
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

export function filesRouter(env: Env) {
  const r = Router();
  const svc = new FilesService(env);

  r.post(
    "/pdf",
    requireAuth(env),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      if (!req.file?.buffer) {
        res.status(400).json({ error: { message: "Missing file field" } });
        return;
      }
      const body = req.body as { bookId?: unknown; fileKind?: unknown };
      const bookId = typeof body.bookId === "string" ? body.bookId : undefined;
      const fileKind = body.fileKind === "pyq" ? "pyq" : "book";
      if (fileKind === "pyq" && !bookId) {
        res.status(400).json({ error: { message: "PYQ uploads require bookId" } });
        return;
      }
      const file = await svc.savePdfUpload(
        u.id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        { bookId, fileKind },
      );
      res.status(201).json({ file });
    }),
  );

  r.post(
    "/pdf-full",
    requireAuth(env),
    uploadLarge.single("file"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      if (!req.file?.buffer) {
        res.status(400).json({ error: { message: "Missing file field" } });
        return;
      }
      const body = req.body as { bookId?: unknown };
      const bookId = typeof body.bookId === "string" ? body.bookId : undefined;
      const file = await svc.saveFullPdfUpload(
        u.id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        { bookId },
      );
      res.status(202).json({
        file,
        message:
          "Ingestion queued: topics, paired atoms, classification, games, and TTS (if GEMINI_API_KEY + GEMINI_TTS_MODEL set). Poll file row or books/chapters for results.",
      });
    }),
  );

  return r;
}
