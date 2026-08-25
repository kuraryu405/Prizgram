import "server-only";

export class CapacityExceededError extends Error {
  override readonly name = "CapacityExceededError";

  constructor(message = "Too many concurrent operations") {
    super(message);
  }
}

export interface ConcurrencyGateOptions {
  /** Maximum number of tasks executing at the same time. */
  maxConcurrent: number;
  /** Maximum number of tasks waiting for a slot at the same time. */
  maxQueued: number;
  /** How long a queued task may wait before being rejected. */
  queueTimeoutMs: number;
}

interface QueuedEntry {
  resume: () => void;
}

/**
 * Bounds how many expensive operations run at the same time. Excess work is
 * queued up to a bounded depth; beyond that, callers are rejected
 * immediately so saturation turns into fast failures instead of unbounded
 * resource usage.
 */
export class ConcurrencyGate {
  private activeCount = 0;
  private readonly queue: QueuedEntry[] = [];

  constructor(private readonly options: ConcurrencyGateOptions) {}

  get active(): number {
    return this.activeCount;
  }

  get queued(): number {
    return this.queue.length;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount < this.options.maxConcurrent) {
      return this.execute(task);
    }
    if (this.queue.length >= this.options.maxQueued) {
      return Promise.reject(new CapacityExceededError());
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new CapacityExceededError("Timed out waiting for capacity"));
      }, this.options.queueTimeoutMs);
      timer.unref?.();
      const entry: QueuedEntry = {
        resume: () => {
          clearTimeout(timer);
          void this.execute(task).then(resolve, reject);
        },
      };
      this.queue.push(entry);
    });
  }

  private async execute<T>(task: () => Promise<T>): Promise<T> {
    // The synchronous prefix of this async function claims the slot before
    // any caller can observe the gate state again.
    this.activeCount += 1;
    try {
      return await task();
    } finally {
      this.activeCount -= 1;
      const next = this.queue.shift();
      if (next !== undefined) next.resume();
    }
  }
}

/** Reads a positive integer override from the environment. */
export function positiveIntFromEnvironment(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
