/**
 * Standalone worker entry. The in-memory queue is process-local; jobs enqueued by the
 * API are handled in the same process as `bun run start`. For a separate worker process,
 * replace `InMemoryQueue` with Redis/BullMQ and move `registerJobHandlers` here only.
 */
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { setDb } from "./db/global.js";
import { registerJobHandlers } from "./jobs/register-handlers.js";
import { getQueue } from "./services/queue/queue-global.js";

const env = loadEnv();
setDb(createDb(env), env.DATABASE_DRIVER);
registerJobHandlers(getQueue(), env);

console.info("[worker] Handlers registered. In-memory MVP: run jobs from the API server process.");
await new Promise<void>(() => {
  /* keep process alive for future Redis consumer */
});
