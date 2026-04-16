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
  recalculatePreparednessPayloadSchema,
  scheduleSrsReviewsPayloadSchema,
} from "./contracts/job-schemas.js";
import { GeminiClient } from "../services/ai/gemini.client.js";
import { GenerationCoordinator } from "../services/generation/generation-coordinator.service.js";
import { AwardingService } from "../services/gamification/awarding.service.js";
import { ClassifyAtomsPipeline } from "../services/ingestion/classify-atoms-pipeline.service.js";
import { PdfIngestionOrchestrator } from "../services/ingestion/pdf-ingestion-orchestrator.service.js";
import { FullPdfIngestOrchestrator } from "../services/ingestion-v2/full-pdf-ingest.orchestrator.js";
import { PreparednessService } from "../services/preparedness/preparedness.service.js";
import { getQueue } from "../services/queue/queue-global.js";
import type { InMemoryQueue } from "../services/queue/in-memory-queue.js";
import { SrsScheduleService } from "../services/srs/srs-schedule.service.js";

export function registerJobHandlers(queue: InMemoryQueue, env: Env): void {
  const gemini = new GeminiClient(env);
  const generation = new GenerationCoordinator(env, gemini);
  const pdf = new PdfIngestionOrchestrator(env);
  const classifyPipeline = new ClassifyAtomsPipeline(env, gemini);
  const preparedness = new PreparednessService();
  const awarding = new AwardingService();

  queue.register("full-pdf-ingest", async (raw) => {
    const p = fullPdfIngestPayloadSchema.parse(raw);
    await new FullPdfIngestOrchestrator(env).run(p.fileId);
  });

  queue.register("extract-pdf", async (raw) => {
    const p = extractPdfPayloadSchema.parse(raw);
    await pdf.runPipeline(p.fileId);
    const db = getDb();
    const { files } = schema();
    const [file] = await db.select().from(files).where(eq(files.id, p.fileId)).limit(1);
    if (file && file.fileKind === "book" && file.ingestionStatus === "completed") {
      getQueue().enqueue("classify-atoms", { fileId: p.fileId }, "medium");
    }
  });

  queue.register("classify-atoms", async (raw) => {
    const p = classifyAtomsPayloadSchema.parse(raw);
    await classifyPipeline.run(p.fileId);
  });

  queue.register("generate-priority-content", async (raw) => {
    const p = generatePriorityContentPayloadSchema.parse(raw);
    await generation.generateForAtoms(p.atomIds, "quiz", "high");
  });

  queue.register("generate-background-content", async (raw) => {
    const p = generateBackgroundContentPayloadSchema.parse(raw);
    await generation.generateForAtoms(p.atomIds, "game", "low");
  });

  queue.register("recalculate-preparedness", async (raw) => {
    const p = recalculatePreparednessPayloadSchema.parse(raw);
    await preparedness.recalculate(p.userId, p.chapterId);
  });

  queue.register("award-xp-and-badges", async (raw) => {
    const p = awardXpAndBadgesPayloadSchema.parse(raw);
    await awarding.grantXp(p.userId, p.source, p.amount, p.metadata);
  });

  queue.register("schedule-srs-reviews", async (raw) => {
    const p = scheduleSrsReviewsPayloadSchema.parse(raw);
    await new SrsScheduleService().run(p.userId, p.sessionId);
  });
}
