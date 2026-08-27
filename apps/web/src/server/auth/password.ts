import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

import { AppError } from "../api";
import {
  CapacityExceededError,
  ConcurrencyGate,
  positiveIntFromEnvironment,
} from "./concurrency";

const KEY_LENGTH = 32;
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 256 * 1024 * 1024;
const SCRYPT_MEMORY_MULTIPLIER = 128;

// How long a client told about scrypt saturation should wait before
// retrying. The gate itself already queues for AUTH_SCRYPT_QUEUE_TIMEOUT_MS
// before giving up, so this only adds breathing room on top of that.
const SCRYPT_RETRY_AFTER_SECONDS = 5;

// scrypt is CPU and memory heavy. A global gate keeps a burst of login or
// registration attempts from saturating the process; overflow waits briefly
// and then fails fast.
export const scryptGate = new ConcurrencyGate({
  maxConcurrent: positiveIntFromEnvironment("AUTH_SCRYPT_MAX_CONCURRENT", 4),
  maxQueued: positiveIntFromEnvironment("AUTH_SCRYPT_MAX_QUEUED", 64),
  queueTimeoutMs: positiveIntFromEnvironment(
    "AUTH_SCRYPT_QUEUE_TIMEOUT_MS",
    5_000,
  ),
});

/**
 * Runs an scrypt derivation through the given gate and translates capacity
 * saturation into an explicit overload response. Saturation is deliberate
 * admission control (Issue #18), so callers must observe 429 instead of an
 * unexpected 500.
 */
export async function runWithinScryptCapacity<T>(
  task: () => Promise<T>,
  gate: ConcurrencyGate = scryptGate,
): Promise<T> {
  try {
    return await gate.run(task);
  } catch (error) {
    if (error instanceof CapacityExceededError) {
      throw new AppError(
        "RATE_LIMITED",
        "Authentication service is busy. Please retry shortly",
        429,
        undefined,
        { "retry-after": String(SCRYPT_RETRY_AFTER_SECONDS) },
      );
    }
    throw error;
  }
}

type ScryptParameters = Readonly<{
  cost: number;
  blockSize: number;
  parallelization: number;
}>;

function deriveKey(
  password: string,
  salt: Buffer,
  { blockSize, cost, parallelization }: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

type ParsedPasswordHash = ScryptParameters &
  Readonly<{ salt: Buffer; key: Buffer }>;

function parsePasswordHash(encoded: string): ParsedPasswordHash | undefined {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined;
  const [, cost, blockSize, parallelization, saltValue, keyValue] = parts;
  if (
    cost === undefined ||
    blockSize === undefined ||
    parallelization === undefined ||
    saltValue === undefined ||
    keyValue === undefined
  ) {
    return undefined;
  }
  const parsedCost = Number(cost);
  const parsedBlockSize = Number(blockSize);
  const parsedParallelization = Number(parallelization);
  if (
    !Number.isSafeInteger(parsedCost) ||
    !Number.isSafeInteger(parsedBlockSize) ||
    !Number.isSafeInteger(parsedParallelization)
  ) {
    return undefined;
  }
  if (
    !/^[A-Za-z0-9_-]+$/.test(saltValue) ||
    !/^[A-Za-z0-9_-]+$/.test(keyValue)
  ) {
    return undefined;
  }
  let salt: Buffer;
  let key: Buffer;
  try {
    salt = Buffer.from(saltValue, "base64url");
    key = Buffer.from(keyValue, "base64url");
  } catch {
    return undefined;
  }
  if (salt.length !== 16 || key.length !== KEY_LENGTH) return undefined;
  if (
    parsedCost < 2 ||
    parsedBlockSize < 1 ||
    parsedBlockSize > 64 ||
    parsedParallelization < 1 ||
    parsedParallelization > 8
  ) {
    return undefined;
  }
  if (!Number.isInteger(Math.log2(parsedCost))) {
    return undefined;
  }
  // Node's scrypt maxmem check uses 128 * N * r as the memory estimate.
  const requiredMemory =
    SCRYPT_MEMORY_MULTIPLIER * parsedCost * parsedBlockSize;
  if (!Number.isSafeInteger(requiredMemory) || requiredMemory > MAX_MEMORY) {
    return undefined;
  }
  return {
    blockSize: parsedBlockSize,
    cost: parsedCost,
    key,
    parallelization: parsedParallelization,
    salt,
  };
}

export async function hashPassword(
  password: string,
  gate: ConcurrencyGate = scryptGate,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await runWithinScryptCapacity(
    () =>
      deriveKey(password, salt, {
        blockSize: BLOCK_SIZE,
        cost: COST,
        parallelization: PARALLELIZATION,
      }),
    gate,
  );
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
  gate: ConcurrencyGate = scryptGate,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === undefined) return false;
  const actual = await runWithinScryptCapacity(
    () => deriveKey(password, parsed.salt, parsed),
    gate,
  );
  return timingSafeEqual(actual, parsed.key);
}

export function isLegacyPasswordHash(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  return (
    parsed !== undefined &&
    (parsed.blockSize !== BLOCK_SIZE ||
      parsed.cost !== COST ||
      parsed.parallelization !== PARALLELIZATION)
  );
}
