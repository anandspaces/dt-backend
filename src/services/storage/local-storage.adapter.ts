import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageAdapter } from "./types.js";

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly baseDir: string) {}

  async saveObject(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = join(this.baseDir, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async readObject(key: string): Promise<Buffer> {
    const full = join(this.baseDir, key);
    return readFile(full);
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await access(join(this.baseDir, key));
      return true;
    } catch {
      return false;
    }
  }

  resolveReadPath(key: string): string {
    return join(this.baseDir, key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    if (prefix.includes("..") || prefix.startsWith("/") || prefix.startsWith("\\")) {
      throw new Error("deletePrefix: invalid prefix");
    }
    const root = join(this.baseDir, prefix);
    await rm(root, { recursive: true, force: true });
  }
}
