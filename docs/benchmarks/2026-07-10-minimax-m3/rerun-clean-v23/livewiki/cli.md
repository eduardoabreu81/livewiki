---
title: cli vitest configuration
owner: generated
anchors: []
---

# cli vitest configuration

This page documents the Vitest configuration used to execute the `cli` package's unit tests.

## When to use this page

- **Run** the package's test suite locally with `vitest` against TypeScript test files under `src/`.
- **Inspect** which file globs are picked up by the runner when adding or relocating tests.
- **Confirm** the test environment in use before writing code that depends on a Node-only API surface.

## How it fits

The `cli` package lives under `packages/cli` in the livewiki repository, alongside the package's own source and test files. The file covered here, `packages/cli/vitest.config.ts`, is the single Vitest configuration consumed by that package and is referenced implicitly whenever the package's tests are invoked from the package directory. It does not affect runtime behaviour of the CLI itself; it only governs how its tests are discovered and executed.

## Configuration source

The file imports `defineConfig` from `vitest/config` and exports a single configuration object that delegates to `defineConfig`.

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

### Test environment

`environment` is set to the string `"node"`. This means tests in this package run under Node's globals (for example `process`, `Buffer`, and Node-style timers) rather than under a browser-like or jsdom-style environment. Tests that depend on browser globals are not supported here without an additional configuration override.

### Test file inclusion

`include` is a single glob array: `["src/**/*.test.ts"]`. Only files whose path matches this pattern — TypeScript test files anywhere beneath the package's `src/` directory whose name ends in `.test.ts` — are picked up by the runner. Files outside `src/`, files that do not end in `.test.ts`, and JavaScript test files are not included by this configuration as written.

### What the excerpt does not establish

The supplied excerpt shows only the imports and the exported configuration object. It does not show any project-level overrides, coverage configuration, reporters, setup files, aliases, or environment variables. Behaviour beyond the `environment` and `include` fields visible above is not established by this excerpt.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
