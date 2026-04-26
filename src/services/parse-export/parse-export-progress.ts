import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { parseExportProgressKey } from "./parse-export-keys.js";
import type { ArtifactCell } from "./parse-export-artifact.types.js";
import { publishParseExportEvent } from "./parse-export-events.js";
import Redis from "ioredis";

export type ParseExportArtifactKind =
  | "tts"
  | "quiz"
  | "gameHtml"
  | "microGame"
  | "simulation"
  | "video"
  | "glossary"
  | "summary"
  | "assessment"
  | "test"
  | "image"
  | "comic"
  | "comicStory";

export type KindStats = { succeeded: number; failed: number; skipped: number };

export type ParseExportProgressV1 = {
  version: 1;
  exportId: string;
  userId: string;
  totalJobs: number;
  completedJobs: number;
  failedCells: number;
  ttsSucceeded: number;
  byKind: Partial<Record<ParseExportArtifactKind, KindStats>>;
  status: "queued" | "running" | "complete";
  updatedAt: string;
  /** UTC ISO8601 — set once when generation jobs are first queued */
  generationStartedAt?: string;
  /** UTC ISO8601 — set when all jobs finished */
  generationCompletedAt?: string;
};

const emptyKindStats = (): KindStats => ({ succeeded: 0, failed: 0, skipped: 0 });

function redisProgressKey(exportId: string): string {
  return `pe:p:${exportId}`;
}

let redisClient: Redis | null = null;

function getRedis(env: Env): Redis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redisClient) {
    redisClient = new Redis(url, { maxRetriesPerRequest: null });
  }
  return redisClient;
}

const fileQueues = new Map<string, Promise<unknown>>();

function runExclusiveFile<T>(exportId: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileQueues.get(exportId) ?? Promise.resolve();
  const next: Promise<T> = prev.then(() => fn());
  fileQueues.set(exportId, next.then(() => undefined, () => undefined));
  return next;
}

async function readProgressJson(
  env: Env,
  userId: string,
  exportId: string,
): Promise<ParseExportProgressV1 | null> {
  const storage = createStorageAdapter(env);
  const key = parseExportProgressKey(userId, exportId);
  try {
    const buf = await storage.readObject(key);
    return JSON.parse(buf.toString("utf8")) as ParseExportProgressV1;
  } catch {
    return null;
  }
}

async function writeProgressJson(env: Env, userId: string, exportId: string, state: ParseExportProgressV1): Promise<void> {
  const storage = createStorageAdapter(env);
  const key = parseExportProgressKey(userId, exportId);
  await storage.saveObject(key, Buffer.from(JSON.stringify(state), "utf8"), "application/json");
}

async function mergeProgressRedis(
  env: Env,
  userId: string,
  exportId: string,
  merger: (cur: ParseExportProgressV1) => ParseExportProgressV1,
): Promise<ParseExportProgressV1> {
  const r = getRedis(env);
  if (!r) throw new Error("Redis not configured");
  const key = redisProgressKey(exportId);
  for (let attempt = 0; attempt < 12; attempt++) {
    await r.watch(key);
    const raw = await r.get(key);
    let cur: ParseExportProgressV1 | null = raw ? (JSON.parse(raw) as ParseExportProgressV1) : null;
    if (!cur) {
      cur = await readProgressJson(env, userId, exportId);
    }
    if (!cur) {
      cur = {
        version: 1,
        exportId,
        userId,
        totalJobs: 0,
        completedJobs: 0,
        failedCells: 0,
        ttsSucceeded: 0,
        byKind: {},
        status: "running",
        updatedAt: new Date().toISOString(),
      };
    }
    const next = merger({ ...cur, userId: cur.userId || userId });
    const exec = await r.multi().set(key, JSON.stringify(next)).exec();
    if (exec) return next;
  }
  throw new Error("parse-export progress: redis merge failed after retries");
}

function bumpKind(byKind: ParseExportProgressV1["byKind"], kind: ParseExportArtifactKind, status: ArtifactCell["status"]): void {
  const slot = (byKind[kind] ??= emptyKindStats());
  if (status === "succeeded") slot.succeeded += 1;
  else if (status === "failed") slot.failed += 1;
  else if (status === "skipped") slot.skipped += 1;
}

const META_KEYS = new Set(["atomId", "chapterIndex", "topicIndex", "lang", "version"]);

/** Canonical list of artifact row keys (must match `ParseExportArtifactKind`). */
export const PARSE_EXPORT_ARTIFACT_KINDS: readonly ParseExportArtifactKind[] = [
  "tts",
  "quiz",
  "gameHtml",
  "microGame",
  "simulation",
  "video",
  "glossary",
  "summary",
  "assessment",
  "test",
  "image",
  "comic",
  "comicStory",
];

function isArtifactKind(k: string): k is ParseExportArtifactKind {
  return (PARSE_EXPORT_ARTIFACT_KINDS as readonly string[]).includes(k);
}

