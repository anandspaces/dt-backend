import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Env } from "../config/env.js";
import { HttpError } from "../common/http-error.js";
import type { UserRole } from "../common/auth-user.js";

type JwtPayload = {
  sub: string;
  role: UserRole;
};

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
