import "server-only";

import { AppError } from "../api";
import { positiveIntFromEnvironment } from "./concurrency";

export interface FixedWindowRateLimitOptions {
  /** Width of the fixed window in milliseconds. */
  windowMs: number;
  /** Requests allowed per source within one window. */
  maxRequests: number;
  /**
   * Hard cap on simultaneously tracked sources. Once live (non-expired)
   * entries reach this bound, unseen sources are rejected until entries
   * expire. This keeps limiter memory bounded when an attacker rotates
   * source identities faster than windows expire.
   */
  maxTrackedSources: number;
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
      this.sweepExpired(now);
    }

    let state = this.states.get(key);
    if (
      state !== undefined &&
      now - state.windowStart >= this.options.windowMs
    ) {
      state = undefined;
    }

    if (state === undefined) {
      // Only grow the map when a slot is available. Active windows are
      // never evicted early, so an attacker cannot reset another source's
      // budget by flooding identities; saturation fails closed instead.
      if (
        this.states.size >= this.options.maxTrackedSources &&
        !this.sweepExpired(now)
      ) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(this.options.windowMs / 1000),
          ),
        };
      }
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

  /** Removes expired windows; returns whether anything was removed. */
  private sweepExpired(now: number): boolean {
    let removed = false;
    for (const [stateKey, state] of this.states) {
      if (now - state.windowStart >= this.options.windowMs) {
        this.states.delete(stateKey);
        removed = true;
      }
    }
    return removed;
  }
}

/**
 * Derives the rate limit key from the client source. Production traffic is
 * expected to arrive through Cloudflare Tunnel, which overwrites
 * `CF-Connecting-IP`. Direct access to the application port must be blocked
 * at the edge so clients cannot provide this header themselves.
 */
export function requestSourceKey(request: Request): string {
  const cloudflareClientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareClientIp !== undefined && cloudflareClientIp !== "") {
    return cloudflareClientIp;
  }
  return "unknown";
}

export function createAuthRateLimiter(
  overrides?: Partial<FixedWindowRateLimitOptions>,
): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter({
    maxRequests: positiveIntFromEnvironment("AUTH_RATE_LIMIT_MAX_REQUESTS", 10),
    maxTrackedSources: positiveIntFromEnvironment(
      "AUTH_RATE_LIMIT_MAX_TRACKED_SOURCES",
      10_000,
    ),
    windowMs: positiveIntFromEnvironment("AUTH_RATE_LIMIT_WINDOW_MS", 60_000),
    ...overrides,
  });
}

const authRateLimiter = createAuthRateLimiter();

export function createLlmRateLimiter(
  overrides?: Partial<FixedWindowRateLimitOptions>,
): FixedWindowRateLimiter {
  return new FixedWindowRateLimiter({
    maxRequests: positiveIntFromEnvironment("LLM_RATE_LIMIT_MAX_REQUESTS", 10),
    maxTrackedSources: positiveIntFromEnvironment(
      "LLM_RATE_LIMIT_MAX_TRACKED_USERS",
      10_000,
    ),
    windowMs: positiveIntFromEnvironment("LLM_RATE_LIMIT_WINDOW_MS", 60_000),
    ...overrides,
  });
}

const llmRateLimiter = createLlmRateLimiter();

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

/**
 * Applies one shared per-user budget to authenticated operations that can
 * invoke the language model. The in-memory budget is shared by every LLM
 * route in this application process.
 */
export function enforceLlmRateLimit(
  userId: string,
  limiter: FixedWindowRateLimiter = llmRateLimiter,
): void {
  const decision = limiter.check(userId);
  if (!decision.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many language model requests. Please retry later",
      429,
      undefined,
      { "retry-after": String(decision.retryAfterSeconds) },
    );
  }
}
