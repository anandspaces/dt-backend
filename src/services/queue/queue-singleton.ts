import type { Env } from "../../config/env.js";
import { BullMqSender } from "./bullmq-queue.js";
import { InMemoryQueue } from "./in-memory-queue.js";
import type { JobQueue } from "./job-queue.types.js";

let instance: JobQueue = new InMemoryQueue();

/** Call once at process startup after `loadEnv()` (API and worker). */
export function configureJobQueueFromEnv(env: Env): JobQueue {
  if (env.JOB_QUEUE_DRIVER === "redis" && env.REDIS_URL?.trim().length) {
    instance = new BullMqSender(env);
  } else {
    instance = new InMemoryQueue();
  }
  return instance;
}

export function getQueueSingleton(): JobQueue {
  return instance;
}
