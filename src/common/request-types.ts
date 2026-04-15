import type { Request } from "express";
import type { AuthUser, UserRole } from "./auth-user.js";

export type { AuthUser, UserRole };

/** After `requireAuth`, `req.user` is set. */
export type AuthenticatedRequest = Request;
