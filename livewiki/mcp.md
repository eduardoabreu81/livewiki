---
title: "@livewiki/mcp package configuration"
owner: generated
anchors: []
---

# @livewiki/mcp package configuration

The `@livewiki/mcp` package bundles configuration files that wire a Model Context Protocol server implementation into the livewiki workspace, declaring its dependencies, TypeScript build target, and vitest test environment.

## When to use this page

- Use the **build** script (`tsc -p tsconfig.json && node scripts/make-executable.mjs`) to compile `src/` into the published `dist/` output and mark the resulting CLI entry executable.
- Use the **test** and **test:watch** scripts (`vitest run` and `vitest`) to execute the Node-environment unit tests collected under `src/**/*.test.ts`.
- Use the **lint:tsc** script (`tsc -p tsconfig.json --noEmit`) to type-check the package without producing build output.
- Use the exported `bin` field (`livewiki-mcp` -> `dist/index.js`) when wiring the package as a CLI consumer dependency in another workspace package.

## How it fits

The `@livewiki/mcp` package lives under `packages/mcp` in the livewiki monorepo. Its `package.json` declares a private, ESM type module that depends on `@livewiki/core` via the workspace protocol plus the `@modelcontextprotocol/sdk`, `better-sqlite3`, and `zod` runtime libraries, and it exposes a single CLI binary named `livewiki-mcp` whose entry is the compiled `dist/index.js`. The TypeScript build is configured by extending `../../tsconfig.base.json` with output directed to `dist` and compilation rooted in `src`, and the vitest configuration loads tests under `src/**/*.test.ts` in a Node environment.

## Build configuration

The `tsconfig.json` file extends the repository-wide base configuration at `../../tsconfig.base.json`. It overrides `outDir` to `dist` and `rootDir` to `src`, and constrains `include` to `src/**/*.ts`. Compilation therefore walks only the package's own source tree and emits JavaScript alongside the `dist/` directory that `package.json`'s `files` and `main` fields reference.

The `package.json` `scripts.build` entry chains the TypeScript compiler (`tsc -p tsconfig.json`) with `node scripts/make-executable.mjs`, so a successful build produces the bundled CLI and ensures the emitted `dist/index.js` carries the executable bit expected by the `bin` mapping.

## Dependency surface

Runtime dependencies are limited to four packages:

- `@livewiki/core` resolved through `workspace:*`, sourcing the sibling package in this monorepo.
- `@modelcontextprotocol/sdk` at `^1.29.0`, supplying the MCP protocol primitives used by the server entry.
- `better-sqlite3` at `^12.0.0`, paired with the `@types/better-sqlite3` `^7.6.0` dev type package for the embedded database layer.
- `zod` at `^4.0.0`, supplying runtime schema validation.

TypeScript, `@types/node`, and `vitest` are kept under `devDependencies` and are not bundled with the published `dist` artifact.

## CLI entry and packaging

```json
"main": "dist/index.js",
"bin": {
  "livewiki-mcp": "dist/index.js"
},
"files": ["dist"]
```

The package publishes only the `dist` directory. Consumers invoking the `livewiki-mcp` binary load the compiled JavaScript produced by the build script, which is the same file referenced by `main` for programmatic imports.

## Test configuration

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Vitest is configured with a Node runtime, so tests execute against the same JavaScript environment the production server targets. The `include` glob restricts test discovery to files matching `src/**/*.test.ts`, keeping fixture data and other helpers out of the test runner's collection step.

## Scripts reference

| Script | Command | Purpose |
| --- | --- | --- |
| `build` | `tsc -p tsconfig.json && node scripts/make-executable.mjs` | Compile `src/` and make the CLI entry executable. |
| `test` | `vitest run` | Run the Node-environment unit tests once. |
| `test:watch` | `vitest` | Run the unit tests in watch mode. |
| `lint:tsc` | `tsc -p tsconfig.json --noEmit` | Type-check the package without emitting output. |

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
