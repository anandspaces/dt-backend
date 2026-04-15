import type { AppDb } from "./client.js";

let client: AppDb | null = null;
let driver: "sqlite" | "postgresql" = "sqlite";

export function setDb(db: AppDb, d: "sqlite" | "postgresql"): void {
  client = db;
  driver = d;
}

export function getDb(): AppDb {
  if (!client) {
    throw new Error("Database not initialized");
  }
  return client;
}

export function getDbDriver(): "sqlite" | "postgresql" {
  return driver;
}
