import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "packages/db/drizzle/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...nextVitals,
  ...nextTypeScript,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  {
    // Browser E2E helpers are plain JavaScript driven by Playwright's
    // runtime; type-aware rules cannot resolve them meaningfully.
    files: ["test/e2e/**/*.{js,mjs,ts}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Deployment helpers run directly under Node.js and are intentionally
    // outside the TypeScript project graph.
    files: ["packages/db/scripts/**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.config.{js,mjs,ts}", "eslint.config.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
