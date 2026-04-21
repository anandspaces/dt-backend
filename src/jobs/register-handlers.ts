import type { Env } from "../config/env.js";
import type { JobQueue } from "../services/queue/job-queue.types.js";
import { executeJob } from "./execute-job.js";
import type { JobName } from "./contracts/job-schemas.js";

const REGISTERED: JobName[] = [
  "full-pdf-ingest",
  "extract-pdf",
  "classify-atoms",
  "generate-priority-content",
  "generate-background-content",
  "recalculate-preparedness",
  "award-xp-and-badges",
  "schedule-srs-reviews",
  "parse-export-atom",
  "parse-export-topic",
  "parse-export-chapter",
];

export function registerJobHandlers(queue: JobQueue, env: Env): void {
  for (const name of REGISTERED) {
    queue.register(name, async (raw) => {
      await executeJob(env, name, raw);
    });
  }
}
