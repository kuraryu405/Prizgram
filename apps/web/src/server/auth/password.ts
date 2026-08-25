import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;
const COST = 131_072;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_MEMORY = 256 * 1024 * 1024;

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
    !Number.isInteger(parsedCost) ||
    !Number.isInteger(parsedBlockSize) ||
    !Number.isInteger(parsedParallelization)
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
  return {
    blockSize: parsedBlockSize,
    cost: parsedCost,
    key,
    parallelization: parsedParallelization,
    salt,
  };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, {
    blockSize: BLOCK_SIZE,
    cost: COST,
    parallelization: PARALLELIZATION,
  });
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
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (parsed === undefined) return false;
  let actual: Buffer;
  try {
    actual = await deriveKey(password, parsed.salt, parsed);
  } catch {
    return false;
  }
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
