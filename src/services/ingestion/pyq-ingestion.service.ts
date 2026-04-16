import { asc, eq } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { extractPdfTextPages } from "./pdf/pdf-text.js";

/**
 * Extract numbered questions from a PYQ PDF and link each to the best-matching
 * atom in the target book (token overlap).
 */
export class PyqIngestionService {
  private readonly storage;

  constructor(env: Env) {
    this.storage = createStorageAdapter(env);
  }

  async run(fileId: string): Promise<{ ok: true; questionCount: number }> {
    const db = getDb();
    const { files, pyqQuestions } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file?.bookId) throw new Error("PYQ file must have bookId set to the textbook");
    const buffer = await this.storage.readObject(file.storageKey);
    const { pages } = await extractPdfTextPages(buffer);
    const fullText = pages.join("\n\n");

    await db.delete(pyqQuestions).where(eq(pyqQuestions.fileId, fileId));

    const blocks = splitQuestionBlocks(fullText);
    const bookAtoms = await loadBookAtoms(file.bookId);
    let inserted = 0;
    for (const q of blocks.slice(0, 200)) {
      const { atomId, score } = bestAtomMatch(q, bookAtoms);
      await db.insert(pyqQuestions).values({
        fileId,
        atomId,
        questionText: q.slice(0, 8000),
        matchScore: score,
        metadataJson: JSON.stringify({}),
      });
      inserted++;
    }
    return { ok: true, questionCount: inserted };
  }
}

async function loadBookAtoms(bookId: string): Promise<{ id: string; body: string }[]> {
  const db = getDb();
  const { chapters, atoms } = schema();
  const chRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.position));
  const out: { id: string; body: string }[] = [];
  for (const ch of chRows) {
    const rows = await db
      .select()
      .from(atoms)
      .where(eq(atoms.chapterId, ch.id))
      .orderBy(asc(atoms.position));
    for (const a of rows) out.push({ id: a.id, body: a.body });
  }
  return out;
}

export function splitQuestionBlocks(text: string): string[] {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return [];
  const parts = t.split(/\n(?=\s*(?:Q\.?\s*)?\d+(?:\.|\))\s*\S)/i);
  const cleaned = parts.map((p) => p.trim()).filter((p) => p.length > 15);
  if (cleaned.length >= 2) return cleaned;
  return t.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 15);
}

export function tokenize(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function bestAtomMatch(
  question: string,
  atoms: { id: string; body: string }[],
): { atomId: string | null; score: number } {
  const qTokens = tokenize(question);
  let best: { atomId: string | null; score: number } = { atomId: null, score: 0 };
  for (const a of atoms) {
    const s = jaccard(qTokens, tokenize(a.body));
    if (s > best.score) best = { atomId: a.id, score: s };
  }
  if (best.score < 0.04) return { atomId: null, score: best.score };
  return best;
}
