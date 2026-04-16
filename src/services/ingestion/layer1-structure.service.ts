import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { extractPdfTextPages } from "./pdf/pdf-text.js";
import { detectChapterSegments } from "./text/chapter-split.js";

export class Layer1StructureService {
  private readonly storage;

  constructor(env: Env) {
    this.storage = createStorageAdapter(env);
  }

  async run(fileId: string): Promise<{ ok: true; bookId: string; chapterIds: string[] }> {
    const db = getDb();
    const { files, books, chapters } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file) throw new Error("file not found");

    const buffer = await this.storage.readObject(file.storageKey);
    const { pages } = await extractPdfTextPages(buffer);
    const segments = detectChapterSegments(pages);

    let bookId = file.bookId;
    if (!bookId) {
      const title = file.originalName.replace(/\.pdf$/i, "").trim() || "Imported book";
      const [book] = await db.insert(books).values({ userId: file.userId, title }).returning();
      if (!book) throw new Error("book insert failed");
      bookId = book.id;
      await db.update(files).set({ bookId }).where(eq(files.id, fileId));
    }

    await db.delete(chapters).where(eq(chapters.bookId, bookId));

    const createdIds: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!seg) continue;
      const sourceText = seg.pageIndices
        .map((pi) => pages[pi] ?? "")
        .join("\n\n")
        .trim();
      const [ch] = await db
        .insert(chapters)
        .values({
          bookId,
          title: seg.title,
          position: i,
          chapterNumber: seg.chapterNumber,
          pageStart: seg.pageStart,
          pageEnd: seg.pageEnd,
          metadataJson: JSON.stringify({
            pageIndices: seg.pageIndices,
            sourceText,
          }),
        })
        .returning();
      if (ch) createdIds.push(ch.id);
    }

    return { ok: true, bookId, chapterIds: createdIds };
  }
}
