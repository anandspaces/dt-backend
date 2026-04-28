import type { AppDb } from "./client.js";

let client: AppDb | null = null;

export function setDb(db: AppDb): void {
  client = db;
}

export function getDb(): AppDb {
  if (!client) {
    throw new Error("Database not initialized");
  }
  return client;
}
