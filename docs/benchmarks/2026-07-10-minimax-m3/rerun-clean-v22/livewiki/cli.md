---
title: cli vitest configuration
owner: generated
---

# cli vitest configuration

This page documents the Vitest configuration used by the `cli` package.

## When to use this page

- **Configure** the `cli` package's Vitest runner by editing `packages/cli/vitest.config.ts`.
- **Run** the package's Node-environment unit tests with the project's standard Vitest invocation.
- **Extend** the test discovery pattern when adding new test files alongside `src/`.
- **Verify** that new tooling changes still respect the existing Node test environment and include glob.

## How it fits

The `cli` package is part of the livewiki workspace, and `packages/cli/vitest.config.ts` is the per-package Vitest configuration consumed by the workspace's test runner. Because the file lives next to the package's `src/` directory, it controls only the test discovery and environment for code inside `cli`, leaving sibling packages to ship their own configurations. The page below describes the concrete options visible in this excerpt; behavior not established by the supplied source is out of scope.

## Vitest project configuration

The package's Vitest setup is a single default export produced by `defineConfig` from `vitest/config`. The configuration is minimal: it pins the test environment to Node and restricts test discovery to files matching `src/**/*.test.ts` under the package's `src/` directory. There is no custom reporter, coverage, aliasing, or setup-file configuration visible in the excerpt, so the rest of Vitest's defaults apply.

The `environment: "node"` option means Vitest will execute the discovered tests in a Node.js environment rather than jsdom or happy-dom, which is consistent with a CLI package whose code targets Node directly. The `include` glob limits which files are treated as test files; tests placed elsewhere (for example, outside `src/` or with a different suffix) will not be picked up by this configuration. The excerpt does not establish exhaustive behavior for options such as `exclude`, `setupFiles`, `globals`, reporters, or shimming, and the page is scoped to the visible source.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