function countArtifactCells(artifactRecord: Record<string, unknown>): {
  failed: number;
  kinds: Partial<Record<ParseExportArtifactKind, ArtifactCell["status"]>>;
} {
  let failed = 0;
  const kinds: Partial<Record<ParseExportArtifactKind, ArtifactCell["status"]>> = {};
  for (const [key, val] of Object.entries(artifactRecord)) {
    if (META_KEYS.has(key) || !isArtifactKind(key)) continue;
    if (!val || typeof val !== "object" || !("status" in val)) continue;
    const cell = val as ArtifactCell;
    kinds[key] = cell.status;
    if (cell.status === "failed") failed += 1;
  }
  return { failed, kinds };
}

function partialKindStatsFromCountedKinds(
  kinds: Partial<Record<ParseExportArtifactKind, ArtifactCell["status"]>>,
): Partial<Record<ParseExportArtifactKind, KindStats>> {
  const byKind: Partial<Record<ParseExportArtifactKind, KindStats>> = {};
  for (const [k, st] of Object.entries(kinds)) {
    if (!isArtifactKind(k)) continue;
    bumpKind(byKind, k, st);
  }
  return byKind;
}

/** Per-type cell counts for one atom/topic/chapter artifact JSON object. */
export function artifactRecordToPartialTypeStats(
  art: Record<string, unknown>,
): Partial<Record<ParseExportArtifactKind, KindStats>> {
  const { kinds } = countArtifactCells(art);
  return partialKindStatsFromCountedKinds(kinds);
}

/** Sum succeeded/failed/skipped per artifact type across many partial maps. */
export function mergePartialTypeStats(
  ...parts: Partial<Record<ParseExportArtifactKind, KindStats>>[]
): Partial<Record<ParseExportArtifactKind, KindStats>> {
  const out: Partial<Record<ParseExportArtifactKind, KindStats>> = {};
  for (const p of parts) {
    for (const k of PARSE_EXPORT_ARTIFACT_KINDS) {
      const slot = p[k];
      if (!slot || (slot.succeeded === 0 && slot.failed === 0 && slot.skipped === 0)) continue;
      const cur = out[k] ?? emptyKindStats();
      out[k] = {
        succeeded: cur.succeeded + slot.succeeded,
        failed: cur.failed + slot.failed,
        skipped: cur.skipped + slot.skipped,
      };
    }
  }
  return out;
}

/** Full keyed map for status API (missing types become zero counts). */
export function expandByTypeStats(
  partial: Partial<Record<ParseExportArtifactKind, KindStats>>,
): Record<ParseExportArtifactKind, KindStats> {
  const out = {} as Record<ParseExportArtifactKind, KindStats>;
  for (const k of PARSE_EXPORT_ARTIFACT_KINDS) {
    out[k] = partial[k] ?? emptyKindStats();
  }
  return out;
}

function kindStatsFromArtifact(art: Record<string, unknown>): {
  failed: number;
  byKind: Partial<Record<ParseExportArtifactKind, KindStats>>;
  ttsSucceeded: number;
} {
  const { failed, kinds } = countArtifactCells(art);
  const byKind = partialKindStatsFromCountedKinds(kinds);
  const ttsSucceeded = kinds.tts === "succeeded" ? 1 : 0;
  return { failed, byKind, ttsSucceeded };
}

function mergeByKindDelta(
  cur: Partial<Record<ParseExportArtifactKind, KindStats>>,
  minus: Partial<Record<ParseExportArtifactKind, KindStats>>,
  plus: Partial<Record<ParseExportArtifactKind, KindStats>>,
): Partial<Record<ParseExportArtifactKind, KindStats>> {
  const keys = new Set([
    ...Object.keys(cur),
    ...Object.keys(minus),
    ...Object.keys(plus),
  ]) as Set<ParseExportArtifactKind>;
  const out: Partial<Record<ParseExportArtifactKind, KindStats>> = { ...cur };
  for (const k of keys) {
    const c = out[k] ?? emptyKindStats();
    const m = minus[k] ?? emptyKindStats();
    const p = plus[k] ?? emptyKindStats();
    out[k] = {
      succeeded: Math.max(0, c.succeeded - m.succeeded + p.succeeded),
      failed: Math.max(0, c.failed - m.failed + p.failed),
      skipped: Math.max(0, c.skipped - m.skipped + p.skipped),
    };
  }
  return out;
}

export async function initParseExportProgress(
  env: Env,
  userId: string,
  exportId: string,
  totalJobs: number,
): Promise<void> {
  const now = new Date().toISOString();
  const initial: ParseExportProgressV1 = {
    version: 1,
    exportId,
    userId,
    totalJobs,
    completedJobs: 0,
    failedCells: 0,
    ttsSucceeded: 0,
    byKind: {},
    status: totalJobs === 0 ? "complete" : "queued",
    updatedAt: now,
    generationStartedAt: now,
    generationCompletedAt: totalJobs === 0 ? now : undefined,
  };
  await writeProgressJson(env, userId, exportId, initial);
  const r = getRedis(env);
  if (r) {
    await r.set(redisProgressKey(exportId), JSON.stringify(initial));
  }
  publishParseExportEvent(env, exportId, { type: "progress", progress: initial });
}

