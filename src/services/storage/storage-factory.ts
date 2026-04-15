import type { Env } from "../../config/env.js";
import { LocalStorageAdapter } from "./local-storage.adapter.js";
import { S3StorageAdapter } from "./s3-storage.adapter.js";
import type { StorageAdapter } from "./types.js";

export function createStorageAdapter(env: Env): StorageAdapter {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3StorageAdapter(env);
  }
  return new LocalStorageAdapter(env.STORAGE_LOCAL_DIR);
}
