import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/async-handler.js";
import { getAuthUser } from "../../common/request-user.js";
import type { Env } from "../../config/env.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import {
  setRoleBodySchema,
  updateUserBodySchema,
  userIdParamsSchema,
} from "./users.validators.js";
import { UsersService } from "./users.service.js";

export function usersRouter(env: Env) {
  const r = Router();
  const svc = new UsersService();

  r.get(
    "/",
    requireAuth(env),
    requireRole("admin"),
    asyncHandler(async (_req, res) => {
      const users = await svc.listAll();
      res.json({ users });
    }),
  );

  r.get(
    "/me",
    requireAuth(env),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const user = await svc.getById(u.id);
      if (!user) {
        res.status(404).json({ error: { message: "Not found" } });
        return;
      }
      res.json({ user });
    }),
  );

  r.patch(
    "/me",
    requireAuth(env),
    validate(updateUserBodySchema, "body"),
    asyncHandler(async (req, res) => {
      const u = getAuthUser(req);
      const body = req.validatedBody as z.infer<typeof updateUserBodySchema>;
      const user = await svc.updateSelf(u.id, body);
      res.json({ user });
    }),
  );

  r.get(
    "/:id",
    requireAuth(env),
    requireRole("admin"),
    validate(userIdParamsSchema, "params"),
    asyncHandler(async (req, res) => {
      const { id } = req.validatedParams as z.infer<typeof userIdParamsSchema>;
      const user = await svc.getById(id);
      if (!user) {
        res.status(404).json({ error: { message: "Not found" } });
        return;
      }
      res.json({ user });
    }),
  );

  r.delete(
    "/:id",
    requireAuth(env),
    requireRole("admin"),
    validate(userIdParamsSchema, "params"),
    asyncHandler(async (req, res) => {
      const { id } = req.validatedParams as z.infer<typeof userIdParamsSchema>;
      await svc.deleteUser(id);
      res.status(204).send();
    }),
  );

  r.patch(
    "/:id/role",
    requireAuth(env),
    requireRole("admin"),
    validate(userIdParamsSchema, "params"),
    validate(setRoleBodySchema, "body"),
    asyncHandler(async (req, res) => {
      const { id } = req.validatedParams as z.infer<typeof userIdParamsSchema>;
      const { role } = req.validatedBody as z.infer<typeof setRoleBodySchema>;
      const user = await svc.setRole(id, role);
      res.json({ user });
    }),
  );

  return r;
}
