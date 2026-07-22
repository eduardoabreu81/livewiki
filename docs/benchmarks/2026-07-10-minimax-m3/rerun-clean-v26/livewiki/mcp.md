---
title: mcp vitest configuration
owner: generated
anchors: []
---

# mcp vitest configuration

This page documents the Vitest test runner configuration that the `mcp` package uses for its Node-based test suite.

## When to use this page

- Run the `mcp` package's unit tests with `vitest` from inside `packages/mcp`.
- Adjust the test runner's environment, file discovery, or reporter behavior for the package.
- Diagnose why a test file under `packages/mcp/src` is or is not being picked up by the runner.
- Onboard a contributor to the `mcp` package's local testing conventions.

## How it fits

The `mcp` package keeps its testing harness in a single root-level config file, `packages/mcp/vitest.config.ts`, which is loaded by Vitest when tests are executed from within the package directory. The file delegates to `defineConfig` from `vitest/config` and applies a small, explicit set of options that scope the runner to the Node runtime and to TypeScript source under `src`.

The configuration is intentionally minimal: it does not register custom reporters, coverage tooling, setup files, alias maps, or environment overrides beyond what is shown in the excerpt. As such, the page documents only what the supplied source establishes; broader CI integration, coverage thresholds, or watch-mode behavior are not visible here and are therefore out of scope for this page.

## Configuration surface

The file exports the default Vitest configuration as a `defineConfig({ test: { ... } })` object. The `test` block is the only configuration group set in the visible source.

### Runtime environment

The `test.environment` option is set to the literal string `"node"`. This tells Vitest to execute tests under the Node.js runtime rather than a browser-like environment such as `jsdom` or `happy-dom`, and it is consistent with `mcp` being a server- or tool-oriented package whose code is expected to run directly under Node.

### Test discovery

The `test.include` option is set to the array `["src/**/*.test.ts"]`. This restricts test discovery to files whose path matches the `src/**/*.test.ts` glob, meaning:

- Only files under the `src` directory of the `packages/mcp` package are scanned.
- Only files whose names end in `.test.ts` are treated as test files.
- TypeScript test files outside that pattern (for example, `*.spec.ts` or tests placed next to source files outside `src/`) are not picked up by this configuration.

### What the excerpt does not establish

The supplied source is truncated to a small excerpt of `vitest.config.ts`. It does not show whether additional `test` options (such as `setupFiles`, `coverage`, `globals`, `reporters`, `testTimeout`, or `alias`) are configured elsewhere in the file, nor does it show any sibling config files. Behavior beyond `environment` and `include` should not be inferred from this page.

## Running the tests

With this configuration in place, running `vitest` (or `npx vitest`) from `packages/mcp` will execute every `*.test.ts` file under `packages/mcp/src` in the Node environment. No additional flags are required by the visible configuration, and no setup file is invoked according to the supplied source.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
