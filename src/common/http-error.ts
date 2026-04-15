export type HttpErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL";

export class HttpError extends Error {
  readonly status: number;
  readonly code: HttpErrorCode;

  constructor(status: number, code: HttpErrorCode, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string): HttpError {
    return new HttpError(400, "BAD_REQUEST", message);
  }

  static unauthorized(message = "Unauthorized"): HttpError {
    return new HttpError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden"): HttpError {
    return new HttpError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found"): HttpError {
    return new HttpError(404, "NOT_FOUND", message);
  }

  static conflict(message: string): HttpError {
    return new HttpError(409, "CONFLICT", message);
  }

  static internal(message = "Internal server error"): HttpError {
    return new HttpError(500, "INTERNAL", message);
  }
}
