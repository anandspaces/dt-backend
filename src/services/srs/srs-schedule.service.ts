import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { nextIntervalAndEase } from "./srs-sm2.js";

const DEFAULT_QUALITY = 3;

export class SrsScheduleService {
  async run(userId: string, sessionId: string): Promise<void> {
    const db = getDb();
    const { learningSessions, atoms, srsCards } = schema();
    const [session] = await db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== userId) return;

    const atomRows = await db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, session.chapterId))
      .orderBy(asc(atoms.position));

    const now = new Date();
    for (const atom of atomRows) {
      const [existing] = await db
        .select()
        .from(srsCards)
        .where(and(eq(srsCards.userId, userId), eq(srsCards.atomId, atom.id)))
        .limit(1);

      const next = nextIntervalAndEase(
        existing
          ? { easeFactor: existing.easeFactor, intervalDays: existing.intervalDays }
          : null,
        DEFAULT_QUALITY,
      );
      const due = new Date(now.getTime() + next.intervalDays * 86_400_000);

      if (existing) {
        await db
          .update(srsCards)
          .set({
            easeFactor: next.easeFactor,
            intervalDays: next.intervalDays,
            dueAt: due,
            reviewHistoryJson: JSON.stringify({
              last: now.toISOString(),
              quality: DEFAULT_QUALITY,
            }),
          })
          .where(eq(srsCards.id, existing.id));
      } else {
        await db.insert(srsCards).values({
          userId,
          atomId: atom.id,
          easeFactor: next.easeFactor,
          intervalDays: next.intervalDays,
          dueAt: due,
          reviewHistoryJson: JSON.stringify({
            last: now.toISOString(),
            quality: DEFAULT_QUALITY,
          }),
        });
      }
    }
  }
}
