---
title: cli vitest configuration
owner: generated
---

# cli vitest configuration

This page documents the Vitest configuration used by the `cli` package's test harness.

## When to use this page

- **Configure** how the `cli` package locates and executes its unit tests under Vitest.
- **Adjust** the test environment or file discovery patterns when adding new test sources.
- **Verify** that the configuration is wired through the standard `vitest/config` entry point consumed by the Vitest CLI.

## How it fits

The `cli` package ships a single Vitest configuration file at `packages/cli/vitest.config.ts`, which is the canonical entry point Vitest loads when running tests inside that package. It re-exports the result of `defineConfig` so that running `vitest` at the package root picks up these defaults without further setup. The file lives next to the package's `package.json` and `tsconfig.json`, making it part of the per-package tooling rather than a workspace-wide setting.

## Configuration source

The page is generated from a single source file:

```text
packages/cli/vitest.config.ts
```

That path is the only thing Vitest looks for by default when invoked inside the `cli` package; the file exports the configuration object directly.

## Configuration contents

The exported configuration is built with `vitest/config`'s `defineConfig` helper and only customizes the `test` field:

- `environment` is set to `"node"`, which means tests run in a Node.js environment rather than a browser-like or jsdom environment. This is appropriate for the `cli` package, whose code targets Node.
- `include` is set to `["src/**/*.test.ts"]`, restricting discovery to TypeScript files under `src/` whose names end in `.test.ts`. Tests placed elsewhere (for example, in a `tests/` directory or with a `.spec.ts` suffix) are not picked up by this configuration.

No other Vitest options (such as `coverage`, `setupFiles`, `globals`, or reporters) are configured in this file. Any behavior beyond the two settings above falls back to Vitest's built-in defaults.

## Adjusting the configuration

To broaden or narrow test discovery, edit the `include` glob in this file. To run tests under a different environment (for example, when adding browser-facing code), change the `environment` string. Because the file is plain TypeScript, any change must remain syntactically valid and continue to default-export the result of `defineConfig`; otherwise the Vitest CLI will fail to load it.

## Scope of this excerpt

The supplied source for `packages/cli/vitest.config.ts` is the complete configuration file shown above. The documentation here describes only what is visible in that source; runtime behavior that depends on Vitest defaults not present in this file is out of scope for this page.