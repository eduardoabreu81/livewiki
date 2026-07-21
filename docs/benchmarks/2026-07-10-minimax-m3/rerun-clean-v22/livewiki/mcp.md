---
title: mcp Vitest configuration
owner: generated
anchors: []
---

# mcp Vitest configuration

This page documents the Vitest test-runner configuration that ships with the `mcp` package.

## When to use this page

- **Configure** the Node.js test environment and test-file discovery pattern used by the `mcp` package.
- **Audit** which files under `packages/mcp/src/` are picked up by the runner (`src/**/*.test.ts`).
- **Extend** the configuration with additional Vitest options (coverage, reporters, setup files) when needed.
- **Troubleshoot** runner behaviour by comparing local invocations against the committed `vitest.config.ts`.

## How it fits

The file lives at `packages/mcp/vitest.config.ts` and is the configuration entry point Vitest discovers when running tests inside the `mcp` package. It exports the result of `defineConfig` from `vitest/config`, which the runner consumes to decide how to execute the suite. Because the configuration is co-located with the package source, any contributor working in `packages/mcp` can run the tests with no additional setup beyond installing dependencies and invoking the standard Vitest command.

## Configuration surface

The exported config is a single object literal handed to `defineConfig`. Only the `test` key is populated, with two visible fields:

- `environment`: set to the string `"node"`, instructing Vitest to spin up a Node.js environment for every test file instead of a browser-like or jsdom environment.
- `include`: set to the glob `["src/**/*.test.ts"]`, restricting test discovery to TypeScript files matching the `*.test.ts` pattern under `src/`. Files placed at the package root or under other directories (for example a `test/` or `tests/` folder) are not picked up by this configuration.

Because the excerpt shows only these two fields, it does not establish whether additional Vitest options (such as `coverage`, `setupFiles`, `globals`, `reporters`, or `testTimeout`) are configured elsewhere, are inherited from a root-level config, or are simply absent. The provided source is limited to this single file's contents.

## Runtime implications

With `environment: "node"`, tests can freely use Node.js built-ins such as `fs`, `path`, `process`, and `crypto` without polyfills, and any code under test that performs I/O or talks to MCP transports runs in its native runtime. The `include` glob means that authoring a test file outside the `src/` tree — for instance at `packages/mcp/test/foo.test.ts` — requires either renaming/moving the file into `src/` or extending this configuration; otherwise the runner will not execute it.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
