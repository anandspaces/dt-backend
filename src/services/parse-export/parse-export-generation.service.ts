import { z } from "zod";
import type { Env } from "../../config/env.js";
import type {
  AtomParseExport,
  ChapterParseExport,
  PdfParseExportResult,
  TopicParseExport,
} from "../ingestion-v2/pdf-parse-export.service.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { extractJsonFromModelText } from "../ai/json-extract.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { TtsHttpService } from "../tts/supertts-http.service.js";
import { verifyGeneratedHtml } from "../generation/html-verification.js";
import { buildPublicApiUrl } from "../../common/public-url.js";
import { detectAtomLanguage, majorityAtomLang } from "../lang-detect/lang-detect.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { GeminiImageService } from "../ai/gemini-image.service.js";
import {
  parseExportAtomArtifactKey,
  parseExportChapterArtifactKey,
  parseExportComicPageKey,
  parseExportHtmlKey,
  parseExportImageKey,
  parseExportManifestKey,
  parseExportTopicArtifactKey,
} from "./parse-export-keys.js";
import { getQueue } from "../queue/queue-global.js";
import type { JobPriority } from "../queue/job-queue.types.js";
import type {
  ParseExportAtomPayload,
  ParseExportChapterPayload,
  ParseExportTopicPayload,
} from "../../jobs/contracts/job-schemas.js";
import type { ArtifactCell, AtomArtifactFile, ChapterArtifactFile, TopicArtifactFile } from "./parse-export-artifact.types.js";
import {
  artifactRecordToPartialTypeStats,
  expandByTypeStats,
  loadParseExportProgress,
  mergePartialTypeStats,
  recordParseExportArtifactSaved,
  type KindStats,
  type ParseExportArtifactKind,
  type ParseExportProgressV1,
} from "./parse-export-progress.js";
import { buildSignedFilesAudioRelativeUrl } from "../../common/file-url-signature.js";
import { comicPageImagePromptForChapter, type ChapterComicPagePlan } from "../ai/templates/prompt-registry.js";
import { logWarn } from "../../common/logger.js";

export type { ArtifactCell, AtomArtifactFile, ChapterArtifactFile, TopicArtifactFile } from "./parse-export-artifact.types.js";

/** Row keys that are not `ArtifactCell` blobs (same idea as parse-export-progress META_KEYS). */
const PARSE_EXPORT_LOG_META_KEYS = new Set([
  "atomId",
  "chapterIndex",
  "topicIndex",
  "lang",
  "version",
]);

function truncateForLog(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Per-cell soft deadline. If the inner thunk doesn't resolve within `ms`, the wrapper resolves
 * with `onTimeout()` instead — guaranteeing every parse-export job returns well within the
 * BullMQ lock window. The orphan thunk continues running in the background; in practice it is
 * aborted promptly because every upstream call (Gemini text/image, SuperTTS) now has its own
 * `AbortController` with a shorter timeout than the cell deadline.
 */
async function withCellDeadline<T>(
  ms: number,
  run: () => Promise<T>,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(onTimeout());
    }, ms);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const cellDeadlineExceeded = (): ArtifactCell => ({
  status: "failed",
  error: "cell_deadline_exceeded",
});

type LabeledCellThunk = { kind: string; run: () => Promise<ArtifactCell> };

async function runCellThunks(
  thunks: LabeledCellThunk[],
  internalConcurrency: number,
  cellTimeoutMs: number,
  out: Record<string, unknown>,
): Promise<void> {
  await mapWithConcurrency(thunks, internalConcurrency, async (lt) => {
    const cell = await withCellDeadline(cellTimeoutMs, lt.run, cellDeadlineExceeded);
    out[lt.kind] = cell;
  });
}

/**
 * Emit one JSON log line per failed artifact cell so operators can grep worker logs
 * (`parse_export.cell_failed`) without pulling `/generated`.
 */
function logParseExportFailedCells(input: {
  job: "parse-export-atom" | "parse-export-topic" | "parse-export-chapter";
  exportId: string;
  userId: string;
  atomId?: string;
  chapterIndex?: number;
  topicIndex?: number;
  row: Record<string, unknown>;
}): void {
  for (const [kind, val] of Object.entries(input.row)) {
    if (PARSE_EXPORT_LOG_META_KEYS.has(kind)) continue;
    if (!val || typeof val !== "object" || !("status" in val)) continue;
    const cell = val as ArtifactCell;
    if (cell.status !== "failed") continue;

    const rawErr = cell.error;
    const error =
      typeof rawErr === "string" && rawErr.length
        ? truncateForLog(rawErr, 500)
        : rawErr != null
          ? truncateForLog(String(rawErr), 500)
          : "unknown";

    logWarn("parse_export.cell_failed", {
      job: input.job,
      exportId: input.exportId,
      userId: input.userId,
      kind,
      error,
      ...(kind === "tts" && typeof error === "string" && error.includes("TTS_HTTP_URL is not set")
        ? { ttsHelp: "Set TTS_HTTP_URL=http://127.0.0.1:4001/tts in .env and start the Silero microservice." }
        : {}),
      verified: cell.verified,
      atomId: input.atomId,
      chapterIndex: input.chapterIndex,
      topicIndex: input.topicIndex,
    });

    if (kind === "comicStory" && typeof cell.payload === "string") {
      try {
        const parsed = JSON.parse(cell.payload) as {
          pages?: Array<{ pageNumber?: unknown; status?: unknown; error?: unknown }>;
        };
        const pages = parsed?.pages;
        if (!Array.isArray(pages)) continue;
        for (const pg of pages) {
          if (!pg || typeof pg !== "object") continue;
          if (pg.status !== "failed") continue;
          const pageErr =
            typeof pg.error === "string" && pg.error.length
              ? truncateForLog(pg.error, 500)
              : pg.error != null
                ? truncateForLog(String(pg.error), 500)
                : "unknown";
          logWarn("parse_export.comic_page_failed", {
            job: input.job,
            exportId: input.exportId,
            userId: input.userId,
            chapterIndex: input.chapterIndex,
            topicIndex: input.topicIndex,
            pageNumber: typeof pg.pageNumber === "number" ? pg.pageNumber : null,
            error: pageErr,
          });
        }
      } catch {
        /* payload not JSON */
      }
    }
  }
}

