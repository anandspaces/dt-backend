import { z } from "zod";

export const startSessionBody = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
  mode: z.enum(["auto", "manual"]).optional(),
});

export const sessionIdParams = z.object({ id: z.string().uuid() });

export const nextSessionBody = z.object({
  durationMs: z.coerce.number().int().positive().optional(),
});
