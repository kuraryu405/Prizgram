import "server-only";

import { credentialsSchema } from "@prizgram/shared";

import { AppError, parseRequest } from "../api";

export const SESSION_COOKIE_NAME = "prizgram_session";

export function withNoStore(
  handler: (request: Request) => Response | Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    const response = await handler(request);
    response.headers.set("cache-control", "no-store");
    return response;
  };
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let expectedOrigin: string | undefined;
  try {
    expectedOrigin =
      process.env.APP_ORIGIN === undefined
        ? host === null
          ? new URL(request.url).origin
          : new URL(`${new URL(request.url).protocol}//${host}`).origin
        : new URL(process.env.APP_ORIGIN).origin;
  } catch {
    throw new AppError(
      "SERVER_MISCONFIGURED",
      "Authentication origin is not configured",
      500,
    );
  }
  if (origin === null || origin !== expectedOrigin) {
    throw new AppError("INVALID_ORIGIN", "Request origin is not allowed", 403);
  }
}

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

export async function readCredentials(request: Request) {
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
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    throw new AppError("REQUEST_TOO_LARGE", "Request body is too large", 413);
  }

  let value: unknown;
  try {
    const body = await readBoundedBody(request, 16_384);
    value = JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  return parseRequest(credentialsSchema, value);
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return value.join("=");
  }
  return undefined;
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
