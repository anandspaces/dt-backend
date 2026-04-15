import { eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

/** Non-linear exploration: fetch atom by id if user owns the book chain. */
export class ManualLearningModeService {
  async getAtomForUser(userId: string, atomId: string) {
    const db = getDb();
    const { atoms, chapters, books } = schema();
    const [atom] = await db.select().from(atoms).where(eq(atoms.id, atomId)).limit(1);
    if (!atom) throw HttpError.notFound("Atom not found");
    const [chapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, atom.chapterId))
      .limit(1);
    if (!chapter) throw HttpError.notFound("Chapter not found");
    const [book] = await db.select().from(books).where(eq(books.id, chapter.bookId)).limit(1);
    if (!book || book.userId !== userId) {
      throw HttpError.forbidden();
    }
    return { atom, chapter, book };
  }
}