export type ParseExportManifestV1 = PdfParseExportResult & {
  userId: string;
  ttsPendingAtomIds: string[];
  ttsMaxAtoms: number;
  expectedGenerationJobs: number;
};

export function manifestToPublicResult(m: ParseExportManifestV1): PdfParseExportResult {
  return {
    exportId: m.exportId,
    meta: m.meta,
    chapters: m.chapters,
  };
}

/** Single-question atom quiz schema: { question, choices[4], answerIndex }. */
const quizOutputSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
});

/** Per-question schema for topic multi-question quiz. */
const topicQuizQuestionSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).min(2).max(6),
  answerIndex: z.number().int().min(0),
  explanation: z.string().optional(),
});

/** Topic quiz schema: { title, questions: [{question, choices, answerIndex, explanation?}] }. */
const topicQuizOutputSchema = z.object({
  title: z.string(),
  questions: z.array(topicQuizQuestionSchema).min(1),
});

function stripCodeFences(html: string): string {
  const trimmed = html.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function verifySimulationPayload(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 500_000) return false;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }
  return t.includes("<") && t.length < 500_000;
}

function verifyGlossaryOrVideo(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length < 200_000;
}

async function tryReadJson<T>(storage: ReturnType<typeof createStorageAdapter>, key: string): Promise<T | null> {
  try {
    const buf = await storage.readObject(key);
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function saveParseExportManifest(
  env: Env,
  manifest: ParseExportManifestV1,
): Promise<void> {
  const storage = createStorageAdapter(env);
  const key = parseExportManifestKey(manifest.userId, manifest.exportId);
  await storage.saveObject(key, Buffer.from(JSON.stringify(manifest), "utf8"), "application/json");
}

export async function readParseExportManifest(
  env: Env,
  userId: string,
  exportId: string,
): Promise<ParseExportManifestV1 | null> {
  const storage = createStorageAdapter(env);
  return tryReadJson<ParseExportManifestV1>(storage, parseExportManifestKey(userId, exportId));
}

function findAtom(
  manifest: ParseExportManifestV1,
  atomId: string,
): { atom: AtomParseExport; chapterIndex: number; topicIndex: number } | null {
  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const ch = manifest.chapters[chi];
    if (!ch) continue;
    for (let tpi = 0; tpi < ch.topics.length; tpi++) {
      const tp = ch.topics[tpi];
      if (!tp) continue;
      const atom = tp.atoms.find((a) => a.id === atomId);
      if (atom) return { atom, chapterIndex: chi, topicIndex: tpi };
    }
  }
  return null;
}

function findTopic(
  manifest: ParseExportManifestV1,
  chapterIndex: number,
  topicIndex: number,
): TopicParseExport | null {
  const ch = manifest.chapters[chapterIndex];
  if (!ch) return null;
  return ch.topics[topicIndex] ?? null;
}

function findChapter(manifest: ParseExportManifestV1, chapterIndex: number): ChapterParseExport | null {
  return manifest.chapters[chapterIndex] ?? null;
}

async function writeAtomArtifact(
  env: Env,
  userId: string,
  exportId: string,
  data: AtomArtifactFile,
): Promise<void> {
  const storage = createStorageAdapter(env);
  const key = parseExportAtomArtifactKey(userId, exportId, data.atomId);
  await storage.saveObject(key, Buffer.from(JSON.stringify(data), "utf8"), "application/json");
}

async function writeTopicArtifact(
  env: Env,
  userId: string,
  exportId: string,
  data: TopicArtifactFile,
): Promise<void> {
  const storage = createStorageAdapter(env);
  const key = parseExportTopicArtifactKey(userId, exportId, data.chapterIndex, data.topicIndex);
  await storage.saveObject(key, Buffer.from(JSON.stringify(data), "utf8"), "application/json");
}

async function writeChapterArtifact(
  env: Env,
  userId: string,
  exportId: string,
  data: ChapterArtifactFile,
): Promise<void> {
  const storage = createStorageAdapter(env);
  const key = parseExportChapterArtifactKey(userId, exportId, data.chapterIndex);
  await storage.saveObject(key, Buffer.from(JSON.stringify(data), "utf8"), "application/json");
}

async function genText(
  gemini: GeminiClient,
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!gemini.isConfigured()) {
    return { ok: false, error: "gemini_not_configured" };
  }
  try {
    const text = await gemini.generateText(prompt);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Generates and stores an illustration image.
 * - When GEMINI_IMAGE_MODEL is configured: calls the image API, stores the binary, returns a cell with `fileUrl`.
 * - Otherwise: stores the image prompt text in `payload` (status: "skipped") for external use.
 */
async function genAndStoreImage(
  env: Env,
  imagePrompt: string,
  userId: string,
  exportId: string,
  scope: "atom" | "topic" | "chapter",
  scopeId: string,
): Promise<ArtifactCell> {
  const imgService = new GeminiImageService(env);

  if (!imgService.isConfigured()) {
    return {
      status: "skipped",
      error: "GEMINI_IMAGE_MODEL not configured",
    };
  }

  try {
    const result = await imgService.generate(imagePrompt);
    if (!result) {
      return { status: "skipped", error: "GEMINI_IMAGE_MODEL not configured" };
    }
    const storage = createStorageAdapter(env);
    const key = parseExportImageKey(userId, exportId, scope, scopeId, result.fileExt);
    await storage.saveObject(key, result.buffer, result.mime);
    const rel = buildSignedFilesAudioRelativeUrl(key, result.mime, env);
    return {
      status: "succeeded",
      fileUrl: buildPublicApiUrl(env, rel),
      mime: result.mime,
      verified: true,
    };
  } catch (e) {
    return {
      status: "failed",
      payload: imagePrompt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function genAndStoreComicImage(
  env: Env,
  imagePrompt: string,
  userId: string,
  exportId: string,
  scope: "atom" | "topic",
  scopeId: string,
): Promise<ArtifactCell> {
  const imgService = new GeminiImageService(env);
  if (!imgService.isConfigured()) {
    return {
      status: "skipped",
      error: "GEMINI_IMAGE_MODEL not configured",
      payload: imagePrompt,
    };
  }
  try {
    const result = await imgService.generate(imagePrompt);
    if (!result) {
      return {
        status: "skipped",
        error: "GEMINI_IMAGE_MODEL not configured",
        payload: imagePrompt,
      };
    }
    const storage = createStorageAdapter(env);
    const key = parseExportImageKey(userId, exportId, scope, `${scopeId}-comic`, result.fileExt);
    await storage.saveObject(key, result.buffer, result.mime);
    const rel = buildSignedFilesAudioRelativeUrl(key, result.mime, env);
    return {
      status: "succeeded",
      fileUrl: buildPublicApiUrl(env, rel),
      mime: result.mime,
      verified: true,
    };
  } catch (e) {
    return {
      status: "failed",
      payload: imagePrompt,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function parseChapterComicPlan(text: string): ChapterComicPagePlan[] {
  const json = extractJsonFromModelText(text);
  const raw = JSON.parse(json) as unknown;
  if (!Array.isArray(raw)) throw new Error("chapter_comic_plan_not_array");
  const pages: ChapterComicPagePlan[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const pageNumber = Number((item as { pageNumber?: unknown }).pageNumber);
    const description = String((item as { description?: unknown }).description ?? "").trim();
    const visualCue = String((item as { visualCue?: unknown }).visualCue ?? "").trim();
    if (!Number.isFinite(pageNumber) || pageNumber <= 0 || !description || !visualCue) continue;
    pages.push({ pageNumber, description, visualCue });
  }
  pages.sort((a, b) => a.pageNumber - b.pageNumber);
  return pages;
}

/**
 * Persists HTML under `parse-export/.../html/...html` and returns the same signed-URL pattern as images/audio:
 * `/api/v1/files/audio?key=...&mime=text/html...` with optional `PUBLIC_API_BASE_URL` prefix.
 */
async function saveHtmlFile(
  env: Env,
  html: string,
  userId: string,
  exportId: string,
  scope: "atom" | "topic" | "chapter",
  scopeId: string,
  kind: "game" | "microgame",
): Promise<string | null> {
  try {
    const storage = createStorageAdapter(env);
    const key = parseExportHtmlKey(userId, exportId, scope, scopeId, kind);
    await storage.saveObject(key, Buffer.from(html, "utf8"), "text/html; charset=utf-8");
    const mime = "text/html; charset=utf-8";
    const rel = buildSignedFilesAudioRelativeUrl(key, mime, env);
    return buildPublicApiUrl(env, rel);
  } catch {
    return null;
  }
}

/** Verifies HTML, saves blob, returns cell with `fileUrl` when stored (no inline payload). */
function artifactCellForHtmlGame(
  html: string,
  v: { ok: boolean; reason?: string },
  savedFileUrl: string | null,
): ArtifactCell {
  if (!v.ok) {
    return {
      status: "failed",
      payload: html,
      verified: false,
      error: v.reason,
    };
  }
  if (savedFileUrl) {
    return {
      status: "succeeded",
      fileUrl: savedFileUrl,
      htmlUrl: savedFileUrl,
      mime: "text/html; charset=utf-8",
      verified: true,
    };
  }
  return {
    status: "failed",
    payload: html,
    verified: false,
    error: "html_storage_failed",
  };
}

export async function processParseExportAtomJob(env: Env, p: ParseExportAtomPayload): Promise<void> {
  const manifest = await readParseExportManifest(env, p.userId, p.exportId);
  if (!manifest) return;
  const found = findAtom(manifest, p.atomId);
  if (!found) return;

  const { atom, chapterIndex: atomChapterIndex, topicIndex: atomTopicIndex } = found;
  const gemini = new GeminiClient(env);
  const superTts = new TtsHttpService(env);
  const storage = createStorageAdapter(env);
  const atomArtifactKey = parseExportAtomArtifactKey(p.userId, p.exportId, p.atomId);
  const previousArtifact = await tryReadJson<AtomArtifactFile>(storage, atomArtifactKey);

  const lang = atom.lang ?? detectAtomLanguage(atom.body);
  const out: AtomArtifactFile = { atomId: p.atomId, lang };

  const cellTimeoutMs = env.PARSE_EXPORT_CELL_TIMEOUT_MS;
  const ttsCellTimeoutMs = env.PARSE_EXPORT_TTS_CELL_TIMEOUT_MS;

  if (manifest.ttsPendingAtomIds.includes(p.atomId)) {
    out.tts = await withCellDeadline(
      ttsCellTimeoutMs,
      async (): Promise<ArtifactCell> => {
        try {
          if (!superTts.isConfigured()) {
            return { status: "skipped", error: "tts_not_configured" };
          }
          const { buffer, mime, fileExt } = await superTts.synthesize(atom.body, lang);
          const objectKey = `parse-export/${p.userId}/${p.exportId}/${p.atomId}.${lang}.${fileExt}`;
          await storage.saveObject(objectKey, buffer, mime);
          const rel = buildSignedFilesAudioRelativeUrl(objectKey, mime, env);
          const url = buildPublicApiUrl(env, rel);
          return {
            status: "succeeded",
            audioUrl: url,
            fileUrl: url,
            mime,
            verified: true,
            language: lang,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { status: "failed", error: msg };
        }
      },
      cellDeadlineExceeded,
    );
  }

  const htmlVerifyOpts = {
    mode: env.PARSE_EXPORT_HTML_VERIFY_MODE,
    maxBytes: env.PARSE_EXPORT_HTML_MAX_BYTES,
  };
  const internalConc = Math.max(1, env.PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY);

  const parallelThunks: LabeledCellThunk[] = [];

  if (atom.recommended.quiz) {
    parallelThunks.push({
      kind: "quiz",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.quiz);
        if (!g.ok) return { status: "skipped", error: g.error };
        try {
          const json = extractJsonFromModelText(g.text);
          const parsed = quizOutputSchema.safeParse(JSON.parse(json));
          const ok = parsed.success;
          return {
            status: ok ? "succeeded" : "failed",
            payload: ok ? JSON.stringify(parsed.data) : g.text,
            verified: ok,
            error: ok ? undefined : "quiz_validation_failed",
          };
        } catch (e) {
          return {
            status: "failed",
            payload: g.text,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    });
  }

  if (atom.recommended.gameHtml) {
    parallelThunks.push({
      kind: "gameHtml",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.gameHtml);
        if (!g.ok) return { status: "skipped", error: g.error };
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "atom", p.atomId, "game")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    });
  }

  if (atom.recommended.gameHtml || atom.recommended.quiz) {
    parallelThunks.push({
      kind: "microGame",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.microGame);
        if (!g.ok) return { status: "skipped", error: g.error };
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "atom", p.atomId, "microgame")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    });
  }

  if (atom.recommended.simulation) {
    parallelThunks.push({
      kind: "simulation",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.simulation);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifySimulationPayload(g.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "simulation_validation_failed",
        };
      },
    });
  }

  if (atom.recommended.video) {
    parallelThunks.push({
      kind: "video",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.video);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifyGlossaryOrVideo(g.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "video_validation_failed",
        };
      },
    });
  }

  if (atom.recommended.quiz) {
    parallelThunks.push({
      kind: "glossary",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, atom.prompts.glossary);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifyGlossaryOrVideo(g.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "glossary_validation_failed",
        };
      },
    });
  }

  parallelThunks.push({
    kind: "image",
    run: () =>
      genAndStoreImage(env, atom.prompts.illustrationImage, p.userId, p.exportId, "atom", p.atomId),
  });
  parallelThunks.push({
    kind: "comic",
    run: () =>
      genAndStoreComicImage(env, atom.prompts.comic, p.userId, p.exportId, "atom", p.atomId),
  });

  await runCellThunks(parallelThunks, internalConc, cellTimeoutMs, out as Record<string, unknown>);

  logParseExportFailedCells({
    job: "parse-export-atom",
    exportId: p.exportId,
    userId: p.userId,
    atomId: p.atomId,
    chapterIndex: atomChapterIndex,
    topicIndex: atomTopicIndex,
    row: out as Record<string, unknown>,
  });

  await writeAtomArtifact(env, p.userId, p.exportId, out);
  await recordParseExportArtifactSaved(env, p.userId, p.exportId, out as Record<string, unknown>, {
    previous: previousArtifact as Record<string, unknown> | null,
  });
}

