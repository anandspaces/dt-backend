import type { JobName } from "../../jobs/contracts/job-schemas.js";

export type JobPriority = "high" | "medium" | "low";

export interface JobQueue {
  register(name: JobName, handler: (payload: unknown) => Promise<void>): void;
  enqueue(name: JobName, payload: unknown, priority?: JobPriority): void | Promise<void>;
}
