import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import {
  averageQuizScore,
  compositePreparedness,
  coveragePercent,
  weakAtomCountFromAggs,
  type AtomScoreAgg,
} from "./preparedness-aggregate.js";

const PASS_THRESHOLD = 70;

export class PreparednessService {
  async recalculate(userId: string, chapterId: string): Promise<void> {
    const db = getDb();
    const { atoms, chapters, interactionEvents } = schema();
    const [ch] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!ch) return;

    const atomList = await db.select().from(atoms).where(eq(atoms.chapterId, chapterId));
    const atomIds = atomList.map((a) => a.id);
    if (atomIds.length === 0) {
      await upsertPreparedness(userId, chapterId, {
        quizScore: 0,
        retentionScore: 0,
        coveragePercent: 0,
        weakAtomCount: 0,
        compositeScore: 0,
      });
      return;
    }

    const events = await db
      .select()
      .from(interactionEvents)
      .where(
        and(
          eq(interactionEvents.userId, userId),
          inArray(interactionEvents.atomId, atomIds),
          eq(interactionEvents.eventType, "activity_score"),
        ),
      );

    const byAtom = new Map<string, { sum: number; n: number }>();
    for (const ev of events) {
      if (!ev.atomId || !ev.payloadJson) continue;
      let score: number | undefined;
      try {
        const p = JSON.parse(ev.payloadJson) as { score?: unknown };
        if (typeof p.score === "number") score = p.score;
      } catch {
        continue;
      }
      if (score === undefined) continue;
      const cur = byAtom.get(ev.atomId) ?? { sum: 0, n: 0 };
      cur.sum += score;
      cur.n += 1;
      byAtom.set(ev.atomId, cur);
    }

    const aggs: AtomScoreAgg[] = atomIds.map((id) => {
      const v = byAtom.get(id);
      if (!v || v.n === 0) return { atomId: id, avgScore: 0, count: 0 };
      return { atomId: id, avgScore: v.sum / v.n, count: v.n };
    });

    const quizScore = averageQuizScore(aggs);
    const atomsWithPass = aggs.filter((a) => a.count > 0 && a.avgScore >= PASS_THRESHOLD).length;
    const cov = coveragePercent(atomIds.length, atomsWithPass);
    const weak = weakAtomCountFromAggs(aggs);
    const retentionScore = Math.min(100, quizScore > 0 ? quizScore * 1.05 : 0);

    const composite = compositePreparedness({
      quizScore,
      retentionScore,
      coveragePercent: cov,
      weakAtomCount: weak,
    });

    await upsertPreparedness(userId, chapterId, {
      quizScore,
      retentionScore,
      coveragePercent: cov,
      weakAtomCount: weak,
      compositeScore: composite,
    });
  }
}

async function upsertPreparedness(
  userId: string,
  chapterId: string,
  values: {
    quizScore: number;
    retentionScore: number;
    coveragePercent: number;
    weakAtomCount: number;
    compositeScore: number;
  },
): Promise<void> {
  const db = getDb();
  const { preparednessScores: ps } = schema();
  const existing = await db
    .select()
    .from(ps)
    .where(and(eq(ps.userId, userId), eq(ps.chapterId, chapterId)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(ps)
      .set({
        quizScore: values.quizScore,
        retentionScore: values.retentionScore,
        coveragePercent: values.coveragePercent,
        weakAtomCount: values.weakAtomCount,
        compositeScore: values.compositeScore,
      })
      .where(eq(ps.id, existing[0].id));
  } else {
    await db.insert(ps).values({
      userId,
      chapterId,
      quizScore: values.quizScore,
      retentionScore: values.retentionScore,
      coveragePercent: values.coveragePercent,
      weakAtomCount: values.weakAtomCount,
      compositeScore: values.compositeScore,
    });
  }
}
