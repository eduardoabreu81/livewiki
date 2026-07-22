---
title: Vitest configuration for the MCP package
owner: generated
anchors: []
---

# Vitest configuration for the MCP package

This page documents the Vitest configuration file that governs how tests are discovered and executed inside the `packages/mcp` workspace.

## When to use this page

- **Configure** the Node test environment and source-file include patterns for the package's test suite.
- **Add** new `*.test.ts` files under `src/` and confirm they are picked up by the configured glob.
- **Audit** how the package isolates its test runner settings from the repository-wide Vitest configuration.
- **Adjust** the runner when introducing non-Node environments or alternative test discovery patterns for this package.

## How it fits

The file lives at `packages/mcp/vitest.config.ts` and is a package-local Vitest configuration. It re-exports a `defineConfig` call so the runner can apply these settings when executing tests scoped to this workspace. Because the configuration lives next to the package source rather than in the repository root, it lets the MCP package opt into settings (in this case, a Node environment and a `src/**/*.test.ts` glob) that apply only to its own `src/` tree. The page does not assert a complete call graph across the monorepo; only the role of this single configuration file within the package is described.

## Configuration contents

The configuration is a single default export produced by Vitest's `defineConfig` helper. It contains a `test` block with two fields visible in the excerpt:

- `environment: "node"` — instructs Vitest to run the package's tests under the Node environment rather than a browser-like one.
- `include: ["src/**/*.test.ts"]` — restricts discovery to files matching the `src/**/*.test.ts` glob, so any `*.test.ts` file placed under `src/` is treated as a test entry.

The literal configuration object from the excerpt is:

```ts
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

There are no additional `test` fields (such as `setupFiles`, `coverage`, `globals`, or `testTimeout`) visible in the supplied excerpt, so the page scopes its claims to the two keys above. If the file is later extended, those additions are not documented here because they are not present in the source provided to this page.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
