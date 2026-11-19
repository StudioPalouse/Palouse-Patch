import { defineConfig } from "vitest/config";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://patch:patch@localhost:5432/patch_test";
// Global setup runs in this process, so it reads from process.env directly.
process.env.TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      PATCH_BASE_URL: "http://localhost:3000",
      PATCH_AUTO_MIGRATE: "false",
    },
  },
});
