export interface StorageAdapter {
  saveObject(key: string, data: Buffer, contentType: string): Promise<void>;
  readObject(key: string): Promise<Buffer>;
  /** Absolute path or URI for local reads (MVP). */
  resolveReadPath(key: string): string;
  /**
   * Delete all objects under a key prefix (treated as a directory root for local storage).
   * Prefix must not start with `/` or contain `..`.
   */
  deletePrefix(prefix: string): Promise<void>;
}