export async function processParseExportTopicJob(env: Env, p: ParseExportTopicPayload): Promise<void> {
  const manifest = await readParseExportManifest(env, p.userId, p.exportId);
  if (!manifest) return;
  const topic = findTopic(manifest, p.chapterIndex, p.topicIndex);
  if (!topic) return;

  const storage = createStorageAdapter(env);
  const topicKey = parseExportTopicArtifactKey(p.userId, p.exportId, p.chapterIndex, p.topicIndex);
  const previousArtifact = await tryReadJson<TopicArtifactFile>(storage, topicKey);

  const gemini = new GeminiClient(env);
  const topicLang =
    topic.lang ?? majorityAtomLang(topic.atoms.map((a) => a.lang ?? detectAtomLanguage(a.body)));
  const out: TopicArtifactFile = {
    chapterIndex: p.chapterIndex,
    topicIndex: p.topicIndex,
    lang: topicLang,
  };

  const htmlVerifyOpts = {
    mode: env.PARSE_EXPORT_HTML_VERIFY_MODE,
    maxBytes: env.PARSE_EXPORT_HTML_MAX_BYTES,
  };
  const topicConc = Math.max(2, env.PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY);
  const cellTimeoutMs = env.PARSE_EXPORT_CELL_TIMEOUT_MS;
  const topicScopeId = `${String(p.chapterIndex)}-${String(p.topicIndex)}`;

  const topicThunks: LabeledCellThunk[] = [
    {
      kind: "summary",
      run: async (): Promise<ArtifactCell> => {
        const gSummary = await genText(gemini, topic.prompts.summary);
        if (!gSummary.ok) return { status: "skipped", error: gSummary.error };
        const ok = verifyGlossaryOrVideo(gSummary.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: gSummary.text,
          verified: ok,
        };
      },
    },
    {
      kind: "quiz",
      run: async (): Promise<ArtifactCell> => {
        const gQuiz = await genText(gemini, topic.prompts.quiz);
        if (!gQuiz.ok) return { status: "skipped", error: gQuiz.error };
        try {
          const json = extractJsonFromModelText(gQuiz.text);
          const parsed = topicQuizOutputSchema.safeParse(JSON.parse(json));
          if (parsed.success) {
            return { status: "succeeded", payload: JSON.stringify(parsed.data), verified: true };
          }
          return {
            status: "failed",
            payload: gQuiz.text,
            verified: false,
            error: "topic_quiz_validation_failed",
          };
        } catch (e) {
          return {
            status: "failed",
            payload: gQuiz.text,
            error: e instanceof Error ? e.message : "topic_quiz_parse_error",
          };
        }
      },
    },
    {
      kind: "gameHtml",
      run: async (): Promise<ArtifactCell> => {
        const gGame = await genText(gemini, topic.prompts.gameHtml);
        if (!gGame.ok) return { status: "skipped", error: gGame.error };
        const html = stripCodeFences(gGame.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "topic", topicScopeId, "game")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    },
    {
      kind: "assessment",
      run: async (): Promise<ArtifactCell> => {
        const gAssess = await genText(gemini, topic.prompts.assessment);
        if (!gAssess.ok) return { status: "skipped", error: gAssess.error };
        const ok = verifyGlossaryOrVideo(gAssess.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: gAssess.text,
          verified: ok,
        };
      },
    },
    {
      kind: "glossary",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, topic.prompts.glossary);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifyGlossaryOrVideo(g.text);
        return {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "glossary_validation_failed",
        };
      },
    },
    {
      kind: "microGame",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, topic.prompts.microGame);
        if (!g.ok) return { status: "skipped", error: g.error };
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "topic", topicScopeId, "microgame")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    },
    {
      kind: "image",
      run: () =>
        genAndStoreImage(
          env,
          topic.prompts.illustrationImage,
          p.userId,
          p.exportId,
          "topic",
          topicScopeId,
        ),
    },
    {
      kind: "comic",
      run: () =>
        genAndStoreComicImage(
          env,
          topic.prompts.comic,
          p.userId,
          p.exportId,
          "topic",
          topicScopeId,
        ),
    },
  ];

  await runCellThunks(topicThunks, topicConc, cellTimeoutMs, out as Record<string, unknown>);

  logParseExportFailedCells({
    job: "parse-export-topic",
    exportId: p.exportId,
    userId: p.userId,
    chapterIndex: p.chapterIndex,
    topicIndex: p.topicIndex,
    row: out as Record<string, unknown>,
  });

  await writeTopicArtifact(env, p.userId, p.exportId, out);
  await recordParseExportArtifactSaved(env, p.userId, p.exportId, out as Record<string, unknown>, {
    previous: previousArtifact as Record<string, unknown> | null,
  });
}

