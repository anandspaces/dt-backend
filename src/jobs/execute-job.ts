import { eq } from "drizzle-orm";
import type { Env } from "../config/env.js";
import { getDb } from "../db/global.js";
import { schema } from "../db/tables.js";
import {
  awardXpAndBadgesPayloadSchema,
  classifyAtomsPayloadSchema,
  extractPdfPayloadSchema,
  fullPdfIngestPayloadSchema,
  generateBackgroundContentPayloadSchema,
  generatePriorityContentPayloadSchema,
  parseExportAtomPayloadSchema,
  parseExportChapterPayloadSchema,
  parseExportTopicPayloadSchema,
  recalculatePreparednessPayloadSchema,
  scheduleSrsReviewsPayloadSchema,
  type JobName,
} from "./contracts/job-schemas.js";
import { GeminiClient } from "../services/ai/gemini.client.js";
import { GenerationCoordinator } from "../services/generation/generation-coordinator.service.js";
import { AwardingService } from "../services/gamification/awarding.service.js";
import { ClassifyAtomsPipeline } from "../services/ingestion/classify-atoms-pipeline.service.js";
import { PdfIngestionOrchestrator } from "../services/ingestion/pdf-ingestion-orchestrator.service.js";
import { FullPdfIngestOrchestrator } from "../services/ingestion-v2/full-pdf-ingest.orchestrator.js";
import {
  processParseExportAtomJob,
  processParseExportChapterJob,
  processParseExportTopicJob,
} from "../services/parse-export/parse-export-generation.service.js";
import { PreparednessService } from "../services/preparedness/preparedness.service.js";
import { getQueue } from "../services/queue/queue-global.js";
import { SrsScheduleService } from "../services/srs/srs-schedule.service.js";

export async function executeJob(env: Env, name: JobName, raw: unknown): Promise<void> {
  const gemini = new GeminiClient(env);
  const generation = new GenerationCoordinator(env, gemini);
  const pdf = new PdfIngestionOrchestrator(env);
  const classifyPipeline = new ClassifyAtomsPipeline(env, gemini);
  const preparedness = new PreparednessService();
  const awarding = new AwardingService();

  switch (name) {
    case "full-pdf-ingest": {
      const p = fullPdfIngestPayloadSchema.parse(raw);
      await new FullPdfIngestOrchestrator(env).run(p.fileId);
      return;
    }
    case "extract-pdf": {
      const p = extractPdfPayloadSchema.parse(raw);
      await pdf.runPipeline(p.fileId);
      const db = getDb();
      const { files } = schema();
      const [file] = await db.select().from(files).where(eq(files.id, p.fileId)).limit(1);
      if (file && file.fileKind === "book" && file.ingestionStatus === "completed") {
        void getQueue().enqueue("classify-atoms", { fileId: p.fileId }, "medium");
      }
      return;
    }
    case "classify-atoms": {
      const p = classifyAtomsPayloadSchema.parse(raw);
      await classifyPipeline.run(p.fileId);
      return;
    }
    case "generate-priority-content": {
      const p = generatePriorityContentPayloadSchema.parse(raw);
      await generation.generateForAtoms(p.atomIds, "quiz", "high");
      return;
    }
    case "generate-background-content": {
      const p = generateBackgroundContentPayloadSchema.parse(raw);
      await generation.generateForAtoms(p.atomIds, "game", "low");
      return;
    }
    case "recalculate-preparedness": {
      const p = recalculatePreparednessPayloadSchema.parse(raw);
      await preparedness.recalculate(p.userId, p.chapterId);
      return;
    }
    case "award-xp-and-badges": {
      const p = awardXpAndBadgesPayloadSchema.parse(raw);
      await awarding.grantXp(p.userId, p.source, p.amount, p.metadata);
      return;
    }
    case "schedule-srs-reviews": {
      const p = scheduleSrsReviewsPayloadSchema.parse(raw);
      await new SrsScheduleService().run(p.userId, p.sessionId);
      return;
    }
    case "parse-export-atom": {
      const p = parseExportAtomPayloadSchema.parse(raw);
      await processParseExportAtomJob(env, p);
      return;
    }
    case "parse-export-topic": {
      const p = parseExportTopicPayloadSchema.parse(raw);
      await processParseExportTopicJob(env, p);
      return;
    }
    case "parse-export-chapter": {
      const p = parseExportChapterPayloadSchema.parse(raw);
      await processParseExportChapterJob(env, p);
      return;
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled job: ${String(_exhaustive)}`);
    }
  }
}
