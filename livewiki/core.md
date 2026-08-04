---
title: Core Engine Package
owner: generated
---

# Core Engine Package

The `@livewiki/core` package hosts the deterministic structural index and batch documentation engine that powers livewiki.

## When to use this page

- **Configure** the TypeScript and Vitest toolchain for the core package.
- **Resolve** which subpath export to import when wiring livewiki into a downstream consumer.
- **Diagnose** test timeout and coverage threshold expectations when running the suite locally or in CI.

## How it fits

This page covers the package-level surface for `@livewiki/core`: the manifest, the TypeScript project configuration, and the Vitest configuration. The package ships as an ESM module (`"type": "module"`) under the `dist` output directory built from `src/**/*.ts`, with the published entry points enumerated under `exports` (root plus a long list of named subpaths such as `./parser`, `./symbols`, `./db`, `./indexer`, `./anchor-ledger`, `./verify`, `./batch`, `./update`, `./view`, and `./diff-preview`). Runtime dependencies include `better-sqlite3`, `ignore`, `jsdom`, `marked`, `mermaid`, and the `tree-sitter-*` family compiled via `web-tree-sitter`; `tree-sitter-cli` is a dev dependency for grammar tooling. Build artifacts and tree-sitter grammars travel in the published tarball through the `files` allowlist (`dist` and `grammars`).

The three paths documented here — `packages/core/package.json`, `packages/core/tsconfig.json`, and `packages/core/vitest.config.ts` — sit at the root of the package and only configure build, test, and publish behavior; they do not themselves contain source symbols. Per-symbol documentation lives on the subpath pages that each export maps to.

## Diagram

```mermaid
%% livewiki/diagrams/core.mmd
```

## Package manifest

`packages/core/package.json` declares the package identity (`@livewiki/core`, version `0.1.0`, MIT) and the `engines.node` floor of `>=24`. The `main` and `types` fields point at `dist/index.js` and `dist/index.d.ts`, while the `exports` map mirrors those for the root plus every named subpath listed in the package surface. `publishConfig.access` is set to `public` so the package can be installed from the registry. The `scripts` block wires `build` to `tsc -p tsconfig.json`, `test` / `test:watch` to `vitest`, and exposes a `lint:tsc` no-emit typecheck as well as `test:coverage` for the v8 reporter.

## TypeScript configuration

`packages/core/tsconfig.json` extends the workspace base (`../../tsconfig.base.json`) and narrows it to this package: `outDir` is `dist`, `rootDir` is `src`, and `include` is limited to `src/**/*.ts`. There is no `exclude` override, so the default workspace exclusion list still applies; tests live under `src/**/*.test.ts` and are compiled by the same project but are excluded from the coverage scope by the Vitest config.

## Vitest configuration

`packages/core/vitest.config.ts` sets the `node` test environment and globs `src/**/*.test.ts` as the suite. `testTimeout` and `hookTimeout` are both raised to `30_000` ms; the inline comment explains that loaded CI Windows runners cause git-spawning suites (risk/churn, status freshness) and the batch suites to exceed the 5 s Vitest default — the documented "batch-review 5s-timeout flake" class — and that 30 s matches the CLI E2E budget.

Coverage is delegated to the `v8` provider with `text` and `html` reporters. The `include` glob is `src/**/*.ts`; `src/**/*.test.ts` and `src/index.ts` are excluded from the report. The `thresholds` block enforces the SPEC regra #5 floor — 80 % lines, 80 % functions, 80 % statements, and 75 % branches — with the inline note that `safe-io` is the critical Phase 0 module and is covered by `safe-io.test.ts`.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
