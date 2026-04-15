import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ContentService } from "./content.service.js";
import {
  atomParams,
  bookIdParams,
  chapterParams,
  createAtomBody,
  createBookBody,
  createChapterBody,
  createContentBody,
  updateAtomBody,
  updateBookBody,
  updateChapterBody,
} from "./content.validators.js";

export function contentRouter(_env: Env) {
  const r = Router();
  const svc = new ContentService();

  r.get(
    "/books",
    requireAuth(_env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const books = await svc.listBooks(u.id);
      res.json({ books });
    }),
  );

  r.post(
    "/books",
    requireAuth(_env),
    validate(createBookBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof createBookBody>;
      const book = await svc.createBook(u.id, body.title);
      res.status(201).json({ book });
    }),
  );

  r.patch(
    "/books/:bookId",
    requireAuth(_env),
    validate(bookIdParams, "params"),
    validate(updateBookBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId } = req.validatedParams as z.infer<typeof bookIdParams>;
      const body = req.validatedBody as z.infer<typeof updateBookBody>;
      const book = await svc.updateBook(u.id, bookId, body.title);
      res.json({ book });
    }),
  );

  r.delete(
    "/books/:bookId",
    requireAuth(_env),
    validate(bookIdParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId } = req.validatedParams as z.infer<typeof bookIdParams>;
      await svc.deleteBook(u.id, bookId);
      res.status(204).send();
    }),
  );

  r.get(
    "/books/:bookId/chapters",
    requireAuth(_env),
    validate(bookIdParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId } = req.validatedParams as z.infer<typeof bookIdParams>;
      const chapters = await svc.listChapters(u.id, bookId);
      res.json({ chapters });
    }),
  );

  r.post(
    "/books/:bookId/chapters",
    requireAuth(_env),
    validate(bookIdParams, "params"),
    validate(createChapterBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId } = req.validatedParams as z.infer<typeof bookIdParams>;
      const body = req.validatedBody as z.infer<typeof createChapterBody>;
      const chapter = await svc.createChapter(u.id, bookId, body.title, body.position);
      res.status(201).json({ chapter });
    }),
  );

  r.patch(
    "/books/:bookId/chapters/:chapterId",
    requireAuth(_env),
    validate(chapterParams, "params"),
    validate(updateChapterBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId } = req.validatedParams as z.infer<typeof chapterParams>;
      const body = req.validatedBody as z.infer<typeof updateChapterBody>;
      const chapter = await svc.updateChapter(u.id, bookId, chapterId, body);
      res.json({ chapter });
    }),
  );

  r.delete(
    "/books/:bookId/chapters/:chapterId",
    requireAuth(_env),
    validate(chapterParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId } = req.validatedParams as z.infer<typeof chapterParams>;
      await svc.deleteChapter(u.id, bookId, chapterId);
      res.status(204).send();
    }),
  );

  r.get(
    "/books/:bookId/chapters/:chapterId/atoms",
    requireAuth(_env),
    validate(chapterParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId } = req.validatedParams as z.infer<typeof chapterParams>;
      const atoms = await svc.listAtoms(u.id, bookId, chapterId);
      res.json({ atoms });
    }),
  );

  r.post(
    "/books/:bookId/chapters/:chapterId/atoms",
    requireAuth(_env),
    validate(chapterParams, "params"),
    validate(createAtomBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId } = req.validatedParams as z.infer<typeof chapterParams>;
      const body = req.validatedBody as z.infer<typeof createAtomBody>;
      const atom = await svc.createAtom(u.id, bookId, chapterId, body.body, body.position);
      res.status(201).json({ atom });
    }),
  );

  r.patch(
    "/books/:bookId/chapters/:chapterId/atoms/:atomId",
    requireAuth(_env),
    validate(atomParams, "params"),
    validate(updateAtomBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId, atomId } = req.validatedParams as z.infer<typeof atomParams>;
      const body = req.validatedBody as z.infer<typeof updateAtomBody>;
      const atom = await svc.updateAtom(u.id, bookId, chapterId, atomId, body);
      res.json({ atom });
    }),
  );

  r.delete(
    "/books/:bookId/chapters/:chapterId/atoms/:atomId",
    requireAuth(_env),
    validate(atomParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId, atomId } = req.validatedParams as z.infer<typeof atomParams>;
      await svc.deleteAtom(u.id, bookId, chapterId, atomId);
      res.status(204).send();
    }),
  );

  r.get(
    "/books/:bookId/chapters/:chapterId/atoms/:atomId/contents",
    requireAuth(_env),
    validate(atomParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId, atomId } = req.validatedParams as z.infer<typeof atomParams>;
      const rows = await svc.listContentsForAtom(u.id, bookId, chapterId, atomId);
      res.json({ contents: rows });
    }),
  );

  r.post(
    "/books/:bookId/chapters/:chapterId/atoms/:atomId/contents",
    requireAuth(_env),
    validate(atomParams, "params"),
    validate(createContentBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { bookId, chapterId, atomId } = req.validatedParams as z.infer<typeof atomParams>;
      const body = req.validatedBody as z.infer<typeof createContentBody>;
      const row = await svc.createContent(
        u.id,
        bookId,
        chapterId,
        atomId,
        body.kind,
        body.body,
      );
      res.status(201).json({ content: row });
    }),
  );

  return r;
}
