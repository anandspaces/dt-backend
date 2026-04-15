import type { AuthUser } from "../common/auth-user.js";

export {};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}
