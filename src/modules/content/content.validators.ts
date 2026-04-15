import { z } from "zod";

export const bookIdParams = z.object({ bookId: z.string().uuid() });
export const chapterParams = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
});
export const atomParams = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
  atomId: z.string().uuid(),
});

export const createBookBody = z.object({ title: z.string().min(1) });
export const updateBookBody = z.object({ title: z.string().min(1) });

export const createChapterBody = z.object({
  title: z.string().min(1),
  position: z.coerce.number().int().default(0),
});
export const updateChapterBody = z.object({
  title: z.string().min(1).optional(),
  position: z.coerce.number().int().optional(),
});

export const createAtomBody = z.object({
  body: z.string().min(1),
  position: z.coerce.number().int().default(0),
});
export const updateAtomBody = z.object({
  body: z.string().min(1).optional(),
  position: z.coerce.number().int().optional(),
});

export const createContentBody = z.object({
  kind: z.string().min(1),
  body: z.string().min(1),
});
