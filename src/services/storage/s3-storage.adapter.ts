import { HttpError } from "../../common/http-error.js";
import type { Env } from "../../config/env.js";
import type { StorageAdapter } from "./types.js";

/** S3-compatible adapter placeholder — wire @aws-sdk/client-s3 when credentials exist. */
export class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly _env: Env) {}

  saveObject(_key: string, _data: Buffer, _contentType: string): Promise<void> {
    void this._env;
    return Promise.reject(HttpError.internal("S3 adapter not implemented in this scaffold"));
  }

  resolveReadPath(_key: string): string {
    throw HttpError.internal("S3 adapter not implemented in this scaffold");
  }
}
