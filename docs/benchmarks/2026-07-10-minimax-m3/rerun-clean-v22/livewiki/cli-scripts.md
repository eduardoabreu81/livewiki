---
title: cli make-executable post-build script
owner: generated
anchors: []
---

# cli make-executable post-build script

This page documents the small post-build Node script that ensures the CLI's compiled entry point has an executable Unix shebang bit set after `tsc` runs.

## When to use this page

- **Run** the script directly with `node` to re-apply executable permissions after a manual build.
- **Confirm** that the CLI's compiled entry point is `dist/index.js` and lives one directory above this script.
- **Check** the chmod log line (`[cli] chmod 755 <path>`) when triaging why a freshly built CLI works on macOS/Linux but not on Windows-native tooling.
- **Understand** why `tsc` output is not directly executable and what closes that gap in the CLI package.

## How it fits

The script lives at `packages/cli/scripts/make-executable.mjs` inside the `@livewiki/cli` package, sitting alongside the package's `tsconfig` and `dist` output. It is invoked as a post-build step so that the TypeScript-compiled `dist/index.js` ships with the executable bit (`0o755`) required to run as `npx @livewiki/cli` on Unix-like systems. On Windows the shebang is unnecessary for `npx`/`node`, but macOS and Linux rely on it; the script closes that gap left by `tsc`, which does not preserve Unix permissions when it transpiles sources.

## What the script does

The file is a Node ESM module. It imports `fs/promises` as `nodeFs` and `path` as `nodePath`, and resolves the entry file from `import.meta.url`.

```js
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
```

It computes the directory of the current script with `nodePath.dirname(fileURLToPath(import.meta.url))` and then resolves the entry point by walking one level up (`..`) into `dist/index.js`:

```js
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const entry = nodePath.resolve(here, "..", "dist", "index.js");
```

Finally it sets the file mode to `0o755` (owner read/write/execute, group/others read/execute) and logs a single line confirming the path that was touched:

```js
await nodeFs.chmod(entry, 0o755);
console.log(`[cli] chmod 755 ${entry}`);
```

The script has no CLI arguments, no error handling around `chmod`, and no early return — it runs end-to-end, including on Windows where `chmod` is effectively a no-op for the executable bit. Because the supplied excerpt is just the body of the script, it does not establish behavior beyond a single chmod + log invocation per run.

## Operational notes

- The chmod target is fixed to `dist/index.js`; renaming the CLI's compiled entry point requires updating `entry` here in lockstep with the bundler config.
- The log prefix `[cli] chmod 755` is the only signal the script emits, so downstream tooling that wants to confirm the step ran should match on that prefix rather than parsing exit codes.
- Because the script uses top-level `await`, it must be executed with a runtime that supports ESM top-level await (Node 14.8+ in ESM mode).

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
