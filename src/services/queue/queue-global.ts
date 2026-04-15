import { getQueueSingleton } from "./queue-singleton.js";

export function getQueue() {
  return getQueueSingleton();
}