export async function loadParseExportProgress(
  env: Env,
  userId: string,
  exportId: string,
): Promise<ParseExportProgressV1 | null> {
  const r = getRedis(env);
  if (r) {
    const raw = await r.get(redisProgressKey(exportId));
    if (raw) {
      try {
        return JSON.parse(raw) as ParseExportProgressV1;
      } catch {
        /* fall through */
      }
    }
  }
  return readProgressJson(env, userId, exportId);
}

/**
 * Update aggregate progress after an artifact JSON is written.
 * Pass `previous` when overwriting (regeneration) so counters stay correct.
 */
export async function recordParseExportArtifactSaved(
  env: Env,
  userId: string,
  exportId: string,
  artifactRecord: Record<string, unknown>,
  options?: { previous?: Record<string, unknown> | null },
): Promise<ParseExportProgressV1 | null> {
  const prev = options?.previous ?? null;
  const nextS = kindStatsFromArtifact(artifactRecord);
  const prevS = prev ? kindStatsFromArtifact(prev) : { failed: 0, byKind: {}, ttsSucceeded: 0 };

  const apply = (cur: ParseExportProgressV1): ParseExportProgressV1 => {
    const completedJobs = cur.completedJobs + (prev ? 0 : 1);
    const failedCells = cur.failedCells - prevS.failed + nextS.failed;
    const ttsSucceeded = cur.ttsSucceeded - prevS.ttsSucceeded + nextS.ttsSucceeded;
    const byKind = mergeByKindDelta(cur.byKind, prevS.byKind, nextS.byKind);
    const totalJobs = cur.totalJobs;
    const status: ParseExportProgressV1["status"] =
      totalJobs > 0 && completedJobs >= totalJobs ? "complete" : completedJobs > 0 ? "running" : cur.status;
    const updatedAt = new Date().toISOString();
    const finished = totalJobs > 0 && completedJobs >= totalJobs;
    const generationCompletedAt =
      finished && !cur.generationCompletedAt ? updatedAt : cur.generationCompletedAt;
    return {
      ...cur,
      userId: cur.userId || userId,
      completedJobs,
      failedCells,
      ttsSucceeded,
      byKind,
      status: totalJobs === 0 ? "complete" : status,
      updatedAt,
      generationCompletedAt,
    };
  };

  const r = getRedis(env);
  let next: ParseExportProgressV1;
  if (r) {
    next = await mergeProgressRedis(env, userId, exportId, apply);
    await writeProgressJson(env, userId, exportId, next);
  } else {
    next = await runExclusiveFile(exportId, async () => {
      const cur =
        (await readProgressJson(env, userId, exportId)) ??
        ({
          version: 1,
          exportId,
          userId,
          totalJobs: 0,
          completedJobs: 0,
          failedCells: 0,
          ttsSucceeded: 0,
          byKind: {},
          status: "running" as const,
          updatedAt: new Date().toISOString(),
        } satisfies ParseExportProgressV1);
      const merged = apply(cur);
      await writeProgressJson(env, userId, exportId, merged);
      return merged;
    });
  }

  publishParseExportEvent(env, exportId, { type: "progress", progress: next });
  if (next.totalJobs > 0 && next.completedJobs >= next.totalJobs) {
    publishParseExportEvent(env, exportId, { type: "complete", progress: next });
  }
  return next;
}

export async function adjustParseExportTotalJobs(
  env: Env,
  userId: string,
  exportId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return;
  const bump = (cur: ParseExportProgressV1): ParseExportProgressV1 => {
    const totalJobs = Math.max(0, cur.totalJobs + delta);
    const status: ParseExportProgressV1["status"] =
      totalJobs > 0 && cur.completedJobs >= totalJobs ? "complete" : cur.completedJobs > 0 ? "running" : "queued";
    return {
      ...cur,
      totalJobs,
      status: totalJobs === 0 ? "complete" : status,
      updatedAt: new Date().toISOString(),
    };
  };

  const r = getRedis(env);
  if (r) {
    const next = await mergeProgressRedis(env, userId, exportId, bump);
    await writeProgressJson(env, userId, exportId, next);
  } else {
    await runExclusiveFile(exportId, async () => {
      const cur = await readProgressJson(env, userId, exportId);
      if (!cur) return;
      const next = bump(cur);
      await writeProgressJson(env, userId, exportId, next);
    });
  }
  publishParseExportEvent(env, exportId, { type: "totalJobsAdjusted", delta });
}

/** Used before re-enqueueing a job so completion does not double-count `completedJobs`. */
