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
    const route = req.originalUrl.split("?")[0] ?? req.originalUrl;
    logInfo(`${req.method} ${route} → ${String(res.statusCode)} (${durationMs}ms)`, {
      event: "http.request.completed",
      requestId,
      method: req.method,
      path: route,
      status: res.statusCode,
      durationMs,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  });
  next();
}
