import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { getFileUrlSigningSecret, verifyFileBlobAccess } from "../../common/file-url-signature.js";
import { requireAuth, tryAuthUserBearerOrQuery } from "../../middleware/auth.js";
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
   * Fetch blobs (audio, images, HTML, …).
   * **Public:** valid `exp` + `sig` (HMAC over key|exp|mime) — no login. Keys must be under `parse-export/` or `tts/`.
   * **Private:** `Authorization: Bearer` or `?access_token=` / `?token=` — only the owning user’s keys.
   */
  r.get(
    "/audio",
    asyncHandler(async (req, res) => {
      const key = typeof req.query.key === "string" ? req.query.key : "";
      if (!key.length || key.includes("..")) {
        res.status(400).json({ error: { message: "Invalid key" } });
        return;
      }

      const mimeRaw =
        typeof req.query.mime === "string" && req.query.mime.length > 0 ? req.query.mime : mimeFromKey(key);
      const expQ = typeof req.query.exp === "string" ? req.query.exp : "";
      const sigQ = typeof req.query.sig === "string" ? req.query.sig : "";

      const secret = getFileUrlSigningSecret(env);
      const signedOk =
        sigQ.length > 0 &&
        expQ.length > 0 &&
        verifyFileBlobAccess(key, mimeRaw, expQ, sigQ, secret);

      let allowed = false;
      let cachePublic = false;

      if (signedOk) {
        allowed = key.startsWith("parse-export/") || key.startsWith("tts/");
        cachePublic = true;
      } else {
        const user = tryAuthUserBearerOrQuery(req, env);
        if (!user) {
          res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
          return;
        }
        allowed =
          key.startsWith(`parse-export/${user.id}/`) || key.startsWith(`tts/${user.id}/`);
      }

      if (!allowed) {
        res.status(403).json({ error: { message: "Forbidden" } });
        return;
      }

      let buf: Buffer;
      try {
        buf = await storage.readObject(key);
      } catch {
        res.status(404).json({ error: { message: "Not found" } });
        return;
      }

      res.setHeader("Content-Type", mimeRaw);
      res.setHeader(
        "Cache-Control",
        cachePublic ? "public, max-age=3600, immutable" : "private, max-age=3600",
      );
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
