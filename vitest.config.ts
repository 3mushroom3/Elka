import path from "node:path";
import { defineConfig } from "vitest/config";
import { pgUrl } from "./scripts/pg";
import { TEST_DATABASE, TEST_PORT } from "./tests/constants";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Все тесты работают с одной тестовой базой, поэтому файлы идут по очереди.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: { DATABASE_URL: pgUrl(TEST_PORT, TEST_DATABASE) },
  },
});
