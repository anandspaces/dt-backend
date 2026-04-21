import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { GeminiClient } from "../../services/ai/gemini.client.js";
import {
  GenerationCoordinator,
  type TopicContentType,
  type ChapterContentType,
} from "../../services/generation/generation-coordinator.service.js";

const chapterGenerateBody = z.object({
  contentType: z.enum(["chapter_summary", "chapter_test"]),
});

const topicGenerateBody = z.object({
  contentType: z.enum(["topic_summary", "topic_quiz", "topic_game", "topic_assessment"]),
});

const atomGenerateBody = z.object({
  contentType: z.enum(["quiz", "game"]),
});

const bookChapterParams = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
});

const bookChapterTopicParams = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
  topicId: z.string().uuid(),
});

const bookChapterAtomParams = z.object({
  bookId: z.string().uuid(),
  chapterId: z.string().uuid(),
  atomId: z.string().uuid(),
});

/**
 * Routes for on-demand content generation at atom, topic, and chapter level.
 */
export function generationRouter(env: Env) {
  const r = Router();

  /** Generate chapter-level content (summary or comprehensive test). */
  r.post(
    "/books/:bookId/chapters/:chapterId/generate",
    requireAuth(env),
    validate(bookChapterParams, "params"),
    validate(chapterGenerateBody, "body"),
    asyncHandler(async (req, res) => {
      const _u = getAuthUser(req);
      void _u;
      const { chapterId } = req.validatedParams as z.infer<typeof bookChapterParams>;
      const { contentType } = req.validatedBody as z.infer<typeof chapterGenerateBody>;

      const gemini = new GeminiClient(env);
      const coordinator = new GenerationCoordinator(env, gemini);
      const result = await coordinator.generateForChapter(
        chapterId,
        contentType as ChapterContentType,
      );
      res.status(200).json(result);
    }),
  );

  /** Generate topic-level content (summary, quiz, game, or assessment). */
  r.post(
    "/books/:bookId/chapters/:chapterId/topics/:topicId/generate",
    requireAuth(env),
    validate(bookChapterTopicParams, "params"),
    validate(topicGenerateBody, "body"),
    asyncHandler(async (req, res) => {
      const _u = getAuthUser(req);
      void _u;
      const { topicId } = req.validatedParams as z.infer<typeof bookChapterTopicParams>;
      const { contentType } = req.validatedBody as z.infer<typeof topicGenerateBody>;

      const gemini = new GeminiClient(env);
      const coordinator = new GenerationCoordinator(env, gemini);
      const result = await coordinator.generateForTopic(
        topicId,
        contentType as TopicContentType,
      );
      res.status(200).json(result);
    }),
  );

  /** Generate atom-level content (quiz or game). */
  r.post(
    "/books/:bookId/chapters/:chapterId/atoms/:atomId/generate",
    requireAuth(env),
    validate(bookChapterAtomParams, "params"),
    validate(atomGenerateBody, "body"),
    asyncHandler(async (req, res) => {
      const _u = getAuthUser(req);
      void _u;
      const { atomId } = req.validatedParams as z.infer<typeof bookChapterAtomParams>;
      const { contentType } = req.validatedBody as z.infer<typeof atomGenerateBody>;

      const gemini = new GeminiClient(env);
      const coordinator = new GenerationCoordinator(env, gemini);
      await coordinator.generateForAtoms([atomId], contentType, "high");
      res.status(200).json({ atomId, contentType, status: "completed" });
    }),
  );

  return r;
}
