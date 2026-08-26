import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

export const CAREERJET_PROVIDER_NAME = "Careerjet";
/** Careerjet is an external-use-licensed search API, not an official board. */
export const CAREERJET_SOURCE_KIND = "licensed_source" as const;

/** Contract types accepted by the provider query API. */
export const careerjetContractTypes = ["p", "c", "t", "i", "v"] as const;
export type CareerjetContractType = (typeof careerjetContractTypes)[number];
/** Working-hours filters accepted by the provider query API. */
export const careerjetWorkHours = ["f", "p"] as const;
export type CareerjetWorkHours = (typeof careerjetWorkHours)[number];

/**
 * Normalized search request handed to a job source tool. Values are already
 * provider-agnostic; each adapter maps them onto its own wire format.
 */
export type JobSearchQuery = Readonly<{
  keywords?: string;
  location?: string;
  contractType?: CareerjetContractType;
  workHours?: CareerjetWorkHours;
}>;

/** A single normalized candidate produced by a provider adapter. */
export type JobCandidate = Readonly<{
  /** Stable provider-scoped identity derived from the posting URL. */
  externalId: string;
  title: string;
  company?: string;
  description?: string;
  location?: string;
  url: string;
  postedAt?: string;
  salaryText?: string;
}>;

export type JobSearchResult = Readonly<{
  hits: number;
  pages: number;
  candidates: readonly JobCandidate[];
}>;

export type JobSearchProviderErrorCode =
  | "PROVIDER_NOT_CONFIGURED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_HTTP_ERROR"
  | "PROVIDER_RESPONSE_TOO_LARGE"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_LOCATION_UNRESOLVED";

export class JobSearchProviderError extends Error {
  override readonly name = "JobSearchProviderError";

