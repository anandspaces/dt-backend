import { z } from "zod";

export const patchProfileBody = z.object({
  profileJson: z.string().min(1),
});

export const createCalibrationBody = z.object({
  title: z.string().min(1),
});

export const calibrationResponseBody = z.object({
  questionId: z.string().min(1),
  answerJson: z.string().min(1),
});

export const interactionBody = z.object({
  eventType: z.string().min(1),
  atomId: z.string().uuid().optional().nullable(),
  sessionId: z.string().uuid().optional().nullable(),
  durationMs: z.coerce.number().int().optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const testIdParams = z.object({ testId: z.string().uuid() });
export const atomIdParams = z.object({ atomId: z.string().uuid() });
