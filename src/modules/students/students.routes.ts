import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ManualLearningModeService } from "../../services/sessions/manual-learning-mode.service.js";
import { StudentsService } from "./students.service.js";
import {
  atomIdParams,
  calibrationResponseBody,
  createCalibrationBody,
  interactionBody,
  patchProfileBody,
  testIdParams,
} from "./students.validators.js";

export function studentsRouter(_env: Env) {
  const r = Router();
  const svc = new StudentsService();
  const manual = new ManualLearningModeService();

  r.get(
    "/profile",
    requireAuth(_env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const profile = await svc.getOrCreateProfile(u.id);
      res.json({ profile });
    }),
  );

  r.patch(
    "/profile",
    requireAuth(_env),
    validate(patchProfileBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof patchProfileBody>;
      const profile = await svc.updateProfileJson(u.id, body.profileJson);
      res.json({ profile });
    }),
  );

  r.post(
    "/calibration/tests",
    requireAuth(_env),
    validate(createCalibrationBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof createCalibrationBody>;
      const test = await svc.createCalibrationTest(u.id, body.title);
      res.status(201).json({ test });
    }),
  );

  r.post(
    "/calibration/tests/:testId/responses",
    requireAuth(_env),
    validate(testIdParams, "params"),
    validate(calibrationResponseBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { testId } = req.validatedParams as z.infer<typeof testIdParams>;
      const body = req.validatedBody as z.infer<typeof calibrationResponseBody>;
      const row = await svc.addCalibrationResponse(
        testId,
        u.id,
        body.questionId,
        body.answerJson,
      );
      res.status(201).json({ response: row });
    }),
  );

  r.post(
    "/interaction-events",
    requireAuth(_env),
    validate(interactionBody, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof interactionBody>;
      const row = await svc.logInteraction(u.id, body);
      res.status(201).json({ event: row });
    }),
  );

  r.get(
    "/roadmap",
    requireAuth(_env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const items = await svc.listRoadmap(u.id);
      res.json({ roadmap: items });
    }),
  );

  r.get(
    "/srs/due",
    requireAuth(_env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const cards = await svc.listSrsDue(u.id);
      res.json({ cards });
    }),
  );

  r.get(
    "/learning/atoms/:atomId",
    requireAuth(_env),
    validate(atomIdParams, "params"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const { atomId } = req.validatedParams as z.infer<typeof atomIdParams>;
      const out = await manual.getAtomForUser(u.id, atomId);
      res.json(out);
    }),
  );

  return r;
}