  constructor(
    readonly code: JobSearchProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const configSchema = z
  .object({
    apiKey: z.string().trim().min(1),
    localeCode: z
      .string()
      .trim()
      .regex(/^[a-z]{2}_[A-Z]{2}$/),
    /** Registered partner site origin sent as the Referer header. */
    siteUrl: z.url(),
    baseUrl: z.url().default("https://search.api.careerjet.net/v4/query"),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(15_000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10_000_000)
      .default(2_000_000),
  })
  .strict();

export type CareerjetProviderConfig = z.input<typeof configSchema>;

const careerjetJobSchema = z
  .object({
    title: z.string(),
    company: z.string().nullish(),
    date: z.string().nullish(),
    description: z.string().nullish(),
    locations: z.string().nullish(),
    salary: z.string().nullish(),
    url: z.string(),
  })
  .loose();

const jobsEnvelopeSchema = z
  .object({
    type: z.string(),
    hits: z.number().int().nonnegative().nullish(),
    pages: z.number().int().nonnegative().nullish(),
    jobs: z.array(z.unknown()).nullish(),
    message: z.string().nullish(),
  })
  .loose();

const locationsEnvelopeSchema = z
  .object({
    type: z.literal("LOCATIONS"),
    locations: z.array(z.unknown()).nullish(),
    message: z.string().nullish(),
  })
  .loose();

function parseIsoDate(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined || raw.trim() === "") return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function cleanText(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Stable external identity for a posting. The Careerjet v4 response carries
 * no explicit job id, so the posting URL — stable per listing — is hashed.
 */
export function careerjetExternalId(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/** Maps one raw provider entry onto a domain candidate, or drops it. */
export function normalizeCareerjetJob(raw: unknown): JobCandidate | undefined {
  const parsed = careerjetJobSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const job = parsed.data;
  let url: URL;
  try {
    url = new URL(job.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const href = url.toString();
  const title = cleanText(job.title);
  // A candidate without a usable title or link cannot be displayed,
  // structured, or revisited; dropping it beats persisting garbage.
  if (title === undefined) return undefined;
  const company = cleanText(job.company);
  const description = cleanText(job.description);
  const location = cleanText(job.locations);
  const salaryText = cleanText(job.salary);
  const postedAt = parseIsoDate(job.date);
  return {
    externalId: careerjetExternalId(href),
    title,
    ...(company === undefined ? {} : { company }),
    ...(description === undefined ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    url: href,
    ...(postedAt === undefined ? {} : { postedAt }),
    ...(salaryText === undefined ? {} : { salaryText }),
  };
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("response size limit exceeded");
        throw new JobSearchProviderError(
          "PROVIDER_RESPONSE_TOO_LARGE",
          "The provider response was too large",
          false,
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Adapter for the licensed Careerjet partner search API
 * (https://www.careerjet.com/partners/api). The adapter owns the wire
 * format, authentication, error classification, and normalization; callers
 * only see {@link JobCandidate}s or typed errors. It never scrapes and
 * never performs writes against the provider.
 */
export class CareerjetProvider {
  private readonly config: z.output<typeof configSchema>;

  constructor(
    config: CareerjetProviderConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse(config);
  }

  /**
   * Builds the factory used by route handlers. Configuration problems are
   * surfaced as a typed error so the API layer can answer 500 consistently
   * with the other server-misconfiguration paths.
   */
  static fromEnvironment(fetcher?: typeof fetch): CareerjetProvider {
    const apiKey = process.env.CAREERJET_API_KEY?.trim();
    if (apiKey === undefined || apiKey === "") {
      throw new JobSearchProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "CAREERJET_API_KEY must be set to a non-empty value",
        false,
      );
    }
    // The provider rejects requests without a Referer identifying the
    // registered partner site ("Undeclared referrer"), so the deployment
    // must declare it — CAREERJET_SITE_URL, falling back to APP_ORIGIN.
    const siteUrl =
      process.env.CAREERJET_SITE_URL?.trim() || process.env.APP_ORIGIN?.trim();
    if (siteUrl === undefined || siteUrl === "") {
      throw new JobSearchProviderError(
        "PROVIDER_NOT_CONFIGURED",
        "CAREERJET_SITE_URL or APP_ORIGIN must be set to a non-empty value",
        false,
      );
    }
    const localeCode = process.env.CAREERJET_LOCALE_CODE?.trim() ?? "ja_JP";
    const timeoutRaw = process.env.CAREERJET_TIMEOUT_MS;
    let timeoutMs = 15_000;
    if (timeoutRaw !== undefined && timeoutRaw.trim() !== "") {
      const parsed = Number(timeoutRaw);
      if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
        throw new JobSearchProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "CAREERJET_TIMEOUT_MS must be an integer between 1000 and 60000",
          false,
        );
      }
      timeoutMs = parsed;
    }
    const baseUrl = process.env.CAREERJET_BASE_URL?.trim();
    return new CareerjetProvider(
      {
        apiKey,
        localeCode,
        siteUrl,
        timeoutMs,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      },
      fetcher,
    );
  }

  private requestUrl(query: JobSearchQuery, pageSize: number): string {
    const url = new URL(this.config.baseUrl);
    url.searchParams.set("locale_code", this.config.localeCode);
    if (query.keywords !== undefined)
      url.searchParams.set("keywords", query.keywords);
    if (query.location !== undefined)
      url.searchParams.set("location", query.location);
    if (query.contractType !== undefined)
      url.searchParams.set("contract_type", query.contractType);
    if (query.workHours !== undefined)
      url.searchParams.set("work_hours", query.workHours);
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("sort", "date");
    return url.toString();
  }

  async search(
    query: JobSearchQuery,
    context: { userIp: string; userAgent: string },
  ): Promise<JobSearchResult> {
    // The provider contract requires the end-user's IP and user agent with
    // every call; they travel as query parameters, never logged or stored.
    const pageSize = 20;
    const url = new URL(this.requestUrl(query, pageSize));
    url.searchParams.set("user_ip", context.userIp);
    url.searchParams.set("user_agent", context.userAgent);

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(new DOMException("Timed out", "TimeoutError")),
      this.config.timeoutMs,
    );

    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        method: "GET",
        headers: {
          // Basic auth: API key as username, empty password.
          authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`).toString("base64")}`,
          // The partner contract requires the registered site origin;
          // requests without it are rejected as "Undeclared referrer".
          referer: this.config.siteUrl,
        },
        signal: timeoutController.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (timeoutController.signal.aborted) {
        throw new JobSearchProviderError(
          "PROVIDER_TIMEOUT",
          "The provider request timed out",
          true,
          { cause: error },
        );
      }
      throw new JobSearchProviderError(
        "PROVIDER_NETWORK",
        "The provider request failed",
        true,
        { cause: error },
      );
    }

    try {
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // Cancellation failures must not change HTTP classification.
        }
        if (response.status === 429) {
          throw new JobSearchProviderError(
            "PROVIDER_RATE_LIMITED",
            "The provider rate limit was reached",
            true,
          );
        }
        throw new JobSearchProviderError(
          "PROVIDER_HTTP_ERROR",
          `The provider returned HTTP ${response.status}`,
          response.status >= 500 || response.status === 408,
        );
      }

      let rawResponse: string;
      try {
        rawResponse = await readBoundedBody(
          response,
          this.config.maxResponseBytes,
        );
      } catch (error) {
        if (error instanceof JobSearchProviderError) throw error;
        if (timeoutController.signal.aborted) {
          throw new JobSearchProviderError(
            "PROVIDER_TIMEOUT",
            "The provider request timed out",
            true,
            { cause: error },
          );
        }
        throw new JobSearchProviderError(
          "PROVIDER_NETWORK",
          "The provider response could not be read",
          true,
          { cause: error },
        );
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(rawResponse) as unknown;
      } catch (error) {
        throw new JobSearchProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "The provider returned invalid JSON",
          false,
          { cause: error },
        );
      }

      const locationEnvelope = locationsEnvelopeSchema.safeParse(decoded);
      if (locationEnvelope.success) {
        throw new JobSearchProviderError(
          "PROVIDER_LOCATION_UNRESOLVED",
          locationEnvelope.data.message ??
            "The provider could not resolve the requested location",
          false,
        );
      }

      const envelope = jobsEnvelopeSchema.safeParse(decoded);
      if (
        !envelope.success ||
        envelope.data.type !== "JOBS" ||
        envelope.data.jobs === null ||
        envelope.data.jobs === undefined
      ) {
        throw new JobSearchProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "The provider returned an unexpected payload shape",
          false,
        );
      }

      const candidates = envelope.data.jobs
        .map(normalizeCareerjetJob)
        .filter(
          (candidate): candidate is JobCandidate => candidate !== undefined,
        );

      return {
        hits: envelope.data.hits ?? candidates.length,
        pages: envelope.data.pages ?? 1,
        candidates,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
