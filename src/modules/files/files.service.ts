import type { Env } from "../../config/env.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { createStorageAdapter } from "../../services/storage/storage-factory.js";
import { getQueue } from "../../services/queue/queue-global.js";

export class FilesService {
  private readonly storage: ReturnType<typeof createStorageAdapter>;

  constructor(env: Env) {
    this.storage = createStorageAdapter(env);
  }

  async savePdfUpload(
    userId: string,
    buffer: Buffer,
    originalName: string,
    mime: string,
    options?: { bookId?: string; fileKind?: "book" | "pyq" },
  ) {
    const relKey = `pdfs/${userId}/${crypto.randomUUID()}.pdf`;
    await this.storage.saveObject(relKey, buffer, mime);
    const db = getDb();
    const { files } = schema();
    const fileKind = options?.fileKind === "pyq" ? "pyq" : "book";
    const [row] = await db
      .insert(files)
      .values({
        userId,
        storageKey: relKey,
        mime,
        size: buffer.length,
        originalName,
        bookId: options?.bookId ?? null,
        fileKind,
        ingestionStatus: "pending",
      })
      .returning();
    if (!row) throw new Error("file insert failed");
    getQueue().enqueue("extract-pdf", { fileId: row.id }, "high");
    return row;
  }

  /**
   * Full modular pipeline: chapters → topics → paired paragraph atoms → classify →
   * deduped games/quizzes → optional Gemini TTS. Best for large textbooks (parallel page + TTS workers).
   */
  async saveFullPdfUpload(
    userId: string,
    buffer: Buffer,
    originalName: string,
    mime: string,
    options?: { bookId?: string },
  ) {
    const relKey = `pdfs/${userId}/${crypto.randomUUID()}.pdf`;
    await this.storage.saveObject(relKey, buffer, mime);
    const db = getDb();
    const { files } = schema();
    const [row] = await db
      .insert(files)
      .values({
        userId,
        storageKey: relKey,
        mime,
        size: buffer.length,
        originalName,
        bookId: options?.bookId ?? null,
        fileKind: "book",
        ingestionStatus: "pending",
      })
      .returning();
    if (!row) throw new Error("file insert failed");
    getQueue().enqueue("full-pdf-ingest", { fileId: row.id }, "high");
    return row;
  }
}
