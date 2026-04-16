import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { GeminiTtsService } from "./gemini-tts.service.js";

/**
 * Generate TTS for the highest-scored atoms (cap TTS_MAX_ATOMS) in parallel.
 */
export async function runTtsPipelineForFile(env: Env, fileId: string): Promise<void> {
  const tts = new GeminiTtsService(env);
  if (!tts.isConfigured()) return;

  const db = getDb();
  const { files, chapters, atoms, atomScores, atomAudio } = schema();
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file?.bookId) return;

  const chRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookId, file.bookId))
    .orderBy(asc(chapters.position));
  const chapterIds = chRows.map((c) => c.id);
  if (chapterIds.length === 0) return;

  const atomRows = await db
    .select()
    .from(atoms)
    .where(inArray(atoms.chapterId, chapterIds));

  const scored: { atomId: string; body: string; score: number }[] = [];
  for (const a of atomRows) {
    const [sc] = await db.select().from(atomScores).where(eq(atomScores.atomId, a.id)).limit(1);
    scored.push({ atomId: a.id, body: a.body, score: sc?.score ?? 0 });
  }
  scored.sort((x, y) => y.score - x.score);
  const top = scored.slice(0, env.TTS_MAX_ATOMS);

  const storage = createStorageAdapter(env);
  const conc = env.INGESTION_TTS_CONCURRENCY;

  await mapWithConcurrency(top, conc, async (row) => {
    const { buffer, mime, fileExt } = await tts.synthesize(row.body);
    const key = `tts/${file.userId}/${row.atomId}.${fileExt}`;
    await storage.saveObject(key, buffer, mime);

    await db.delete(atomAudio).where(eq(atomAudio.atomId, row.atomId));
    await db.insert(atomAudio).values({
      atomId: row.atomId,
      storageKey: key,
      mime,
      provider: "gemini_tts",
      charCount: row.body.length,
    });
  });
}
