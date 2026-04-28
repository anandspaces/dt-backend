export interface StorageAdapter {
  saveObject(key: string, data: Buffer, contentType: string): Promise<void>;
  readObject(key: string): Promise<Buffer>;
  /** True when an object exists at `key` (cheap on local FS; avoids full reads for progress checks). */
  objectExists(key: string): Promise<boolean>;
  /** Absolute path or URI for local reads (MVP). */
  resolveReadPath(key: string): string;
  /**
   * Delete all objects under a key prefix (treated as a directory root for local storage).
   * Prefix must not start with `/` or contain `..`.
   */
  deletePrefix(prefix: string): Promise<void>;
}
