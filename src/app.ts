import cors from "cors";
import express from "express";
import helmet from "helmet";
import { type Env, shouldExposeApiDocs } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/request-logger.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { contentRouter } from "./modules/content/content.routes.js";
import { generationRouter } from "./modules/content/generation.routes.js";
import { filesRouter } from "./modules/files/files.routes.js";
import { parseRouter } from "./modules/parse/parse.routes.js";
import { gamificationRouter } from "./modules/gamification/gamification.routes.js";
import { progressRouter } from "./modules/progress/progress.routes.js";
import { preparednessRouter } from "./modules/preparedness/preparedness.routes.js";
import { sessionsRouter } from "./modules/sessions/sessions.routes.js";
import { studentsRouter } from "./modules/students/students.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { healthRouter } from "./routes/health.js";
import { openApiRouter } from "./routes/openapi.js";
import type { CachePort } from "./services/cache/redis-cache.js";

export function createApp(env: Env, _cache: CachePort) {
  void _cache;
  const app = express();
  app.disable("x-powered-by");
  const exposeDocs = shouldExposeApiDocs(env);
  if (exposeDocs) {
    const strictHelmet = helmet();
    const docsHelmet = helmet({ contentSecurityPolicy: false });
    app.use((req, res, next) => {
      if (req.path.startsWith("/api/docs") || req.path === "/api/openapi.json") {
        docsHelmet(req, res, next);
      } else {
        strictHelmet(req, res, next);
      }
    });
  } else {
    app.use(helmet());
  }
  app.use(cors());
  app.use(requestLogger);
  app.use(express.json({ limit: "10mb" }));
  app.use(healthRouter());

  if (exposeDocs) {
    app.use("/api", openApiRouter());
  }

  const v1 = express.Router();
  v1.use(apiRateLimiter(env));
  v1.use("/auth", authRouter(env));
  v1.use("/users", usersRouter(env));
  v1.use("/", contentRouter(env));
  v1.use("/", generationRouter(env));
  v1.use("/files", filesRouter(env));
  v1.use("/parse", parseRouter(env));
  v1.use("/progress", progressRouter(env));
  v1.use("/sessions", sessionsRouter(env));
  v1.use("/preparedness", preparednessRouter(env));
  v1.use("/students", studentsRouter(env));
  v1.use("/gamification", gamificationRouter(env));

  app.use("/api/v1", v1);
  app.use(errorHandler(env));
  return app;
}
