import type { Env } from "../../config/env.js";
import { LocalStorageAdapter } from "./local-storage.adapter.js";
import type { StorageAdapter } from "./types.js";

export function createStorageAdapter(env: Env): StorageAdapter {
  return new LocalStorageAdapter(env.STORAGE_LOCAL_DIR);
}
