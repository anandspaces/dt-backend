import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";

type Part = "body" | "query" | "params";

export function validate(schema: z.ZodTypeAny, part: Part) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const raw: unknown =
      part === "body" ? req.body : part === "query" ? req.query : req.params;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      next(parsed.error);
      return;
    }
    const data: unknown = parsed.data;
    if (part === "body") {
      req.validatedBody = data;
    } else if (part === "query") {
      req.validatedQuery = data;
    } else {
      req.validatedParams = data;
    }
    next();
  };
}
