import "server-only";

import { AppError } from "../api";
import { positiveIntFromEnvironment } from "./concurrency";

export interface FixedWindowRateLimitOptions {
  /** Width of the fixed window in milliseconds. */
  windowMs: number;
  /** Requests allowed per source within one window. */
  maxRequests: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export type RateLimitDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface WindowState {
  windowStart: number;
  count: number;
}

/**
 * Small in-process fixed-window limiter. It protects a single application
 * instance; the reverse proxy may add another layer, but the application
 * must stay safe on its own.
 */
export class FixedWindowRateLimiter {
  private readonly states = new Map<string, WindowState>();
  private checksSinceSweep = 0;

  constructor(private readonly options: FixedWindowRateLimitOptions) {}

  /** Number of sources currently tracked, for monitoring and tests. */
  get trackedSourceCount(): number {
    return this.states.size;
  }

  check(key: string): RateLimitDecision {
    const now = (this.options.now ?? Date.now)();
    this.checksSinceSweep += 1;
    if (this.checksSinceSweep >= 128) {
      this.checksSinceSweep = 0;
      for (const [stateKey, state] of this.states) {
        if (now - state.windowStart >= this.options.windowMs)
          this.states.delete(stateKey);
      }
    }

    let state = this.states.get(key);
    if (
      state === undefined ||
      now - state.windowStart >= this.options.windowMs
    ) {
      state = { count: 0, windowStart: now };
      this.states.set(key, state);
    }
    if (state.count >= this.options.maxRequests) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.windowStart + this.options.windowMs - now) / 1000),
      );
      return { allowed: false, retryAfterSeconds };
    }
    state.count += 1;
    return { allowed: true };
  }
}

/**
 * Derives the rate limit key from the client source. The TLS-terminating
 * reverse proxy must overwrite client-supplied X-Forwarded-For values; even
 * if sources are spoofed, the global scrypt gate still bounds CPU usage.
 */
export function requestSourceKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstHop = forwarded?.split(",", 1)[0]?.trim();
  if (firstHop !== undefined && firstHop !== "") return firstHop;
  return "unknown";
}

export function createAuthRateLimiter(
  overrides?: Partial<FixedWindowRateLimitOptions>,
): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter({
    maxRequests: positiveIntFromEnvironment("AUTH_RATE_LIMIT_MAX_REQUESTS", 10),
    windowMs: positiveIntFromEnvironment("AUTH_RATE_LIMIT_WINDOW_MS", 60_000),
    ...overrides,
  });
}

const authRateLimiter = createAuthRateLimiter();

/**
 * Applies the shared per-source budget for authentication mutations.
 * Throws a 429 AppError with a Retry-After header once a source exceeds it.
 */
export function enforceAuthRateLimit(
  request: Request,
  limiter: FixedWindowRateLimiter = authRateLimiter,
): void {
  const decision = limiter.check(requestSourceKey(request));
  if (!decision.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many authentication attempts. Please retry later",
      429,
      undefined,
      { "retry-after": String(decision.retryAfterSeconds) },
    );
  }
}
