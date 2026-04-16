import type { AuthUser } from "../common/auth-user.js";

export {};

declare global {
  namespace Express {
    interface Request {
      /** Correlation id for logs and optional client header `X-Request-Id`. */
      requestId?: string;
      user?: AuthUser;
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}
