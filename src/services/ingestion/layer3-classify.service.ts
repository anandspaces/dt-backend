import { asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import {
  atomClassificationOutputSchema,
  type AtomClassificationOutput,
  normalizePrimaryTag,
} from "../../domain/atom-tags.js";
import { GeminiClient } from "../ai/gemini.client.js";
import { extractJsonFromModelText } from "../ai/json-extract.js";
import {
  classificationPromptForAtom,
  classificationPromptForAtomBatch,
} from "../ai/templates/prompt-registry.js";

export class Layer3ClassifyService {
  constructor(private readonly gemini: GeminiClient) {}

  async run(fileId: string): Promise<void> {
    const db = getDb();
    const { files, chapters, atoms, atomClassifications } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file?.bookId || file.fileKind === "pyq") return;

    const chRows = await db
      .select()
      .from(chapters)
      .where(eq(chapters.bookId, file.bookId))
      .orderBy(asc(chapters.position));
    const chapterIds = chRows.map((c) => c.id);
    if (chapterIds.length === 0) return;

    const atomRows = await db
      .select()
      .from(atoms)
      .where(inArray(atoms.chapterId, chapterIds))
      .orderBy(asc(atoms.chapterId), asc(atoms.position));

    for (const atom of atomRows) {
      const out = await classifyAtomBody(this.gemini, atom.body);

      await db.delete(atomClassifications).where(eq(atomClassifications.atomId, atom.id));
      await db.insert(atomClassifications).values({
        atomId: atom.id,
        tagsJson: JSON.stringify({ primary: out.primary, tags: out.tags }),
        metadataJson: null,
      });
      await db
        .update(atoms)
        .set({ contentType: out.primary })
        .where(eq(atoms.id, atom.id));
    }
  }
}

/** Classify a single paragraph (Gemini when configured, else heuristics). */
export async function classifyAtomBody(
  gemini: GeminiClient | null,
  body: string,
): Promise<AtomClassificationOutput> {
  if (gemini?.isConfigured()) {
    return classifyWithGemini(gemini, body);
  }
  return heuristicClassify(body);
}

function shapeClassificationOutput(
  body: string,
  rawPrimary: unknown,
  rawTags: unknown,
): AtomClassificationOutput {
  const primaryStr = typeof rawPrimary === "string" ? rawPrimary : "CONCEPT";
  const primary = normalizePrimaryTag(primaryStr);
  const tags = Array.isArray(rawTags)
    ? rawTags.map((t) => normalizePrimaryTag(String(t)))
    : [];
  const uniq = [...new Set([primary, ...tags])];
  const merged = { primary, tags: uniq.slice(0, 6) };
  const safe = atomClassificationOutputSchema.safeParse(merged);
  return safe.success ? safe.data : heuristicClassify(body);
}

/**
 * Classify many atoms in one Gemini request (when configured).
 * Missing or invalid rows fall back to heuristics per atom.
 */
export async function classifyAtomBodiesBatch(
  gemini: GeminiClient | null,
  items: { id: string; body: string }[],
): Promise<Map<string, AtomClassificationOutput>> {
  const out = new Map<string, AtomClassificationOutput>();
  const bodyById = new Map(items.map((i) => [i.id, i.body]));

  const fillHeuristics = () => {
    for (const { id, body } of items) {
      if (!out.has(id)) out.set(id, heuristicClassify(body));
    }
  };

  if (items.length === 0) return out;
  if (!gemini?.isConfigured()) {
    fillHeuristics();
    return out;
  }

  try {
    const raw = await gemini.generateText(classificationPromptForAtomBatch(items));
    const json = extractJsonFromModelText(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      fillHeuristics();
      return out;
    }

    const rows = Array.isArray(parsed) ? parsed : [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as { id?: unknown; primary?: unknown; tags?: unknown };
      const idFromRow = typeof row.id === "string" ? row.id : items[i]?.id;
      const body = idFromRow ? (bodyById.get(idFromRow) ?? "") : "";
      if (!idFromRow || !bodyById.has(idFromRow)) continue;
      out.set(idFromRow, shapeClassificationOutput(body, row.primary, row.tags));
    }
  } catch {
    // Rate limits / errors: degrade per atom
  }
  fillHeuristics();
  return out;
}

async function classifyWithGemini(
  gemini: GeminiClient,
  body: string,
): Promise<AtomClassificationOutput> {
  const raw = await gemini.generateText(classificationPromptForAtom(body));
  const json = extractJsonFromModelText(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return heuristicClassify(body);
  }
  const p = parsed as { primary?: unknown; tags?: unknown };
  return shapeClassificationOutput(body, p.primary, p.tags);
}

export function heuristicClassify(body: string): AtomClassificationOutput {
  const t = body.trim();
  if (/^(Example|Ex\.|Worked example)/im.test(t)) {
    return { primary: "EXAMPLE", tags: ["EXAMPLE", "CONCEPT"] };
  }
  if (/experiment|procedure|apparatus|observation/i.test(t)) {
    return { primary: "EXPERIMENT", tags: ["EXPERIMENT", "PROCESS"] };
  }
  if (/theorem|law of |principle of /i.test(t)) {
    return { primary: "THEOREM_LAW", tags: ["THEOREM_LAW", "CONCEPT"] };
  }
  if (/compared to|versus|unlike|similarly|on the other hand/i.test(t)) {
    return { primary: "COMPARISON", tags: ["COMPARISON", "CONCEPT"] };
  }
  if (/step\s*\d|first[, ]|then[, ]|finally/i.test(t) && t.length > 120) {
    return { primary: "PROCESS", tags: ["PROCESS", "CONCEPT"] };
  }
  if (/fig\.|figure\s+\d|diagram|shown in/i.test(t)) {
    return { primary: "DIAGRAM_REF", tags: ["DIAGRAM_REF", "CONCEPT"] };
  }
  if (/\b(in \d{4}|century|revolt|dynasty|king|queen|battle)\b/i.test(t)) {
    return { primary: "HISTORICAL", tags: ["HISTORICAL", "FACT_LIST"] };
  }
  if (/^(In this chapter|Introduction|Overview)/i.test(t) || t.length < 80) {
    return { primary: "INTRO_CONTEXT", tags: ["INTRO_CONTEXT"] };
  }
  if (/^(\d+\.)+\s/.test(t) && /following|listed|characteristics/i.test(t)) {
    return { primary: "FACT_LIST", tags: ["FACT_LIST", "CONCEPT"] };
  }
  if (/=\s*\S|∫|∑|π|\bformula\b|\bequation\b/i.test(t)) {
    return { primary: "FORMULA", tags: ["FORMULA", "CONCEPT"] };
  }
  if (/\b(is defined as|is called|means)\b/i.test(t) && t.length < 500) {
    return { primary: "DEFINITION", tags: ["DEFINITION", "CONCEPT"] };
  }
  return { primary: "CONCEPT", tags: ["CONCEPT"] };
}
