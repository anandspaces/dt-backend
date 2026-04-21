/**
 * Standalone worker: BullMQ consumer when `JOB_QUEUE_DRIVER=redis` + `REDIS_URL`.
 * Otherwise logs and idles (in-memory jobs run in the API process).
 */
import { Worker } from "bullmq";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { setDb } from "./db/global.js";
import { executeJob } from "./jobs/execute-job.js";
import type { JobName } from "./jobs/contracts/job-schemas.js";
import { bullMqQueueName, createBullMqConnection } from "./services/queue/bullmq-queue.js";
import { configureJobQueueFromEnv } from "./services/queue/queue-singleton.js";

const env = loadEnv();
configureJobQueueFromEnv(env);
const db = createDb(env);
setDb(db, env.DATABASE_DRIVER);

if (env.JOB_QUEUE_DRIVER !== "redis" || !env.REDIS_URL?.trim()) {
  console.info(
    "[worker] JOB_QUEUE_DRIVER is not redis or REDIS_URL is empty — no BullMQ worker started.",
  );
  await new Promise<void>(() => {
    /* keep alive for process managers */
  });
} else {
  const connection = createBullMqConnection(env);
  const worker = new Worker(
    bullMqQueueName,
    async (job) => {
      await executeJob(env, job.name as JobName, job.data);
    },
    {
      connection,
      concurrency: env.PARSE_EXPORT_WORKER_CONCURRENCY,
    },
  );
  worker.on("failed", (job, err) => {
    console.error("[worker] job failed", job?.name, err);
  });
  console.info("[worker] BullMQ listening on queue", bullMqQueueName);
}
