import Redis from "ioredis";
import type { Env } from "../../config/env.js";

export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
}

export class NoopCache implements CachePort {
  get(_key: string): Promise<string | null> {
    return Promise.resolve(null);
  }

  set(_key: string, _value: string, _ttlSeconds?: number): Promise<void> {
    return Promise.resolve();
  }
}

export class RedisCache implements CachePort {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }
}

export function createCache(env: Env): CachePort {
  if (env.REDIS_URL && env.REDIS_URL.length > 0) {
    return new RedisCache(env.REDIS_URL);
  }
  return new NoopCache();
}
