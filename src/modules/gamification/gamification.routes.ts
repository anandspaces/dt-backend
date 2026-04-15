import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { AwardingService } from "../../services/gamification/awarding.service.js";

const grantXpBody = z.object({
  amount: z.coerce.number().int().positive(),
  source: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function gamificationRouter(_env: Env) {
  const r = Router();
  const awarding = new AwardingService();

  r.post(
    "/xp",
    requireAuth(_env),
    validate(grantXpBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof grantXpBody>;
      await awarding.grantXp(u.id, body.source, body.amount, body.metadata);
      res.status(204).send();
    }),
  );

  return r;
}
