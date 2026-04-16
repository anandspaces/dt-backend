/**
 * Apply Drizzle migrations using Bun's native SQLite driver.
 * Use this instead of `drizzle-kit migrate` when better-sqlite3 fails (Node ABI mismatch).
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { loadEnv } from "../src/config/env.js";
import * as sqliteSchema from "../src/db/schema/sqlite/schema.js";

const env = loadEnv();
if (env.DATABASE_DRIVER !== "sqlite") {
  console.error("migrate-sqlite.ts only supports DATABASE_DRIVER=sqlite. For PostgreSQL use drizzle-kit migrate.");
  process.exit(1);
}

let filePath = env.DATABASE_URL;
if (filePath.startsWith("file:")) {
  filePath = filePath.slice("file:".length);
}
const dir = dirname(filePath);
if (dir && dir !== "." && !existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(filePath, { create: true });
const db = drizzle(sqlite, { schema: sqliteSchema });
const migrationsFolder = join(import.meta.dirname, "..", "drizzle");
migrate(db, { migrationsFolder });
console.info(`SQLite migrations applied (${filePath}).`);