export async function processParseExportChapterJob(env: Env, p: ParseExportChapterPayload): Promise<void> {
  const manifest = await readParseExportManifest(env, p.userId, p.exportId);
  if (!manifest) return;
  const level = manifest.meta.level;
  const chapter = findChapter(manifest, p.chapterIndex);
  if (!chapter) return;

  const storage = createStorageAdapter(env);
  const chapterKey = parseExportChapterArtifactKey(p.userId, p.exportId, p.chapterIndex);
  const previousArtifact = await tryReadJson<ChapterArtifactFile>(storage, chapterKey);

  const gemini = new GeminiClient(env);
  const chapterLang =
    chapter.lang ??
    majorityAtomLang(chapter.topics.map((t) => t.lang ?? majorityAtomLang(t.atoms.map((a) => a.lang ?? detectAtomLanguage(a.body)))));
  const out: ChapterArtifactFile = { chapterIndex: p.chapterIndex, lang: chapterLang };

  const htmlVerifyOpts = {
    mode: env.PARSE_EXPORT_HTML_VERIFY_MODE,
    maxBytes: env.PARSE_EXPORT_HTML_MAX_BYTES,
  };
  const chapterConc = Math.max(2, env.PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY);
  const chapterCellTimeoutMs = env.PARSE_EXPORT_CHAPTER_CELL_TIMEOUT_MS;
  const chapterScopeId = String(p.chapterIndex);

  const chapterThunks: LabeledCellThunk[] = [
    {
      kind: "summary",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, chapter.prompts.summary);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifyGlossaryOrVideo(g.text);
        return { status: ok ? "succeeded" : "failed", payload: g.text, verified: ok };
      },
    },
    {
      kind: "test",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, chapter.prompts.test);
        if (!g.ok) return { status: "skipped", error: g.error };
        const ok = verifyGlossaryOrVideo(g.text);
        return { status: ok ? "succeeded" : "failed", payload: g.text, verified: ok };
      },
    },
    {
      kind: "gameHtml",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, chapter.prompts.gameHtml);
        if (!g.ok) return { status: "skipped", error: g.error };
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "chapter", chapterScopeId, "game")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    },
    {
      kind: "microGame",
      run: async (): Promise<ArtifactCell> => {
        const g = await genText(gemini, chapter.prompts.microGame);
        if (!g.ok) return { status: "skipped", error: g.error };
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        const fileUrl = v.ok
          ? await saveHtmlFile(env, html, p.userId, p.exportId, "chapter", chapterScopeId, "microgame")
          : null;
        return artifactCellForHtmlGame(html, v, fileUrl);
      },
    },
    {
      kind: "image",
      run: () =>
        genAndStoreImage(
          env,
          chapter.prompts.illustrationImage,
          p.userId,
          p.exportId,
          "chapter",
          chapterScopeId,
        ),
    },
    {
      kind: "comicStory",
      run: async (): Promise<ArtifactCell> => {
        const gem = await genText(gemini, chapter.prompts.comicStoryPlan);
        if (!gem.ok) return { status: "skipped", error: gem.error };
        const imgService = new GeminiImageService(env);
        if (!imgService.isConfigured()) {
          return {
            status: "skipped",
            payload: gem.text,
            error: "GEMINI_IMAGE_MODEL not configured",
          };
        }
        try {
          let pages = parseChapterComicPlan(gem.text);
          if (pages.length === 0) {
            return {
              status: "failed",
              payload: gem.text,
              error: "chapter_comic_plan_invalid",
            };
          }
          pages = pages.slice(0, env.PARSE_EXPORT_COMIC_CHAPTER_MAX_PAGES);
          const pageOutputs = await mapWithConcurrency(
            pages,
            Math.max(1, env.PARSE_EXPORT_COMIC_PAGE_CONCURRENCY),
            async (page) => {
              const imagePrompt = comicPageImagePromptForChapter(
                chapter.title,
                chapter.prompts.comicCharacters,
                page,
                pages.length,
                level,
              );
              try {
                const image = await imgService.generate(imagePrompt);
                if (!image) {
                  return {
                    pageNumber: page.pageNumber,
                    status: "failed" as const,
                    error: "GEMINI_IMAGE_MODEL not configured",
                  };
                }
                const key = parseExportComicPageKey(
                  p.userId,
                  p.exportId,
                  p.chapterIndex,
                  page.pageNumber,
                  image.fileExt,
                );
                await storage.saveObject(key, image.buffer, image.mime);
                const rel = buildSignedFilesAudioRelativeUrl(key, image.mime, env);
                return {
                  pageNumber: page.pageNumber,
                  status: "succeeded" as const,
                  fileUrl: buildPublicApiUrl(env, rel),
                  mime: image.mime,
                  description: page.description,
                  visualCue: page.visualCue,
                };
              } catch (e) {
                return {
                  pageNumber: page.pageNumber,
                  status: "failed" as const,
                  error: e instanceof Error ? e.message : String(e),
                };
              }
            },
          );
          const failed = pageOutputs.filter((pout) => pout.status !== "succeeded");
          return {
            status: failed.length === 0 ? "succeeded" : "failed",
            verified: failed.length === 0,
            payload: JSON.stringify({
              chapterTitle: chapter.title,
              characters: chapter.prompts.comicCharacters,
              pages: pageOutputs.sort((a, b) => a.pageNumber - b.pageNumber),
            }),
            error:
              failed.length === 0
                ? undefined
                : `failed_pages:${failed.map((x) => x.pageNumber).join(",")}`,
          };
        } catch (e) {
          return {
            status: "failed",
            payload: gem.text,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    },
  ];

  await runCellThunks(
    chapterThunks,
    chapterConc,
    chapterCellTimeoutMs,
    out as Record<string, unknown>,
  );

  logParseExportFailedCells({
    job: "parse-export-chapter",
    exportId: p.exportId,
    userId: p.userId,
    chapterIndex: p.chapterIndex,
    row: out as Record<string, unknown>,
  });

  await writeChapterArtifact(env, p.userId, p.exportId, out);
  await recordParseExportArtifactSaved(env, p.userId, p.exportId, out as Record<string, unknown>, {
    previous: previousArtifact as Record<string, unknown> | null,
  });
}

function countFailedInArtifact(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  let n = 0;
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (v && typeof v === "object" && "status" in v && (v as ArtifactCell).status === "failed") n += 1;
  }
  return n;
}

