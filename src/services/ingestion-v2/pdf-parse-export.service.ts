import type { AtomPrimaryTag } from "../../domain/atom-tags.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import {
  classificationPromptForAtom,
  gameHtmlPromptForAtom,
  gamePromptForAtom,
  quizPromptForAtom,
  simulationPromptForAtom,
  videoLessonPromptForAtom,
} from "../ai/templates/prompt-registry.js";
import { extractPdfTextPages } from "../ingestion/pdf/pdf-text.js";
import { detectChapterSegments } from "../ingestion/text/chapter-split.js";
import { extractSectionLabel } from "../ingestion/layer2-content-extract.service.js";
import { classifyAtomBody } from "../ingestion/layer3-classify.service.js";
import { scoreFromPrimaryAndLength } from "../ingestion/layer4-score.service.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { isPageTextProbablyScannedSparse, summarizeOcrHints } from "./ocr-hints.js";
import { detectTopicsInChapter } from "./topic-detection.js";
import { pairedAtomBodiesFromTopicBody } from "./paragraph-pairing.js";
import { GeminiTtsService } from "../tts/gemini-tts.service.js";
import { createStorageAdapter } from "../storage/storage-factory.js";

export type ParseExportOptions = {
  /** Max concurrent Gemini classification calls. */
  classifyConcurrency: number;
  /** Max concurrent TTS syntheses. */
  ttsConcurrency: number;
  /** Cap how many atoms get TTS audio (highest importance first). */
  ttsMaxAtoms: number;
};

export type AtomParseExport = {
  id: string;
  position: number;
  body: string;
  sectionLabel: string | null;
  classification: { primary: AtomPrimaryTag; tags: string[] };
  importanceScore: number;
  recommended: {
    quiz: boolean;
    gameHtml: boolean;
    simulation: boolean;
    video: boolean;
    notes: string;
  };
  prompts: {
    classification: string;
    quiz: string;
    gameHtml: string;
    gameIdea: string;
    simulation: string;
    video: string;
  };
  tts: {
    audioUrl: string | null;
    mime: string | null;
    skipped: boolean;
    skipReason?: string;
  };
};

export type TopicParseExport = {
  title: string;
  position: number;
  atoms: AtomParseExport[];
};

export type ChapterParseExport = {
  title: string;
  position: number;
  chapterNumber: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  topics: TopicParseExport[];
};

export type PdfParseExportResult = {
  exportId: string;
  meta: {
    originalName: string;
    pageCount: number;
    ocrHints: { sparsePageIndices: number[]; sparseRatio: number };
    pipeline: "parse_export_v1";
  };
  chapters: ChapterParseExport[];
};

type FlatWork = {
  ch: number;
  tp: number;
  at: number;
  id: string;
  body: string;
  sectionLabel: string | null;
};

function recommendKinds(primary: AtomPrimaryTag, score: number): AtomParseExport["recommended"] {
  const intro = primary === "INTRO_CONTEXT";
  const low = score < 4;

  const simulation =
    !intro &&
    score >= 5 &&
    (primary === "FORMULA" ||
      primary === "PROCESS" ||
      primary === "EXPERIMENT" ||
      primary === "THEOREM_LAW");

  const video =
    !low &&
    !intro &&
    (primary === "PROCESS" ||
      primary === "COMPARISON" ||
      primary === "EXPERIMENT" ||
      primary === "DIAGRAM_REF" ||
      primary === "HISTORICAL" ||
      primary === "CONCEPT" ||
      primary === "DEFINITION");

  const gameHtml =
    !intro && score >= 4 && !(primary === "FACT_LIST" && score < 5);

  const quiz = score >= 3 && !intro;

  const notes = intro
    ? "Intro/context paragraph: prioritize a short orientation clip or skip heavy interactives."
    : "";

  return { quiz, gameHtml, simulation, video, notes };
}

function buildAtomExport(
  flat: FlatWork,
  classification: { primary: AtomPrimaryTag; tags: string[] },
  importanceScore: number,
  difficultyHint: string,
  ttsByAtomId: Map<string, { key: string; mime: string }>,
  ttsServiceConfigured: boolean,
  ttsRequested: boolean,
): AtomParseExport {
  const primary = classification.primary;
  const rec = recommendKinds(primary, importanceScore);
  const importanceHint =
    importanceScore >= 7 ? "high" : importanceScore >= 4 ? "medium" : "low";

  const ttsMeta = ttsByAtomId.get(flat.id);
  let audioUrl: string | null = null;
  let mime: string | null = null;
  if (ttsMeta) {
    const q = new URLSearchParams({ key: ttsMeta.key, mime: ttsMeta.mime });
    audioUrl = `/api/v1/files/audio?${q.toString()}`;
    mime = ttsMeta.mime;
  }

  let tts: AtomParseExport["tts"];
  if (ttsMeta) {
    tts = { audioUrl, mime, skipped: false };
  } else if (!ttsServiceConfigured) {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "gemini_tts_not_configured",
    };
  } else if (!ttsRequested) {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "tts_disabled_by_request",
    };
  } else {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "not_in_top_tts_budget",
    };
  }

  return {
    id: flat.id,
    position: flat.at,
    body: flat.body,
    sectionLabel: flat.sectionLabel,
    classification: { primary, tags: classification.tags },
    importanceScore,
    recommended: rec,
    prompts: {
      classification: classificationPromptForAtom(flat.body),
      quiz: quizPromptForAtom(flat.body),
      gameHtml: gameHtmlPromptForAtom(flat.body, importanceHint),
      gameIdea: gamePromptForAtom(flat.body, difficultyHint),
      simulation: simulationPromptForAtom(flat.body, primary),
      video: videoLessonPromptForAtom(flat.body, primary),
    },
    tts,
  };
}

