import { asc, eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { getQueue } from "../queue/queue-global.js";

export class SessionService {
  async startSession(
    userId: string,
    bookId: string,
    chapterId: string,
    mode: "auto" | "manual",
  ) {
    const db = getDb();
    const { learningSessions, books, chapters, atoms } = schema();
    const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!book || book.userId !== userId) {
      throw HttpError.notFound("Book not found");
    }
    const [chapter] = await db.select().from(chapters).where(eq(chapters.id, chapterId)).limit(1);
    if (!chapter || chapter.bookId !== bookId) {
      throw HttpError.notFound("Chapter not found");
    }
    const atomRows = await db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, chapterId))
      .orderBy(asc(atoms.position));
    const [session] = await db
      .insert(learningSessions)
      .values({ userId, bookId, chapterId, mode, currentAtomIndex: 0 })
      .returning();
    if (!session) throw HttpError.internal("Session create failed");
    const first = atomRows[0];
    return { session, atoms: atomRows, currentAtom: first ?? null };
  }

  async advanceSession(sessionId: string, userId: string, durationMs?: number) {
    const db = getDb();
    const { learningSessions, atoms, sessionEvents } = schema();
    const [session] = await db
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.id, sessionId))
      .limit(1);
    if (!session || session.userId !== userId) {
      throw HttpError.notFound("Session not found");
    }
    await db.insert(sessionEvents).values({
      sessionId,
      type: "next",
      durationMs: durationMs ?? null,
      payloadJson: JSON.stringify({ fromIndex: session.currentAtomIndex }),
    });
    const atomRows = await db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, session.chapterId))
      .orderBy(asc(atoms.position));
    const nextIndex = session.currentAtomIndex + 1;
    if (nextIndex >= atomRows.length) {
      await db
        .update(learningSessions)
        .set({ completedAt: new Date(), currentAtomIndex: nextIndex })
        .where(eq(learningSessions.id, sessionId));
      getQueue().enqueue(
        "schedule-srs-reviews",
        { userId, sessionId },
        "low",
      );
      return { completed: true as const, atom: null };
    }
    await db
      .update(learningSessions)
      .set({ currentAtomIndex: nextIndex })
      .where(eq(learningSessions.id, sessionId));
    const atom = atomRows[nextIndex];
    return { completed: false as const, atom: atom ?? null };
  }
}
