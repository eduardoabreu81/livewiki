---
title: CLI package test runner configuration
owner: generated
anchors: []
---

# CLI package test runner configuration

This page documents the Vitest configuration that drives unit tests for the `@livewiki/cli` package.

## When to use this page

- **Verify** the runtime and discovery rules used by `pnpm test` (or an equivalent `vitest run`) inside `packages/cli`.
- **Extend** the configuration when adding new test file conventions, environment overrides, or coverage thresholds.
- **Diagnose** why a test file is or is not picked up by the suite by checking the `include` glob against the actual file location.
- **Mirror** this baseline when authoring sibling packages so they share a consistent Vitest contract.

## How it fits

The configuration lives at `packages/cli/vitest.config.ts`, sitting alongside the package source under `packages/cli/src`. It is consumed by Vitest when the package's test script runs, and it constrains the test environment, the file patterns Vitest scans, and the global defaults applied to every test file discovered in this package. Because it is a leaf-level Vitest config, it has no upstream import; it is the entry point Vitest reads from this package's working directory. Other packages in the monorepo are expected to carry equivalent configurations, so this file should be reviewed in tandem with their `vitest.config.ts` files when standardizing tooling.

## Configuration contents

The file imports `defineConfig` from `vitest/config` and exports the result of calling it with a single `test` option object. The exported default has the following effective shape:

```ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- **Runtime environment**: `environment: "node"` tells Vitest to use the Node.js test environment rather than `jsdom`, `happy-dom`, or `edge-runtime`. This is appropriate for a CLI package whose code is meant to execute under Node and not a browser-like global.
- **Discovery glob**: `include: ["src/**/*.test.ts"]` restricts Vitest to files matching the `*.test.ts` pattern anywhere under `src/`. Tests placed outside `src/`, or written with a `.spec.ts` suffix, will not be discovered by this configuration.
- **Implied defaults**: any option not set here — for example `coverage`, `setupFiles`, `globals`, `reporters`, or `testTimeout` — falls back to Vitest's built-in defaults. Because this excerpt does not enumerate them, it does not establish exhaustive behavior for those settings; consult the Vitest version pinned by the package if a non-default value is observed at runtime.

## Adding new tests

New tests for this package should be placed under `packages/cli/src/` and named with the `.test.ts` suffix so that the existing `include` glob picks them up. If a future change introduces a different naming convention (for example `*.spec.ts`) or a new directory such as `src/__tests__/`, the `include` array must be updated in lockstep; otherwise the file will be silently skipped by the runner.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
