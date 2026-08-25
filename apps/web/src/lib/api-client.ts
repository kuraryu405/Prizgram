export type ApiFieldErrors = Record<string, string[]>;

export const UNAUTHORIZED_EVENT = "prizgram:unauthorized";

export class ApiClientError extends Error {
  override readonly name = "ApiClientError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fieldErrors?: ApiFieldErrors,
    readonly requestId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function notifyUnauthorized(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiClientError(
      "NETWORK_ERROR",
      "Network request failed",
      0,
      undefined,
      undefined,
      { cause: error },
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ApiClientError(
      "INVALID_RESPONSE",
      "The server returned an unreadable response",
      response.status,
      undefined,
      response.headers.get("x-request-id") ?? undefined,
      { cause: error },
    );
  }

  if (!isRecord(payload) || typeof payload.ok !== "boolean") {
    throw new ApiClientError(
      "INVALID_RESPONSE",
      "The server returned an unexpected response",
      response.status,
      undefined,
      response.headers.get("x-request-id") ?? undefined,
    );
  }

  if (!payload.ok) {
    const error = isRecord(payload.error) ? payload.error : {};
    const code = typeof error.code === "string" ? error.code : "UNKNOWN_ERROR";
    const message =
      typeof error.message === "string" ? error.message : "Request failed";
    const fieldErrors = isRecord(error.fieldErrors)
      ? (error.fieldErrors as ApiFieldErrors)
      : undefined;
    const requestId =
      typeof error.requestId === "string" ? error.requestId : undefined;
    if (response.status === 401 && code === "AUTHENTICATION_REQUIRED") {
      notifyUnauthorized();
    }
    throw new ApiClientError(
      code,
      message,
      response.status,
      fieldErrors,
      requestId,
    );
  }

  return payload.data as T;
}

export function jsonRequestInit(
  method: "POST" | "PATCH",
  body: unknown,
): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