function computeTimeTakenSeconds(prog: {
  generationStartedAt?: string;
  generationCompletedAt?: string;
}): { time_taken_seconds: number | null; generation_started_at: string | null; generation_completed_at: string | null } {
  const generation_started_at = prog.generationStartedAt ?? null;
  const generation_completed_at = prog.generationCompletedAt ?? null;
  if (!generation_started_at) {
    return {
      time_taken_seconds: null,
      generation_started_at,
      generation_completed_at,
    };
  }
  const startMs = Date.parse(generation_started_at);
  if (Number.isNaN(startMs)) {
    return {
      time_taken_seconds: null,
      generation_started_at,
      generation_completed_at,
    };
  }
  const endMs = generation_completed_at ? Date.parse(generation_completed_at) : Date.now();
  const end = Number.isNaN(endMs) ? Date.now() : endMs;
  const time_taken_seconds = Math.max(0, Math.floor((end - startMs) / 1000));
  return { time_taken_seconds, generation_started_at, generation_completed_at };
}

/**
 * Counts persisted atom/topic/chapter artifact JSON files — same slots as {@link loadParseExportGenerated}.
 * Uses `objectExists` so progress matches GET /generated without parsing every blob or trusting Redis alone
 * (Redis `completedJobs` can briefly lag after a write).
 */
