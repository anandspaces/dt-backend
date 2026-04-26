import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";
import { HttpError } from "../common/http-error.js";
import type { UserRole } from "../common/auth-user.js";

type JwtPayload = {
  sub: string;
  role: UserRole;
};

/** Resolve user from `Authorization: Bearer` or `?access_token=` / `?token=` (no `requireAuth`). */
export function tryAuthUserBearerOrQuery(req: Request, env: Env): { id: string; role: UserRole } | null {
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    token = header.slice("Bearer ".length).trim();
  } else {
    const q = req.query;
    token =
      (typeof q.access_token === "string" && q.access_token.trim()) ||
      (typeof q.token === "string" && q.token.trim()) ||
      undefined;
  }
  if (!token?.length) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    return { id: decoded.sub, role: decoded.role };
  } catch {
    return null;
  }
}

export function requireAuth(env: Env) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      next(HttpError.unauthorized());
      return;
    }
    const token = header.slice("Bearer ".length);
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      req.user = { id: decoded.sub, role: decoded.role };
      next();
    } catch {
      next(HttpError.unauthorized("Invalid token"));
    }
  };
}

/**
 * Same as `requireAuth` but also accepts the JWT in the query string so assets work in
 * new browser tabs, `<img src>`, and `<audio src>` (no custom headers). Use
 * `?access_token=<jwt>` or `?token=<jwt>` alongside `key` / `mime`.
 *
 * Prefer `Authorization: Bearer` when possible — query tokens can leak via Referer/logs.
 */
export function requireAuthBearerOrQueryToken(env: Env) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = tryAuthUserBearerOrQuery(req, env);
    if (!user) {
      next(HttpError.unauthorized());
      return;
    }
    req.user = user;
    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(HttpError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(HttpError.forbidden());
      return;
    }
    next();
  };
}
