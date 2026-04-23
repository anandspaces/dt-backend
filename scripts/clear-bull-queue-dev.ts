#!/usr/bin/env bun
/**
 * Runs before `bun dev` (see package.json). Development only.
 * - PING Redis (fail fast if unhealthy)
 * - Obliterate BullMQ queue `dextora` (waiting, active, delayed, completed metadata — no stale backlog)
 * - Delete Redis keys `pe:p:*` (parse-export progress cache) so status matches an empty queue
 *
 * Skip: PRODUCTION, non-Redis queue driver, or DEV_SKIP_CLEAR_BULL_QUEUE=1
 */
import { Queue } from "bullmq";
import type Redis from "ioredis";
import { loadEnv } from "../src/config/env.js";
import { bullMqQueueName, createBullMqConnection } from "../src/services/queue/bullmq-queue.js";

async function deleteByPattern(redis: Redis, pattern: string): Promise<number> {
  let deleted = 0;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "200");
    cursor = next;
    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== "0");
  return deleted;
}

async function main(): Promise<void> {
  const env = loadEnv();

  if (process.env.DEV_SKIP_CLEAR_BULL_QUEUE === "1" || process.env.DEV_SKIP_CLEAR_BULL_QUEUE === "true") {
    console.info("[dev-queue] skip: DEV_SKIP_CLEAR_BULL_QUEUE is set");
    return;
  }

  if (env.NODE_ENV === "production") {
    console.info("[dev-queue] skip: NODE_ENV=production");
    return;
  }

  if (env.JOB_QUEUE_DRIVER !== "redis" || !env.REDIS_URL?.trim()) {
    console.info("[dev-queue] skip: JOB_QUEUE_DRIVER is not redis or REDIS_URL empty (in-memory queue)");
    return;
  }

  const connection = createBullMqConnection(env);
  try {
    const pong = await connection.ping();
    if (pong !== "PONG") {
      throw new Error(`Redis PING unexpected: ${String(pong)}`);
    }
    console.info("[dev-queue] Redis PING ok");

    const queue = new Queue(bullMqQueueName, { connection });
    await queue.obliterate({ force: true });
    await queue.close();
    console.info(`[dev-queue] BullMQ queue "${bullMqQueueName}" obliterated (empty)`);

    const peDeleted = await deleteByPattern(connection, "pe:p:*");
    if (peDeleted > 0) {
      console.info(`[dev-queue] Removed ${String(peDeleted)} parse-export progress key(s) (pe:p:*)`);
    }
  } finally {
    await connection.quit();
  }
}

main().catch((e) => {
  console.error("[dev-queue] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
