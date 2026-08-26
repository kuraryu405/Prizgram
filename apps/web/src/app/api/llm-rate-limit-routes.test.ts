import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/server/api";
import {
  createLlmRateLimiter,
  enforceLlmRateLimit,
} from "@/server/auth/rate-limit";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(() => Promise.resolve({ hits: 0, jobs: [], query: {} })),
  enforce: vi.fn<(userId: string) => void>(),
  evaluateJob: vi.fn(() => Promise.resolve({ duplicate: false })),
  generatePersona: vi.fn(() => Promise.resolve({ duplicate: false })),
  importJob: vi.fn(() => Promise.resolve({ duplicate: false })),
  propose: vi.fn(() => Promise.resolve({ proposed: true })),
  reEvaluateAll: vi.fn(() => Promise.resolve({ audit: [], remainingJobs: [] })),
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

vi.mock("@/server/scoring/service", () => ({
  ScoringService: class {
    evaluateJob = mocks.evaluateJob;
  },
}));

vi.mock("@/server/persona/service", async (importOriginal) => ({
  ...(await importOriginal()),
  PersonaService: class {
    generatePersona = mocks.generatePersona;
  },
}));

vi.mock("@/server/persona-update/service", async (importOriginal) => ({
  ...(await importOriginal()),
  PersonaUpdateService: class {
    propose = mocks.propose;
    reEvaluateAll = mocks.reEvaluateAll;
  },
}));

vi.mock("@/server/jobs/discovery", async (importOriginal) => ({
  ...(await importOriginal()),
  DiscoveryService: class {
    discover = mocks.discover;
  },
}));

import { POST as importJobPost } from "./jobs/route";
import { POST as discoverPost } from "./jobs/discover/route";
import { POST as scorePost } from "./jobs/[id]/score/route";
import { POST as generatePersonaPost } from "./persona/generate/route";
import { POST as proposePost } from "./persona/update/propose/route";
import { POST as reEvaluatePost } from "./persona/update/re-evaluate/route";

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`https://prizgram.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://prizgram.test",
    },
    body: JSON.stringify(body),
  });
}

const operations = [
  {
    invoke: () =>
      importJobPost(
        jsonRequest("/api/jobs", {
          body: "A sufficiently detailed job posting body for route testing.",
        }),
      ),
    name: "job import",
    service: mocks.importJob,
  },
  {
    invoke: () =>
      scorePost(
        new Request("https://prizgram.test/api/jobs/job-1/score", {
          method: "POST",
          headers: { origin: "https://prizgram.test" },
        }),
        { params: Promise.resolve({ id: "job-1" }) },
      ),
    name: "job scoring",
    service: mocks.evaluateJob,
  },
  {
    invoke: () =>
      generatePersonaPost(
        jsonRequest("/api/persona/generate", { intakeId: "intake-1" }),
      ),
    name: "persona generation",
    service: mocks.generatePersona,
  },
  {
    invoke: () =>
      proposePost(
        jsonRequest("/api/persona/update/propose", {
          reflection: "面接結果を踏まえた十分な振り返りです。",
        }),
      ),
    name: "persona update proposal",
    service: mocks.propose,
  },
  {
    invoke: () => discoverPost(jsonRequest("/api/jobs/discover", {})),
    name: "job discovery",
    service: mocks.discover,
  },
  {
    invoke: () =>
      reEvaluatePost(
        jsonRequest("/api/persona/update/re-evaluate", {
          personaVersionId: "persona-1",
        }),
      ),
    name: "bulk re-evaluation",
    service: mocks.reEvaluateAll,
  },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enforce.mockImplementation(() => undefined);
});

describe("LLM route rate limiting", () => {
  it.each(operations)(
    "stops $name before its service when the budget is exhausted",
    async ({ invoke, service }) => {
      mocks.enforce.mockImplementation(() => {
        throw new AppError(
          "RATE_LIMITED",
          "Too many language model requests. Please retry later",
          429,
          undefined,
          { "retry-after": "60" },
        );
      });

      const response = await invoke();

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(mocks.enforce).toHaveBeenCalledWith("user-1");
      expect(service).not.toHaveBeenCalled();
    },
  );

  it("shares one user's budget across different LLM routes", async () => {
    const limiter = createLlmRateLimiter({
      maxRequests: 2,
      maxTrackedSources: 10,
      now: () => 0,
      windowMs: 60_000,
    });
    mocks.enforce.mockImplementation((userId) =>
      enforceLlmRateLimit(userId, limiter),
    );

    expect((await operations[0].invoke()).status).toBe(201);
    expect((await operations[2].invoke()).status).toBe(201);
    expect((await operations[4].invoke()).status).toBe(429);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("does not consume the budget when request validation fails", async () => {
    const response = await importJobPost(
      jsonRequest("/api/jobs", { body: "too short" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(mocks.importJob).not.toHaveBeenCalled();
  });
});
