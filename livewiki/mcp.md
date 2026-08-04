---
title: livewiki MCP server package
owner: generated
---

# livewiki MCP server package

The `@livewiki/mcp` package exposes the livewiki repository wiki as a Model Context Protocol (MCP) server that any MCP-compatible client can connect to.

## When to use this page

- **Install** the package as a workspace dependency when you want an MCP server binary in the livewiki monorepo.
- **Configure** Node and TypeScript tooling to match the package's `engines`, build, and test scripts before contributing source under `packages/mcp/src`.
- **Run** the test suite with `vitest` against the `src/**/*.test.ts` files defined in the Vitest configuration.
- **Ship** the compiled output (`dist/index.js`) and use the `livewiki-mcp` bin entry to launch the MCP server.

## How it fits

`packages/mcp` is one workspace package inside the livewiki monorepo. Its `package.json` declares it as a public ESM module named `@livewiki/mcp`, with `private: false`, `type: "module"`, and an MIT license. The `repository` field points at `eduardoabreu81/livewiki.git` under the `packages/mcp` directory, and the `publishConfig.access` is set to `public`, so the build artifact is intended to be published to an npm registry. The build runs `tsc -p tsconfig.json` followed by `node scripts/make-executable.mjs`, which suggests the compiled JavaScript is then post-processed so it can be launched directly from the `livewiki-mcp` bin name.

The package depends on three runtime libraries and one workspace sibling. It pulls in `@livewiki/core` via the `workspace:*` protocol, indicating it shares internal livewiki code with the core package. The other runtime dependencies are `@modelcontextprotocol/sdk ^1.30.0` for MCP server wiring, `better-sqlite3 ^12.0.0` for local SQLite storage, and `zod ^4.0.0` for schema validation. Dev dependencies cover TypeScript types for `better-sqlite3` and Node, the TypeScript compiler, and Vitest for testing.

The `tsconfig.json` extends `../../tsconfig.base.json` and narrows the TypeScript build to `src/**/*.ts`, emitting into `dist/` while keeping the project rooted at `src`. The Vitest configuration declares a Node test environment and restricts test discovery to `src/**/*.test.ts`, matching the same source root used by the TypeScript build. Together, these three configuration files describe a self-contained workspace package whose source, build, and test boundaries are all aligned on `src/`.

## Diagram

```mermaid
%% livewiki/diagrams/mcp.mmd
```

## Package manifest

The visible configuration files contain no extracted source symbols. The following H3 headings describe the responsibilities of each file as they appear in the supplied excerpts.

### package.json — `@livewiki/mcp` 0.1.0

The manifest declares the package identity, distribution shape, and script surface. The visible fields show:

- `name: "@livewiki/mcp"` and `version: "0.1.0"`, with `private: false` and `license: "MIT"`.
- `type: "module"` so Node treats `.js` output as native ESM.
- `main: "dist/index.js"` and `bin: { "livewiki-mcp": "dist/index.js" }`, which means the built file doubles as both the package entry point and the CLI executable exposed under the `livewiki-mcp` name.
- `files: ["dist"]` restricting the published tarball to the build output.
- `engines.node: ">=24"`, requiring a modern Node runtime for the MCP server.
- `scripts.build`, `scripts.test`, `scripts.test:watch`, and `scripts.lint:tsc` covering compilation, type-checking, and Vitest-driven test runs.
- `dependencies` on `@livewiki/core` (workspace), `@modelcontextprotocol/sdk ^1.30.0`, `better-sqlite3 ^12.0.0`, and `zod ^4.0.0`.
- `devDependencies` for TypeScript types, the TypeScript compiler, and Vitest.

The `repository.directory` field pins this package to the `packages/mcp` folder of the monorepo, and `publishConfig.access: "public"` confirms it is intended for public npm distribution.

### tsconfig.json — TypeScript project settings

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

This file inherits shared compiler settings from the monorepo root, redirects compiled output into `dist/`, constrains the root directory to `src/`, and limits TypeScript compilation to `src/**/*.ts`. The combination keeps the build output layout predictable and ensures the published `dist/` contains only the compiled sources from `src/`.

### vitest.config.ts — test runner settings

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

The Vitest configuration is minimal. It selects the `node` test environment and restricts test discovery to files matching `src/**/*.test.ts`, so the same source root used by the TypeScript compiler also defines the test boundary. Tests are invoked through the `test` and `test:watch` scripts declared in `package.json`.

## Runtime dependencies and scripts

Because the closed key list for this module is empty, this section is intentionally unanchored and describes only what the supplied excerpts make visible.

### Build pipeline

The `build` script chains two commands: `tsc -p tsconfig.json` followed by `node scripts/make-executable.mjs`. The first step compiles `src/**/*.ts` into `dist/`. The second step runs a helper script that, based on the bin entry pointing at `dist/index.js`, prepares the compiled output so it can be executed as the `livewiki-mcp` CLI.

### Test pipeline

The `test` script invokes `vitest run` for a single run, while `test:watch` starts Vitest in interactive watch mode. Both rely on the `src/**/*.test.ts` include pattern from `vitest.config.ts`.

### Type-check pipeline

The `lint:tsc` script runs `tsc -p tsconfig.json --noEmit`, which performs TypeScript type-checking without producing output. This is useful in CI or pre-commit hooks when the build artifacts are not yet needed.

### Engine requirement

The `engines.node: ">=24"` field declares a minimum Node version of 24. Consumers and CI environments must satisfy this constraint; the excerpt does not show any visible runtime fallback for older Node versions.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
