import type { AtomClassificationOutput, AtomPrimaryTag } from "../../domain/atom-tags.js";
import type { Env } from "../../config/env.js";
import { GeminiClient } from "../ai/gemini.client.js";
import {
  classificationPromptForAtom,
  gameHtmlPromptForAtom,
  glossaryPromptForAtom,
  illustrationImagePromptForAtom,
  illustrationImagePromptForChapter,
  illustrationImagePromptForTopic,
  microGamePromptForAtom,
  quizPromptForAtom,
  simulationPromptForAtom,
  videoLessonPromptForAtom,
  topicSummaryPrompt,
  topicQuizPrompt,
  topicGameHtmlPrompt,
  topicAssessmentPrompt,
  chapterSummaryPrompt,
  chapterTestPrompt,
} from "../ai/templates/prompt-registry.js";
import { extractPdfTextPages } from "../ingestion/pdf/pdf-text.js";
import { detectChapterSegments } from "../ingestion/text/chapter-split.js";
import { extractSectionLabel } from "../ingestion/layer2-content-extract.service.js";
import { classifyAtomBodiesBatch } from "../ingestion/layer3-classify.service.js";
import { scoreFromPrimaryAndLength } from "../ingestion/layer4-score.service.js";
import { mapWithConcurrency } from "../utils/parallel.js";
import { isPageTextProbablyScannedSparse, summarizeOcrHints } from "./ocr-hints.js";
import { detectTopicsInChapter } from "./topic-detection.js";
import { pairedAtomBodiesFromTopicBody } from "./paragraph-pairing.js";
import { GeminiTtsService } from "../tts/gemini-tts.service.js";
import { SuperTtsHttpService } from "../tts/supertts-http.service.js";
import {
  computeExpectedGenerationJobCount,
  enqueueParseExportGenerationJobs,
  saveParseExportManifest,
  type ParseExportManifestV1,
} from "../parse-export/parse-export-generation.service.js";

export type ParseExportOptions = {
  /** Max concurrent Gemini classification calls (each call may include a batch of atoms). */
  classifyConcurrency: number;
  /** Atoms per classification request — higher means fewer Gemini round trips. */
  classifyBatchSize: number;
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
    microGame: string;
    glossary: string;
    simulation: string;
    video: string;
    illustrationImage: string;
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
  prompts: {
    summary: string;
    quiz: string;
    gameHtml: string;
    assessment: string;
    illustrationImage: string;
  };
};

export type ChapterParseExport = {
  title: string;
  position: number;
  chapterNumber: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  topics: TopicParseExport[];
  prompts: {
    summary: string;
    test: string;
    illustrationImage: string;
  };
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
  ttsPlan: {
    pendingAsyncIds: ReadonlySet<string>;
    anyProviderConfigured: boolean;
    ttsRequested: boolean;
  },
): AtomParseExport {
  const primary = classification.primary;
  const rec = recommendKinds(primary, importanceScore);
  const importanceHint =
    importanceScore >= 7 ? "high" : importanceScore >= 4 ? "medium" : "low";

  let tts: AtomParseExport["tts"];
  if (ttsPlan.pendingAsyncIds.has(flat.id) && ttsPlan.ttsRequested && ttsPlan.anyProviderConfigured) {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "async_queued",
    };
  } else if (!ttsPlan.ttsRequested) {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "tts_disabled_by_request",
    };
  } else if (!ttsPlan.anyProviderConfigured) {
    tts = {
      audioUrl: null,
      mime: null,
      skipped: true,
      skipReason: "tts_not_configured",
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
      microGame: microGamePromptForAtom(flat.body, difficultyHint),
      glossary: glossaryPromptForAtom(flat.body),
      simulation: simulationPromptForAtom(flat.body, primary),
      video: videoLessonPromptForAtom(flat.body, primary),
      illustrationImage: illustrationImagePromptForAtom(
        flat.body,
        primary,
        flat.sectionLabel,
      ),
    },
    tts,
  };
}

