import type { Request } from "express";
import { HttpError } from "./http-error.js";
import type { AuthUser } from "./auth-user.js";

export function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw HttpError.unauthorized();
  }
  return req.user;
}
