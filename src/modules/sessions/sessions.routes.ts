import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { SessionService } from "../../services/sessions/session.service.js";
import { nextSessionBody, sessionIdParams, startSessionBody } from "./sessions.validators.js";

export function sessionsRouter(_env: Env) {
  const r = Router();
  const svc = new SessionService();

  r.post(
    "/",
    requireAuth(_env),
    validate(startSessionBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof startSessionBody>;
      const mode = body.mode ?? "auto";
      const out = await svc.startSession(u.id, body.bookId, body.chapterId, mode);
      res.status(201).json(out);
    }),
  );

  r.post(
    "/:id/next",
    requireAuth(_env),
    validate(sessionIdParams, "params"),
    validate(nextSessionBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { id } = req.validatedParams as z.infer<typeof sessionIdParams>;
      const body = req.validatedBody as z.infer<typeof nextSessionBody>;
      const out = await svc.advanceSession(id, u.id, body.durationMs);
      res.json(out);
    }),
  );

  return r;
}
