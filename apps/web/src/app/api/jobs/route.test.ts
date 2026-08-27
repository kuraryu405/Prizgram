import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  JOB_IMPORT_MAX_BODY_CHARS,
  JOB_IMPORT_MAX_REQUEST_BYTES,
} from "@/server/jobs/request-limits";

const mocks = vi.hoisted(() => ({
  enforce: vi.fn<(userId: string) => void>(),
  importJob: vi.fn(() => Promise.resolve({ duplicate: false })),
  requireUser: vi.fn(() => ({ id: "user-1", loginId: "route.user" })),
}));

vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal()),
  enforceLlmRateLimit: mocks.enforce,
  requireSessionUser: mocks.requireUser,
}));

vi.mock("@/server/database", () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock("@/server/jobs/service", async (importOriginal) => ({
  ...(await importOriginal()),
  JobService: class {
    importJob = mocks.importJob;
  },
}));

import { POST } from "./route";

function jobImportRequest(body: string): Request {
  return new Request("https://prizgram.test/api/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://prizgram.test",
    },
    body: JSON.stringify({ body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforce.mockImplementation(() => undefined);
});

describe("POST /api/jobs request limits", () => {
  it("accepts a maximum-length Japanese posting within the byte budget", async () => {
    const body = "募".repeat(JOB_IMPORT_MAX_BODY_CHARS);
    const encodedBytes = new TextEncoder().encode(
      JSON.stringify({ body }),
    ).byteLength;

    expect(encodedBytes).toBeGreaterThan(JOB_IMPORT_MAX_BODY_CHARS);
    expect(encodedBytes).toBeLessThanOrEqual(JOB_IMPORT_MAX_REQUEST_BYTES);

    const response = await POST(jobImportRequest(body));

    expect(response.status).toBe(201);
    expect(mocks.importJob).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      { body },
    );
  });

  it("rejects an oversized JSON request with 413 before service execution", async () => {
    const response = await POST(
      jobImportRequest("a".repeat(JOB_IMPORT_MAX_REQUEST_BYTES)),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
      ok: false,
    });
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(mocks.importJob).not.toHaveBeenCalled();
  });

  it("keeps schema violations on the validation error contract", async () => {
    const response = await POST(
      jobImportRequest("a".repeat(JOB_IMPORT_MAX_BODY_CHARS + 1)),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
      ok: false,
    });
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(mocks.importJob).not.toHaveBeenCalled();
  });
});
