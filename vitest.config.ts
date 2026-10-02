import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests drive real Git repositories; 5 s is too tight on a loaded runner.
    testTimeout: 30_000,
    coverage: {
      enabled: false,
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 50,
        branches: 35,
        functions: 50,
        lines: 50,
      },
    },
  },
});
