---
title: "Core package vitest configuration"
owner: generated
anchors: []
---

# Core package vitest configuration

This page documents the Vitest configuration that governs test execution and coverage reporting for the `core` package.

## When to use this page

- Use **vitest** to run the `core` package's unit tests in Node.
- Use **v8 coverage** to enforce the package's minimum coverage thresholds.
- Read this page to understand which files are included or excluded from the test run and the coverage report.

## How it fits

The `packages/core/vitest.config.ts` file is the Vitest configuration consumed by the `core` package's tooling. It defines the runtime environment for the suite, the file globs that Vitest collects, and the coverage provider, reporters, and thresholds that gate the build. The repository uses this file together with `src/**/*.test.ts` files inside `packages/core` to verify behaviour during the Fase 0 milestones referenced in the inline comment, with `safe-io.test.ts` highlighted as the suite that exercises the critical `safe-io` module.

## Test runner

Vitest is initialised with the Node environment, so test files execute under Node rather than a browser-like or jsdom-like runtime.

```ts
test: {
  environment: "node",
  include: ["src/**/*.test.ts"],
}
```

The `include` glob restricts the runner to TypeScript files living under `packages/core/src` whose filenames end in `.test.ts`.

## Coverage configuration

Coverage is produced by the `v8` provider and rendered both as text and as an HTML report. The `include` and `exclude` globs shape which TypeScript sources count toward coverage: every file under `src/**/*.ts` is considered, while test files (`src/**/*.test.ts`) and the package entry point `src/index.ts` are excluded from the measurement. `safe-io` is the critical module of Fase 0 and is covered by `safe-io.test.ts`, per the inline comment, so excluding only test files and the index barrel keeps the reported metric focused on real source.

The configuration imposes the following thresholds, which gate the build when coverage falls below them:

| Metric      | Threshold |
| ----------- | --------- |
| lines       | 80        |
| functions   | 80        |
| statements  | 80        |
| branches    | 75        |

These values match the inline comment, which cites SPEC rule #5 that the `core` package must ship with at least 80% coverage and treats `safe-io` as the module responsible for meeting that bar.

## Notes on the visible excerpt

The supplied excerpt shows the full file as it stands: a single `defineConfig` call that returns the configuration object above. There is no fallback branch, custom reporter, or runtime hook visible in the source, so the page is scoped strictly to the behaviour observable from that excerpt and does not assume any additional configuration consumed from elsewhere.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
