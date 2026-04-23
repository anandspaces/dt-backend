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
import { GeminiTtsService } from "../tts/gemini-tts.service.js";
import { SuperTtsHttpService } from "../tts/supertts-http.service.js";
import { verifyGeneratedHtml } from "../generation/html-verification.js";
import { buildPublicApiUrl } from "../../common/public-url.js";
import { detectAtomLanguage, majorityAtomLang } from "../lang-detect/lang-detect.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { GeminiImageService } from "../ai/gemini-image.service.js";
import {
  parseExportAtomArtifactKey,
  parseExportChapterArtifactKey,
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
import { loadParseExportProgress, recordParseExportArtifactSaved } from "./parse-export-progress.js";

export type { ArtifactCell, AtomArtifactFile, ChapterArtifactFile, TopicArtifactFile } from "./parse-export-artifact.types.js";

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

const quizOutputSchema = z.object({
  question: z.string(),
  choices: z.array(z.string()).length(4),
  answerIndex: z.number().int().min(0).max(3),
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
      return { status: "failed", error: "no_image_returned" };
    }
    const storage = createStorageAdapter(env);
    const key = parseExportImageKey(userId, exportId, scope, scopeId, result.fileExt);
    await storage.saveObject(key, result.buffer, result.mime);
    const q = new URLSearchParams({ key, mime: result.mime });
    const rel = `/api/v1/files/audio?${q.toString()}`;
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

/**
 * Returns the canonical API path for an HTML game file.
 *   atom    → /api/v1/parse/exports/{exportId}/atoms/{scopeId}/game.html
 *   topic   → /api/v1/parse/exports/{exportId}/topics/0/5/game.html  (scopeId="0-5")
 *   chapter → /api/v1/parse/exports/{exportId}/chapters/0/game.html
 */
function htmlArtifactPath(
  exportId: string,
  scope: "atom" | "topic" | "chapter",
  scopeId: string,
  kind: "game" | "microgame",
): string {
  const filename = kind === "game" ? "game.html" : "microgame.html";
  const base = `/api/v1/parse/exports/${exportId}`;
  if (scope === "atom") return `${base}/atoms/${scopeId}/${filename}`;
  if (scope === "topic") return `${base}/topics/${scopeId.replace("-", "/")}/${filename}`;
  return `${base}/chapters/${scopeId}/${filename}`;
}

/**
 * Persists an HTML string as a standalone `.html` file and returns its canonical API URL.
 * Falls back to null on storage error (caller keeps inline payload as fallback).
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
    return buildPublicApiUrl(env, htmlArtifactPath(exportId, scope, scopeId, kind));
  } catch {
    return null;
  }
}

export async function processParseExportAtomJob(env: Env, p: ParseExportAtomPayload): Promise<void> {
  const manifest = await readParseExportManifest(env, p.userId, p.exportId);
  if (!manifest) return;
  const found = findAtom(manifest, p.atomId);
  if (!found) return;

  const { atom } = found;
  const gemini = new GeminiClient(env);
  const superTts = new SuperTtsHttpService(env);
  const geminiTts = new GeminiTtsService(env);
  const storage = createStorageAdapter(env);
  const atomArtifactKey = parseExportAtomArtifactKey(p.userId, p.exportId, p.atomId);
  const previousArtifact = await tryReadJson<AtomArtifactFile>(storage, atomArtifactKey);

  const lang = atom.lang ?? detectAtomLanguage(atom.body);
  const out: AtomArtifactFile = { atomId: p.atomId, lang };

  if (manifest.ttsPendingAtomIds.includes(p.atomId)) {
    try {
      if (superTts.isConfigured()) {
        const { buffer, mime, fileExt } = await superTts.synthesize(atom.body, lang);
        const objectKey = `parse-export/${p.userId}/${p.exportId}/${p.atomId}.${lang}.${fileExt}`;
        await storage.saveObject(objectKey, buffer, mime);
        const q = new URLSearchParams({ key: objectKey, mime });
        const rel = `/api/v1/files/audio?${q.toString()}`;
        out.tts = {
          status: "succeeded",
          audioUrl: buildPublicApiUrl(env, rel),
          mime,
          verified: true,
          language: lang,
        };
      } else if (geminiTts.isConfigured()) {
        const { buffer, mime, fileExt } = await geminiTts.synthesize(atom.body, lang);
        const objectKey = `parse-export/${p.userId}/${p.exportId}/${p.atomId}.${lang}.${fileExt}`;
        await storage.saveObject(objectKey, buffer, mime);
        const q = new URLSearchParams({ key: objectKey, mime });
        const rel = `/api/v1/files/audio?${q.toString()}`;
        out.tts = {
          status: "succeeded",
          audioUrl: buildPublicApiUrl(env, rel),
          mime,
          verified: true,
          language: lang,
        };
      } else {
        out.tts = { status: "skipped", error: "tts_not_configured" };
      }
    } catch (e) {
      out.tts = {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const htmlVerifyOpts = {
    mode: env.PARSE_EXPORT_HTML_VERIFY_MODE,
    maxBytes: env.PARSE_EXPORT_HTML_MAX_BYTES,
  };
  const internalConc = Math.max(1, env.PARSE_EXPORT_ATOM_INTERNAL_CONCURRENCY);

  const parallelThunks: Array<() => Promise<void>> = [];

  if (atom.recommended.quiz) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.quiz);
      if (!g.ok) out.quiz = { status: "skipped", error: g.error };
      else {
        try {
          const json = extractJsonFromModelText(g.text);
          const parsed = quizOutputSchema.safeParse(JSON.parse(json));
          const ok = parsed.success;
          out.quiz = {
            status: ok ? "succeeded" : "failed",
            payload: ok ? JSON.stringify(parsed.data) : g.text,
            verified: ok,
            error: ok ? undefined : "quiz_validation_failed",
          };
        } catch (e) {
          out.quiz = {
            status: "failed",
            payload: g.text,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
    });
  }

  if (atom.recommended.gameHtml) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.gameHtml);
      if (!g.ok) { out.gameHtml = { status: "skipped", error: g.error }; return; }
      const html = stripCodeFences(g.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "atom", p.atomId, "game")
        : null;
      out.gameHtml = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    });
  }

  if (atom.recommended.gameHtml || atom.recommended.quiz) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.microGame);
      if (!g.ok) { out.microGame = { status: "skipped", error: g.error }; return; }
      const html = stripCodeFences(g.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "atom", p.atomId, "microgame")
        : null;
      out.microGame = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    });
  }

  if (atom.recommended.simulation) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.simulation);
      if (!g.ok) out.simulation = { status: "skipped", error: g.error };
      else {
        const ok = verifySimulationPayload(g.text);
        out.simulation = {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "simulation_validation_failed",
        };
      }
    });
  }

  if (atom.recommended.video) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.video);
      if (!g.ok) out.video = { status: "skipped", error: g.error };
      else {
        const ok = verifyGlossaryOrVideo(g.text);
        out.video = {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "video_validation_failed",
        };
      }
    });
  }

  if (atom.recommended.quiz) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.glossary);
      if (!g.ok) out.glossary = { status: "skipped", error: g.error };
      else {
        const ok = verifyGlossaryOrVideo(g.text);
        out.glossary = {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "glossary_validation_failed",
        };
      }
    });
  }

  // Image generation runs in parallel with the other thunks
  parallelThunks.push(async () => {
    out.image = await genAndStoreImage(
      env,
      atom.prompts.illustrationImage,
      p.userId,
      p.exportId,
      "atom",
      p.atomId,
    );
  });

  await mapWithConcurrency(parallelThunks, internalConc, (fn) => fn());

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

  const topicThunks: Array<() => Promise<void>> = [
    async () => {
      const gSummary = await genText(gemini, topic.prompts.summary);
      if (!gSummary.ok) out.summary = { status: "skipped", error: gSummary.error };
      else {
        const ok = verifyGlossaryOrVideo(gSummary.text);
        out.summary = {
          status: ok ? "succeeded" : "failed",
          payload: gSummary.text,
          verified: ok,
        };
      }
    },
    async () => {
      const gQuiz = await genText(gemini, topic.prompts.quiz);
      if (!gQuiz.ok) out.quiz = { status: "skipped", error: gQuiz.error };
      else {
        try {
          const json = extractJsonFromModelText(gQuiz.text);
          const parsed = quizOutputSchema.safeParse(JSON.parse(json));
          const ok = parsed.success;
          out.quiz = {
            status: ok ? "succeeded" : "failed",
            payload: ok ? JSON.stringify(parsed.data) : gQuiz.text,
            verified: ok,
          };
        } catch {
          out.quiz = { status: "failed", payload: gQuiz.text };
        }
      }
    },
    async () => {
      const gGame = await genText(gemini, topic.prompts.gameHtml);
      if (!gGame.ok) { out.gameHtml = { status: "skipped", error: gGame.error }; return; }
      const html = stripCodeFences(gGame.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const scopeId = `${String(p.chapterIndex)}-${String(p.topicIndex)}`;
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "topic", scopeId, "game")
        : null;
      out.gameHtml = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    },
    async () => {
      const gAssess = await genText(gemini, topic.prompts.assessment);
      if (!gAssess.ok) out.assessment = { status: "skipped", error: gAssess.error };
      else {
        const ok = verifyGlossaryOrVideo(gAssess.text);
        out.assessment = {
          status: ok ? "succeeded" : "failed",
          payload: gAssess.text,
          verified: ok,
        };
      }
    },
    async () => {
      const g = await genText(gemini, topic.prompts.glossary);
      if (!g.ok) out.glossary = { status: "skipped", error: g.error };
      else {
        const ok = verifyGlossaryOrVideo(g.text);
        out.glossary = {
          status: ok ? "succeeded" : "failed",
          payload: g.text,
          verified: ok,
          error: ok ? undefined : "glossary_validation_failed",
        };
      }
    },
    async () => {
      const g = await genText(gemini, topic.prompts.microGame);
      if (!g.ok) { out.microGame = { status: "skipped", error: g.error }; return; }
      const html = stripCodeFences(g.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const scopeId = `${String(p.chapterIndex)}-${String(p.topicIndex)}`;
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "topic", scopeId, "microgame")
        : null;
      out.microGame = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    },
    async () => {
      const scopeId = `${String(p.chapterIndex)}-${String(p.topicIndex)}`;
      out.image = await genAndStoreImage(
        env,
        topic.prompts.illustrationImage,
        p.userId,
        p.exportId,
        "topic",
        scopeId,
      );
    },
  ];

  await mapWithConcurrency(topicThunks, topicConc, (fn) => fn());

  await writeTopicArtifact(env, p.userId, p.exportId, out);
  await recordParseExportArtifactSaved(env, p.userId, p.exportId, out as Record<string, unknown>, {
    previous: previousArtifact as Record<string, unknown> | null,
  });
}

export async function processParseExportChapterJob(env: Env, p: ParseExportChapterPayload): Promise<void> {
  const manifest = await readParseExportManifest(env, p.userId, p.exportId);
  if (!manifest) return;
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

  const chapterThunks: Array<() => Promise<void>> = [
    async () => {
      const g = await genText(gemini, chapter.prompts.summary);
      if (!g.ok) { out.summary = { status: "skipped", error: g.error }; return; }
      const ok = verifyGlossaryOrVideo(g.text);
      out.summary = { status: ok ? "succeeded" : "failed", payload: g.text, verified: ok };
    },
    async () => {
      const g = await genText(gemini, chapter.prompts.test);
      if (!g.ok) { out.test = { status: "skipped", error: g.error }; return; }
      const ok = verifyGlossaryOrVideo(g.text);
      out.test = { status: ok ? "succeeded" : "failed", payload: g.text, verified: ok };
    },
    async () => {
      const g = await genText(gemini, chapter.prompts.gameHtml);
      if (!g.ok) { out.gameHtml = { status: "skipped", error: g.error }; return; }
      const html = stripCodeFences(g.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "chapter", String(p.chapterIndex), "game")
        : null;
      out.gameHtml = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    },
    async () => {
      const g = await genText(gemini, chapter.prompts.microGame);
      if (!g.ok) { out.microGame = { status: "skipped", error: g.error }; return; }
      const html = stripCodeFences(g.text);
      const v = verifyGeneratedHtml(html, htmlVerifyOpts);
      const htmlUrl = v.ok
        ? await saveHtmlFile(env, html, p.userId, p.exportId, "chapter", String(p.chapterIndex), "microgame")
        : null;
      out.microGame = {
        status: v.ok ? "succeeded" : "failed",
        payload: html,
        htmlUrl,
        verified: v.ok,
        error: v.ok ? undefined : v.reason,
      };
    },
    async () => {
      out.image = await genAndStoreImage(
        env,
        chapter.prompts.illustrationImage,
        p.userId,
        p.exportId,
        "chapter",
        String(p.chapterIndex),
      );
    },
  ];

  await mapWithConcurrency(chapterThunks, chapterConc, (fn) => fn());

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
  ttsCount: number;
  lastUpdatedAt: string;
} | null> {
  const prog = await loadParseExportProgress(env, userId, exportId);
  if (prog) {
    const total = prog.totalJobs;
    const done = prog.completedJobs;
    return {
      exportId,
      status: prog.status,
      complete: total > 0 && done >= total,
      ready: done > 0,
      progress: { done, total, failedCells: prog.failedCells },
      ttsCount: prog.ttsSucceeded,
      lastUpdatedAt: prog.updatedAt,
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
  return {
    exportId,
    status: gen.complete ? "complete" : gen.ready ? "running" : "queued",
    complete: gen.complete,
    ready: gen.ready,
    progress: gen.progress,
    ttsCount: ttsOk,
    lastUpdatedAt: new Date().toISOString(),
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
