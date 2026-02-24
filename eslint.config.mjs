import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import testingLibrary from "eslint-plugin-testing-library";
import vitest from "eslint-plugin-vitest";

const TEST_FILES = ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Testing Library — catches common RTL mistakes (scoped to test files only)
  {
    files: TEST_FILES,
    ...testingLibrary.configs["flat/react"],
    rules: {
      ...testingLibrary.configs["flat/react"].rules,
      // Downgrade to warn: many existing tests use container.querySelector to
      // check CSS classes — a full migration to role queries is out of scope.
      "testing-library/no-container": "warn",
      "testing-library/no-node-access": "warn",
    },
  },
  // Vitest — catches common Vitest mistakes (scoped to test files only)
  {
    files: TEST_FILES,
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // Allow expectTypeOf (Vitest type-level assertions) as a valid assertion.
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectTypeOf"] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vercel build output:
    ".vercel/**",
    // CDK build output:
    "infra/cdk/cdk.out/**",
    // Server has its own tsconfig/linting:
    "server/**",
    // CDK infra has its own tsconfig:
    "infra/**",
  ]),
]);

export default eslintConfig;
