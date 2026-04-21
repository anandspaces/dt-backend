import { Queue } from "bullmq";
import Redis from "ioredis";
import type { Env } from "../../config/env.js";
import { parseJobPayload, type JobName } from "../../jobs/contracts/job-schemas.js";
import type { JobPriority, JobQueue } from "./job-queue.types.js";

const QUEUE_NAME = "dextora";

const PRI: Record<JobPriority, number> = { high: 1, medium: 2, low: 3 };

export function createBullMqConnection(env: Env): Redis {
  const url = env.REDIS_URL?.trim();
  if (!url) throw new Error("REDIS_URL required for BullMQ");
  return new Redis(url, { maxRetriesPerRequest: null });
}

/**
 * API process: enqueue only. Run `bun run worker` to consume.
 */
export class BullMqSender implements JobQueue {
  private readonly queue: Queue;

  constructor(env: Env) {
    const connection = createBullMqConnection(env);
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
  }

  register(_name: JobName, _handler: (payload: unknown) => Promise<void>): void {
    void _name;
    void _handler;
  }

  async enqueue(name: JobName, payload: unknown, priority: JobPriority = "medium"): Promise<void> {
    parseJobPayload(name, payload);
    await this.queue.add(name, payload, {
      priority: PRI[priority],
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
}

export const bullMqQueueName = QUEUE_NAME;
