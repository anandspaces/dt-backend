import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { atomPrimaryTagSchema, type AtomPrimaryTag } from "../../domain/atom-tags.js";

const PRIMARY_SCORE: Record<AtomPrimaryTag, number> = {
  DEFINITION: 6,
  FORMULA: 9,
  PROCESS: 7,
  COMPARISON: 6,
  EXAMPLE: 5,
  FACT_LIST: 6,
  DIAGRAM_REF: 7,
  EXPERIMENT: 7,
  THEOREM_LAW: 9,
  HISTORICAL: 6,
  INTRO_CONTEXT: 3,
  CONCEPT: 7,
};

export class Layer4ScoreService {
  async run(fileId: string): Promise<void> {
    const db = getDb();
    const { files, chapters, atoms, atomClassifications, atomScores } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file?.bookId || file.fileKind === "pyq") return;

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

    for (const atom of atomRows) {
      const [cl] = await db
        .select()
        .from(atomClassifications)
        .where(eq(atomClassifications.atomId, atom.id))
        .limit(1);
      let primary: AtomPrimaryTag = "CONCEPT";
      try {
        if (cl?.tagsJson) {
          const j = JSON.parse(cl.tagsJson) as { primary?: string };
          const parsed = atomPrimaryTagSchema.safeParse(j.primary);
          if (parsed.success) primary = parsed.data;
        }
      } catch {
        primary = "CONCEPT";
      }
      let score = PRIMARY_SCORE[primary];
      if (atom.body.length > 800) score += 0.5;
      if (primary === "INTRO_CONTEXT") score = Math.min(score, 4);
      score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

      const factors = { primary, bodyLength: atom.body.length, layer: "layer4" };
      await db.delete(atomScores).where(eq(atomScores.atomId, atom.id));
      await db.insert(atomScores).values({
        atomId: atom.id,
        score,
        factorsJson: JSON.stringify(factors),
      });
    }
  }
}
