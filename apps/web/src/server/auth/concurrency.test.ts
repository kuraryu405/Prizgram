import { describe, expect, it } from "vitest";

import { CapacityExceededError, ConcurrencyGate } from "./concurrency";

describe("ConcurrencyGate", () => {
  it("never exceeds the concurrent limit while queuing overflow", async () => {
    const gate = new ConcurrencyGate({
      maxConcurrent: 2,
      maxQueued: 10,
      queueTimeoutMs: 5_000,
    });
    let running = 0;
    let peak = 0;
    const task = () => (): Promise<void> =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        setImmediate(() => {
          running -= 1;
          resolve();
        });
      });

    await Promise.all(Array.from({ length: 9 }, () => gate.run(task())));
    expect(peak).toBeLessThanOrEqual(2);
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("rejects immediately once the queue is full", async () => {
    const gate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 1,
      queueTimeoutMs: 5_000,
    });
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const held = gate.run(() => blocker);
    const queuedFirst = gate.run(() => Promise.resolve("first"));
    await expect(
      gate.run(() => Promise.resolve("overflow")),
    ).rejects.toBeInstanceOf(CapacityExceededError);

    releaseBlocker();
    await held;
    await expect(queuedFirst).resolves.toBe("first");
    expect(gate.active).toBe(0);
  });

  it("rejects queued work that waits longer than the timeout", async () => {
    const gate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 2,
      queueTimeoutMs: 40,
    });
    let releaseBlocker!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const held = gate.run(() => blocker);
    const first = gate.run(() => Promise.resolve("first"));
    const second = gate.run(() => Promise.resolve("second"));
    await expect(first).rejects.toBeInstanceOf(CapacityExceededError);
    await expect(second).rejects.toBeInstanceOf(CapacityExceededError);

    releaseBlocker();
    await held;
    expect(gate.active).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it("propagates task failures without stalling the queue", async () => {
    const gate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 2,
      queueTimeoutMs: 5_000,
    });

    await expect(
      gate.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(
      gate.run(() => Promise.resolve("after failure")),
    ).resolves.toBe("after failure");
  });
});
