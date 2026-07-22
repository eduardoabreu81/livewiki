---
title: core package vitest configuration
owner: generated
anchors: []
---

# core package vitest configuration

This page documents the Vitest configuration file used by the `core` package's test runner.

## When to use this page

- **Configure** the `core` package's Vitest run by editing `packages/core/vitest.config.ts`.
- **Run** the package's unit tests with `vitest` to pick up the discoveries declared here.
- **Audit** coverage thresholds and exclusions before adding or removing source files.
- **Troubleshoot** missing or skipped tests by cross-checking the `include` and `exclude` globs against the source tree.

## How it fits

The `packages/core/vitest.config.ts` file lives alongside the `core` package's `package.json` and `tsconfig.json`, exporting a `defineConfig` object consumed by the Vitest CLI. It scopes the runner to the Node environment, restricts discovery to TypeScript test files under `src`, and steers the v8 coverage report. The configuration is package-local: it does not reach into sibling workspaces, and it does not declare any custom aliases, plugins, or setup files — anything beyond the defaults shown in the excerpt must come from elsewhere or be added inline.

## Test discovery and environment

The exported configuration sets `test.environment` to `"node"`, so test files execute in a Node runtime rather than jsdom or happy-dom. The `test.include` glob `["src/**/*.test.ts"]` is the only discovery pattern; any test file outside that glob will not be picked up by this configuration. The Vitest defaults (such as concurrency, reporter choice, and watch behavior) are left untouched in the visible source.

## Coverage settings

The `coverage` block sets `provider` to `"v8"` and registers two reporters: `"text"` for console output and `"html"` for a browsable report. The `coverage.include` glob `["src/**/*.ts"]` defines which source files are eligible to be measured, while `coverage.exclude` removes `src/**/*.test.ts` files and `src/index.ts` from the measurement set. This keeps the coverage report focused on the runtime source rather than test code or public re-export barrels.

## Coverage thresholds

The `coverage.thresholds` block sets floors that the run must clear:

```ts
thresholds: {
  lines: 80,
  functions: 80,
  statements: 80,
  branches: 75,
},
```

These numeric values match the inline comment in the excerpt, which references an internal "regra #5" minimum of 80% coverage on the `core` package and notes that `safe-io` is the critical module for "Fase 0", covered by `safe-io.test.ts`. The comment is part of the visible source but does not change executable behavior; a future edit should update the comment alongside any threshold change so the two stay in sync.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
