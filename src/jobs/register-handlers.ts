import type { Env } from "../config/env.js";
import {
  awardXpAndBadgesPayloadSchema,
  classifyAtomsPayloadSchema,
  extractPdfPayloadSchema,
  generateBackgroundContentPayloadSchema,
  generatePriorityContentPayloadSchema,
  recalculatePreparednessPayloadSchema,
  scheduleSrsReviewsPayloadSchema,
} from "./contracts/job-schemas.js";
import { GeminiClient } from "../services/ai/gemini.client.js";
import { GenerationCoordinator } from "../services/generation/generation-coordinator.service.js";
import { AwardingService } from "../services/gamification/awarding.service.js";
import { PdfIngestionOrchestrator } from "../services/ingestion/pdf-ingestion-orchestrator.service.js";
import { PreparednessService } from "../services/preparedness/preparedness.service.js";
import type { InMemoryQueue } from "../services/queue/in-memory-queue.js";

export function registerJobHandlers(queue: InMemoryQueue, env: Env): void {
  const gemini = new GeminiClient(env);
  const generation = new GenerationCoordinator(env, gemini);
  const pdf = new PdfIngestionOrchestrator();
  const preparedness = new PreparednessService();
  const awarding = new AwardingService();

  queue.register("extract-pdf", async (raw) => {
    const p = extractPdfPayloadSchema.parse(raw);
    await pdf.runPipeline(p.fileId);
  });

  queue.register("classify-atoms", (raw) => {
    classifyAtomsPayloadSchema.parse(raw);
    return Promise.resolve();
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

  queue.register("schedule-srs-reviews", (raw) => {
    scheduleSrsReviewsPayloadSchema.parse(raw);
    return Promise.resolve();
  });
}
