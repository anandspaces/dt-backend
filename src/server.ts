import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { logInfo } from "./common/logger.js";
import { createDb } from "./db/client.js";
import { setDb } from "./db/global.js";
import { registerJobHandlers } from "./jobs/register-handlers.js";
import { createCache } from "./services/cache/redis-cache.js";
import { getQueue } from "./services/queue/queue-global.js";
import { configureJobQueueFromEnv } from "./services/queue/queue-singleton.js";

const env = loadEnv();
configureJobQueueFromEnv(env);
const db = createDb(env);
setDb(db, env.DATABASE_DRIVER);
const cache = createCache(env);
registerJobHandlers(getQueue(), env);

const app = createApp(env, cache);
app.listen(env.PORT, () => {
  logInfo("HTTP server listening", {
    event: "server.start",
    port: env.PORT,
    url: `http://127.0.0.1:${String(env.PORT)}`,
  });
});
