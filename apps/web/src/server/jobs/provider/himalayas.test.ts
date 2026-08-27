import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HimalayasProvider, normalizeHimalayasJob } from "./himalayas";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(
  fetcher: typeof fetch,
  overrides: Record<string, unknown> = {},
): HimalayasProvider {
  return new HimalayasProvider(
    {
      timeoutMs: 1000,
      ...overrides,
    },
    fetcher,
  );
}

const context = { userIp: "203.0.113.9", userAgent: "vitest-agent" };

const sampleJob = {
  title: "Senior Frontend Engineer",
  excerpt: "We are looking for a senior frontend...",
  companyName: "Himalayas Inc",
  companySlug: "himalayas",
  companyLogo: "https://logo.example/himalayas.png",
  employmentType: "Full Time",
  minSalary: 80000,
  maxSalary: 120000,
  salaryPeriod: "annual",
  currency: "USD",
  seniority: ["Senior"],
  locationRestrictions: ["United States"],
  timezoneRestrictions: [-5],
  categories: ["Frontend"],
  parentCategories: ["Developer"],
  description: "<p>Build <strong>modern</strong> web apps with React.</p>",
  pubDate: 1731600000, // seconds
  expiryDate: 1734200000,
  applicationLink:
    "https://himalayas.app/jobs/senior-frontend-engineer-xyz/apply",
  guid: "himalayas-guid-123",
};

describe("normalizeHimalayasJob", () => {
  it("normalizes a full Himalayas entry onto a domain candidate", () => {
    const candidate = normalizeHimalayasJob(sampleJob);
    expect(candidate).toMatchObject({
      title: "Senior Frontend Engineer",
      company: "Himalayas Inc",
      location: "United States",
      url: "https://himalayas.app/jobs/senior-frontend-engineer-xyz/apply",
    });
    expect(candidate?.externalId).toBe("himalayas-guid-123");
    expect(candidate?.description).toBe("Build modern web apps with React.");
    expect(candidate?.salaryText).toBe("USD 80,000 - USD 120,000 per annual");
    expect(candidate?.postedAt).toBe(new Date(1731600000 * 1000).toISOString());
  });

  it("drops entries without a usable title or URL", () => {
    expect(
      normalizeHimalayasJob({ ...sampleJob, title: "  " }),
    ).toBeUndefined();
    expect(
      normalizeHimalayasJob({ ...sampleJob, applicationLink: "not-a-url" }),
    ).toBeUndefined();
    expect(normalizeHimalayasJob({ companyName: "only" })).toBeUndefined();
  });

  it("treats blank optional fields and unparseable dates as absent", () => {
    const candidate = normalizeHimalayasJob({
      ...sampleJob,
      companyName: "",
      pubDate: null,
      description: null,
      excerpt: null,
    });
    expect(candidate).not.toHaveProperty("company");
    expect(candidate).not.toHaveProperty("description");
    expect(candidate).not.toHaveProperty("postedAt");
  });

  it("falls back to excerpt when description is missing", () => {
    const candidate = normalizeHimalayasJob({
      ...sampleJob,
      description: null,
      excerpt: "Short excerpt text",
    });
    expect(candidate?.description).toBe("Short excerpt text");
  });

  it("normalizes HTML descriptions to plain text", () => {
    expect(
      normalizeHimalayasJob({
        ...sampleJob,
        description:
          '<script>alert("x")</script><a href="https://evil.example">Safe</a><img src="x">',
      })?.description,
    ).toBe("Safe");
  });

  it.each([1731600000, 1731600000000])(
    "parses pubDate seconds or milliseconds",
    (pubDate) => {
      const candidate = normalizeHimalayasJob({ ...sampleJob, pubDate });
      expect(candidate?.postedAt).toBeDefined();
      // Both should produce same iso date truncated to seconds equality
      const iso = candidate?.postedAt as string;
      expect(new Date(iso).getTime()).toBeGreaterThan(0);
    },
  );

  it("uses guid as externalId and preserves source URL", () => {
    const candidate = normalizeHimalayasJob(sampleJob);
    expect(candidate?.externalId).toBe("himalayas-guid-123");
    expect(candidate?.url).toBe(
      "https://himalayas.app/jobs/senior-frontend-engineer-xyz/apply",
    );
  });

  it("joins multiple locationRestrictions", () => {
    const candidate = normalizeHimalayasJob({
      ...sampleJob,
      locationRestrictions: ["United States", "Canada"],
    });
    expect(candidate?.location).toBe("United States, Canada");
  });
});

