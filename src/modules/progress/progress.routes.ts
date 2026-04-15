import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ProgressService } from "./progress.service.js";
import {
  createProgressBody,
  progressIdParams,
  updateProgressBody,
} from "./progress.validators.js";

export function progressRouter(_env: Env) {
  const r = Router();
  const svc = new ProgressService();

  r.get(
    "/",
    requireAuth(_env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const rows = await svc.list(u.id);
      res.json({ progress: rows });
    }),
  );

  r.post(
    "/",
    requireAuth(_env),
    validate(createProgressBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof createProgressBody>;
      const row = await svc.create(u.id, body);
      res.status(201).json({ progress: row });
    }),
  );

  r.patch(
    "/:id",
    requireAuth(_env),
    validate(progressIdParams, "params"),
    validate(updateProgressBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { id } = req.validatedParams as z.infer<typeof progressIdParams>;
      const body = req.validatedBody as z.infer<typeof updateProgressBody>;
      const row = await svc.update(u.id, id, body);
      res.json({ progress: row });
    }),
  );

  return r;
}
