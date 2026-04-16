import { eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { extractPdfTextPages } from "../ingestion/pdf/pdf-text.js";
import { detectChapterSegments } from "../ingestion/text/chapter-split.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { isPageTextProbablyScannedSparse, summarizeOcrHints } from "./ocr-hints.js";
import { detectTopicsInChapter } from "./topic-detection.js";
import { pairedAtomBodiesFromTopicBody } from "./paragraph-pairing.js";
import { extractSectionLabel } from "../ingestion/layer2-content-extract.service.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { ClassifyAtomsPipeline } from "../ingestion/classify-atoms-pipeline.service.js";
import { runTtsPipelineForFile } from "../tts/tts-pipeline.service.js";

/**
 * Full pipeline: PDF text → chapters → topics → paired paragraph atoms → classify →
 * deduped games + quizzes → optional Gemini TTS. Uses parallel page analysis for speed.
 */
export class FullPdfIngestOrchestrator {
  constructor(private readonly env: Env) {}

  async run(fileId: string): Promise<void> {
    const db = getDb();
    const { files, books, chapters, topics, atoms } = schema();
    const storage = createStorageAdapter(this.env);

    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file || file.fileKind !== "book") {
      throw new Error("full ingest expects a textbook PDF (fileKind=book)");
    }

    await db
      .update(files)
      .set({ ingestionStatus: "running", lastError: null })
      .where(eq(files.id, fileId));

    try {
      const buffer = await storage.readObject(file.storageKey);
      const { pages, numPages } = await extractPdfTextPages(buffer);

      const pageHints = await mapWithConcurrency(
        pages,
        this.env.INGESTION_PAGE_CONCURRENCY,
        (text, pageIndex) =>
          Promise.resolve({
            pageIndex,
            sparse: isPageTextProbablyScannedSparse(text),
          }),
      );
      const ocrSummary = summarizeOcrHints(pageHints);

      const segments = detectChapterSegments(pages);

      let bookId = file.bookId;
      if (!bookId) {
        const title = file.originalName.replace(/\.pdf$/i, "").trim() || "Imported book";
        const [book] = await db.insert(books).values({ userId: file.userId, title }).returning();
        if (!book) throw new Error("book insert failed");
        bookId = book.id;
        await db.update(files).set({ bookId }).where(eq(files.id, fileId));
      }

      const [bookRow] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
      if (bookRow) {
        let meta: Record<string, unknown> = {};
        try {
          meta = bookRow.metadataJson
            ? (JSON.parse(bookRow.metadataJson) as Record<string, unknown>)
            : {};
        } catch {
          meta = {};
        }
        meta.ingestion = {
          pageCount: numPages,
          ocrHints: ocrSummary,
          pipeline: "full_v1",
        };
        await db
          .update(books)
          .set({ metadataJson: JSON.stringify(meta) })
          .where(eq(books.id, bookId));
      }

      await db.delete(chapters).where(eq(chapters.bookId, bookId));

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
        if (!ch) continue;

        const topicBlocks = detectTopicsInChapter(sourceText);
        let tp = 0;
        for (const tb of topicBlocks) {
          const [topicRow] = await db
            .insert(topics)
            .values({
              chapterId: ch.id,
              title: tb.title,
              position: tp,
              metadataJson: JSON.stringify({}),
            })
            .returning();
          tp += 1;
          if (!topicRow) continue;

          const bodies = pairedAtomBodiesFromTopicBody(tb.body);
          let pos = 0;
          for (const body of bodies) {
            await db.insert(atoms).values({
              chapterId: ch.id,
              topicId: topicRow.id,
              body,
              position: pos,
              sectionLabel: extractSectionLabel(body),
            });
            pos += 1;
          }
        }
      }

      await db
        .update(files)
        .set({ ingestionStatus: "completed", lastError: null })
        .where(eq(files.id, fileId));

      const gemini = new GeminiClient(this.env);
      const classify = new ClassifyAtomsPipeline(this.env, gemini);
      await classify.run(fileId, { dedupeGames: true });

      await runTtsPipelineForFile(this.env, fileId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db
        .update(files)
        .set({ ingestionStatus: "failed", lastError: message })
        .where(eq(files.id, fileId));
      throw e;
    }
  }
}
