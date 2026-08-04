---
title: "@livewiki/cli — livewiki command-line interface"
owner: generated
anchors: []
---

# @livewiki/cli — livewiki command-line interface

The `cli` package publishes the `livewiki` command-line interface that turns a source tree into anchored, verifiable documentation.

## When to use this page

- **Build** the package with `npm run build` when iterating on the CLI source.
- **Run** the Vitest test suite (`npm test` or `npm run test:watch`) to validate the CLI behavior locally.
- **Ship** the package by publishing from `dist/`, `skills/`, and `templates/` as declared in `package.json`'s `files` field.
- **Lint** the TypeScript surface with `npm run lint:tsc` without producing output.

## How it fits

The `cli` package lives under `packages/cli` in the livewiki monorepo and depends on the sibling `@livewiki/core` workspace package; together they implement the end-to-end pipeline that anchors markdown to code symbols. It is a Node-native (ESM) package, declared with `"type": "module"`, and ships a single executable named `livewiki` that resolves to `dist/index.js`. Build output is rooted at `src/` and emitted to `dist/` via `tsconfig.json`, and the runtime requires Node `>=24`. Test execution is delegated to Vitest, which is configured to run against the Node environment and to include any `*.test.ts` file under `src/`.

## Package manifest

```json
{
  "name": "@livewiki/cli",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "livewiki command-line interface — living documentation anchored to code, verifiable against hallucination.",
  "license": "MIT",
  "bin": {
    "livewiki": "dist/index.js"
  },
  "main": "dist/index.js",
  "files": ["dist", "skills", "templates"],
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/make-executable.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint:tsc": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@livewiki/core": "workspace:*",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^22.0.0"
  }
}
```

The manifest declares the package as public (`publishConfig.access: "public"`), pins the Node engine to `>=24`, and points the `livewiki` binary at the compiled `dist/index.js`. Two runtime dependencies are declared: the workspace-linked `@livewiki/core` and the `commander` package at `^12.1.0`. The `files` array restricts what `npm publish` ships to `dist/`, `skills/`, and `templates/`, so any source-only artifacts outside those directories are excluded from the published artifact.

## Build configuration

The TypeScript build extends the monorepo base config at `../../tsconfig.base.json` and overrides two options:

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

Compilation is restricted to `src/**/*.ts`, which becomes the input root for `rootDir`, and the resulting files are emitted to `dist/`. The `npm run build` script chains `tsc -p tsconfig.json` with `node scripts/make-executable.mjs`, so after TypeScript emits the executable, the post-processing step is responsible for making the bundle runnable as the `livewiki` binary declared in `package.json`.

## Test configuration

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

Vitest runs in Node mode and collects any `src/**/*.test.ts` file. Both `testTimeout` and `hookTimeout` are raised to `30_000` ms. The inline comment in the config explains the reason: end-to-end suites spawn real CLI subprocesses (init, index, batch) that drive SQLite and tree-sitter; on a loaded CI Windows runner, a single test has been observed to take roughly 8 seconds, and the 5-second default caused timeouts whose late `finally` blocks then raced environment mutations into the next test, producing a cascade reported on CI run `30761766155` (missing `ANTHROPIC_API_KEY`). The 30-second budget is described as approximately four times the worst observed test.

## Diagram

```mermaid
%% livewiki/diagrams/cli.mmd
```

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
