import { defineConfig } from "drizzle-kit";

import {
  databasePathFromUrl,
  databaseUrlFromEnvironment,
  loadPrizgramEnvironment,
} from "./packages/db/src/config";

loadPrizgramEnvironment();

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/db/src/schema.ts",
  out: "./packages/db/drizzle",
  dbCredentials: {
    url: databasePathFromUrl(databaseUrlFromEnvironment()),
  },
  strict: true,
  verbose: true,
});
