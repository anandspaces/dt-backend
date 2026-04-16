import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../common/http-error.js";
import type { Env } from "../config/env.js";
import { logError, logInfo, logWarn } from "../common/logger.js";

function requestLogFields(req: Request): Record<string, unknown> {
  return {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
  };
}

export function errorHandler(env: Env) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const base = requestLogFields(req);

    if (err instanceof ZodError) {
      logWarn("Request validation failed", {
        event: "http.error",
        ...base,
        code: "VALIDATION_ERROR",
        issueCount: err.issues.length,
      });
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid request", issues: err.flatten() },
      });
      return;
    }
    if (err instanceof HttpError) {
      const level = err.status >= 500 ? "warn" : "info";
      const payload = {
        event: "http.error" as const,
        ...base,
        code: err.code,
        status: err.status,
        httpMessage: err.message,
      };
      if (level === "warn") logWarn("HTTP error response", payload);
      else logInfo("HTTP client error", payload);
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const message =
      env.NODE_ENV === "production" ? "Internal server error" : getErrorMessage(err);
    const detail =
      env.NODE_ENV !== "production" && err instanceof Error && err.stack
        ? { stack: err.stack, errMessage: err.message }
        : { errMessage: message };
    logError("Unhandled server error", {
      event: "http.error",
      ...base,
      code: "INTERNAL",
      ...detail,
    });
    res.status(500).json({ error: { code: "INTERNAL", message } });
  };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
