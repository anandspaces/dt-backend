import { InMemoryQueue } from "./in-memory-queue.js";

const queue = new InMemoryQueue();

export function getQueueSingleton(): InMemoryQueue {
  return queue;
}
