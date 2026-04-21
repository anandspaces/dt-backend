import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { runPdfParseExport } from "../../services/ingestion-v2/pdf-parse-export.service.js";
import {
  loadParseExportGenerated,
  loadParseExportStatus,
  loadSingleAtomArtifact,
  loadSingleChapterArtifact,
  loadSingleTopicArtifact,
  manifestToPublicResult,
  readParseExportManifest,
} from "../../services/parse-export/parse-export-generation.service.js";
import { subscribeParseExportEvents } from "../../services/parse-export/parse-export-events.js";
import { loadParseExportProgress } from "../../services/parse-export/parse-export-progress.js";
import { deleteParseExportBundle } from "../../services/parse-export/parse-export-delete.js";
import {
  enqueueParseExportRegeneration,
  regenerateBodySchema,
} from "../../services/parse-export/parse-export-regenerate.js";

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

function paramString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" ? v : v[0];
}

function isUuid(id: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(id);
}

function exportLinks(exportId: string) {
  const base = `/api/v1/parse/exports/${exportId}`;
  return {
    self: base,
    status: `${base}/status`,
    generated: `${base}/generated`,
    events: `${base}/events`,
  };
}

async function assertExportOwner(env: Env, userId: string, exportId: string) {
  const m = await readParseExportManifest(env, userId, exportId);
  if (!m) return null;
  if (m.userId !== userId) return null;
  return m;
}

/**
 * PDF → nested chapters/topics/atoms JSON with classification, generation prompts, async TTS + artifacts.
 * Prefer `POST /exports` (202); `POST /pdf-export` remains for backward compatibility.
 */
export function parseRouter(env: Env) {
  const r = Router();

  const handlePdfUpload = async (req: Request, res: Response, legacy: boolean): Promise<void> => {
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

    const links = exportLinks(result.exportId);
    if (legacy) {
      res.setHeader("Deprecation", "true");
      res.setHeader("Link", `<${links.self}>; rel="successor-version"`);
      res.status(200).json({
        ...result,
        generation: { queued: true as const },
      });
      return;
    }

    res.status(202).json({
      exportId: result.exportId,
      status: "queued" as const,
      manifest: result,
      _links: links,
      generation: { queued: true as const },
    });
  };

  r.post(
    "/exports",
    requireAuth(env),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      await handlePdfUpload(req, res, false);
    }),
  );

  r.post(
    "/pdf-export",
    requireAuth(env),
    upload.single("file"),
    asyncHandler(async (req, res) => {
      await handlePdfUpload(req, res, true);
    }),
  );

  r.get(
    "/exports/:exportId",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      res.status(200).json(manifestToPublicResult(m));
    }),
  );

  r.get(
    "/exports/:exportId/status",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const state = await loadParseExportStatus(env, u.id, exportId);
      if (!state) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      res.status(200).json(state);
    }),
  );

  r.get(
    "/exports/:exportId/generated",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const state = await loadParseExportGenerated(env, u.id, exportId);
      if (!state) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      res.status(200).json(state);
    }),
  );

  r.get(
    "/exports/:exportId/atoms/:atomId",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      const atomId = paramString(req.params.atomId);
      if (!exportId || !isUuid(exportId) || !atomId || !isUuid(atomId)) {
        res.status(400).json({ error: { message: "Invalid exportId or atomId" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      const art = await loadSingleAtomArtifact(env, u.id, exportId, atomId);
      if (!art) {
        res.status(404).json({ error: { message: "Atom artifact not found" } });
        return;
      }
      res.status(200).json(art);
    }),
  );

  const indexParams = z.object({
    chapterIndex: z.coerce.number().int().nonnegative(),
    topicIndex: z.coerce.number().int().nonnegative(),
  });

  r.get(
    "/exports/:exportId/topics/:chapterIndex/:topicIndex",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const parsed = indexParams.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({ error: { message: "Invalid chapter or topic index" } });
        return;
      }
      const { chapterIndex, topicIndex } = parsed.data;
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      const art = await loadSingleTopicArtifact(env, u.id, exportId, chapterIndex, topicIndex);
      if (!art) {
        res.status(404).json({ error: { message: "Topic artifact not found" } });
        return;
      }
      res.status(200).json(art);
    }),
  );

  r.get(
    "/exports/:exportId/chapters/:chapterIndex",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const chapterIndex = z.coerce.number().int().nonnegative().safeParse(req.params.chapterIndex);
      if (!chapterIndex.success) {
        res.status(400).json({ error: { message: "Invalid chapter index" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      const art = await loadSingleChapterArtifact(env, u.id, exportId, chapterIndex.data);
      if (!art) {
        res.status(404).json({ error: { message: "Chapter artifact not found" } });
        return;
      }
      res.status(200).json(art);
    }),
  );

  r.get(
    "/exports/:exportId/events",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      const unsub = await subscribeParseExportEvents(env, exportId, (data) => {
        res.write(`data: ${data}\n\n`);
      });

      const heartbeat = setInterval(() => {
        res.write(": ping\n\n");
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        void unsub();
      };
      req.on("close", cleanup);

      try {
        const prog = await loadParseExportProgress(env, u.id, exportId);
        if (prog) {
          res.write(`data: ${JSON.stringify({ type: "progress", progress: prog })}\n\n`);
        }
      } catch {
        /* ignore */
      }
    }),
  );

  r.post(
    "/exports/:exportId/regenerate",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      const parsed = regenerateBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(422).json({ error: { message: "Invalid body", details: parsed.error.flatten() } });
        return;
      }
      const counts = await enqueueParseExportRegeneration(env, u.id, exportId, parsed.data);
      res.status(202).json({ queued: true as const, ...counts });
    }),
  );

  r.delete(
    "/exports/:exportId",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const m = await assertExportOwner(env, u.id, exportId);
      if (!m) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      await deleteParseExportBundle(env, u.id, exportId);
      res.status(204).send();
    }),
  );

  r.get(
    "/export/:exportId/status",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const state = await loadParseExportStatus(env, u.id, exportId);
      if (!state) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      res.setHeader("Deprecation", "true");
      res.setHeader("Link", `</api/v1/parse/exports/${exportId}/status>; rel="successor-version"`);
      res.status(200).json({
        exportId: state.exportId,
        complete: state.complete,
        ready: state.ready,
        progress: state.progress,
      });
    }),
  );

  r.get(
    "/export/:exportId/generated",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const exportId = paramString(req.params.exportId);
      if (!exportId || !isUuid(exportId)) {
        res.status(400).json({ error: { message: "Invalid exportId" } });
        return;
      }
      const state = await loadParseExportGenerated(env, u.id, exportId);
      if (!state) {
        res.status(404).json({ error: { message: "Export not found" } });
        return;
      }
      res.setHeader("Deprecation", "true");
      res.setHeader("Link", `</api/v1/parse/exports/${exportId}/generated>; rel="successor-version"`);
      res.status(200).json(state);
    }),
  );

  return r;
}
