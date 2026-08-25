import "server-only";

import type { z } from "zod";

import { AppError, parseRequest } from "./errors";

const DEFAULT_MAX_BYTES = 16_384;

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel("request size limit exceeded");
        throw new AppError(
          "REQUEST_TOO_LARGE",
          "Request body is too large",
          413,
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Reads a size-bounded JSON request body and validates it with the given
 * schema. Media type and hard byte limits are enforced before parsing.
 */
export async function readJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<T> {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new AppError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json",
      415,
    );
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
  }

  let value: unknown;
  try {
    value = JSON.parse(await readBoundedBody(request, maxBytes)) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  return parseRequest(schema, value);
}
