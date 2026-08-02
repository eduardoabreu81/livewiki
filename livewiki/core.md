---
title: "@livewiki/core package"
owner: generated
anchors: []
---

# `@livewiki/core` package

The `@livewiki/core` package is the workspace's shared runtime that exposes a single ESM entry point plus many subpath entry points covering parsing, indexing, persistence, and other concerns consumed by sibling packages and tooling.

## When to use this page

- **Inspect** the package's public surface (entry points, scripts, dependencies) before importing from `@livewiki/core/*` subpaths in another package.
- **Build or type-check** the package by running the `build` or `lint:tsc` scripts defined in `packages/core/package.json`.
- **Run the test suite** with `vitest run` (or `vitest` for watch mode, `vitest run --coverage` for the v8 coverage report) configured in `packages/core/vitest.config.ts`.
- **Verify coverage thresholds** for the core module (80% lines/functions/statements, 75% branches) when changing code under `packages/core/src`.

## How it fits

This package is the foundational library of the livewiki monorepo. Its `package.json` declares the `@livewiki/core` name with `"private": true` and `"type": "module"`, signaling that it is an internal ESM workspace package rather than a published artifact. The `exports` map defines one root import (`./`) and a long list of named subpath imports (for example `./safe-io`, `./parser`, `./db`, `./indexer`, `./frontmatter`, `./flows`, `./risk`, `./view`, `./install`), each pointing to a paired `./dist/<name>.js` and `./dist/<name>.d.ts`. Consumers therefore never read individual files directly — they resolve a subpath, and Node's exports field routes them to the corresponding build artifact.

The TypeScript build is configured by `packages/core/tsconfig.json`, which extends the monorepo's `../../tsconfig.base.json`, compiles everything under `src/` into `dist/`, and is invoked by the `build` and `lint:tsc` scripts. Tests live alongside the source and are picked up by `vitest.config.ts`, which restricts the test environment to Node, includes `src/**/*.test.ts`, and applies a v8 coverage gate focused on production code (`src/**/*.ts` minus `src/**/*.test.ts` and the umbrella `src/index.ts`). The package depends on `better-sqlite3`, `ignore`, `jsdom`, `marked`, `mermaid`, and several `tree-sitter` packages, which together supply SQLite persistence, `.gitignore`-aware file matching, DOM-based Markdown rendering, Mermaid diagram rendering, and syntactic parsing for JavaScript, Python, and TypeScript.

## Package identity and entry points

The manifest sets `"name": "@livewiki/core"`, `"version": "0.0.0"`, and `"main": "dist/index.js"` with `"types": "dist/index.d.ts"`. The `files` allowlist is `["dist"]`, so only the compiled output is meant to be portable across the workspace boundary. Every subpath export follows the same shape:

```json
"./<subpath>": {
  "types": "./dist/<subpath>.d.ts",
  "import": "./dist/<subpath>.js"
}
```

Notable subpath groupings visible in the source include parsing and indexing (`./parser`, `./symbols`, `./indexer`, `./anchor-ledger`), persistence (`./db`, `./status`), verification (`./verify`, `./anchors`), Markdown concerns (`./frontmatter`, `./hashes`), batch and update flows (`./batch`, `./batch-status`, `./update`, `./update-metrics`, `./pointer`), configuration and presets (`./config`, `./presets`, `./init`), exports (`./export`, `./readme-export`), graph/topic views (`./flows`, `./topics`, `./import-resolution`, `./risk`, `./orientation`, `./view`, `./view-activity`), impact analysis (`./blast-radius`, `./diff-preview`, `./change-impact`), and a few utility-flavoured entries (`./safe-io`, `./walker`, `./artifact`, `./gitignore`, `./install`, `./community`). Each one is independent at the resolver level; the manifest does not enforce any ordering or co-import relationship between them.

## Scripts and dependency posture

The `scripts` block is intentionally small:

- `build` — `tsc -p tsconfig.json` produces `dist/` from `src/`.
- `test` — `vitest run` executes the suite once.
- `test:watch` — `vitest` runs in interactive watch mode.
- `test:coverage` — `vitest run --coverage` produces the v8 coverage report (see the next section for thresholds).
- `lint:tsc` — `tsc -p tsconfig.json --noEmit` type-checks without emitting output.

Runtime dependencies cover persistence (`better-sqlite3`), filesystem filtering (`ignore`), DOM-backed Markdown parsing (`jsdom`, `marked`), diagram rendering (`mermaid`), and tree-sitter parsing for JavaScript, Python, and TypeScript via `web-tree-sitter`. Dev dependencies pin TypeScript 5.6, Vitest 2.1, the v8 coverage plugin, Node type definitions, and the `tree-sitter-cli` binary.

## Build configuration

`packages/core/tsconfig.json` extends the shared base config and adds only what is local to this package:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

The `rootDir` is `src`, so every TypeScript file consumed by the build must live under `src/`, and emitted JavaScript plus declaration files land under `dist/` mirroring that layout. The `include` glob restricts the program to that same subtree.

## Test configuration and coverage gate

`packages/core/vitest.config.ts` uses Vitest's `defineConfig` and pins the suite to a Node environment. The `test.include` glob `src/**/*.test.ts` keeps test discovery co-located with the source. Coverage uses the `v8` provider, reports `text` and `html` formats, and limits measurement to `src/**/*.ts` while excluding `src/**/*.test.ts` and `src/index.ts` — meaning the umbrella entry point is intentionally not held to the same coverage gate as the rest of the package. The thresholds block in the source carries an inline comment naming `safe-io` as the Phase-0 critical module covered by `safe-io.test.ts`, and sets:

- `lines: 80`
- `functions: 80`
- `statements: 80`
- `branches: 75`

Anything that drops these metrics below the configured thresholds will fail the coverage-enabled run.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
