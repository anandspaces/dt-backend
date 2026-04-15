import { parseJobPayload, type JobName } from "../../jobs/contracts/job-schemas.js";

export type JobPriority = "high" | "medium" | "low";

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

export class InMemoryQueue {
  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly heap: Envelope[] = [];
  private running = false;

  register(name: JobName, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  enqueue(name: JobName, payload: unknown, priority: JobPriority = "medium"): void {
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
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.heap.length > 0) {
        const job = this.heap.shift();
        if (!job) break;
        const handler = this.handlers.get(job.name);
        if (!handler) {
          console.error(`[queue] no handler for ${job.name}`);
          continue;
        }
        try {
          await handler(job.payload);
        } catch (err) {
          job.attempts += 1;
          if (job.attempts < job.maxAttempts) {
            const delayMs = 300 * 2 ** (job.attempts - 1);
            await new Promise((r) => setTimeout(r, delayMs));
            this.heap.push(job);
            this.heap.sort((a, b) => PRI[a.priority] - PRI[b.priority]);
          } else {
            console.error(
              `[queue] job ${job.name} failed after ${String(job.attempts)} attempts`,
              err,
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
