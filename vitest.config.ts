import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://patch:patch@localhost:5432/patch_test",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
      PATCH_BASE_URL: "http://localhost:3000",
    },
  },
});
