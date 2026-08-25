import { randomBytes, scrypt, type ScryptOptions } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ConcurrencyGate } from "./concurrency";
import {
  hashPassword,
  isLegacyPasswordHash,
  runWithinScryptCapacity,
  verifyPassword,
} from "./password";

function deriveLegacyKey(
  password: string,
  salt: Buffer,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function legacyPasswordHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveLegacyKey(password, salt, {
    N: 16_384,
    maxmem: 64 * 1024 * 1024,
    p: 1,
    r: 8,
  });
  return [
    "scrypt",
    "16384",
    "8",
    "1",
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

describe("password hashing", () => {
  it("hashes with a random salt and verifies in constant-length form", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");
    expect(first).not.toBe(second);
    await expect(
      verifyPassword("correct horse battery staple", first),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", first)).resolves.toBe(false);
  });

  it("uses the OWASP-recommended scrypt cost", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded.split("$")[1]).toBe("131072");
    expect(encoded.length).toBeLessThanOrEqual(200);
  });

  it("verifies hashes stored with legacy parameters and flags them for upgrade", async () => {
    const legacy = await legacyPasswordHash("legacy stored password");
    await expect(
      verifyPassword("legacy stored password", legacy),
    ).resolves.toBe(true);
    await expect(verifyPassword("wrong password", legacy)).resolves.toBe(false);
    expect(isLegacyPasswordHash(legacy)).toBe(true);
    const current = await hashPassword("legacy stored password");
    expect(isLegacyPasswordHash(current)).toBe(false);
  });

  it("rejects hashes whose claimed parameters exceed the memory bound", async () => {
    const inflated = [
      "scrypt",
      "268435456",
      "8",
      "1",
      randomBytes(16).toString("base64url"),
      randomBytes(32).toString("base64url"),
    ].join("$");
    await expect(verifyPassword("anything", inflated)).resolves.toBe(false);
  });

  it("rejects malformed hashes", async () => {
    await expect(verifyPassword("password", "not-a-hash")).resolves.toBe(false);
    await expect(
      verifyPassword("password", "scrypt$16384$8$1$only-five-parts"),
    ).resolves.toBe(false);
  });

  it("answers queue saturation with a 429 rate limit error, not a crash", async () => {
    const saturatedGate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 0,
      queueTimeoutMs: 5_000,
    });
    let releaseSlot!: () => void;
    void new Promise<void>((resolve) => {
      releaseSlot = resolve;
    });
    const held = hashPassword("holder", saturatedGate);

    await expect(hashPassword("overflow", saturatedGate)).rejects.toMatchObject(
      {
        name: "AppError",
        code: "RATE_LIMITED",
        status: 429,
        headers: { "retry-after": "5" },
      },
    );
    // A shape-valid encoded hash reaches the gated derivation and must hit
    // the same explicit overload response instead of returning early.
    const shapeValidEncoded = [
      "scrypt",
      "16384",
      "8",
      "1",
      Buffer.alloc(16).toString("base64url"),
      Buffer.alloc(32).toString("base64url"),
    ].join("$");
    await expect(
      verifyPassword("anything", shapeValidEncoded, saturatedGate),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });

    releaseSlot();
    await held;
  });

  it("answers queue timeout with the same explicit overload response", async () => {
    const slowGate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 2,
      queueTimeoutMs: 30,
    });
    let releaseSlot!: () => void;
    const blocker = new Promise<void>((resolve) => {
      releaseSlot = resolve;
    });
    // A raw gate occupant keeps the slot for exactly as long as the test
    // decides; a real scrypt hash may finish before the queued timer does.
    const held = slowGate.run(() => blocker).catch(() => undefined);

    await expect(hashPassword("waiter", slowGate)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });

    releaseSlot();
    await held;
  });

  it("propagates non-capacity failures unchanged", async () => {
    const gate = new ConcurrencyGate({
      maxConcurrent: 1,
      maxQueued: 1,
      queueTimeoutMs: 5_000,
    });
    const injected = new Error("crypto backend exploded");
    await expect(
      runWithinScryptCapacity(() => Promise.reject(injected), gate),
    ).rejects.toBe(injected);
  });
});
