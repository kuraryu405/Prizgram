import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  enforce: vi.fn<(userId: string) => void>(),
  discover: vi.fn(() =>
    Promise.resolve({
      query: { keywords: "k" },
      promptVersion: "test",
      hits: 0,
      jobs: [],
    }),
  ),
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

vi.mock("@/server/jobs/discovery", () => ({
  jobDiscoveryRequestSchema: z
    .object({
      keywords: z.string().trim().min(1).max(200).optional(),
      location: z.string().trim().min(1).max(200).optional(),
      employmentType: z.string().optional(),
    })
    .strict(),
  DiscoveryService: class {
    discover = mocks.discover;
  },
}));

import { POST } from "./route";

function discoveryRequest(body: unknown): Request {
  return new Request("https://prizgram.test/api/jobs/discover", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://prizgram.test",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforce.mockImplementation(() => undefined);
});

describe("POST /api/jobs/discover", () => {
  it("does not consume the LLM rate limit for manual searches", async () => {
    const response = await POST(
      discoveryRequest({ keywords: "TypeScript", location: "東京" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      { keywords: "TypeScript", location: "東京" },
      expect.any(Object),
    );
  });

  it("keeps the LLM rate limit for persona-assisted searches", async () => {
    const response = await POST(discoveryRequest({}));

    expect(response.status).toBe(200);
    expect(mocks.enforce).toHaveBeenCalledWith("user-1");
  });
});
