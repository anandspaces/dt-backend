import { Router } from "express";
import type { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import type { Env } from "../../config/env.js";
import { validate } from "../../middleware/validate.js";
import { loginBodySchema, registerBodySchema } from "./auth.validators.js";
import { AuthService } from "./auth.service.js";

export function authRouter(env: Env) {
  const r = Router();
  const svc = new AuthService(env);

  r.post(
    "/register",
    validate(registerBodySchema, "body"),
    asyncHandler(async (req, res) => {
      const body = req.validatedBody as z.infer<typeof registerBodySchema>;
      const out = await svc.register(body.email, body.password);
      res.status(201).json(out);
    }),
  );

  r.post(
    "/login",
    validate(loginBodySchema, "body"),
    asyncHandler(async (req, res) => {
      const body = req.validatedBody as z.infer<typeof loginBodySchema>;
      const out = await svc.login(body.email, body.password);
      res.json(out);
    }),
  );

  return r;
}