/**
 * Parse PDF in memory: chapters → topics → paired paragraph atoms, parallel Gemini classification,
 * generation prompts, optional parallel Gemini TTS with retrievable URLs (see GET /api/v1/files/audio).
 */
export async function runPdfParseExport(
  env: Env,
  buffer: Buffer,
  userId: string,
  originalName: string,
  options: ParseExportOptions,
): Promise<PdfParseExportResult> {
  const exportId = crypto.randomUUID();
  const { pages: rawPages, numPages } = await extractPdfTextPages(buffer);
  const pages = rawPages.length > 0 ? rawPages : [""];

  const pageHints = await mapWithConcurrency(
    pages,
    Math.min(env.INGESTION_PAGE_CONCURRENCY, Math.max(1, pages.length)),
    (text, pageIndex) =>
      Promise.resolve({
        pageIndex,
        sparse: isPageTextProbablyScannedSparse(text),
      }),
  );
  const ocrSummary = summarizeOcrHints(pageHints);

  const segments = detectChapterSegments(pages);
  const gemini = new GeminiClient(env);

  const chapterStructs = await mapWithConcurrency(
    segments,
    Math.min(8, Math.max(1, segments.length)),
    (seg, i) => {
      const sourceText = seg.pageIndices
        .map((pi) => pages[pi] ?? "")
        .join("\n\n")
        .trim();

      const topicBlocks = detectTopicsInChapter(sourceText);
      const topics: { title: string; position: number; atoms: FlatWork[] }[] = [];

      let tp = 0;
      for (const tb of topicBlocks) {
        const bodies = pairedAtomBodiesFromTopicBody(tb.body);
        const atoms: FlatWork[] = [];
        let pos = 0;
        for (const body of bodies) {
          atoms.push({
            ch: i,
            tp,
            at: pos,
            id: crypto.randomUUID(),
            body,
            sectionLabel: extractSectionLabel(body),
          });
          pos += 1;
        }
        topics.push({ title: tb.title, position: tp, atoms });
        tp += 1;
      }

      return Promise.resolve({
        position: i,
        title: seg.title,
        chapterNumber: seg.chapterNumber,
        pageStart: seg.pageStart,
        pageEnd: seg.pageEnd,
        topics,
      });
    },
  );

  const flatAtoms: FlatWork[] = [];
  for (const ch of chapterStructs) {
    for (const tp of ch.topics) {
      for (const a of tp.atoms) flatAtoms.push(a);
    }
  }

  const classifications = await mapWithConcurrency(
    flatAtoms,
    Math.max(1, options.classifyConcurrency),
    async (a) => {
      const c = await classifyAtomBody(gemini, a.body);
      return { id: a.id, classification: c };
    },
  );
  const classById = new Map(classifications.map((x) => [x.id, x.classification]));

  const scored = flatAtoms.map((a) => {
    const c = classById.get(a.id);
    const primary = c?.primary ?? ("CONCEPT" as AtomPrimaryTag);
    const score = scoreFromPrimaryAndLength(primary, a.body.length);
    return { ...a, primary, score };
  });

  const ttsByAtomId = new Map<string, { key: string; mime: string }>();
  const tts = new GeminiTtsService(env);
  const ttsServiceConfigured = tts.isConfigured();
  const ttsRequested = options.ttsMaxAtoms > 0;
  if (ttsServiceConfigured && ttsRequested) {
    const sorted = [...scored].sort((x, y) => y.score - x.score);
    const pick = sorted.slice(0, options.ttsMaxAtoms);
    const storage = createStorageAdapter(env);

    await mapWithConcurrency(pick, Math.max(1, options.ttsConcurrency), async (row) => {
      const { buffer: audioBuf, mime, fileExt } = await tts.synthesize(row.body);
      const key = `parse-export/${userId}/${exportId}/${row.id}.${fileExt}`;
      await storage.saveObject(key, audioBuf, mime);
      ttsByAtomId.set(row.id, { key, mime });
    });
  }

  const chapters: ChapterParseExport[] = chapterStructs.map((ch, chi) => {
    const topics: TopicParseExport[] = ch.topics.map((tp) => {
      const atoms: AtomParseExport[] = tp.atoms.map((flat) => {
        const c = classById.get(flat.id);
        const primary = c?.primary ?? ("CONCEPT" as AtomPrimaryTag);
        const tags = c?.tags ?? [primary];
        const importanceScore = scoreFromPrimaryAndLength(primary, flat.body.length);
        const difficultyHint = importanceScore >= 7 ? "hard" : importanceScore >= 4 ? "medium" : "easy";
        return buildAtomExport(
          flat,
          { primary, tags },
          importanceScore,
          difficultyHint,
          ttsByAtomId,
          ttsServiceConfigured,
          ttsRequested,
        );
      });
      return { title: tp.title, position: tp.position, atoms };
    });

    return {
      title: ch.title,
      position: chi,
      chapterNumber: ch.chapterNumber,
      pageStart: ch.pageStart,
      pageEnd: ch.pageEnd,
      topics,
    };
  });

  return {
    exportId,
    meta: {
      originalName,
      pageCount: numPages,
      ocrHints: ocrSummary,
      pipeline: "parse_export_v1",
    },
    chapters,
  };
}
