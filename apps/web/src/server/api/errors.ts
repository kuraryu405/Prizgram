import { NextResponse } from "next/server";
import type { z, ZodError } from "zod";

export type ApiErrorBody = {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId: string;
    fieldErrors?: Record<string, string[]>;
  };
};

export class AppError extends Error {
  override readonly name = "AppError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fieldErrors?: Record<string, string[]>,
    readonly headers?: Readonly<Record<string, string>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function validationError(error: ZodError): AppError {
  const flattened = error.flatten();
  return new AppError(
    "VALIDATION_ERROR",
    "Request validation failed",
    400,
    flattened.fieldErrors,
  );
}

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** Requires browser mutations to originate from the configured application. */
export function assertSameOrigin(request: Request): void {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_ORIGIN === undefined
  ) {
    throw new AppError(
      "SERVER_MISCONFIGURED",
      "Application origin is not configured",
      500,
    );
  }

  const configuredOrigin = process.env.APP_ORIGIN;
  let expectedOrigin: string;
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
    const host = request.headers.get("host");
    try {
      const requestUrl = new URL(request.url);
      expectedOrigin =
        host === null
          ? requestUrl.origin
          : new URL(`${requestUrl.protocol}//${host}`).origin;
    } catch {
      throw new AppError(
        "SERVER_MISCONFIGURED",
        "Application origin could not be determined from the request",
        500,
      );
    }
  }

  if (request.headers.get("origin") !== expectedOrigin) {
    throw new AppError("INVALID_ORIGIN", "Request origin is not allowed", 403);
  }
}

function assertMutationSameOrigin(request: Request): void {
  if (!safeMethods.has(request.method.toUpperCase())) assertSameOrigin(request);
}

function errorResponse(
  error: unknown,
  requestId: string,
): NextResponse<ApiErrorBody> {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "An unexpected error occurred", 500);

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: appError.code,
        message: appError.message,
        requestId,
        ...(appError.fieldErrors === undefined
          ? {}
          : { fieldErrors: appError.fieldErrors }),
      },
    },
    {
      status: appError.status,
      headers: { ...(appError.headers ?? {}), "x-request-id": requestId },
    },
  );
}

/**
 * Correlates an unexpected 5xx with the requestId returned to the client.
 * Only the error identity is logged; request bodies, headers, and query
 * strings are excluded because they can carry credentials or PII.
 */
export function logApiServerError(
  request: Request,
  requestId: string,
  requestIdSource: "client" | "server",
  error: unknown,
): void {
  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = "<unparsed>";
  }
  const base = {
    level: "error",
    method: request.method,
    path,
    requestId,
    requestIdSource,
  };

  if (error instanceof AppError) {
    // Expected client-facing failures stay quiet; server faults are logged
    // with their developer-defined code and message, which never embed
    // request data.
    if (error.status < 500) return;
    console.error(
      JSON.stringify({ ...base, code: error.code, message: error.message }),
    );
    return;
  }

  const details =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: "UnknownError", message: String(error), stack: undefined };
  console.error(
    JSON.stringify({ ...base, code: "INTERNAL_ERROR", ...details }),
  );
}

export type ApiSuccessBody<T> = { ok: true; data: T; requestId: string };
export type ApiBodyStatus = 200 | 201 | 202 | 203 | 206 | 207 | 208 | 226;
export type ApiBodyResponseInit = Omit<ResponseInit, "status"> & {
  status?: ApiBodyStatus;
};

export class ApiResult<T> {
  constructor(
    readonly data: T,
    readonly init: ApiBodyResponseInit = {},
  ) {
    if (
      init.status !== undefined &&
      ![200, 201, 202, 203, 206, 207, 208, 226].includes(init.status)
    ) {
      throw new TypeError(
        "apiResult requires a response status that permits a body",
      );
    }
  }
}

export class ApiNoContent {
  constructor(readonly headers?: HeadersInit) {}
}

export function apiResult<T>(
  data: T,
  init: ApiBodyResponseInit = {},
): ApiResult<T> {
  return new ApiResult(data, init);
}

export function apiNoContent(headers?: HeadersInit): ApiNoContent {
  return new ApiNoContent(headers);
}

export type ApiHandler<T> = (
  request: Request,
) => ApiNoContent | ApiResult<T> | T | Promise<ApiNoContent | ApiResult<T> | T>;

export function withApiHandler<T>(handler: ApiHandler<T>) {
  return async (request: Request): Promise<NextResponse> => {
    const suppliedRequestId = request.headers.get("x-request-id");
    const requestIdIsClientSupplied =
      suppliedRequestId !== null &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId);
    const requestId = requestIdIsClientSupplied
      ? suppliedRequestId
      : crypto.randomUUID();
    try {
      assertMutationSameOrigin(request);
      const result = await handler(request);
      if (result instanceof ApiNoContent) {
        const headers = new Headers(result.headers);
        headers.set("x-request-id", requestId);
        return new NextResponse(null, { status: 204, headers });
      }
      const data = result instanceof ApiResult ? result.data : result;
      const init = result instanceof ApiResult ? result.init : {};
      const headers = new Headers(init.headers);
      headers.set("x-request-id", requestId);
      return NextResponse.json(
        { ok: true, data, requestId },
        { ...init, status: init.status ?? 200, headers },
      );
    } catch (error) {
      logApiServerError(
        request,
        requestId,
        requestIdIsClientSupplied ? "client" : "server",
        error,
      );
      return errorResponse(error, requestId);
    }
  };
}
