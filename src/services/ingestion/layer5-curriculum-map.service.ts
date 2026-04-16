import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";

export class Layer5CurriculumMapService {
  async run(fileId: string): Promise<void> {
    const db = getDb();
    const { files, books, chapters, atoms, topics } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file?.bookId || file.fileKind === "pyq") return;

    const [book] = await db.select().from(books).where(eq(books.id, file.bookId)).limit(1);
    if (!book) return;

    const chRows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, file.bookId))
      .orderBy(asc(chapters.position));
    const chapterIds = chRows.map((c) => c.id);

    const curriculumChapters: {
      chapterId: string;
      title: string;
      topics?: { topicId: string; title: string; atomIds: string[] }[];
      sections?: { sectionLabel: string | null; atomIds: string[] }[];
    }[] = [];

    for (const ch of chRows) {
      const topicRows = await db
        .select()
        .from(topics)
        .where(eq(topics.chapterId, ch.id))
        .orderBy(asc(topics.position));

      if (topicRows.length > 0) {
        const topicBlocks: { topicId: string; title: string; atomIds: string[] }[] = [];
        for (const top of topicRows) {
          const atomRows = await db
            .select()
            .from(atoms)
            .where(eq(atoms.topicId, top.id))
            .orderBy(asc(atoms.position));
          topicBlocks.push({
            topicId: top.id,
            title: top.title,
            atomIds: atomRows.map((a) => a.id),
          });
        }
        curriculumChapters.push({
          chapterId: ch.id,
          title: ch.title,
          topics: topicBlocks,
        });
      } else {
        const atomRows = await db
          .select()
          .from(atoms)
          .where(eq(atoms.chapterId, ch.id))
          .orderBy(asc(atoms.position));
        const sectionMap = new Map<string | null, string[]>();
        for (const a of atomRows) {
          const key = a.sectionLabel ?? null;
          const list = sectionMap.get(key) ?? [];
          list.push(a.id);
          sectionMap.set(key, list);
        }
        const sections = [...sectionMap.entries()].map(([sectionLabel, atomIds]) => ({
          sectionLabel,
          atomIds,
        }));
        curriculumChapters.push({
          chapterId: ch.id,
          title: ch.title,
          sections,
        });
      }
    }

    let meta: Record<string, unknown> = {};
    try {
      meta = book.metadataJson ? (JSON.parse(book.metadataJson) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }
    meta.curriculumMap = { chapters: curriculumChapters, chapterOrder: chapterIds };
    await db
      .update(books)
      .set({ metadataJson: JSON.stringify(meta) })
      .where(eq(books.id, file.bookId));
  }
}
