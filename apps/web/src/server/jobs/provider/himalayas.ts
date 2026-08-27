import "server-only";

import { convert, type HtmlToTextOptions } from "html-to-text";
import { z } from "zod";

import type { CareerjetContractType, CareerjetWorkHours } from "./careerjet";
import { JobSearchProviderError } from "./careerjet";
import type {
  JobCandidate,
  JobSearchQuery,
  JobSearchResult,
} from "./careerjet";

export const HIMALAYAS_PROVIDER_NAME = "Himalayas";
export const HIMALAYAS_SOURCE_KIND = "licensed_source" as const;
export const HIMALAYAS_ATTRIBUTION =
  "Jobs provided by Himalayas (https://himalayas.app)";

const configSchema = z
  .object({
    baseUrl: z.url().default("https://himalayas.app/jobs/api"),
    searchBaseUrl: z.url().default("https://himalayas.app/jobs/api/search"),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(10_000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10_000_000)
      .default(2_000_000),
    limit: z.number().int().min(1).max(20).default(20),
  })
  .strict();

export type HimalayasProviderConfig = z.input<typeof configSchema>;

const himalayasJobSchema = z
  .object({
    title: z.string(),
    excerpt: z.string().nullish(),
    companyName: z.string().nullish(),
    companySlug: z.string().nullish(),
    companyLogo: z.string().nullish(),
    employmentType: z.string().nullish(),
    minSalary: z.number().nullish(),
    maxSalary: z.number().nullish(),
    salaryPeriod: z.string().nullish(),
    currency: z.string().nullish(),
    seniority: z.array(z.string()).nullish(),
    locationRestrictions: z.array(z.string()).nullish(),
    timezoneRestrictions: z.array(z.unknown()).nullish(),
    categories: z.array(z.string()).nullish(),
    parentCategories: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    pubDate: z.number().nullish(),
    expiryDate: z.number().nullish(),
    applicationLink: z.string().nullish(),
    guid: z.string().nullish(),
    url: z.string().nullish(),
  })
  .loose();

const himalayasEnvelopeSchema = z
  .object({
    jobs: z.array(z.unknown()).nullish(),
    totalCount: z.number().int().nonnegative().nullish(),
    hits: z.number().int().nonnegative().nullish(),
    limit: z.number().int().nonnegative().nullish(),
    offset: z.number().int().nonnegative().nullish(),
    nextCursor: z.string().nullish(),
    comments: z.string().nullish(),
    updatedAt: z.number().nullish(),
  })
  .loose();

function parsePubDate(raw: number | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!Number.isFinite(raw)) return undefined;
  // Himalayas docs report seconds; data dictionary shows milliseconds.
  // Detect by magnitude: > 1e12 is millis.
  const millis = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function cleanText(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

const providerDescriptionTextOptions: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: "a", options: { ignoreHref: true } },
    { selector: "img", format: "skip" },
  ],
};

function normalizeProviderDescription(
  raw: string | null | undefined,
): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const text = convert(raw, providerDescriptionTextOptions)
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? undefined : text;
}

function formatSalaryText(
  minSalary: number | null | undefined,
  maxSalary: number | null | undefined,
  currency: string | null | undefined,
  salaryPeriod: string | null | undefined,
): string | undefined {
  const period = cleanText(salaryPeriod) ?? "annual";
  const cur = cleanText(currency);
  const min = minSalary ?? null;
  const max = maxSalary ?? null;
  if (min === null && max === null) return undefined;
  const currencyPrefix = cur ?? "";
  const periodSuffix = ` per ${period}`;
  if (min !== null && max !== null) {
    const a = currencyPrefix
      ? `${currencyPrefix} ${min.toLocaleString()}`
      : `${min.toLocaleString()}`;
    const b = currencyPrefix
      ? `${currencyPrefix} ${max.toLocaleString()}`
      : `${max.toLocaleString()}`;
    return `${a} - ${b}${periodSuffix}`;
  }
  if (min !== null) {
    const a = currencyPrefix
      ? `${currencyPrefix} ${min.toLocaleString()}`
      : `${min.toLocaleString()}`;
    return `${a}${periodSuffix}`;
  }
  if (max !== null) {
    const b = currencyPrefix
      ? `${currencyPrefix} ${max.toLocaleString()}`
      : `${max.toLocaleString()}`;
    return `${b}${periodSuffix}`;
  }
  return undefined;
}

function mapContractToEmploymentType(
  contractType?: CareerjetContractType,
  workHours?: CareerjetWorkHours,
): string | undefined {
  // Map internal contractType/workHours to Himalayas employment_type values.
  // Himalayas enums: "Full Time", "Part Time", "Contractor", "Temporary", "Intern", "Volunteer", "Other"
  if (contractType === "i") return "Intern";
  if (contractType === "c") return "Contractor";
  if (workHours === "p" && contractType !== "p") return "Part Time";
  if (contractType === "p" && workHours === "f") return "Full Time";
  if (contractType === "p") return "Full Time";
  if (workHours === "f") return "Full Time";
  return undefined;
}

export function himalayasExternalId(guid: string, fallbackUrl: string): string {
  // guid is stable per Himalayas; fallback to hashed url pattern if missing
  if (guid.trim() !== "") return guid.trim();
  // Fallback: hash url (should not happen for well-formed payloads)
  return `himalayas:${fallbackUrl}`;
}

