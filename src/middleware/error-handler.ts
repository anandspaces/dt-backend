import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../common/http-error.js";
import type { Env } from "../config/env.js";

export function errorHandler(env: Env) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid request", issues: err.flatten() },
      });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message =
      env.NODE_ENV === "production" ? "Internal server error" : getErrorMessage(err);
    if (env.NODE_ENV !== "production" && err instanceof Error && err.stack) {
      console.error(err.stack);
    } else {
      console.error(message);
    }
    res.status(500).json({ error: { code: "INTERNAL", message } });
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
