import { customType } from "drizzle-orm/sqlite-core";
import type { z } from "zod";

import { decodeJsonColumn, encodeJsonColumn } from "@prizgram/shared";

export function validatedJsonText<T>(label: string, schema: z.ZodType<T>) {
  return customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    fromDriver: (value) => decodeJsonColumn(label, schema, value),
    toDriver: (value) => encodeJsonColumn(label, schema, value),
  });
}
