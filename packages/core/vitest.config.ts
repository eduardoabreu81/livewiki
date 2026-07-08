import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        // SPEC regra #5: cobertura mínima 80% no core. safe-io é o módulo
        // crítico da Fase 0 e está coberto pelos testes em safe-io.test.ts.
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});