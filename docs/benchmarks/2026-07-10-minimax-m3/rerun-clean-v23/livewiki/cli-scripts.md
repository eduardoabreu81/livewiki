---
title: cli scripts make-executable helper
owner: generated
---

# cli scripts make-executable helper

Post-build Node script in the CLI package that restores the executable bit on the compiled entry point so it can be invoked directly on Unix-like systems.

## When to use this page

- **Inspect** the post-build hook that chmods the CLI's compiled entry point.
- **Run** the script manually when debugging permission issues on a freshly built `dist`.
- **Understand** why a Unix shebang is preserved across a TypeScript transpile step.
- **Troubleshoot** cases where `npx <pkg>` or a symlinked command loses its executable bit on macOS/Linux.

## How it fits

This module lives at `packages/cli/scripts/make-executable.mjs`, inside the `cli` workspace. It is one of the small Node scripts that ship under `packages/cli/scripts/` and is intended to be executed after `tsc` (or any other TypeScript emit) finishes producing `packages/cli/dist/index.js`. Because the TypeScript compiler does not propagate the Unix permission bits of the original `.ts` source, the resulting `.js` artifact lands without the executable flag even though it may carry a `#!/usr/bin/env node` shebang. This script closes that gap by performing a single `chmod` against the resolved entry file and logging the action to stdout. It is referenced from the CLI package's build pipeline rather than imported by application code.

## make-executable.mjs

The script is a single top-level await sequence with no exported symbols. It imports the promise-based Node filesystem API, the path module, and `fileURLToPath` from `node:url` so it can derive its own directory from `import.meta.url`. It then resolves `packages/cli/dist/index.js` relative to that directory and applies mode `0o755` (owner read/write/execute, group and others read/execute) to the file. After the chmod resolves, it prints a one-line `[cli] chmod 755 <path>` confirmation. The visible source does not establish behavior beyond this single chmod call, so treat the following as the documented scope:

- The target path is computed from `import.meta.url` of the script itself, not from `process.cwd()`, so the script behaves the same regardless of where it is invoked from.
- The chmod is unconditional and best-effort: any rejection from `fs.chmod` is not caught in the visible excerpt and will surface as a top-level unhandled rejection.
- The script does not check whether the target file exists or whether the platform is Unix; on Windows the call is accepted by Node and is effectively a no-op for execution purposes, which the source comment acknowledges.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
