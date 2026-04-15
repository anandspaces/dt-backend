import { z } from "zod";

export const createProgressBody = z.object({
  bookId: z.string().uuid().optional().nullable(),
  chapterId: z.string().uuid().optional().nullable(),
  status: z.string().optional(),
  percent: z.coerce.number().int().min(0).max(100).optional(),
  lastAtomId: z.string().uuid().optional().nullable(),
});

export const updateProgressBody = z.object({
  status: z.string().optional(),
  percent: z.coerce.number().int().min(0).max(100).optional(),
  lastAtomId: z.string().uuid().optional().nullable(),
});

export const progressIdParams = z.object({ id: z.string().uuid() });
