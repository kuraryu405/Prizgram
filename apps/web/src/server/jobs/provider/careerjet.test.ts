import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CareerjetProvider,
  JobSearchProviderError,
  careerjetExternalId,
  normalizeCareerjetJob,
} from "./careerjet";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function provider(
  fetcher: typeof fetch,
  overrides: Record<string, unknown> = {},
): CareerjetProvider {
  return new CareerjetProvider(
    {
      apiKey: "secret-key",
      localeCode: "ja_JP",
      siteUrl: "https://prizgram.example.test",
      timeoutMs: 1000,
      ...overrides,
    },
    fetcher,
  );
}

const context = { userIp: "203.0.113.9", userAgent: "vitest-agent" };

const sampleJob = {
  title: "フロントエンドエンジニア",
  company: "株式会社サンプル",
  date: "Wed,15 Nov 2025 19:13:43 GMT",
  description: "ReactとTypeScriptでの開発を担当します。",
  locations: "東京都",
  salary: "年収 400〜600万円",
  url: "https://jobviewtrack.example.test/v2/abc",
};

describe("normalizeCareerjetJob", () => {
  it("normalizes a full provider entry onto a domain candidate", () => {
    const candidate = normalizeCareerjetJob(sampleJob);
    expect(candidate).toMatchObject({
      title: "フロントエンドエンジニア",
      company: "株式会社サンプル",
      location: "東京都",
      salaryText: "年収 400〜600万円",
      postedAt: new Date("Wed,15 Nov 2025 19:13:43 GMT").toISOString(),
    });
    expect(candidate?.externalId).toBe(
      careerjetExternalId("https://jobviewtrack.example.test/v2/abc"),
    );
  });

  it("drops entries without a usable title or URL instead of failing the page", () => {
    expect(
      normalizeCareerjetJob({ ...sampleJob, title: "  " }),
    ).toBeUndefined();
    expect(
      normalizeCareerjetJob({ ...sampleJob, url: "not-a-url" }),
    ).toBeUndefined();
    expect(normalizeCareerjetJob({ company: "only" })).toBeUndefined();
  });

  it("treats blank optional fields and unparseable dates as absent", () => {
    const candidate = normalizeCareerjetJob({
      ...sampleJob,
      company: "",
      date: "not-a-date",
      description: null,
    });
    expect(candidate).not.toHaveProperty("company");
    expect(candidate).not.toHaveProperty("description");
    expect(candidate).not.toHaveProperty("postedAt");
  });

  it.each([
    [
      "エンジニアのキャリアを<b>デザイン</b>する",
      "エンジニアのキャリアをデザインする",
    ],
    ["<B>強調</B>", "強調"],
    ["<b>一</b><b>二</b>", "一二"],
    ["前  <b>強調</b>  後", "前 強調 後"],
  ])("removes bold tags from descriptions", (description, expected) => {
    expect(
      normalizeCareerjetJob({ ...sampleJob, description })?.description,
    ).toBe(expected);
  });

  it.each(["タグのない説明文", "  前後の空白のみ除去  "])(
    "preserves the existing plain-text normalization",
    (description) => {
      expect(
        normalizeCareerjetJob({ ...sampleJob, description })?.description,
      ).toBe(description.trim());
    },
  );

  it.each([null, "", "   "])(
    "keeps blank descriptions absent",
    (description) => {
      expect(
        normalizeCareerjetJob({ ...sampleJob, description }),
      ).not.toHaveProperty("description");
    },
  );

  it("produces a stable external id per posting URL", () => {
    expect(careerjetExternalId("https://a.example/1")).toBe(
      careerjetExternalId("https://a.example/1"),
    );
    expect(careerjetExternalId("https://a.example/1")).not.toBe(
      careerjetExternalId("https://a.example/2"),
    );
  });
});

