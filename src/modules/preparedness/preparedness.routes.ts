import { and, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { getDb } from "../../db/global.js";
import { schema } from "../../db/tables.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";

const chapterParams = z.object({ chapterId: z.string().uuid() });

export function preparednessRouter(_env: Env) {
  const r = Router();

  r.get(
    "/chapters/:chapterId",
    requireAuth(_env),
    validate(chapterParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { chapterId } = req.validatedParams as z.infer<typeof chapterParams>;
      const db = getDb();
      const { preparednessScores } = schema();
      const [row] = await db
        .select()
        .from(preparednessScores)
        .where(
          and(
            eq(preparednessScores.userId, u.id),
            eq(preparednessScores.chapterId, chapterId),
          ),
        )
        .limit(1);
      if (!row) {
        res.json({
          preparedness: null,
          breakdown: {
            quizScore: 0,
            retentionScore: 0,
            coveragePercent: 0,
            weakAtomCount: 0,
            compositeScore: 0,
          },
        });
        return;
      }
      res.json({
        preparedness: row,
        breakdown: {
          quizScore: row.quizScore,
          retentionScore: row.retentionScore,
          coveragePercent: row.coveragePercent,
          weakAtomCount: row.weakAtomCount,
          compositeScore: row.compositeScore,
        },
      });
    }),
  );

  return r;
}
