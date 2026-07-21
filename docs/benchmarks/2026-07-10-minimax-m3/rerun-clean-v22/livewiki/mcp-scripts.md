---
title: mcp post-build permission fixer
owner: generated
anchors: []
---

# mcp post-build permission fixer

This page documents a single-purpose Node script that restores the executable bit on the compiled MCP entry point after `tsc` finishes.

## When to use this page

- **Inspect** the script when a freshly built `mcp` package cannot be launched directly on Unix hosts.
- **Run** the script as part of a `postbuild` step in `packages/mcp` so the shipped `dist/index.js` stays executable.
- **Diagnose** cases where `npm exec` / `npx` invocations fail with `Permission denied` on macOS or Linux.

## How it fits

The script lives at `packages/mcp/scripts/make-executable.mjs` inside the `mcp` workspace package. It is invoked once the TypeScript compiler has produced `packages/mcp/dist/index.js`, and it exists because `tsc` does not preserve Unix file modes during transpilation. On Windows the shebang is unnecessary for `npx`/`node`, but on macOS and Linux the missing executable bit would prevent the file from being run directly.

## What the script does

The excerpt opens with a comment explaining the intent: ensure the shebang line in the MCP entry point is executable. It then imports three Node built-ins — `node:fs/promises` (for `chmod`), `node:path` (for path joining), and `node:url` (for `fileURLToPath`).

```js
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const entry = nodePath.resolve(here, "..", "dist", "index.js");

await nodeFs.chmod(entry, 0o755);
console.log(`[mcp] chmod 755 ${entry}`);
```

Using `fileURLToPath(import.meta.url)` and `nodePath.dirname`, the script derives the directory of the current `.mjs` file, then resolves one level up and into `dist/index.js` to locate the built artifact. It awaits `nodeFs.chmod` with mode `0o755` (owner read/write/execute, group and others read/execute) and prints a confirmation line of the form `[mcp] chmod 755 <absolute path>`.

## Failure modes visible in the excerpt

The supplied source does not show a `try`/`catch`, retry, or fallback around `chmod`. If the file does not exist (e.g. `tsc` was skipped or failed silently) the `await nodeFs.chmod` call will reject and the script will terminate with the underlying `ENOENT` error from Node. Likewise, on Windows the underlying `chmod` call is a best-effort no-op for the execute bit but does not throw. The excerpt does not establish exhaustive behavior beyond the happy path described above.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
