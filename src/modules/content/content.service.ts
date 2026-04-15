import { and, asc, eq } from "drizzle-orm";
import { HttpError } from "../../common/http-error.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class ContentService {
  private async assertBookOwner(userId: string, bookId: string) {
    const db = getDb();
    const { books } = schema();
    const [b] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
    if (!b || b.userId !== userId) throw HttpError.notFound("Book not found");
    return b;
  }

  async listBooks(userId: string) {
    const db = getDb();
    const { books } = schema();
    return db.select().from(books).where(eq(books.userId, userId)).orderBy(asc(books.title));
  }

  async createBook(userId: string, title: string) {
    const db = getDb();
    const { books } = schema();
    const [row] = await db.insert(books).values({ userId, title }).returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async updateBook(userId: string, bookId: string, title: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { books } = schema();
    const [row] = await db
      .update(books)
      .set({ title })
      .where(eq(books.id, bookId))
      .returning();
    if (!row) throw HttpError.notFound("Book not found");
    return row;
  }

  async deleteBook(userId: string, bookId: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { books } = schema();
    await db.delete(books).where(eq(books.id, bookId));
  }

  async listChapters(userId: string, bookId: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters } = schema();
    return db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, bookId))
      .orderBy(asc(chapters.position));
  }

  async createChapter(userId: string, bookId: string, title: string, position: number) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters } = schema();
    const [row] = await db.insert(chapters).values({ bookId, title, position }).returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async updateChapter(
    userId: string,
    bookId: string,
    chapterId: string,
    patch: { title?: string; position?: number },
  ) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    const [row] = await db
      .update(chapters)
      .set(patch)
      .where(eq(chapters.id, chapterId))
      .returning();
    if (!row) throw HttpError.internal("Update failed");
    return row;
  }

  async deleteChapter(userId: string, bookId: string, chapterId: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters } = schema();
    await db
      .delete(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)));
  }

  async listAtoms(userId: string, bookId: string, chapterId: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    return db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, chapterId))
      .orderBy(asc(atoms.position));
  }

  async createAtom(
    userId: string,
    bookId: string,
    chapterId: string,
    body: string,
    position: number,
  ) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    const [row] = await db.insert(atoms).values({ chapterId, body, position }).returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }

  async updateAtom(
    userId: string,
    bookId: string,
    chapterId: string,
    atomId: string,
    patch: { body?: string; position?: number },
  ) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    const [at] = await db
      .select()
      .from(atoms)
      .where(and(eq(atoms.id, atomId), eq(atoms.chapterId, chapterId)))
      .limit(1);
    if (!at) throw HttpError.notFound("Atom not found");
    const [row] = await db
      .update(atoms)
      .set(patch)
      .where(eq(atoms.id, atomId))
      .returning();
    if (!row) throw HttpError.internal("Update failed");
    return row;
  }

  async deleteAtom(userId: string, bookId: string, chapterId: string, atomId: string) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    await db
      .delete(atoms)
      .where(and(eq(atoms.id, atomId), eq(atoms.chapterId, chapterId)));
  }

  async listContentsForAtom(
    userId: string,
    bookId: string,
    chapterId: string,
    atomId: string,
  ) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms, contents } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    const [at] = await db
      .select()
      .from(atoms)
      .where(and(eq(atoms.id, atomId), eq(atoms.chapterId, chapterId)))
      .limit(1);
    if (!at) throw HttpError.notFound("Atom not found");
    return db.select().from(contents).where(eq(contents.atomId, atomId));
  }

  async createContent(
    userId: string,
    bookId: string,
    chapterId: string,
    atomId: string,
    kind: string,
    body: string,
  ) {
    await this.assertBookOwner(userId, bookId);
    const db = getDb();
    const { chapters, atoms, contents } = schema();
    const [ch] = await db
      .select()
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.bookId, bookId)))
      .limit(1);
    if (!ch) throw HttpError.notFound("Chapter not found");
    const [at] = await db
      .select()
      .from(atoms)
      .where(and(eq(atoms.id, atomId), eq(atoms.chapterId, chapterId)))
      .limit(1);
    if (!at) throw HttpError.notFound("Atom not found");
    const [row] = await db
      .insert(contents)
      .values({ atomId, userId, kind, body })
      .returning();
    if (!row) throw HttpError.internal("Create failed");
    return row;
  }
}
