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
export type ApiHandler<T> = (request: Request) => T | Promise<T>;

export function withApiHandler<T>(handler: ApiHandler<T>) {
  return async (
    request: Request,
  ): Promise<NextResponse<ApiSuccessBody<T> | ApiErrorBody>> => {
    const suppliedRequestId = request.headers.get("x-request-id");
    const requestId =
      suppliedRequestId !== null &&
      /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
        ? suppliedRequestId
        : crypto.randomUUID();
    try {
      const data = await handler(request);
      return NextResponse.json(
        { ok: true, data, requestId },
        { status: 200, headers: { "x-request-id": requestId } },
      );
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}
