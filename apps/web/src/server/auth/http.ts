import "server-only";

import { credentialsSchema } from "@prizgram/shared";

import { AppError, parseRequest } from "../api";

export function sessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-prizgram_session"
    : "prizgram_session";
}

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
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_ORIGIN === undefined
  ) {
    throw new AppError(
      "SERVER_MISCONFIGURED",
      "Authentication origin is not configured",
      500,
    );
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let expectedOrigin: string | undefined;
  const configuredOrigin = process.env.APP_ORIGIN;
  if (configuredOrigin !== undefined) {
    try {
      expectedOrigin = new URL(configuredOrigin).origin;
    } catch {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "APP_ORIGIN must be a valid absolute origin",
        500,
      );
    }
  } else {
    try {
      expectedOrigin =
        host === null
          ? new URL(request.url).origin
          : new URL(`${new URL(request.url).protocol}//${host}`).origin;
    } catch {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "Authentication origin could not be determined from the request",
        500,
      );
    }
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
    if (name === sessionCookieName()) return value.join("=");
  }
  return undefined;
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
