import { vi } from "vitest";

type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | Promise<Response>;

export function okEnvelope(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ ok: true, data, requestId: "req-test" }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export function errorEnvelope(
  status: number,
  code: string,
  message = "failure",
  fieldErrors?: Record<string, string[]>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        requestId: "req-test",
        ...(fieldErrors === undefined ? {} : { fieldErrors }),
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
