import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import type { StorageAdapter } from "./types.js";

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  async saveObject(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = join(this.baseDir, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  resolveReadPath(key: string): string {
    return join(this.baseDir, key);
  }
}
