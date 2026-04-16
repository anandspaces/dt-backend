import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { splitIntoParagraphs } from "./text/paragraph-split.js";

export class Layer2ContentExtractService {
  async run(fileId: string): Promise<{ ok: true; atomCount: number }> {
    const db = getDb();
    const { files, chapters, atoms } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file?.bookId) throw new Error("book not linked for file");

    const chapterRows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, file.bookId))
      .orderBy(asc(chapters.position));

    let total = 0;
    for (const ch of chapterRows) {
      let sourceText = "";
      try {
        if (ch.metadataJson) {
          const meta = JSON.parse(ch.metadataJson) as { sourceText?: string };
          sourceText = meta.sourceText ?? "";
        }
      } catch {
        sourceText = "";
      }
      const paras = splitIntoParagraphs(sourceText);
      for (let i = 0; i < paras.length; i++) {
        const body = paras[i];
        if (!body) continue;
        const sectionLabel = extractSectionLabel(body);
        await db.insert(atoms).values({
          chapterId: ch.id,
          topicId: null,
          body,
          position: i,
          sectionLabel,
        });
        total++;
      }
    }
    return { ok: true, atomCount: total };
  }
}

export function extractSectionLabel(para: string): string | null {
  const m = para.match(/^(\d+(?:\.\d+)*)\s+([^.\n]{1,120})/);
  if (m?.[0]) return m[0].trim().slice(0, 200);
  return null;
}
