---
title: livewiki core vitest configuration
owner: generated
anchors: []
---

# livewiki core vitest configuration

This page documents the vitest configuration that governs how the `@livewiki/core` package runs its unit tests and reports code coverage.

## When to use this page

- **Adjust** the Node test environment, test discovery patterns, or v8 coverage scope for the core package.
- **Verify** whether the configured coverage thresholds for lines, functions, statements, and branches reflect the policy described in the source comment.
- **Read** the exclusion patterns to understand which files are intentionally omitted from coverage measurement.

## How it fits

The `packages/core/vitest.config.ts` file lives next to the core package source and is consumed by the vitest runner invoked from the repository's workspace tooling. It complements the per-package source under `packages/core/src/` by declaring how that source should be tested rather than implementing any runtime behavior. Within the broader repository, it is one of several package-level vitest configs; product code paths reach it only indirectly, through the test runner resolving this config when executing the core test suite.

## Test runner settings

The configuration uses vitest's `defineConfig` helper and exports a single config object. The `test` block selects the Node execution environment, so tests run against the standard Node.js runtime instead of a DOM or jsdom shim. Discovery is limited to TypeScript files matching `src/**/*.test.ts`, which means every test file for the core package must live under `src/` and end with the `.test.ts` suffix to be picked up.

## Coverage configuration

The `coverage` block registers the v8 instrumentation provider and declares two reporters — `text` for terminal output and `html` for a navigable report. The `include` pattern narrows coverage measurement to TypeScript sources under `src/**/*.ts`, while `exclude` removes two specific categories: every `*.test.ts` file (so test code itself is not measured) and `src/index.ts` (the package's public entry barrel).

### Coverage thresholds

The inline comment ties these thresholds to a documented rule (`SPEC` rule #5) that mandates a minimum of 80% coverage on the core package, with `safe-io` described as the critical module of Phase 0 and covered by `safe-io.test.ts`. The thresholds are then expressed numerically:

- `lines`: 80
- `functions`: 80
- `statements`: 80
- `branches`: 75

The branches threshold is intentionally lower than the other three metrics, which is a deliberate soft line for branching coverage while keeping line, function, and statement coverage at the headline 80% floor. Because the values are declared directly in this config, changing the policy requires editing this file.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
