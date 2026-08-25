import { describe, expect, it } from "vitest";

import { AppError } from "../api";
import {
  createAuthRateLimiter,
  enforceAuthRateLimit,
  FixedWindowRateLimiter,
  requestSourceKey,
} from "./rate-limit";

function fakeClock(start = 0): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let current = start;
  return {
    advance: (ms) => {
      current += ms;
    },
    now: () => current,
  };
}

describe("FixedWindowRateLimiter", () => {
  it("allows up to the configured requests per source and window", () => {
    const clock = fakeClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 3,
      now: clock.now,
      windowMs: 60_000,
    });

    expect(limiter.check("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.check("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.check("203.0.113.7")).toEqual({ allowed: true });
    expect(limiter.check("203.0.113.7")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("reports the remaining seconds until the window resets", () => {
    const clock = fakeClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      now: clock.now,
      windowMs: 60_000,
    });

    expect(limiter.check("source-a")).toEqual({ allowed: true });
    clock.advance(45_000);
    expect(limiter.check("source-a")).toEqual({
      allowed: false,
      retryAfterSeconds: 15,
    });
    clock.advance(15_000);
    expect(limiter.check("source-a")).toEqual({ allowed: true });
  });

  it("isolates sources from each other", () => {
    const clock = fakeClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      now: clock.now,
      windowMs: 60_000,
    });

    expect(limiter.check("source-a")).toEqual({ allowed: true });
    expect(limiter.check("source-b")).toEqual({ allowed: true });
    expect(limiter.check("source-a")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("keeps the state map bounded across many windows", () => {
    const clock = fakeClock();
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 1,
      now: clock.now,
      windowMs: 1_000,
    });

    for (let round = 0; round < 200; round += 1) {
      for (let key = 0; key < 50; key += 1) limiter.check(`ip-${key}`);
      clock.advance(1_001);
    }
    // Expired windows are swept, so the map must stay far below the total
    // number of distinct sources ever seen.
    expect(limiter.trackedSourceCount).toBeLessThanOrEqual(128);
  });
});

describe("requestSourceKey", () => {
  it("uses the first forwarded hop when present", () => {
    const request = new Request("https://prizgram.test", {
      headers: { "x-forwarded-for": "203.0.113.7 , 70.41.3.18" },
    });
    expect(requestSourceKey(request)).toBe("203.0.113.7");
  });

  it("falls back to a shared bucket without proxy headers", () => {
    expect(requestSourceKey(new Request("https://prizgram.test"))).toBe(
      "unknown",
    );
  });
});

describe("enforceAuthRateLimit", () => {
  it("throws a 429 AppError with Retry-After once the budget is spent", () => {
    const limiter = createAuthRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    const request = (forwardedFor?: string) =>
      new Request("https://prizgram.test/api/auth/login", {
        method: "POST",
        headers:
          forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
      });

    expect(() =>
      enforceAuthRateLimit(request("198.51.100.9"), limiter),
    ).not.toThrow();

    let caught: unknown;
    try {
      enforceAuthRateLimit(request("198.51.100.9"), limiter);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const appError = caught as AppError;
    expect(appError.code).toBe("RATE_LIMITED");
    expect(appError.status).toBe(429);
    expect(appError.headers).toEqual({ "retry-after": "60" });

    // Another source still has its own budget.
    expect(() =>
      enforceAuthRateLimit(request("198.51.100.10"), limiter),
    ).not.toThrow();
  });
});
