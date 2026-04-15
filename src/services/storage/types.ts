export interface StorageAdapter {
  saveObject(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Absolute path or URI for local reads (MVP). */
  resolveReadPath(key: string): string;
}
