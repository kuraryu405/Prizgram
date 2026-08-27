import "server-only";

import { convert, type HtmlToTextOptions } from "html-to-text";
import { z } from "zod";

import { JobSearchProviderError } from "./careerjet";
import type {
  JobCandidate,
  JobSearchQuery,
  JobSearchResult,
} from "./careerjet";

export const JOBICY_PROVIDER_NAME = "Jobicy";
export const JOBICY_SOURCE_KIND = "licensed_source" as const;
export const JOBICY_ATTRIBUTION =
  "Jobs provided by Jobicy (https://jobicy.com)";

const configSchema = z
  .object({
    baseUrl: z.url().default("https://jobicy.com/api/v2/remote-jobs"),
    timeoutMs: z.number().int().min(1_000).max(60_000).default(10_000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10_000_000)
      .default(2_000_000),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export type JobicyProviderConfig = z.input<typeof configSchema>;

const jobicyJobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullish(),
    url: z.string().nullish(),
    jobSlug: z.string().nullish(),
    jobTitle: z.string().nullish(),
    title: z.string().nullish(),
    companyName: z.string().nullish(),
    companyLogo: z.string().nullish(),
    jobIndustry: z.array(z.string()).nullish(),
    jobType: z.array(z.string()).nullish(),
    jobGeo: z.string().nullish(),
    jobLevel: z.string().nullish(),
    jobExcerpt: z.string().nullish(),
    jobDescription: z.string().nullish(),
    description: z.string().nullish(),
    pubDate: z.string().nullish(),
    date: z.string().nullish(),
  })
  .loose();

const jobicyEnvelopeSchema = z
  .object({
    jobs: z.array(z.unknown()).nullish(),
    jobCount: z.number().int().nonnegative().nullish(),
    success: z.boolean().nullish(),
    statusCode: z.number().int().nullish(),
    apiVersion: z.string().nullish(),
  })
  .loose();

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

function parsePubDate(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function normalizeJobicyJob(raw: unknown): JobCandidate | undefined {
  const parsed = jobicyJobSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const job = parsed.data;

  const title = cleanText(job.jobTitle) ?? cleanText(job.title);
  if (title === undefined) return undefined;

  const rawUrl = cleanText(job.url);
  if (rawUrl === undefined) return undefined;
  let href: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    href = url.toString();
  } catch {
    return undefined;
  }

  const idRaw = job.id;
  const externalId =
    idRaw === null || idRaw === undefined
      ? href
      : String(idRaw).trim() === ""
        ? href
        : String(idRaw);

  const company = cleanText(job.companyName);
  const description =
    normalizeProviderDescription(job.jobDescription) ??
    normalizeProviderDescription(job.description) ??
    cleanText(job.jobExcerpt);
  const location = cleanText(job.jobGeo);
  const postedAt = parsePubDate(job.pubDate ?? job.date ?? undefined);

  return {
    externalId,
    title,
    ...(company === undefined ? {} : { company }),
    ...(description === undefined ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    url: href,
    ...(postedAt === undefined ? {} : { postedAt }),
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

export class JobicyProvider {
  private readonly config: z.output<typeof configSchema>;

  constructor(
    config: JobicyProviderConfig = {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse(config);
  }

  static fromEnvironment(fetcher?: typeof fetch): JobicyProvider {
    const baseUrl = process.env.JOBICY_BASE_URL?.trim();
    const timeoutRaw = process.env.JOBICY_TIMEOUT_MS?.trim();
    let timeoutMs: number | undefined;
    if (timeoutRaw !== undefined && timeoutRaw !== "") {
      const parsed = Number(timeoutRaw);
      if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
        throw new JobSearchProviderError(
          "PROVIDER_NOT_CONFIGURED",
          "JOBICY_TIMEOUT_MS must be an integer between 1000 and 60000",
          false,
        );
      }
      timeoutMs = parsed;
    }
    return new JobicyProvider(
      {
        ...(baseUrl ? { baseUrl } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      },
      fetcher,
    );
  }

  private requestUrl(query: JobSearchQuery): string {
    const url = new URL(this.config.baseUrl);
    url.searchParams.set("count", String(this.config.limit));
    // tag: keyword search (3-50 chars required). Only send if valid length.
    if (query.keywords !== undefined) {
      const kw = query.keywords.trim();
      if (kw.length >= 3 && kw.length <= 50) {
        url.searchParams.set("tag", kw);
      } else if (kw.length > 0 && kw.length < 3) {
        // Too short for Jobicy tag filter – fall back to unfiltered with count limit;
        // client-side filtering could be done but we keep server simple.
      } else if (kw.length > 50) {
        url.searchParams.set("tag", kw.slice(0, 50));
      }
    }
    // geo: region slug; Jobicy expects slugs like usa, europe, apac. Pass through if plausible.
    if (query.location !== undefined) {
      const loc = query.location.trim();
      // Heuristic: if location contains non-ascii or multi-word like "東京", don't send as geo
      // to avoid empty results; keep it as tag supplement instead.
      if (/^[a-zA-Z\s,-]+$/.test(loc) && loc.length >= 2 && loc.length <= 30) {
        url.searchParams.set("geo", loc.toLowerCase());
      }
    }
    // industry mapping from contract filters – optional
    // For now we don't map employmentType to Jobicy industry; could be added later.
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
        headers: { accept: "application/json" },
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
          // ignore
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

      const envelope = jobicyEnvelopeSchema.safeParse(decoded);
      if (!envelope.success) {
        throw new JobSearchProviderError(
          "PROVIDER_INVALID_RESPONSE",
          "The provider returned an unexpected payload shape",
          false,
        );
      }

      const jobsRaw = envelope.data.jobs;
      if (jobsRaw === null || jobsRaw === undefined) {
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
        .map(normalizeJobicyJob)
        .filter((c): c is JobCandidate => c !== undefined)
        .slice(0, this.config.limit);

      const hits = envelope.data.jobCount ?? candidates.length;

      return { hits, pages: 1, candidates };
    } finally {
      clearTimeout(timeout);
    }
  }
}
