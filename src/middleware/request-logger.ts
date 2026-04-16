import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { logInfo } from "../common/logger.js";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startMs;
    logInfo("HTTP request completed", {
      event: "http.request",
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  });
  next();
}
