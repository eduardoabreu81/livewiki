---
title: "core Vitest configuration"
owner: generated
anchors: []
---

# core Vitest configuration

This page documents the Vitest configuration that governs how the `@livewiki/core` package runs its unit tests and reports coverage.

## When to use this page

- **Run** the package's test suite with the documented environment and file-pattern settings before publishing or merging changes to `packages/core`.
- **Check** that coverage thresholds defined here are met after modifying core sources, and review which files are excluded from coverage.
- **Adjust** the included file patterns, excluded files, or coverage reporter set when adding new tooling expectations to the core package.
- **Verify** that node-environment-only assumptions in core source files match the configuration before adding browser-dependent helpers.

## How it fits

`packages/core/vitest.config.ts` is the Vitest configuration file for the `@livewiki/core` package within the livewiki monorepo. It sits alongside the package's `package.json` and `src/` directory and is read by Vitest's CLI when tests are executed from the package root. The file does not declare any runtime exports; it is consumed solely by the test runner and by tooling that introspects the Vitest configuration (such as coverage reporters). The configuration described here is local to the core package — other livewiki packages are expected to ship their own `vitest.config.ts` files with package-specific choices.

## Configuration shape

The file calls `defineConfig` from `vitest/config` once and exports the resulting object as its default export. There is no environment-specific override or programmatic branching in the source: a single configuration object applies to every invocation of Vitest against this package.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ ... });
```

## Test discovery

The `test` block pins the environment to Node and restricts test discovery to TypeScript files that match the `src/**/*.test.ts` glob.

- `environment: "node"` selects Vitest's Node environment, so tests run under a Node-style global (no JSDOM/DOM globals are injected unless a test provides its own).
- `include: ["src/**/*.test.ts"]` limits Vitest to files whose path starts with the package's `src/` directory and whose filename ends in `.test.ts`. Files outside that pattern (including any future non-`.test.ts` spec naming conventions) are not picked up by this configuration.

## Coverage settings

The `coverage` sub-block configures the v8 coverage provider and the set of files that count toward coverage statistics, then declares the minimum thresholds the suite must meet.

- `provider: "v8"` selects Vitest's built-in v8-based coverage instrumentation, which reads coverage counters emitted by the Node.js V8 engine rather than relying on a separate Babel/transform pipeline.
- `reporter: ["text", "html"]` enables both a console-friendly text summary and an HTML report. Any tooling or CI step that expects additional formats (for example `lcov`, `json`) would need to extend this array.
- `include: ["src/**/*.ts"]` defines the universe of source files whose usage is measured. Test files and the package's barrel entry point are explicitly carved out below.
- `exclude: ["src/**/*.test.ts", "src/index.ts"]` removes test files (to avoid counting test code against coverage targets) and excludes `src/index.ts`, which is the package's public re-export surface rather than behavior-bearing logic.
- `thresholds` enforces minimum coverage percentages that gate the test run. The inline comment before these thresholds ties them to the project's rule that core must maintain a baseline of roughly 80% coverage, with the `safe-io` module called out as the critical Phase 0 module whose coverage is carried by `safe-io.test.ts`.

```ts
coverage: {
  provider: "v8",
  reporter: ["text", "html"],
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/index.ts"],
  thresholds: {
    lines: 80,
    functions: 80,
    statements: 80,
    branches: 75,
  },
}
```

## Threshold values

- `lines: 80` requires at least 80% of executable lines across included files to be exercised by tests.
- `functions: 80` requires at least 80% of declared functions to be invoked during the suite.
- `statements: 80` aligns the statement-level expectation with the line and function targets at 80%.
- `branches: 75` allows branches (such as `if`/`else` arms) a slightly lower floor of 75%, which is the only metric whose target dips below the 80% ceiling applied to the others.

The excerpt as supplied does not establish how these thresholds interact with CI gating (for example, whether Vitest is invoked with `--coverage` in CI), nor does it show any per-file overrides; only what is visible in this single configuration file can be summarized here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
