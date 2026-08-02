import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // E2E suites spawn real CLI subprocesses (init/index/batch with
    // SQLite + tree-sitter). On loaded CI Windows runners a single test
    // can take ~8s; the 5s default caused timeouts whose late `finally`
    // blocks then raced env mutations into the NEXT test (CI run
    // 30761766155: missing ANTHROPIC_API_KEY cascade). 30s ≈ 4x the
    // worst observed test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
