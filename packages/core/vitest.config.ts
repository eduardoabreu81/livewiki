import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Loaded CI Windows runners make git-spawning tests (risk/churn,
    // status freshness) and the batch suites exceed the 5s default —
    // the documented "batch-review 5s-timeout flake" class. 30s matches
    // the CLI E2E budget and covers the whole class at once.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        // SPEC rule #5: minimum 80% coverage in core. safe-io is the critical
        // Phase 0 module and is covered by the tests in safe-io.test.ts.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});