async function countPersistedGenerationArtifacts(
  env: Env,
  userId: string,
  exportId: string,
  manifest: ParseExportManifestV1,
): Promise<number> {
  const storage = createStorageAdapter(env);
  let done = 0;
  for (const ch of manifest.chapters) {
    for (const tp of ch.topics) {
      for (const at of tp.atoms) {
        const key = parseExportAtomArtifactKey(userId, exportId, at.id);
        if (await storage.objectExists(key)) done += 1;
      }
    }
  }
  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const ch = manifest.chapters[chi];
    if (!ch) continue;
    for (let tpi = 0; tpi < ch.topics.length; tpi++) {
      const key = parseExportTopicArtifactKey(userId, exportId, chi, tpi);
      if (await storage.objectExists(key)) done += 1;
    }
  }
  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const key = parseExportChapterArtifactKey(userId, exportId, chi);
    if (await storage.objectExists(key)) done += 1;
  }
  return done;
}

export async function loadParseExportStatus(
  env: Env,
  userId: string,
  exportId: string,
): Promise<{
  exportId: string;
  status: "queued" | "running" | "complete";
  complete: boolean;
  ready: boolean;
  progress: { done: number; total: number; failedCells: number };
  /** Per-artifact-type succeeded/failed/skipped counts (all known types; zeros when none). */
  byType: Record<ParseExportArtifactKind, KindStats>;
  ttsCount: number;
  lastUpdatedAt: string;
  generation_started_at: string | null;
  generation_completed_at: string | null;
  /** Elapsed seconds since generation started; frozen when complete (UTC timestamps). */
  time_taken_seconds: number | null;
  /** Same as `time_taken_seconds` (seconds); prefer `time_taken_seconds` in new clients. */
  time_taken: number | null;
} | null> {
  const prog = await loadParseExportProgress(env, userId, exportId);
  if (prog) {
    const manifest = await readParseExportManifest(env, userId, exportId);
    const totalJobs = manifest?.expectedGenerationJobs ?? prog.totalJobs;
    let done =
      manifest != null
        ? await countPersistedGenerationArtifacts(env, userId, exportId, manifest)
        : prog.completedJobs;
    const timing = computeTimeTakenSeconds(prog);
    const complete = totalJobs > 0 && done >= totalJobs;
    const ready = done > 0;
    const status: ParseExportProgressV1["status"] =
      totalJobs > 0 && done >= totalJobs
        ? "complete"
        : done > 0 || prog.status === "running"
          ? "running"
          : "queued";
    return {
      exportId,
      status,
      complete,
      ready,
      progress: { done, total: totalJobs, failedCells: prog.failedCells },
      byType: expandByTypeStats(prog.byKind),
      ttsCount: prog.ttsSucceeded,
      lastUpdatedAt: prog.updatedAt,
      generation_started_at: timing.generation_started_at,
      generation_completed_at: timing.generation_completed_at,
      time_taken_seconds: timing.time_taken_seconds,
      time_taken: timing.time_taken_seconds,
    };
  }

  const manifest = await readParseExportManifest(env, userId, exportId);
  if (!manifest) return null;
  const gen = await loadParseExportGenerated(env, userId, exportId);
  if (!gen) return null;
  let ttsOk = 0;
  for (const a of Object.values(gen.atoms)) {
    if (a?.tts?.status === "succeeded") ttsOk += 1;
  }
  const partials: Partial<Record<ParseExportArtifactKind, KindStats>>[] = [];
  for (const a of Object.values(gen.atoms)) {
    if (a) partials.push(artifactRecordToPartialTypeStats(a as Record<string, unknown>));
  }
  for (const t of Object.values(gen.topics)) {
    if (t) partials.push(artifactRecordToPartialTypeStats(t as Record<string, unknown>));
  }
  for (const c of Object.values(gen.chapters)) {
    if (c) partials.push(artifactRecordToPartialTypeStats(c as Record<string, unknown>));
  }
  const byType = expandByTypeStats(mergePartialTypeStats(...partials));
  return {
    exportId,
    status: gen.complete ? "complete" : gen.ready ? "running" : "queued",
    complete: gen.complete,
    ready: gen.ready,
    progress: gen.progress,
    byType,
    ttsCount: ttsOk,
    lastUpdatedAt: new Date().toISOString(),
    generation_started_at: null,
    generation_completed_at: null,
    time_taken_seconds: null,
    time_taken: null,
  };
}

