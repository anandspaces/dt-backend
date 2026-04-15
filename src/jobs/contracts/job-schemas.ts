import { z } from "zod";

export const extractPdfPayloadSchema = z.object({
  fileId: z.string().uuid(),
});
export type ExtractPdfPayload = z.infer<typeof extractPdfPayloadSchema>;

export const classifyAtomsPayloadSchema = z.object({
  fileId: z.string().uuid(),
});
export type ClassifyAtomsPayload = z.infer<typeof classifyAtomsPayloadSchema>;

export const generatePriorityContentPayloadSchema = z.object({
  atomIds: z.array(z.string().uuid()),
});
export type GeneratePriorityContentPayload = z.infer<
  typeof generatePriorityContentPayloadSchema
>;

export const generateBackgroundContentPayloadSchema = z.object({
  atomIds: z.array(z.string().uuid()),
});
export type GenerateBackgroundContentPayload = z.infer<
  typeof generateBackgroundContentPayloadSchema
>;

export const recalculatePreparednessPayloadSchema = z.object({
  userId: z.string().uuid(),
  chapterId: z.string().uuid(),
});
export type RecalculatePreparednessPayload = z.infer<
  typeof recalculatePreparednessPayloadSchema
>;

export const awardXpAndBadgesPayloadSchema = z.object({
  userId: z.string().uuid(),
  source: z.string(),
  amount: z.number().int(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AwardXpAndBadgesPayload = z.infer<typeof awardXpAndBadgesPayloadSchema>;

export const scheduleSrsReviewsPayloadSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
});
export type ScheduleSrsReviewsPayload = z.infer<typeof scheduleSrsReviewsPayloadSchema>;

export const jobSchemas = {
  "extract-pdf": extractPdfPayloadSchema,
  "classify-atoms": classifyAtomsPayloadSchema,
  "generate-priority-content": generatePriorityContentPayloadSchema,
  "generate-background-content": generateBackgroundContentPayloadSchema,
  "recalculate-preparedness": recalculatePreparednessPayloadSchema,
  "award-xp-and-badges": awardXpAndBadgesPayloadSchema,
  "schedule-srs-reviews": scheduleSrsReviewsPayloadSchema,
} as const;

export type JobName = keyof typeof jobSchemas;

export function parseJobPayload(name: string, payload: unknown): unknown {
  if (!(name in jobSchemas)) {
    throw new Error(`Unknown job: ${name}`);
  }
  return jobSchemas[name as JobName].parse(payload);
}
