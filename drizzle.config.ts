import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/postgres/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432/dt_backend_db",
  },
});