export async function loadSingleAtomArtifact(
  env: Env,
  userId: string,
  exportId: string,
  atomId: string,
): Promise<AtomArtifactFile | null> {
  const storage = createStorageAdapter(env);
  return tryReadJson<AtomArtifactFile>(storage, parseExportAtomArtifactKey(userId, exportId, atomId));
}

export async function loadSingleTopicArtifact(
  env: Env,
  userId: string,
  exportId: string,
  chapterIndex: number,
  topicIndex: number,
): Promise<TopicArtifactFile | null> {
  const storage = createStorageAdapter(env);
  return tryReadJson<TopicArtifactFile>(storage, parseExportTopicArtifactKey(userId, exportId, chapterIndex, topicIndex));
}

export async function loadSingleChapterArtifact(
  env: Env,
  userId: string,
  exportId: string,
  chapterIndex: number,
): Promise<ChapterArtifactFile | null> {
  const storage = createStorageAdapter(env);
  return tryReadJson<ChapterArtifactFile>(storage, parseExportChapterArtifactKey(userId, exportId, chapterIndex));
}

/**
 * Strip `payload` from every ArtifactCell in an artifact object.
 * Used by the summary view so HTML / JSON payloads (can be 200+ KB each) are not
 * sent over the wire when the client only needs status + URLs.
 */
