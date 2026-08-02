---
title: livewiki CLI package
owner: generated
anchors: []
---

# livewiki CLI package

This page documents the `@livewiki/cli` package, the published command-line entry that ships under the `livewiki` binary name.

## When to use this page

- **Build** the CLI with `pnpm build` (or the package's `build` script) when you need to refresh the executable that consumers install.
- **Run** the Vitest suite via `pnpm test` or `pnpm test:watch` to exercise the test files under `src/`.
- **Inspect** TypeScript correctness with `pnpm lint:tsc`, which performs a no-emit type check against `tsconfig.json`.
- **Package** the CLI by relying on the `files` field, which restricts the published tarball to `dist`, `skills`, and `templates`.

## How it fits

`@livewiki/cli` is a workspace-scoped, private package inside the livewiki monorepo. It depends on `@livewiki/core` from the same workspace and on `commander` for argument parsing, and it is intended to be consumed via the `livewiki` binary that resolves to `dist/index.js`. The package declares `dist`, `skills`, and `templates` as the only directories shipped to consumers, and its build pipeline runs `tsc` followed by a `node scripts/make-executable.mjs` post-step that prepares the published artifact. Vitest is configured with the Node environment and resolves tests anywhere under `src/**/*.test.ts`. Because no canonical symbols were extracted for this module, the sections below describe the visible configuration only.

## Build pipeline

The `build` script chains two steps:

```
tsc -p tsconfig.json && node scripts/make-executable.mjs
```

The first step is a TypeScript compile that targets `dist/` from sources under `src/` (per `outDir` and `rootDir`), and `tsconfig.json` extends the monorepo root `tsconfig.base.json`. The second step runs `scripts/make-executable.mjs`, which is not part of the three supplied paths but is referenced from the script.

## Test runner

The Vitest configuration selects the Node environment and matches every `*.test.ts` file under `src/`. The visible config does not set up coverage reporters, custom aliases, or environment variables, so the suite runs with Vitest defaults.

## TypeScript configuration

The local `tsconfig.json` extends `../../tsconfig.base.json` and overrides only `outDir` (set to `dist`) and `rootDir` (set to `src`). The `include` array restricts compilation to `src/**/*.ts`, so files such as `vitest.config.ts` (which lives outside `src/`) are not part of the regular compile graph but are still picked up by their own tooling.

## Binaries and entry points

The package publishes a `livewiki` binary that resolves to `dist/index.js`, the same path used as `main`. Because both `bin` and `main` point at the compiled output, runtime consumers never load TypeScript sources directly; the `build` script is the only way that artifact is produced.

## Workspace dependencies

Runtime dependencies are limited to `@livewiki/core` (workspace protocol) and `commander` `^12.1.0`. Dev dependencies are TypeScript `^5.6.0`, Vitest `^2.1.0`, and `@types/node` `^22.0.0`. The visible excerpt does not show any additional tooling such as ESLint, Prettier, or a linter script.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
