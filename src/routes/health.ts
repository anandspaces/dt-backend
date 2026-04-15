import { Router } from "express";
import { asyncHandler } from "../common/async-handler.js";
import { getDb } from "../db/global.js";
import { schema } from "../db/tables.js";

export function healthRouter() {
  const r = Router();

  r.get(
    "/health",
    asyncHandler(async (_req, res) => {
      await Promise.resolve();
      res.json({ status: "ok" });
    }),
  );

  r.get(
    "/health/ready",
    asyncHandler(async (_req, res) => {
      const db = getDb();
      const { users } = schema();
      await db.select().from(users).limit(1);
      res.json({ status: "ready" });
    }),
  );

  return r;
}
