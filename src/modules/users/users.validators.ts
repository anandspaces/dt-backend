import { z } from "zod";

export const updateUserBodySchema = z.object({
  email: z.string().email().optional(),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const setRoleBodySchema = z.object({
  role: z.enum(["student", "admin"]),
});
