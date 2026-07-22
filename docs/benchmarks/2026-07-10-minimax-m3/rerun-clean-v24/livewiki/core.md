---
title: core Vitest configuration
owner: generated
anchors: []
---

# core Vitest configuration

This page documents the Vitest configuration that drives unit-test execution and coverage enforcement for the `core` package.

## When to use this page

- **Run** the `core` package test suite locally with Vitest to verify behavior changes.
- **Adjust** the coverage thresholds in `packages/core/vitest.config.ts` when expanding or retiring coverage targets.
- **Inspect** which source files participate in coverage and which are excluded before diagnosing a coverage gap.
- **Add** new `*.test.ts` files under `src/` to extend coverage of the `core` package.

## How it fits

The `core` package ships with its own `vitest.config.ts` at `packages/core/vitest.config.ts`, sitting alongside the repository's other workspace packages. It configures Vitest for the Node runtime, narrows test discovery to TypeScript source files, and applies V8-based coverage instrumentation with explicit per-metric thresholds. The configuration is the contract that local `vitest run` invocations, CI pipelines, and editor integrations all use to decide what counts as a passing test run and an adequately covered change inside `core`.

## Test discovery

The configuration opts into the `node` test environment, so tests execute in a plain Node.js context rather than jsdom or happy-dom. The `include` pattern is set to `src/**/*.test.ts`, which restricts Vitest's discovery to TypeScript test files that live under `src/` and follow the `*.test.ts` naming convention. Files such as `src/**/*.ts` that are not test files are not picked up as tests by this rule, even when they live alongside test files.

## Coverage instrumentation

Coverage is enabled through Vitest's built-in provider model with `provider: "v8"`, which delegates coverage collection to the V8 JavaScript engine's built-in inspector. Reporting is configured to emit both a `text` summary and an `html` report, so a developer running tests locally sees a console rollup while CI can archive an HTML artifact for browsing.

The `include` field scopes coverage measurement to `src/**/*.ts`, meaning every TypeScript source file under `src/` is a candidate for coverage tracking. The `exclude` field then narrows that scope by removing `src/**/*.test.ts` (test files are never measured against their own assertions) and `src/index.ts` (the package's public entry point is excused from coverage so re-export modules do not skew the metric).

## Coverage thresholds and the SPEC regra #5 note

A `thresholds` block enforces hard lower bounds on the reported metrics:

- `lines: 80`
- `functions: 80`
- `statements: 80`
- `branches: 75`

Exceeding these is acceptable; falling below them fails the run. The three line, function, and statement thresholds are aligned at 80%, while the branch threshold is set one tier lower at 75%, leaving room for defensive branches that are intentionally hard to exercise.

The configuration carries an inline comment that ties the thresholds to **SPEC regra #5**, which establishes a minimum coverage of 80% for the `core` package. The same comment names `safe-io` as the critical module of **Fase 0** and notes that its coverage is provided by `safe-io.test.ts`, framing the `safe-io` suite as the load-bearing test artifact that satisfies the 80% line, function, and statement floors for the package.