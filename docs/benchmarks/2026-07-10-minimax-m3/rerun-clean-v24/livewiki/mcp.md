---
title: "@livewiki/mcp vitest harness"
owner: generated
anchors: []
---

# @livewiki/mcp vitest harness

This page documents the Vitest configuration for the `@livewiki/mcp` package's test harness.

## When to use this page

- **Configure** the Node-environment test runner that discovers `*.test.ts` sources for this package.
- **Audit** the test discovery glob and runtime environment before adding new test suites under `packages/mcp`.
- **Diagnose** why a test file is not picked up by confirming it matches the configured `include` pattern.

## How it fits

The `packages/mcp` workspace is one of the packages in the livewiki repository and ships its own local Vitest configuration rather than inheriting a root-level one. `packages/mcp/vitest.config.ts` is the single configuration entry point consumed by the Vitest CLI when running tests in this package; it lives next to the package's source and test files and is loaded automatically by Vitest's standard config-resolution rules.

The file is small and focused: it sets the test environment, the source-file discovery glob, and nothing else. There is no visible setup for reporters, coverage, projects, aliases, or environment variables in the supplied excerpt — only the three properties shown below. Anything beyond that surface is not established by this excerpt and would have to be verified against the full file or downstream tooling.

## Configuration surface

The file calls `defineConfig` from `vitest/config` and exports the resulting object as the default export. Vitest reads this default export to determine how to run the test suite. The literal call shown in the source is:

```ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Because the only configuration object passed to `defineConfig` has a single `test` property, the runtime behavior of the harness is fully determined by that `test` block.

### `test.environment`

The `environment` field is set to the string `"node"`. With this setting, Vitest executes test files in a Node.js runtime rather than a browser-like jsdom or happy-dom environment. This is the appropriate choice for a package whose tests exercise server-side or tooling concerns rather than DOM behavior; there is no visible override per-file in the excerpt.

### `test.include`

The `include` field is an array with a single glob: `["src/**/*.test.ts"]`. Vitest uses this pattern to discover which files to treat as test files. The pattern restricts discovery to TypeScript files under any `src` subtree whose basename ends with `.test.ts`. Files outside `src/`, files with a `.spec.ts` suffix, or plain `.ts` files would not be matched by this pattern based on the visible configuration; if any such files exist, the excerpt does not establish how they are picked up.

### Default export and consumers

The `defineConfig` call returns a config object that is exported as the module's default export. Vitest's CLI and programmatic API both consume this default export when running tests for the `packages/mcp` workspace. No other named exports, plugins, or config presets are visible in the supplied source, so additional configuration — such as coverage providers, custom reporters, or `setupFiles` — is not established by this excerpt and may either be absent or live outside the visible region.