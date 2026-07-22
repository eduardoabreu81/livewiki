---
title: mcp Vitest configuration
owner: generated
anchors: []
---

# mcp Vitest configuration

This page documents the Vitest test runner configuration that the `mcp` package uses to execute its unit tests.

## When to use this page

- **Configure** Vitest coverage, reporters, or environment for the `mcp` package by editing this file.
- **Add** a new test glob pattern under `src/` and verify the runner picks it up.
- **Diagnose** why a test file in `packages/mcp/src` is not being executed by the runner.
- **Extend** the test command in CI to include or exclude files based on the existing `include` pattern.

## How it fits

The `mcp` package sits inside the `livewiki` repository as a workspace package and ships its own Vitest setup at `packages/mcp/vitest.config.ts`. Because the file re-exports `defineConfig` from `vitest/config`, it plugs directly into the standard Vitest CLI and programmatic runner used by the rest of the monorepo, so any workspace-wide Vitest script will discover this configuration automatically when it descends into `packages/mcp`.

The excerpt does not establish a complete call graph beyond the Vitest CLI entry point, but the file's role is narrowly scoped: it tells Vitest how to find and run the package's tests, nothing more.

## Configuration surface

The exported default is the result of `defineConfig({ ... })` from `vitest/config`, which means every field below is interpreted by Vitest itself rather than by any local wrapper.

### Test environment

The `test.environment` field is set to the string `"node"`. Vitest uses this value to select the runtime that loads test files, opting for the built-in Node environment rather than `jsdom`, `happy-dom`, or `edge-runtime`. Tests in `packages/mcp/src` therefore execute with Node globals (such as `process`, `Buffer`, and the Node module system) available, and without browser-style globals like `window` or `document`.

### Test discovery glob

The `test.include` field is the array `["src/**/*.test.ts"]`. This single pattern tells Vitest which files count as test files for the `mcp` package:

- Only files under a `src/` directory at any depth are considered.
- Only files whose name ends in `.test.ts` are matched; `.spec.ts` files or plain TypeScript files are not picked up by this configuration.
- Files outside `packages/mcp/src` are excluded because the pattern is evaluated relative to the package root (the directory containing `vitest.config.ts`).

The excerpt does not establish whether additional Vitest options (for example `coverage`, `setupFiles`, `globals`, or `reporters`) are configured elsewhere; the visible source only sets `environment` and `include`.

## Behaviour implied by the excerpt

When a developer runs the Vitest CLI inside `packages/mcp` (or a workspace-level command that delegates to it), the runner resolves this file, applies the Node environment, and scans `src/**/*.test.ts` for test modules. Anything outside that glob is silently skipped by this configuration. The excerpt does not establish exhaustive behaviour — for example, it does not show whether watch mode, sharding, or reporters are customised — so treat the prose above as scoped to the normal path that the visible fields define.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