export function normalizeHimalayasJob(raw: unknown): JobCandidate | undefined {
  const parsed = himalayasJobSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const job = parsed.data;

  const title = cleanText(job.title);
  if (title === undefined) return undefined;

  const company = cleanText(job.companyName);
  // applicationLink is canonical source URL; fall back to url field if present
  const rawUrl = cleanText(job.applicationLink) ?? cleanText(job.url);
  if (rawUrl === undefined) return undefined;
  let href: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    href = url.toString();
  } catch {
    return undefined;
  }

  const guid = cleanText(job.guid);
  const externalId = guid ? guid : himalayasExternalId("", href);

  // Prefer description HTML; fallback to excerpt plain text
  const description =
    normalizeProviderDescription(job.description) ?? cleanText(job.excerpt);

  // Location: join locationRestrictions if present
  let location: string | undefined;
  if (job.locationRestrictions && job.locationRestrictions.length > 0) {
    const cleaned = job.locationRestrictions
      .map((loc) => cleanText(loc))
      .filter((loc): loc is string => loc !== undefined);
    if (cleaned.length > 0) location = cleaned.join(", ");
  }

  const salaryText = formatSalaryText(
    job.minSalary ?? null,
    job.maxSalary ?? null,
    job.currency ?? null,
    job.salaryPeriod ?? null,
  );

  const postedAt = parsePubDate(job.pubDate ?? undefined);

  return {
    externalId,
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

export class HimalayasProvider {
  private readonly config: z.output<typeof configSchema>;

  constructor(
    config: HimalayasProviderConfig = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse(config);
  }

  static fromEnvironment(fetcher?: typeof fetch): HimalayasProvider {
    const baseUrl = process.env.HIMALAYAS_BASE_URL?.trim();
    const searchBaseUrl = process.env.HIMALAYAS_SEARCH_BASE_URL?.trim();
    const timeoutRaw = process.env.HIMALAYAS_TIMEOUT_MS?.trim();
    let timeoutMs: number | undefined;
    if (timeoutRaw !== undefined && timeoutRaw !== "") {
      const parsed = Number(timeoutRaw);
      if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
        throw new JobSearchProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "HIMALAYAS_TIMEOUT_MS must be an integer between 1000 and 60000",
          false,
        );
      }
      timeoutMs = parsed;
    }
    return new HimalayasProvider(
      {
        ...(baseUrl ? { baseUrl } : {}),
        ...(searchBaseUrl ? { searchBaseUrl } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      },
      fetcher,
    );
  }

  private requestUrl(query: JobSearchQuery): string {
    const hasQuery =
      query.keywords !== undefined && query.keywords.trim() !== "";
    // Use search endpoint when keywords or location filter is present; otherwise browse
    if (
      hasQuery ||
      query.location !== undefined ||
      query.contractType !== undefined ||
      query.workHours !== undefined
    ) {
      const url = new URL(this.config.searchBaseUrl);
      if (query.keywords !== undefined)
        url.searchParams.set("q", query.keywords);
      if (query.location !== undefined)
        url.searchParams.set("country", query.location);
      const employmentType = mapContractToEmploymentType(
        query.contractType,
        query.workHours,
      );
      if (employmentType !== undefined)
        url.searchParams.set("employment_type", employmentType);
      url.searchParams.set("page", "1");
      // Search endpoint returns page-based; limit via provider default (20)
      return url.toString();
    }
    const url = new URL(this.config.baseUrl);
    url.searchParams.set("limit", String(this.config.limit));
    return url.toString();
  }

  async search(
    query: JobSearchQuery,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _context: { userIp: string; userAgent: string },
  ): Promise<JobSearchResult> {
    const url = this.requestUrl(query);

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(new DOMException("Timed out", "TimeoutError")),
      this.config.timeoutMs,
    );

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          // Himalayas does not require auth; no Referer requirement.
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
          {
            cause: error,
          },
        );
      }
      throw new JobSearchProviderError(
        "PROVIDER_NETWORK",
        "The provider request failed",
        true,
        {
          cause: error,
        },
      );
    }

    try {
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // ignore cancel failure
        }
        if (response.status === 429) {
          throw new JobSearchProviderError(
            "PROVIDER_RATE_LIMITED",
            "The provider rate limit was reached",
            true,
          );
        }
        if (response.status === 400) {
          throw new JobSearchProviderError(
            "PROVIDER_INVALID_RESPONSE",
            "The provider returned an unexpected payload shape",
            false,
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
            {
              cause: error,
            },
          );
        }
        throw new JobSearchProviderError(
          "PROVIDER_NETWORK",
          "The provider response could not be read",
          true,
          {
            cause: error,
          },
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
          {
            cause: error,
          },
        );
      }

      const envelope = himalayasEnvelopeSchema.safeParse(decoded);
      if (!envelope.success) {
        throw new JobSearchProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "The provider returned an unexpected payload shape",
          false,
        );
      }

      const jobsRaw = envelope.data.jobs;
      if (jobsRaw === null || jobsRaw === undefined) {
        // Empty but valid response
        return { hits: 0, pages: 1, candidates: [] };
      }
      if (!Array.isArray(jobsRaw)) {
        throw new JobSearchProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "The provider returned an unexpected payload shape",
          false,
        );
      }

      const candidates = jobsRaw
        .map(normalizeHimalayasJob)
        .filter((c): c is JobCandidate => c !== undefined)
        .slice(0, this.config.limit);

      const hits =
        envelope.data.totalCount ?? envelope.data.hits ?? candidates.length;

      return {
        hits,
        pages: 1,
        candidates,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
