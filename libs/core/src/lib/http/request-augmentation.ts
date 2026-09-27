import type { Actor } from '../actor';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requestIdMiddleware. */
      requestId?: string;
      /** Set by the auth guard once the caller is authenticated. */
      actor?: Actor;
    }
  }
}

export {};
