import { parseJobPayload, type JobName } from "../../jobs/contracts/job-schemas.js";
import type { JobPriority, JobQueue } from "./job-queue.types.js";

export type { JobPriority } from "./job-queue.types.js";

const PRI: Record<JobPriority, number> = { high: 0, medium: 1, low: 2 };

type JobHandler = (payload: unknown) => Promise<void>;

type Envelope = {
  id: string;
  name: JobName;
  payload: unknown;
  priority: JobPriority;
  attempts: number;
  maxAttempts: number;
};

export class InMemoryQueue implements JobQueue {
  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly heap: Envelope[] = [];
  private activeJobs = 0;
  private readonly maxConcurrency: number;

  constructor(maxConcurrency = 20) {
    this.maxConcurrency = maxConcurrency;
  }

  register(name: JobName, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  enqueue(name: JobName, payload: unknown, priority: JobPriority = "medium"): void | Promise<void> {
    parseJobPayload(name, payload);
    this.heap.push({
      id: crypto.randomUUID(),
      name,
      payload,
      priority,
      attempts: 0,
      maxAttempts: 5,
    });
    this.heap.sort((a, b) => PRI[a.priority] - PRI[b.priority]);
    this.pump();
  }

  /** Fills all free slots up to maxConcurrency — non-blocking. */
  private pump(): void {
    while (this.activeJobs < this.maxConcurrency && this.heap.length > 0) {
      const job = this.heap.shift();
      if (!job) break;
      this.activeJobs += 1;
      this.runJob(job);
    }
  }

  private runJob(job: Envelope): void {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      console.error(`[queue] no handler for ${job.name}`);
      this.activeJobs -= 1;
      this.pump();
      return;
    }

    handler(job.payload)
      .then(() => {
        this.activeJobs -= 1;
        this.pump();
      })
      .catch((err: unknown) => {
        job.attempts += 1;
        if (job.attempts < job.maxAttempts) {
          const delayMs = 300 * 2 ** (job.attempts - 1);
          setTimeout(() => {
            this.heap.push(job);
            this.heap.sort((a, b) => PRI[a.priority] - PRI[b.priority]);
            this.activeJobs -= 1;
            this.pump();
          }, delayMs);
        } else {
          console.error(
            `[queue] job ${job.name} failed after ${String(job.attempts)} attempts`,
            err,
          );
          this.activeJobs -= 1;
          this.pump();
        }
      });
  }
}
