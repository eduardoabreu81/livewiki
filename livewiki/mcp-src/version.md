---
title: Reading the livewiki MCP package version
owner: generated
anchors:
- packages/mcp/src/version.ts#UNKNOWN_VERSION
- packages/mcp/src/version.ts#readPackageVersion
---

# Reading the livewiki MCP package version

This file resolves the version string that `@livewiki/mcp` reports about itself.

## When to use this page

- Understand how `@livewiki/mcp` avoids hardcoded version drift.
- Learn the fallback behavior when `package.json` is missing or malformed.
- Trace why a synchronous file read is acceptable during server startup.
- Compare this mechanism with the analogous `readVersion` in `@livewiki/cli`.

## How it fits

`packages/mcp/src/version.ts` is a tiny, standalone utility inside the MCP (Model Context Protocol) package. Its only job is to load the package's own `package.json` and return the `version` field as a string. This is the single source of truth for the version the server advertises in its MCP handshake, and it exists because a previously hardcoded literal became stale — reporting `0.0.0` from version 0.1.0 through 0.2.1 while the published package said otherwise.

The file has no internal collaborators beyond Node's built-in filesystem module. The module's two exported symbols work together as a tiny read-or-fallback flow: `readPackageVersion` attempts the read; `UNKNOWN_VERSION` is the constant it returns when that attempt fails. The same pattern was previously applied to the CLI side via `readVersion` in `@livewiki/cli`'s `cli.ts`, and this file deliberately mirrors that approach rather than inventing a second convention.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-version.mmd
```

## Version fallback constant

<!-- lw:anchors packages/mcp/src/version.ts#UNKNOWN_VERSION -->

This constant defines what `@livewiki/mcp` reports when it cannot discover a real version. Its purpose is to give every caller a predictable, non-throwing outcome: rather than letting a missing or malformed manifest crash startup, the module degrades to `"0.0.0"`.

The constant is exported as `export const UNKNOWN_VERSION = "0.0.0"`. The literal `"0.0.0"` is intentionally static — it is not parsed from anywhere and carries no information about the actual release. Callers can compare against this constant if they need to distinguish "we genuinely do not know the version" from a real value, even though the source code itself performs no such branching.

## Reading the package version

<!-- lw:anchors packages/mcp/src/version.ts#readPackageVersion -->

The function `export function readPackageVersion(): string` — it takes no arguments and returns the version string, either from `package.json` or, on failure, the fallback constant.

This function exists to make the version a runtime fact derived from the package's own manifest, not a hardcoded string that can drift away from the actual npm release. The module's file-level comment records that exactly this drift happened before, motivating the read-based design.

The flow is deliberately synchronous because the value is static at build time and every caller constructs the server during startup, where a single small file read costs nothing. The step-by-step behavior is:

1. It builds a file URL pointing to `../package.json` relative to the current module, using `new URL("../package.json", import.meta.url)`. The relative path works in both source (`src/version.ts`) and built (`dist/version.js`) layouts because both directories sit at the same depth inside the package; the published tarball also ships `package.json` next to `dist/`.
2. It reads that file synchronously with `readFileSync` and parses the content as JSON, casting the result to an object that may carry an optional `version` field.
3. It returns `parsed.version` when that field is present; otherwise it falls back to `UNKNOWN_VERSION`.
4. The `try/catch` wrapper is fail-closed around the entire read-and-parse step: if the file is missing, unreadable, or not valid JSON, the catch branch returns `UNKNOWN_VERSION` rather than propagating an error. This ensures the version lookup never throws, so server startup cannot be blocked by manifest problems.

## Tests

Covered by `packages/mcp/src/version.test.ts` (same-name test file on disk).
