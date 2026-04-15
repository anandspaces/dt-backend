import { defineConfig } from "drizzle-kit";

const driver = process.env.DATABASE_DRIVER ?? "sqlite";
const rawUrl = process.env.DATABASE_URL ?? "file:./data/app.db";

const isPg = driver === "postgresql";

export default defineConfig({
  schema: isPg
    ? "./src/db/schema/postgres/schema.ts"
    : "./src/db/schema/sqlite/schema.ts",
  out: "./drizzle",
  dialect: isPg ? "postgresql" : "sqlite",
  dbCredentials: isPg
    ? { url: rawUrl }
    : { url: rawUrl.startsWith("file:") ? rawUrl.slice("file:".length) : rawUrl },
});
