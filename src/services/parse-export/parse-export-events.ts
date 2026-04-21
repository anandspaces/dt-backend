import { EventEmitter } from "node:events";
import type { Env } from "../../config/env.js";
import Redis from "ioredis";

const mem = new EventEmitter();
mem.setMaxListeners(500);

function eventsChannel(exportId: string): string {
  return `pe:events:${exportId}`;
}

let publisher: Redis | null = null;

function getPublisher(url: string): Redis {
  if (!publisher) {
    publisher = new Redis(url, { maxRetriesPerRequest: null });
  }
  return publisher;
}

/**
 * Broadcast parse-export progress / completion (JSON string payload).
 */
export function publishParseExportEvent(env: Env, exportId: string, payload: unknown): void {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const url = env.REDIS_URL?.trim();
  if (url) {
    void getPublisher(url).publish(eventsChannel(exportId), data);
    return;
  }
  mem.emit(exportId, data);
}

export type ParseExportEventUnsubscribe = () => Promise<void>;

/**
 * Subscribe to events for one export (Redis pub/sub or in-process EventEmitter).
 */
export async function subscribeParseExportEvents(
  env: Env,
  exportId: string,
  onMessage: (data: string) => void,
): Promise<ParseExportEventUnsubscribe> {
  const url = env.REDIS_URL?.trim();
  if (url) {
    const sub = new Redis(url, { maxRetriesPerRequest: null });
    const ch = eventsChannel(exportId);
    await sub.subscribe(ch);
    sub.on("message", (channel, message) => {
      if (channel === ch) onMessage(message);
    });
    return async () => {
      await sub.unsubscribe(ch);
      await sub.quit();
    };
  }

  const handler = (msg: string) => {
    onMessage(msg);
  };
  mem.on(exportId, handler);
    return () => {
      mem.off(exportId, handler);
      return Promise.resolve();
    };
}
