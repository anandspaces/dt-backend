import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzleBunSqlite } from "drizzle-orm/bun-sqlite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Env } from "../config/env.js";
import * as pgSchema from "./schema/postgres/schema.js";
import * as sqliteSchema from "./schema/sqlite/schema.js";

/** Typed against the SQLite schema; Postgres driver is cast for shared service code. */
export type AppDb = BunSQLiteDatabase<typeof sqliteSchema>;

export function createDb(env: Env): AppDb {
  if (env.DATABASE_DRIVER === "sqlite") {
    let filePath = env.DATABASE_URL;
    if (filePath.startsWith("file:")) {
      filePath = filePath.slice("file:".length);
    }
    const dir = dirname(filePath);
    if (dir && dir !== "." && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const sqlite = new Database(filePath, { create: true });
    return drizzleBunSqlite(sqlite, { schema: sqliteSchema });
  }

  const client = postgres(env.DATABASE_URL, { max: 10 });
  return drizzlePg(client, { schema: pgSchema }) as unknown as AppDb;
}
