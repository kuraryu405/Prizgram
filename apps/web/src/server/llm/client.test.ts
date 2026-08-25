import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { personaStructuredOutput } from "@prizgram/shared";

import {
  LlmClientError,
  OpenAiCompatibleClient,
  toOpenAiStrictJsonSchema,
} from "./client";

const providerOutputSchema = z.object({ value: z.string() }).strict();
const outputSchema = z.object({ value: z.string().min(1) }).strict();
const output = {
  providerSchema: providerOutputSchema,
  domainSchema: outputSchema,
  normalize: (value: { value: string }) => value,
};
const config = {
  baseUrl: "https://llm.example.test/v1",
  apiKey: "test-secret",
  model: "test-model",
  timeoutMs: 100,
};

function responseWithContent(
  content: string | null,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

async function errorCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof LlmClientError ? error.code : undefined;
  }
}

describe("OpenAiCompatibleClient", () => {
  it("accepts provider-specific persona schema and rejects optional provider fields", () => {
    const jsonSchema = toOpenAiStrictJsonSchema(
      personaStructuredOutput.providerSchema,
    );
    expect(JSON.stringify(jsonSchema)).not.toContain("minLength");
    expect(JSON.stringify(jsonSchema)).not.toContain('"format":"uri"');
    expect(() =>
      toOpenAiStrictJsonSchema(
        z.object({ optional: z.string().optional() }).strict(),
      ),
    ).toThrowError(/required/);
  });

  it("requests JSON schema output and validates the result", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(responseWithContent('{"value":"ok"}'));
    const client = new OpenAiCompatibleClient(config, fetcher);

    await expect(
      client.generateStructured({
        messages: [{ role: "user", content: "input" }],
        output,
        schemaName: "test_output",
      }),
    ).resolves.toEqual({ value: "ok" });

    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("https://llm.example.test/v1/chat/completions");
    const requestBody = request?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    const body = JSON.parse(
      typeof requestBody === "string" ? requestBody : "",
    ) as {
      response_format: { type: string; json_schema: { strict: boolean } };
    };
    expect(body.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
  });

  it("classifies HTTP, network, and timeout failures without response bodies", async () => {
    const httpClient = new OpenAiCompatibleClient(
      config,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("secret", { status: 503 })),
    );
    await expect(
      errorCode(
        httpClient.generateStructured({
          messages: [],
          output,
          schemaName: "test",
        }),
      ),
    ).resolves.toBe("HTTP_ERROR");

    const networkClient = new OpenAiCompatibleClient(
      config,
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("network included secret")),
    );
    await expect(
      errorCode(
        networkClient.generateStructured({
          messages: [],
          output,
          schemaName: "test",
        }),
      ),
    ).resolves.toBe("NETWORK_ERROR");

    const timeoutFetcher: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () =>
            reject(
              init.signal?.reason instanceof Error
                ? init.signal.reason
                : new Error("Request aborted"),
            ),
          { once: true },
        );
      });
    const timeoutClient = new OpenAiCompatibleClient(
      { ...config, timeoutMs: 100 },
      timeoutFetcher,
    );
    await expect(
      errorCode(
        timeoutClient.generateStructured({
          messages: [],
          output,
          schemaName: "test",
        }),
      ),
    ).resolves.toBe("TIMEOUT");
  });

  it("rejects malformed envelopes, empty content, invalid structured JSON, and schema mismatch", async () => {
    const cases: Array<[Response, string]> = [
      [new Response("not-json"), "INVALID_RESPONSE"],
      [new Response(JSON.stringify({ choices: [] })), "INVALID_RESPONSE"],
      [responseWithContent(null), "INVALID_RESPONSE"],
      [responseWithContent("not-json"), "INVALID_RESPONSE"],
      [responseWithContent('{"value":""}'), "SCHEMA_VALIDATION_FAILED"],
      [
        responseWithContent('{"value":"ok","unknown":true}'),
        "SCHEMA_VALIDATION_FAILED",
      ],
    ];

    for (const [response, expected] of cases) {
      const client = new OpenAiCompatibleClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(response),
      );
      await expect(
        errorCode(
          client.generateStructured({
            messages: [],
            output,
            schemaName: "test",
          }),
        ),
      ).resolves.toBe(expected);
    }
  });

  it("rejects oversized responses", async () => {
    let cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(800));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const client = new OpenAiCompatibleClient(
      { ...config, maxResponseBytes: 1_024 },
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );
    await expect(
      errorCode(
        client.generateStructured({
          messages: [],
          output,
          schemaName: "test",
        }),
      ),
    ).resolves.toBe("RESPONSE_TOO_LARGE");
    expect(cancelled).toBe(true);
  });

  it("keeps the timeout active while reading the response body", async () => {
    const streamingFetcher: typeof fetch = (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new Error("stream aborted")),
            { once: true },
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const client = new OpenAiCompatibleClient(
      { ...config, timeoutMs: 100 },
      streamingFetcher,
    );
    await expect(
      errorCode(
        client.generateStructured({
          messages: [],
          output,
          schemaName: "test",
        }),
      ),
    ).resolves.toBe("TIMEOUT");
  });
});
