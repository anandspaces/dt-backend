import { and, eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class ProgressService {
  async list(userId: string) {
    const db = getDb();
    const { progress } = schema();
    return db.select().from(progress).where(eq(progress.userId, userId));
  }

  async create(
    userId: string,
    input: {
      bookId?: string | null;
      chapterId?: string | null;
      status?: string;
      percent?: number;
      lastAtomId?: string | null;
    },
  ) {
    const db = getDb();
    const { progress } = schema();
    const [row] = await db
      .insert(progress)
      .values({
        userId,
        bookId: input.bookId ?? null,
        chapterId: input.chapterId ?? null,
        status: input.status ?? "active",
        percent: input.percent ?? 0,
        lastAtomId: input.lastAtomId ?? null,
      })
      .returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async update(
    userId: string,
    progressId: string,
    patch: { status?: string; percent?: number; lastAtomId?: string | null },
  ) {
    const db = getDb();
    const { progress } = schema();
    const [existing] = await db
      .select()
      .from(progress)
      .where(and(eq(progress.id, progressId), eq(progress.userId, userId)))
      .limit(1);
    if (!existing) throw HttpError.notFound("Progress not found");
    const [row] = await db
      .update(progress)
      .set(patch)
      .where(eq(progress.id, progressId))
      .returning();
    if (!row) throw HttpError.internal("Update failed");
    return row;
  }
}
