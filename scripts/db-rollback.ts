/**
 * Drizzle is forward-first. For local dev reset only:
 * `CONFIRM_DB_DROP=1 bun run db:rollback`
 */
import { spawnSync } from "node:child_process";

if (process.env.CONFIRM_DB_DROP !== "1") {
  console.error(
    "Rollback is not automated. For destructive dev reset: CONFIRM_DB_DROP=1 bun run db:rollback",
  );
  process.exit(1);
}

const r = spawnSync("bunx", ["drizzle-kit", "drop"], {
  stdio: "inherit",
  env: process.env,
  shell: false,
});
process.exit(r.status ?? 1);
