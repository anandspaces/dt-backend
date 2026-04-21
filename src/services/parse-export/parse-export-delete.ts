import type { Env } from "../../config/env.js";
import { createStorageAdapter } from "../storage/storage-factory.js";
import { parseExportRootPrefix } from "./parse-export-keys.js";
import Redis from "ioredis";

let redisSingleton: Redis | null = null;

function redisForProgress(env: Env): Redis | null {
  const url = env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redisSingleton) {
    redisSingleton = new Redis(url, { maxRetriesPerRequest: null });
  }
  return redisSingleton;
}

/** Remove manifest, artifacts, audio, and optional Redis progress key for this export. */
export async function deleteParseExportBundle(env: Env, userId: string, exportId: string): Promise<void> {
  const storage = createStorageAdapter(env);
  await storage.deletePrefix(parseExportRootPrefix(userId, exportId));
  const r = redisForProgress(env);
  if (r) {
    await r.del(`pe:p:${exportId}`);
  }
}
