import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { getQueue } from "../queue/queue-global.js";
import { pickAtomsForGamesDeduped } from "../ingestion-v2/game-dedup.js";
import { Layer3ClassifyService } from "./layer3-classify.service.js";
import { Layer4ScoreService } from "./layer4-score.service.js";
import { Layer5CurriculumMapService } from "./layer5-curriculum-map.service.js";
import { Layer6PyqService } from "./layer6-pyq.service.js";

export type ClassifyPipelineOptions = {
  /** When false, only runs L3–L5 (no quiz/game jobs). Default true. */
  enqueueContent?: boolean;
  /** When true, similar consecutive atoms in the same topic skip redundant HTML games. */
  dedupeGames?: boolean;
};

export class ClassifyAtomsPipeline {
  private readonly l3: Layer3ClassifyService;
  private readonly l4 = new Layer4ScoreService();
  private readonly l5 = new Layer5CurriculumMapService();
  private readonly l6 = new Layer6PyqService();

  constructor(
    _env: Env,
    gemini: GeminiClient,
  ) {
    void _env;
    this.l3 = new Layer3ClassifyService(gemini);
  }

  async run(fileId: string, options?: ClassifyPipelineOptions): Promise<void> {
    const db = getDb();
    const { files } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file || file.fileKind === "pyq") return;
    if (file.ingestionStatus !== "completed") return;

    await this.l3.run(fileId);
    await this.l4.run(fileId);
    await this.l5.run(fileId);
    await this.l6.run(fileId);

    const enqueueContent = options?.enqueueContent !== false;
    if (enqueueContent) {
      await enqueueGenerationJobs(fileId, { dedupeGames: options?.dedupeGames === true });
    }
  }
}

export async function enqueueGenerationJobs(
  fileId: string,
  opts?: { dedupeGames?: boolean },
): Promise<void> {
  const db = getDb();
  const { files, chapters, atoms, atomScores } = schema();
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
    .where(inArray(atoms.chapterId, chapterIds))
    .orderBy(asc(atoms.chapterId), asc(atoms.position));

  const priority: string[] = [];
  const backgroundCandidates: typeof atomRows = [];

  for (const atom of atomRows) {
    const [sc] = await db.select().from(atomScores).where(eq(atomScores.atomId, atom.id)).limit(1);
    const importance = sc?.score ?? 5;
    if (importance < 3) continue;
    if (importance >= 7) priority.push(atom.id);
    else if (importance >= 4) backgroundCandidates.push(atom);
  }

  const dedupe = opts?.dedupeGames === true;
  let backgroundIds: string[];
  if (dedupe) {
    backgroundIds = pickAtomsForGamesDeduped(
      backgroundCandidates.map((a) => ({
        id: a.id,
        body: a.body,
        topicId: a.topicId,
        position: a.position,
        chapterId: a.chapterId,
      })),
    ).slice(0, 80);
  } else {
    backgroundIds = backgroundCandidates.map((a) => a.id).slice(0, 40);
  }

  const q = getQueue();
  if (priority.length) {
    q.enqueue("generate-priority-content", { atomIds: priority.slice(0, 40) }, "high");
  }
  if (backgroundIds.length) {
    q.enqueue("generate-background-content", { atomIds: backgroundIds }, "low");
  }
}
