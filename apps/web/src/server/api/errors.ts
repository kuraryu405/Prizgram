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
    { status: appError.status, headers: { "x-request-id": requestId } },
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
    const requestId =
      suppliedRequestId !== null &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    try {
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
      return errorResponse(error, requestId);
    }
  };
}
