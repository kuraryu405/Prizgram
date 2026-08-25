import type { z } from "zod";

export class JsonColumnValidationError extends Error {
  override readonly name = "JsonColumnValidationError";

  constructor(
    readonly column: string,
    options?: ErrorOptions,
  ) {
    super(`Invalid structured data in ${column}`, options);
  }
}

export function encodeJsonColumn<T>(
  column: string,
  schema: z.ZodType<T>,
  value: unknown,
): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new JsonColumnValidationError(column, { cause: parsed.error });
  }
  return JSON.stringify(parsed.data);
}

export function decodeJsonColumn<T>(
  column: string,
  schema: z.ZodType<T>,
  value: string,
): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch (error) {
    throw new JsonColumnValidationError(column, { cause: error });
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new JsonColumnValidationError(column, { cause: parsed.error });
  }
  return parsed.data;
}
