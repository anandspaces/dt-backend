import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import swaggerUi from "swagger-ui-express";

const spec = JSON.parse(
  readFileSync(join(import.meta.dirname, "../openapi/openapi.json"), "utf8"),
) as Record<string, unknown>;

export function openApiRouter() {
  const r = Router();

  r.get("/openapi.json", (_req, res) => {
    res.json(spec);
  });

  r.use(
    "/docs",
    ...swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "Dextora API",
      swaggerOptions: {
        persistAuthorization: true,
      },
    }),
  );

  return r;
}
