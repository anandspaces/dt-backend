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
import {
  parseExportAtomArtifactKey,
  parseExportChapterArtifactKey,
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
      if (!g.ok) out.gameHtml = { status: "skipped", error: g.error };
      else {
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        out.gameHtml = {
          status: v.ok ? "succeeded" : "failed",
          payload: html,
          verified: v.ok,
          error: v.ok ? undefined : v.reason,
        };
      }
    });
  }

  if (atom.recommended.gameHtml || atom.recommended.quiz) {
    parallelThunks.push(async () => {
      const g = await genText(gemini, atom.prompts.microGame);
      if (!g.ok) out.microGame = { status: "skipped", error: g.error };
      else {
        const html = stripCodeFences(g.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        out.microGame = {
          status: v.ok ? "succeeded" : "failed",
          payload: html,
          verified: v.ok,
          error: v.ok ? undefined : v.reason,
        };
      }
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
      if (!gGame.ok) out.gameHtml = { status: "skipped", error: gGame.error };
      else {
        const html = stripCodeFences(gGame.text);
        const v = verifyGeneratedHtml(html, htmlVerifyOpts);
        out.gameHtml = {
          status: v.ok ? "succeeded" : "failed",
          payload: html,
          verified: v.ok,
          error: v.ok ? undefined : v.reason,
        };
      }
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

  await Promise.all(
    (["summary", "test"] as const).map(async (key) => {
      const prompt = key === "summary" ? chapter.prompts.summary : chapter.prompts.test;
      const g = await genText(gemini, prompt);
      if (!g.ok) {
        out[key] = { status: "skipped", error: g.error };
        return;
      }
      const ok = verifyGlossaryOrVideo(g.text);
      out[key] = {
        status: ok ? "succeeded" : "failed",
        payload: g.text,
        verified: ok,
      };
    }),
  );

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

export async function loadParseExportGenerated(
  env: Env,
  userId: string,
  exportId: string,
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
        const data = await tryReadJson<AtomArtifactFile>(storage, key);
        atoms[at.id] = data;
        if (data) {
          done += 1;
          failedCells += countFailedInArtifact(data);
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
      const data = await tryReadJson<TopicArtifactFile>(storage, key);
      topics[tk] = data;
      if (data) {
        done += 1;
        failedCells += countFailedInArtifact(data);
      }
    }
  }

  for (let chi = 0; chi < manifest.chapters.length; chi++) {
    const key = parseExportChapterArtifactKey(userId, exportId, chi);
    const data = await tryReadJson<ChapterArtifactFile>(storage, key);
    chapters[String(chi)] = data;
    if (data) {
      done += 1;
      failedCells += countFailedInArtifact(data);
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
