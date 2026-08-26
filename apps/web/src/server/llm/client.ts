import "server-only";

import type { StructuredOutputContract } from "@prizgram/shared";
import { z } from "zod";

import type { LogSafeCause } from "../api";

const configSchema = z
  .object({
    baseUrl: z.url(),
    apiKey: z.string().min(1),
    model: z.string().trim().min(1),
    timeoutMs: z.number().int().min(100).max(120_000),
    maxResponseBytes: z
      .number()
      .int()
      .min(1_024)
      .max(10_000_000)
      .default(1_000_000),
  })
  .strict();

const responseSchema = z
  .object({
    choices: z.array(
      z
        .object({
          message: z.object({ content: z.string().nullable() }).passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type LlmClientConfig = z.input<typeof configSchema>;
export type LlmErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_PROVIDER_SCHEMA"
  | "INVALID_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED";

/**
 * Every message is a developer-defined constant (HTTP statuses aside) and
 * never embeds request data, so causes of this class may be logged.
 */
export class LlmClientError extends Error implements LogSafeCause {
  override readonly name = "LlmClientError";
  readonly logSafeMessage = true as const;

  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type ChatMessage = Readonly<{
  role: "system" | "user" | "assistant";
  content: string;
}>;

export type StructuredGeneration<ProviderOutput, DomainOutput> = Readonly<{
  messages: readonly ChatMessage[];
  output: StructuredOutputContract<ProviderOutput, DomainOutput>;
  schemaName: string;
  signal?: AbortSignal;
}>;

export interface StructuredLlmClient {
  generateStructured<ProviderOutput, DomainOutput>(
    input: StructuredGeneration<ProviderOutput, DomainOutput>,
  ): Promise<DomainOutput>;
}

type JsonSchema = Record<string, unknown>;

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOpenAiStrictSchema(node: unknown, path = "$"): void {
  if (!isRecord(node)) return;
  const format = node.format;
  const supportedFormats = new Set([
    "date-time",
    "time",
    "date",
    "duration",
    "email",
    "hostname",
    "ipv4",
    "ipv6",
    "uuid",
  ]);
  if (typeof format === "string" && !supportedFormats.has(format)) {
    throw new LlmClientError(
      "INVALID_PROVIDER_SCHEMA",
      `Unsupported provider schema format at ${path}`,
      false,
    );
  }
  if ("minLength" in node || "maxLength" in node) {
    throw new LlmClientError(
      "INVALID_PROVIDER_SCHEMA",
      `Unsupported provider string constraint at ${path}`,
      false,
    );
  }
  if (isRecord(node.properties)) {
    const properties = Object.keys(node.properties);
    const required = Array.isArray(node.required) ? node.required : [];
    if (
      properties.some((key) => !required.includes(key)) ||
      required.length !== properties.length
    ) {
      throw new LlmClientError(
        "INVALID_PROVIDER_SCHEMA",
        `All provider fields must be required at ${path}`,
        false,
      );
    }
    if (node.additionalProperties !== false) {
      throw new LlmClientError(
        "INVALID_PROVIDER_SCHEMA",
        `Provider objects must reject additional properties at ${path}`,
        false,
      );
    }
    for (const [key, child] of Object.entries(node.properties))
      assertOpenAiStrictSchema(child, `${path}.${key}`);
  }
  if (node.items !== undefined)
    assertOpenAiStrictSchema(node.items, `${path}[]`);
  if (Array.isArray(node.anyOf))
    node.anyOf.forEach((child, index) =>
      assertOpenAiStrictSchema(child, `${path}.anyOf[${index}]`),
    );
}

export function toOpenAiStrictJsonSchema(schema: z.ZodType): JsonSchema {
  const converted = z.toJSONSchema(schema, { io: "output", reused: "inline" });
  if (!isRecord(converted) || converted.type !== "object") {
    throw new LlmClientError(
      "INVALID_PROVIDER_SCHEMA",
      "Provider schema root must be an object",
      false,
    );
  }
  delete converted.$schema;
  assertOpenAiStrictSchema(converted);
  return converted;
}

function completionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/chat/completions`;
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
        throw new LlmClientError(
          "RESPONSE_TOO_LARGE",
          "The language model response was too large",
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

export class OpenAiCompatibleClient implements StructuredLlmClient {
  private readonly config: z.output<typeof configSchema>;

  constructor(
    config: LlmClientConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.config = configSchema.parse(config);
  }

  async generateStructured<ProviderOutput, DomainOutput>({
    messages,
    output,
    schemaName,
    signal,
  }: StructuredGeneration<
    ProviderOutput,
    DomainOutput
  >): Promise<DomainOutput> {
    const providerJsonSchema = toOpenAiStrictJsonSchema(output.providerSchema);
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(new DOMException("Timed out", "TimeoutError")),
      this.config.timeoutMs,
    );
    const combinedSignal =
      signal === undefined
        ? timeoutController.signal
        : AbortSignal.any([signal, timeoutController.signal]);

    let response: Response;
    try {
      response = await this.fetcher(completionsUrl(this.config.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: schemaName,
              strict: true,
              schema: providerJsonSchema,
            },
          },
        }),
        signal: combinedSignal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (timeoutController.signal.aborted) {
        throw new LlmClientError(
          "TIMEOUT",
          "The language model request timed out",
          true,
          { cause: error },
        );
      }
      if (signal?.aborted === true) {
        throw new LlmClientError(
          "ABORTED",
          "The language model request was aborted",
          false,
          { cause: error },
        );
      }
      throw new LlmClientError(
        "NETWORK_ERROR",
        "The language model request failed",
        true,
        { cause: error },
      );
    }

    try {
      if (!response.ok) {
        // Release the error response so its connection is not pinned by an
        // unread body. The body is intentionally not surfaced to callers.
        try {
          await response.body?.cancel();
        } catch {
          // Cancellation failures must not change the HTTP classification.
        }
        throw new LlmClientError(
          "HTTP_ERROR",
          `The language model returned HTTP ${response.status}`,
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        );
      }

      const declaredLength = Number(response.headers.get("content-length"));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > this.config.maxResponseBytes
      ) {
        throw new LlmClientError(
          "RESPONSE_TOO_LARGE",
          "The language model response was too large",
          false,
        );
      }

      let rawResponse: string;
      try {
        rawResponse = await readBoundedBody(
          response,
          this.config.maxResponseBytes,
        );
      } catch (error) {
        if (error instanceof LlmClientError) throw error;
        if (timeoutController.signal.aborted) {
          throw new LlmClientError(
            "TIMEOUT",
            "The language model request timed out",
            true,
            { cause: error },
          );
        }
        if (signal?.aborted === true) {
          throw new LlmClientError(
            "ABORTED",
            "The language model request was aborted",
            false,
            { cause: error },
          );
        }
        throw new LlmClientError(
          "NETWORK_ERROR",
          "The language model response could not be read",
          true,
          { cause: error },
        );
      }
      let decodedResponse: unknown;
      try {
        decodedResponse = JSON.parse(rawResponse) as unknown;
      } catch (error) {
        throw new LlmClientError(
          "INVALID_RESPONSE",
          "The language model returned invalid JSON",
          false,
          { cause: error },
        );
      }

      const envelope = responseSchema.safeParse(decodedResponse);
      const content = envelope.success
        ? envelope.data.choices[0]?.message.content
        : undefined;
      if (content === undefined || content === null || content.trim() === "") {
        throw new LlmClientError(
          "INVALID_RESPONSE",
          "The language model returned no structured content",
          false,
          {
            cause: envelope.success ? undefined : envelope.error,
          },
        );
      }

      let structured: unknown;
      try {
        structured = JSON.parse(content) as unknown;
      } catch (error) {
        throw new LlmClientError(
          "INVALID_RESPONSE",
          "The structured content was invalid JSON",
          false,
          { cause: error },
        );
      }

      const providerParsed = output.providerSchema.safeParse(structured);
      if (!providerParsed.success) {
        throw new LlmClientError(
          "SCHEMA_VALIDATION_FAILED",
          "The structured content did not match its schema",
          false,
          {
            cause: providerParsed.error,
          },
        );
      }
      const domainParsed = output.domainSchema.safeParse(
        output.normalize(providerParsed.data),
      );
      if (!domainParsed.success) {
        throw new LlmClientError(
          "SCHEMA_VALIDATION_FAILED",
          "The normalized content did not match its domain schema",
          false,
          { cause: domainParsed.error },
        );
      }
      return domainParsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} must be set to a non-empty value`);
  }
  return value.trim();
}

export function createLlmClientFromEnvironment(): OpenAiCompatibleClient {
  const timeoutRaw = process.env.OPENAI_TIMEOUT_MS ?? "30000";
  const timeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error(
      `OPENAI_TIMEOUT_MS must be an integer between 100 and 120000 milliseconds, received "${timeoutRaw}"`,
    );
  }
  return new OpenAiCompatibleClient({
    apiKey: requiredEnvironmentVariable("OPENAI_API_KEY"),
    baseUrl: requiredEnvironmentVariable("OPENAI_BASE_URL"),
    model: requiredEnvironmentVariable("OPENAI_MODEL"),
    timeoutMs,
  });
}
