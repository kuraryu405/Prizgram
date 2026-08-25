import "server-only";

import { z } from "zod";

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
  | "INVALID_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED";

export class LlmClientError extends Error {
  override readonly name = "LlmClientError";

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

export type StructuredGeneration<T> = Readonly<{
  messages: readonly ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  signal?: AbortSignal;
}>;

export interface StructuredLlmClient {
  generateStructured<T>(input: StructuredGeneration<T>): Promise<T>;
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

  async generateStructured<T>({
    messages,
    schema,
    schemaName,
    signal,
  }: StructuredGeneration<T>): Promise<T> {
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
              schema: z.toJSONSchema(schema, { io: "output" }),
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

      const parsed = schema.safeParse(structured);
      if (!parsed.success) {
        throw new LlmClientError(
          "SCHEMA_VALIDATION_FAILED",
          "The structured content did not match its schema",
          false,
          {
            cause: parsed.error,
          },
        );
      }
      return parsed.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLlmClientFromEnvironment(): OpenAiCompatibleClient {
  return new OpenAiCompatibleClient({
    baseUrl: process.env.OPENAI_BASE_URL ?? "",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL ?? "",
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? "30000"),
  });
}