describe("HimalayasProvider.search", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends query params to the search endpoint and normalizes candidates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        jobs: [sampleJob],
        totalCount: 1,
      }),
    );
    const result = await provider(fetcher).search(
      {
        keywords: "frontend",
        location: "Japan",
        contractType: "p",
        workHours: "f",
      },
      context,
    );
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/jobs/api/search");
    expect(parsed.searchParams.get("q")).toBe("frontend");
    expect(parsed.searchParams.get("country")).toBe("Japan");
    expect(parsed.searchParams.get("employment_type")).toBe("Full Time");
    expect(parsed.searchParams.get("page")).toBe("1");
    expect(result.hits).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Senior Frontend Engineer");
  });

  it("uses browse endpoint when no search filters are present", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], totalCount: 0 }));
    await provider(fetcher).search({}, context);
    const [url] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/jobs/api");
    expect(parsed.searchParams.get("limit")).toBe("20");
  });

  it("handles empty job list", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], totalCount: 0 }));
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
        jobs: [{ title: "  " }, sampleJob, { url: "bad" }],
        totalCount: 3,
      }),
    );
    const result = await provider(fetcher).search(
      { keywords: "test" },
      context,
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Senior Frontend Engineer");
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

  it("maps 400 to invalid response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 400));
    await expect(provider(fetcher).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
    });
  });

  it("handles missing optional fields without failing", async () => {
    const minimalJob = {
      title: "Minimal Job",
      applicationLink: "https://himalayas.app/jobs/minimal/apply",
      guid: "guid-minimal",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [minimalJob], totalCount: 1 }));
    const result = await provider(fetcher).search({}, context);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Minimal Job");
    expect(result.candidates[0]).not.toHaveProperty("company");
    expect(result.candidates[0]).not.toHaveProperty("description");
  });

  it("is constructible from environment without API key", () => {
    // Himalayas requires no API key; fromEnvironment should succeed even with empty env
    vi.stubEnv("CAREERJET_API_KEY", "");
    expect(() => HimalayasProvider.fromEnvironment()).not.toThrow();
    const instance = HimalayasProvider.fromEnvironment();
    expect(instance).toBeInstanceOf(HimalayasProvider);
  });

  it("rejects invalid timeout env config", () => {
    vi.stubEnv("HIMALAYAS_TIMEOUT_MS", "10");
    expect(() => HimalayasProvider.fromEnvironment()).toThrowError(
      /HIMALAYAS_TIMEOUT_MS/,
    );
  });

  it("respects custom baseUrl from env", async () => {
    vi.stubEnv("HIMALAYAS_BASE_URL", "https://custom.example.test/jobs/api");
    vi.stubEnv(
      "HIMALAYAS_SEARCH_BASE_URL",
      "https://custom.example.test/jobs/api/search",
    );
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], totalCount: 0 }));
    await HimalayasProvider.fromEnvironment(fetcher).search(
      { keywords: "a" },
      context,
    );
    const [url] = fetcher.mock.calls[0] as unknown as [string];
    expect(url).toContain("custom.example.test");
  });

  it("maps internship contractType to Intern employment_type", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ jobs: [], totalCount: 0 }));
    await provider(fetcher).search(
      { keywords: "intern", contractType: "i" },
      context,
    );
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.get("employment_type")).toBe("Intern");
  });
});