/**
 * Parse PDF in memory: chapters → topics → paired paragraph atoms, parallel Gemini classification,
 * generation prompts, async TTS + generated artifacts (SuperTTS or Gemini TTS; see GET /parse/export/.../generated).
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

  const batchSize = Math.max(1, options.classifyBatchSize);
  const batches: FlatWork[][] = [];
  for (let i = 0; i < flatAtoms.length; i += batchSize) {
    batches.push(flatAtoms.slice(i, i + batchSize));
  }

  const batchResults = await mapWithConcurrency(
    batches,
    Math.max(1, options.classifyConcurrency),
    async (batch) =>
      classifyAtomBodiesBatch(
        gemini,
        batch.map((a) => ({ id: a.id, body: a.body })),
      ),
  );
  const classById = new Map<string, AtomClassificationOutput>();
  for (const m of batchResults) {
    for (const [id, c] of m) classById.set(id, c);
  }

  const scored = flatAtoms.map((a) => {
    const c = classById.get(a.id);
    const primary = c?.primary ?? ("CONCEPT" as AtomPrimaryTag);
    const score = scoreFromPrimaryAndLength(primary, a.body.length);
    return { ...a, primary, score };
  });

  const geminiTts = new GeminiTtsService(env);
  const superTts = new SuperTtsHttpService(env);
  const ttsAnyProviderConfigured = superTts.isConfigured() || geminiTts.isConfigured();
  const ttsRequested = options.ttsMaxAtoms > 0;
  const ttsPendingAsyncIds = new Set<string>();
  if (ttsAnyProviderConfigured && ttsRequested) {
    const sorted = [...scored].sort((x, y) => y.score - x.score);
    for (const row of sorted.slice(0, options.ttsMaxAtoms)) {
      ttsPendingAsyncIds.add(row.id);
    }
  }

  const ttsPlan = {
    pendingAsyncIds: ttsPendingAsyncIds,
    anyProviderConfigured: ttsAnyProviderConfigured,
    ttsRequested,
  };

  const chapters: ChapterParseExport[] = chapterStructs.map((ch, chi) => {
    const topics: TopicParseExport[] = ch.topics.map((tp) => {
      const atoms: AtomParseExport[] = tp.atoms.map((flat) => {
        const c = classById.get(flat.id);
        const primary = c?.primary ?? ("CONCEPT" as AtomPrimaryTag);
        const tags = c?.tags ?? [primary];
        const importanceScore = scoreFromPrimaryAndLength(primary, flat.body.length);
        const difficultyHint = importanceScore >= 7 ? "hard" : importanceScore >= 4 ? "medium" : "easy";
        return buildAtomExport(flat, { primary, tags }, importanceScore, difficultyHint, ttsPlan);
      });
      const topicAtomBodies = atoms.map((a) => a.body);
      const avgImportance = atoms.length > 0
        ? atoms.reduce((s, a) => s + a.importanceScore, 0) / atoms.length
        : 5;
      const topicImportanceHint = avgImportance >= 7 ? "high" : avgImportance >= 4 ? "medium" : "low";

      return {
        title: tp.title,
        position: tp.position,
        atoms,
        prompts: {
          summary: topicSummaryPrompt(tp.title, topicAtomBodies),
          quiz: topicQuizPrompt(tp.title, topicAtomBodies),
          gameHtml: topicGameHtmlPrompt(tp.title, topicAtomBodies, topicImportanceHint),
          assessment: topicAssessmentPrompt(tp.title, topicAtomBodies),
          illustrationImage: illustrationImagePromptForTopic(tp.title, topicAtomBodies),
        },
      };
    });

    const allTopicTitles = topics.map((t) => t.title);
    const keyAtomBodies = topics.flatMap((t) =>
      t.atoms
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, 3)
        .map((a) => a.body),
    );

    return {
      title: ch.title,
      position: chi,
      chapterNumber: ch.chapterNumber,
      pageStart: ch.pageStart,
      pageEnd: ch.pageEnd,
      topics,
      prompts: {
        summary: chapterSummaryPrompt(ch.title, allTopicTitles, keyAtomBodies),
        test: chapterTestPrompt(ch.title, allTopicTitles, keyAtomBodies),
        illustrationImage: illustrationImagePromptForChapter(
          ch.title,
          allTopicTitles,
          keyAtomBodies,
        ),
      },
    };
  });

  const result: PdfParseExportResult = {
    exportId,
    meta: {
      originalName,
      pageCount: numPages,
      ocrHints: ocrSummary,
      pipeline: "parse_export_v1",
    },
    chapters,
  };

  const manifest: ParseExportManifestV1 = {
    ...result,
    userId,
    ttsPendingAtomIds: [...ttsPendingAsyncIds],
    ttsMaxAtoms: options.ttsMaxAtoms,
    expectedGenerationJobs: computeExpectedGenerationJobCount(result),
  };
  await saveParseExportManifest(env, manifest);
  await enqueueParseExportGenerationJobs(manifest);

  return result;
}