function stripArtifactPayloads<T extends object>(artifact: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(artifact)) {
    if (v && typeof v === "object" && "status" in v) {
      const { payload: _drop, ...rest } = v as ArtifactCell & Record<string, unknown>;
      out[k] = rest;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export async function loadParseExportGenerated(
  env: Env,
  userId: string,
  exportId: string,
  opts: { summary?: boolean } = {},
): Promise<{
  exportId: string;
  complete: boolean;
  ready: boolean;
  progress: { done: number; total: number; failedCells: number };
  /** Which atoms were scheduled for TTS at export time (`TTS_MAX_ATOMS` highest‑scoring only). Those atoms may get `tts.audioUrl` / `tts.fileUrl` when synthesis succeeds. */
  ttsScope: { pendingAtomIds: string[]; maxAtoms: number };
  atoms: Record<string, AtomArtifactFile | null>;
  topics: Record<string, TopicArtifactFile | null>;
  chapters: Record<string, ChapterArtifactFile | null>;
} | null> {
  const manifest = await readParseExportManifest(env, userId, exportId);
  if (!manifest) return null;

  const storage = createStorageAdapter(env);
  const atoms: Record<string, AtomArtifactFile | null> = {};
  const topics: Record<string, TopicArtifactFile | null> = {};
  const chapters: Record<string, ChapterArtifactFile | null> = {};

  let done = 0;
  let failedCells = 0;
  const total = manifest.expectedGenerationJobs;

  for (const ch of manifest.chapters) {
    for (const tp of ch.topics) {
      for (const at of tp.atoms) {
        const key = parseExportAtomArtifactKey(userId, exportId, at.id);
        const raw = await tryReadJson<AtomArtifactFile>(storage, key);
        atoms[at.id] = raw ? (opts.summary ? stripArtifactPayloads(raw) : raw) : null;
        if (raw) {
          done += 1;
          failedCells += countFailedInArtifact(raw);
        }
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const ch = manifest.chapters[chi];
    if (!ch) continue;
    for (let tpi = 0; tpi < ch.topics.length; tpi++) {
      const tk = `${String(chi)}-${String(tpi)}`;
      const key = parseExportTopicArtifactKey(userId, exportId, chi, tpi);
      const raw = await tryReadJson<TopicArtifactFile>(storage, key);
      topics[tk] = raw ? (opts.summary ? stripArtifactPayloads(raw) : raw) : null;
      if (raw) {
        done += 1;
        failedCells += countFailedInArtifact(raw);
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const key = parseExportChapterArtifactKey(userId, exportId, chi);
    const raw = await tryReadJson<ChapterArtifactFile>(storage, key);
    chapters[String(chi)] = raw ? (opts.summary ? stripArtifactPayloads(raw) : raw) : null;
    if (raw) {
      done += 1;
      failedCells += countFailedInArtifact(raw);
    }
  }

  const complete = done >= total;
  const ready = done > 0;
  return {
    exportId,
    complete,
    ready,
    progress: { done, total, failedCells },
    ttsScope: {
      pendingAtomIds: manifest.ttsPendingAtomIds,
      maxAtoms: manifest.ttsMaxAtoms,
    },
    atoms,
    topics,
    chapters,
  };
}

export async function enqueueParseExportGenerationJobs(
  manifest: ParseExportManifestV1,
  priority: JobPriority = "medium",
): Promise<void> {
  const q = getQueue();
  const pending: Promise<void>[] = [];

  const track = (v: void | Promise<void>): void => {
    if (v instanceof Promise) pending.push(v);
  };

  for (const ch of manifest.chapters) {
    for (const tp of ch.topics) {
      for (const at of tp.atoms) {
        track(
          q.enqueue(
            "parse-export-atom",
            { exportId: manifest.exportId, userId: manifest.userId, atomId: at.id } satisfies ParseExportAtomPayload,
            priority,
          ),
        );
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const ch = manifest.chapters[chi];
    if (!ch) continue;
    for (let tpi = 0; tpi < ch.topics.length; tpi++) {
      track(
        q.enqueue(
          "parse-export-topic",
          {
            exportId: manifest.exportId,
            userId: manifest.userId,
            chapterIndex: chi,
            topicIndex: tpi,
          } satisfies ParseExportTopicPayload,
          priority,
        ),
      );
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    track(
      q.enqueue(
        "parse-export-chapter",
        {
          exportId: manifest.exportId,
          userId: manifest.userId,
          chapterIndex: chi,
        } satisfies ParseExportChapterPayload,
        priority,
      ),
    );
  }

  await Promise.all(pending);
}

export function computeExpectedGenerationJobCount(manifest: PdfParseExportResult): number {
  let atoms = 0;
  let topics = 0;
  for (const ch of manifest.chapters) {
    topics += ch.topics.length;
    for (const tp of ch.topics) {
      atoms += tp.atoms.length;
    }
  }
  return atoms + topics + manifest.chapters.length;
}
