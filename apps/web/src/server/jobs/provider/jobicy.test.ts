import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobicyProvider, normalizeJobicyJob } from "./jobicy";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(
  fetcher: typeof fetch,
  overrides: Record<string, unknown> = {},
): JobicyProvider {
  return new JobicyProvider(
    {
      timeoutMs: 1000,
      ...overrides,
    },
    fetcher,
  );
}

const context = { userIp: "203.0.113.9", userAgent: "vitest-agent" };

const sampleJob = {
  id: 151837,
  url: "https://jobicy.com/jobs/151837-core-software-engineer-c",
  jobSlug: "151837-core-software-engineer-c",
  jobTitle: "Core Software Engineer (C++)",
  companyName: "Clickhouse",
  companyLogo: "https://jobicy.com/data/logo.png",
  jobIndustry: ["Software Engineering"],
  jobType: ["Full-Time"],
  jobGeo: "UK",
  jobLevel: "Any",
  jobExcerpt: "About ClickHouse ...",
  jobDescription: "<p>About ClickHouse</p><p>We are hiring...</p>",
  pubDate: "2026-08-27T10:58:14+00:00",
};

describe("normalizeJobicyJob", () => {
  it("normalizes a full Jobicy entry onto a domain candidate", () => {
    const candidate = normalizeJobicyJob(sampleJob);
    expect(candidate).toMatchObject({
      title: "Core Software Engineer (C++)",
      company: "Clickhouse",
      location: "UK",
      url: "https://jobicy.com/jobs/151837-core-software-engineer-c",
    });
    expect(candidate?.externalId).toBe("151837");
    expect(candidate?.description).toBe("About ClickHouse We are hiring...");
  });

  it("drops entries without a usable title or URL", () => {
    expect(
      normalizeJobicyJob({ ...sampleJob, jobTitle: "  " }),
    ).toBeUndefined();
    expect(
      normalizeJobicyJob({ ...sampleJob, url: "not-a-url" }),
    ).toBeUndefined();
    expect(normalizeJobicyJob({ companyName: "only" })).toBeUndefined();
  });

  it("treats blank optional fields as absent", () => {
    const candidate = normalizeJobicyJob({
      ...sampleJob,
      companyName: "",
      jobDescription: null,
      jobExcerpt: null,
    });
    expect(candidate).not.toHaveProperty("company");
    expect(candidate).not.toHaveProperty("description");
  });

  it("falls back to excerpt when description is missing", () => {
    const candidate = normalizeJobicyJob({
      ...sampleJob,
      jobDescription: null,
      jobExcerpt: "Short excerpt",
    });
    expect(candidate?.description).toBe("Short excerpt");
  });

  it("normalizes HTML descriptions to plain text", () => {
    expect(
      normalizeJobicyJob({
        ...sampleJob,
        jobDescription:
          '<script>alert("x")</script><a href="https://evil.example">Safe</a><img src="x">',
      })?.description,
    ).toBe("Safe");
  });

  it("uses jobTitle fallback and numeric id as externalId", () => {
    const candidate = normalizeJobicyJob({
      ...sampleJob,
      jobTitle: undefined,
      title: "Fallback Title",
      id: 999,
    });
    expect(candidate?.title).toBe("Fallback Title");
    expect(candidate?.externalId).toBe("999");
  });

  it("handles string id", () => {
    const candidate = normalizeJobicyJob({ ...sampleJob, id: "abc-123" });
    expect(candidate?.externalId).toBe("abc-123");
  });

  it("parses pubDate ISO string", () => {
    const candidate = normalizeJobicyJob(sampleJob);
    expect(candidate?.postedAt).toBe(
      new Date("2026-08-27T10:58:14+00:00").toISOString(),
    );
  });
});

describe("JobicyProvider.search", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends count and tag to the API and normalizes candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jobs: [sampleJob],
        jobCount: 1,
        success: true,
      }),
    );
    const result = await provider(fetcher).search(
      { keywords: "engineer" },
      context,
    );
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v2/remote-jobs");
    expect(parsed.searchParams.get("count")).toBe("20");
    expect(parsed.searchParams.get("tag")).toBe("engineer");
    expect(result.hits).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Core Software Engineer (C++)");
  });

  it("truncates tag longer than 50 chars", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    const long = "a".repeat(60);
    await provider(fetcher).search({ keywords: long }, context);
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.get("tag")?.length).toBe(50);
  });

  it("does not send tag for keywords shorter than 3 chars", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    await provider(fetcher).search({ keywords: "ab" }, context);
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.has("tag")).toBe(false);
  });

  it("handles empty job list", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    const result = await provider(fetcher).search(
      { keywords: "nope" },
      context,
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.hits).toBe(0);
  });

  it("drops malformed entries and keeps valid ones", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jobs: [{ jobTitle: "  " }, sampleJob, { url: "bad" }],
        jobCount: 3,
      }),
    );
    const result = await provider(fetcher).search(
      { keywords: "test" },
      context,
    );
    expect(result.candidates).toHaveLength(1);
  });

  it("enforces response size bound", async () => {
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("x".repeat(4096)));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    await expect(
      provider(oversized, { maxResponseBytes: 1024 }).search({}, context),
    ).rejects.toMatchObject({
      code: "PROVIDER_RESPONSE_TOO_LARGE",
    });
  });

  it("reports timeouts through abort signal", async () => {
    const neverSettles = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new Error("aborted"),
            ),
          );
        }),
    );
    await expect(
      provider(neverSettles).search({}, context),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("wraps network failures", async () => {
    const failing = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection refused"));
    await expect(provider(failing).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_NETWORK",
    });
  });

  it("rejects malformed JSON", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>not json</html>", { status: 200 }),
      );
    await expect(provider(fetcher).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
    });
  });

  it("maps 429 to rate limited", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 429));
    await expect(provider(fetcher).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
  });

  it("handles missing optional fields without failing", async () => {
    const minimalJob = {
      jobTitle: "Minimal Job",
      url: "https://jobicy.com/jobs/minimal/apply",
      id: 999,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [minimalJob], jobCount: 1 }));
    const result = await provider(fetcher).search({}, context);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Minimal Job");
    expect(result.candidates[0]).not.toHaveProperty("company");
  });

  it("is constructible from environment without API key", () => {
    expect(() => JobicyProvider.fromEnvironment()).not.toThrow();
    const instance = JobicyProvider.fromEnvironment();
    expect(instance).toBeInstanceOf(JobicyProvider);
  });

  it("rejects invalid timeout env config", () => {
    vi.stubEnv("JOBICY_TIMEOUT_MS", "10");
    expect(() => JobicyProvider.fromEnvironment()).toThrowError(
      /JOBICY_TIMEOUT_MS/,
    );
  });

  it("respects custom baseUrl from env", async () => {
    vi.stubEnv("JOBICY_BASE_URL", "https://custom.example.test/jobs");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    await JobicyProvider.fromEnvironment(fetcher).search(
      { keywords: "a" },
      context,
    );
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain("custom.example.test");
  });

  it("sends geo for valid location", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    await provider(fetcher).search(
      { keywords: "test", location: "usa" },
      context,
    );
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.get("geo")).toBe("usa");
  });

  it("does not send geo for non-ascii location like Tokyo", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], jobCount: 0 }));
    await provider(fetcher).search(
      { keywords: "test", location: "東京" },
      context,
    );
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.has("geo")).toBe(false);
  });
});
