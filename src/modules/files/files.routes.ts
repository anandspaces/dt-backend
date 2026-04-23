import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { createStorageAdapter } from "../../services/storage/storage-factory.js";
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

function mimeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function filesRouter(env: Env) {
  const r = Router();
  const svc = new FilesService(env);
  const storage = createStorageAdapter(env);

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

  /**
   * Fetch audio (or other blobs) stored under keys owned by the authenticated user.
   * Used by parse-export TTS URLs (`parse-export/{userId}/...` and legacy `tts/{userId}/...`).
   */
  r.get(
    "/audio",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const key = typeof req.query.key === "string" ? req.query.key : "";
      if (!key.length || key.includes("..")) {
        res.status(400).json({ error: { message: "Invalid key" } });
        return;
      }
      const allowed =
        key.startsWith(`parse-export/${u.id}/`) || key.startsWith(`tts/${u.id}/`);
      if (!allowed) {
        res.status(403).json({ error: { message: "Forbidden" } });
        return;
      }
      const mime =
        typeof req.query.mime === "string" && req.query.mime.length > 0
          ? req.query.mime
          : mimeFromKey(key);
      const buf = await storage.readObject(key);
      res.setHeader("Content-Type", mime);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
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