describe("CareerjetProvider.search", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends basic auth, locale, filters, and caller context as query parameters", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: "JOBS",
        hits: 1,
        pages: 1,
        jobs: [sampleJob],
      }),
    );
    const result = await provider(fetcher).search(
      {
        keywords: "フロントエンド エンジニア",
        location: "東京",
        contractType: "i",
        workHours: "f",
      },
      context,
    );

    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://search.api.careerjet.net/v4/query",
    );
    expect(parsed.searchParams.get("locale_code")).toBe("ja_JP");
    expect(parsed.searchParams.get("keywords")).toBe(
      "フロントエンド エンジニア",
    );
    expect(parsed.searchParams.get("location")).toBe("東京");
    expect(parsed.searchParams.get("contract_type")).toBe("i");
    expect(parsed.searchParams.get("work_hours")).toBe("f");
    expect(parsed.searchParams.get("user_ip")).toBe("203.0.113.9");
    expect(parsed.searchParams.get("user_agent")).toBe("vitest-agent");
    // Basic auth: API key as username, empty password.
    expect(init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from("secret-key:").toString("base64")}`,
      referer: "https://prizgram.example.test",
    });

    expect(result.hits).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("フロントエンドエンジニア");
  });

  it("omits unset filters from the request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type: "JOBS", hits: 0, jobs: [] }));
    await provider(fetcher).search({}, context);
    const parsed = new URL(fetcher.mock.calls[0]?.[0] as string);
    expect(parsed.searchParams.has("keywords")).toBe(false);
    expect(parsed.searchParams.has("location")).toBe(false);
    expect(parsed.searchParams.has("contract_type")).toBe(false);
    expect(parsed.searchParams.has("work_hours")).toBe(false);
  });

  it("maps a LOCATIONS envelope to a typed location error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        type: "LOCATIONS",
        locations: [],
        message: "no matching location found for 存在しない場所",
      }),
    );
    const caught: unknown = await provider(fetcher)
      .search({ location: "存在しない場所" }, context)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    if (!(caught instanceof JobSearchProviderError)) {
      throw new Error("expected JobSearchProviderError");
    }
    expect(caught.code).toBe("PROVIDER_LOCATION_UNRESOLVED");
    expect(caught.retryable).toBe(false);
    // The message must stay a developer-defined constant: instances of this
    // class are logged verbatim as cause chains, so upstream response text
    // (which may echo query data) must never be embedded (#92).
    expect(caught.message).toBe(
      "The provider could not resolve the requested location",
    );
    expect(caught.message).not.toContain("存在しない場所");
  });

  it("classifies rate limiting as retryable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: "slow down" }, 429));
    await expect(provider(fetcher).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
    });
  });

  it("marks client errors non-retryable and server errors retryable", async () => {
    const badKey = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 403));
    await expect(provider(badKey).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      retryable: false,
    });
    const outage = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 503));
    await expect(provider(outage).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
      retryable: true,
    });
  });

  it("reports timeouts through the abort signal", async () => {
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

  it("wraps network failures in a retryable provider error", async () => {
    const failing = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection refused"));
    await expect(provider(failing).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_NETWORK",
      retryable: true,
    });
  });

  it("rejects malformed JSON payloads", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>not json</html>", { status: 200 }),
      );
    await expect(provider(fetcher).search({}, context)).rejects.toMatchObject({
      code: "PROVIDER_INVALID_RESPONSE",
    });
  });

  it("enforces the response size bound", async () => {
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
    ).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_TOO_LARGE" });
  });

  it("requires an API key before any network call is attempted", () => {
    vi.stubEnv("CAREERJET_API_KEY", "");
    expect(() => CareerjetProvider.fromEnvironment()).toThrowError(
      JobSearchProviderError,
    );
  });

  it("requires a site origin for the Referer header", () => {
    vi.stubEnv("CAREERJET_API_KEY", "env-key");
    vi.stubEnv("APP_ORIGIN", "");
    vi.stubEnv("CAREERJET_SITE_URL", "");
    expect(() => CareerjetProvider.fromEnvironment()).toThrowError(
      /CAREERJET_SITE_URL or APP_ORIGIN/,
    );
  });

  it("falls back to APP_ORIGIN for the site origin", () => {
    vi.stubEnv("CAREERJET_API_KEY", "env-key");
    vi.stubEnv("APP_ORIGIN", "https://prizgram.example.test");
    const instance = CareerjetProvider.fromEnvironment();
    expect(instance).toBeInstanceOf(CareerjetProvider);
  });

  it("prefers CAREERJET_SITE_URL over APP_ORIGIN and sends it as Referer", async () => {
    vi.stubEnv("CAREERJET_API_KEY", "env-key");
    vi.stubEnv("APP_ORIGIN", "https://stale.example.test");
    vi.stubEnv("CAREERJET_SITE_URL", "https://prizgram.example.test");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ type: "JOBS", hits: 0, jobs: [] }));
    await CareerjetProvider.fromEnvironment(fetcher).search({}, context);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      referer: "https://prizgram.example.test",
    });
  });

  it("builds itself from environment configuration", () => {
    vi.stubEnv("CAREERJET_API_KEY", "env-key");
    vi.stubEnv("APP_ORIGIN", "https://prizgram.example.test");
    vi.stubEnv("CAREERJET_LOCALE_CODE", "ja_JP");
    vi.stubEnv("CAREERJET_TIMEOUT_MS", "5000");
    const instance = CareerjetProvider.fromEnvironment();
    expect(instance).toBeInstanceOf(CareerjetProvider);
  });

  it("rejects out-of-range timeout configuration", () => {
    vi.stubEnv("CAREERJET_API_KEY", "env-key");
    vi.stubEnv("APP_ORIGIN", "https://prizgram.example.test");
    vi.stubEnv("CAREERJET_TIMEOUT_MS", "10");
    expect(() => CareerjetProvider.fromEnvironment()).toThrowError(
      /CAREERJET_TIMEOUT_MS/,
    );
  });
});
