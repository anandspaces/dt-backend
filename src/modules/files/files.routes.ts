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
      const body = req.body as { bookId?: unknown };
      const bookId = typeof body.bookId === "string" ? body.bookId : undefined;
      const file = await svc.savePdfUpload(
        u.id,
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        bookId,
      );
      res.status(201).json({ file });
    }),
  );

  return r;
}
