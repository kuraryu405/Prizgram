import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { structuredJsonColumns } from "../src/client";
import { schema, tableNames } from "../src/schema";

describe("schema consistency", () => {
  it("keeps tableNames aligned with the exported drizzle schema", () => {
    const schemaTableNames = Object.values(schema).map(
      (table) => getTableConfig(table).name,
    );
    expect([...schemaTableNames].sort()).toEqual([...tableNames].sort());
  });

  it("covers every custom (validated JSON) column in the post-migration validator", () => {
    const customColumnLabels = Object.values(schema).flatMap((table) => {
      const config = getTableConfig(table);
      return config.columns
        .filter((column) => column.columnType === "SQLiteCustomColumn")
        .map((column) => `${config.name}.${column.name}`);
    });
    const validatedLabels = structuredJsonColumns.map(
      ({ table, column }) => `${table}.${column}`,
    );
    expect([...customColumnLabels].sort()).toEqual([...validatedLabels].sort());
  });
});
