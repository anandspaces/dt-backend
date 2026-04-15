import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class PreparednessService {
  async recalculate(userId: string, chapterId: string): Promise<void> {
    const db = getDb();
    const { preparednessScores, atoms, chapters } = schema();
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!ch) return;
    const atomList = await db.select().from(atoms).where(eq(atoms.chapterId, chapterId));
    const coverage =
      atomList.length === 0 ? 0 : Math.min(100, (atomList.length / Math.max(atomList.length, 1)) * 100);
    const quizScore = 0;
    const retentionScore = 0;
    const weakAtomCount = 0;
    const composite =
      quizScore * 0.35 + retentionScore * 0.35 + coverage * 0.2 - weakAtomCount * 0.1;
    const existing = await db
      .select()
      .from(preparednessScores)
      .where(
        and(
          eq(preparednessScores.userId, userId),
          eq(preparednessScores.chapterId, chapterId),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await db
        .update(preparednessScores)
        .set({
          quizScore,
          retentionScore,
          coveragePercent: coverage,
          weakAtomCount,
          compositeScore: Math.max(0, composite),
        })
        .where(eq(preparednessScores.id, existing[0].id));
    } else {
      await db.insert(preparednessScores).values({
        userId,
        chapterId,
        quizScore,
        retentionScore,
        coveragePercent: coverage,
        weakAtomCount,
        compositeScore: Math.max(0, composite),
      });
    }
  }
}
