---
title: cli package test runner configuration
owner: generated
anchors: []
---

# cli package test runner configuration

This page documents the Vitest configuration that governs how unit tests are discovered and executed inside the `packages/cli` workspace.

## When to use this page

- **Run the CLI package's unit tests** with `vitest` against the files matched by the configured `include` glob.
- **Verify the Node test environment** is in effect when executing `packages/cli` tests.
- **Audit the CLI package's test discovery scope** when adding or relocating test files under `packages/cli/src`.

## How it fits

The file `packages/cli/vitest.config.ts` is a project-local Vitest configuration. It lives inside the `packages/cli` workspace of the livewiki monorepo and is loaded by Vitest when tests are invoked from that package, overriding any inherited root-level Vitest settings for the `test` block.

The configuration is intentionally small: it delegates the heavy lifting to Vitest defaults and only pins the bits that matter for the CLI package — namely the runtime environment and the file discovery pattern. Because the configuration is workspace-scoped, any other package under `packages/` that wants a different Vitest setup can supply its own `vitest.config.ts` without conflicting with this one.

## Test environment

The `test.environment` field is set to `"node"`, which instructs Vitest to provide a Node.js global environment for the tests it runs from this configuration. This is appropriate for the CLI package, whose subject code runs under Node rather than in a browser or jsdom-like DOM shim.

## Test file discovery

The `test.include` field is `["src/**/*.test.ts"]`. This glob restricts Vitest's test discovery to TypeScript files whose names end in `.test.ts` and that reside anywhere under `packages/cli/src`. Other extensions (for example `.spec.ts`) and other locations (for example a top-level `test/` directory or files alongside source without the `.test.` infix) are not picked up by this configuration.

The configuration does not set `test.exclude`, `test.root`, or any reporter/coverage fields, so Vitest's built-in defaults apply for those. The excerpt provided does not establish the exhaustive behavior of those defaults; consult Vitest's documentation for what they resolve to in this version.

## What is intentionally not configured here

The configuration does not set up coverage thresholds, custom reporters, setup files, alias resolution, or `test.globals`. Any of those would need to be added to this file (or layered via a shared root config) before they take effect for the CLI package. Because no such entries are present in the supplied source, behavior outside `environment` and `include` is not pinned here and is therefore governed by Vitest defaults that the excerpt does not enumerate.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
