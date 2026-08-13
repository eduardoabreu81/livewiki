---
title: View command
owner: generated
anchors:
  - packages/cli/src/commands/view.ts#openBrowser
  - packages/cli/src/commands/view.ts#registerView
---

# View command

The `livewiki view` CLI command builds a self-contained static site from the canonical `livewiki/` wiki and opens it in a browser.

## When to use this page

- **Wire** the `view` subcommand onto the root `commander` program when bootstrapping the CLI.
- **Trace** how option parsing, build invocation, and post-build browser launch flow from one entry point.
- **Debug** the cross-platform browser-open behaviour or the fail-open handling around missing openers.
- **Extend** the view pipeline (new flags, new templates) by following the existing option/action split.

## How it fits

`packages/cli/src/commands/view.ts` lives under `packages/cli/src/commands/`, the directory that holds every subcommand the root CLI registers. The module imports `Command` from `commander`, `spawn` and `node:path` from Node, the core view engine from `@livewiki/core/view`, configuration loading from `@livewiki/core/config`, and the repo-root resolver plus human/JSON emitters from sibling CLI files. Its role is narrow: it does not build the site itself — it parses flags, validates the few inputs it owns, delegates to `buildSite` from core, then decides whether to launch a browser. Two symbols do all of that work: `registerView` attaches the subcommand, and `openBrowser` is the small helper used at the end of a successful run.

## Diagram

```mermaid
%% livewiki/diagrams/commands-view.mmd
```

## Subcommand registration and option parsing

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` is the single entry point the root CLI calls to mount the subcommand; the file has no other exported symbol. Its job is to declare the `view` verb, attach every flag it understands, and run the build when the user invokes it.

```ts
export function registerView(program: Command): void {
```

The signature takes the root `commander.Command` and returns nothing; the command is attached as a side effect of the `.command("view")...action(...)` chain.

The action body proceeds in stages. First, it re-reads the merged options via `command.optsWithGlobals<ViewCliOptions>()` so that global flags like `--json` are visible, and it resolves the repository root through `resolveRepoRoot` from the parent CLI module.

Next, it validates the `--badge-days` value before paying any build cost. The flag is a string from commander and is coerced to a `Number`; the check rejects anything that is not an integer or that is negative, because the badges window is a non-negative day count and `0` is the explicit "disable" sentinel. On rejection the function does not throw — it sets `process.exitCode = 1`, emits either a JSON envelope with `code: "invalid_badge_days"` or a human-readable `FAILED [invalid_badge_days]` line, and returns from the action. This is the first of the visible fail-open paths in the file: an invalid input skips the build entirely and reports the reason.

With the badge window validated, the action calls `loadConfig(repoRoot)` inside a `.catch(() => null)` so a config load failure is treated as "no config" rather than a thrown error; the optional `language` is then forwarded only when a config was actually returned. The build itself is `await buildSite({...})` from `@livewiki/core/view`. Only the `out`, `ref`, and `language` fields are spread conditionally so that `undefined` does not silently override a default inside core. The template falls back to `"agent"` and the badge window uses the validated integer.

Once `buildSite` returns, the action computes `indexHtml` under the resolved `outDir` and, unless the user passed `--no-open` (commander maps that to `opts.open === false`), calls `openBrowser(indexHtml)`. The boolean `opened` is reported back so JSON consumers can tell whether the launcher actually fired. The success branch sets `process.exitCode = 0` and emits either a JSON `ok: true` payload or two human lines — a `pages → outDir` summary and either "opened in the browser." or an `open <path>` hint. Per the file's docstring, the command uses `process.exitCode` and never `process.exit`, so any handlers downstream of the action still get to run.

The failure branch wraps the build in a `try/catch`. A `ViewError` from core carries its own `code` (e.g. `missing_wiki`, `invalid_template`, `invalid_ref`, `invalid_out`); any other thrown value is normalized to the generic `view_failed` code. In both cases `process.exitCode` is set to `1`, and the JSON or human emitter is selected to mirror the success branch. This is the second visible fail-open branch: a build failure does not rethrow — it reports and exits non-zero.

## Browser launch

<!-- lw:anchors packages/cli/src/commands/view.ts#openBrowser -->

`openBrowser` is the small private helper invoked at the tail of a successful build to actually launch the user's default browser. It is deliberately narrow and best-effort: by the time it runs, the build has already succeeded and the index path has already been printed, so any opener failure must not propagate.

```ts
function openBrowser(target: string): boolean {
```

The signature takes the URL or absolute file path to open and returns a `boolean` indicating whether the spawn was issued successfully — not whether the browser itself launched.

The helper picks a command and arguments based on `process.platform`. On Windows it uses `cmd /c start "" <target>`; on macOS it uses `open <target>`; on Linux and other Unix-likes it falls back to `xdg-open <target>`. In every case the arguments array is built before the spawn call so the platform branch is a pure data selection.

It then calls `spawn(args[0], args[1], { detached: true, stdio: "ignore", shell: false })`. Three details matter here:

- `detached: true` plus `child.unref()` lets the CLI exit immediately without waiting for the browser process; the parent does not hold the child's lifecycle.
- `stdio: "ignore"` ensures the browser's chatter never reaches the CLI's stdio.
- `shell: false` avoids shell interpolation of the path, which on Windows would otherwise misinterpret characters in the target.

The helper installs a no-op `child.on("error", () => {})` listener so an asynchronous spawn error — typically `ENOENT` when no opener is installed — is swallowed. A synchronous throw from `spawn` itself is caught by the outer `try/catch`, which returns `false`. In both fail paths the function still returns a usable `false`, which `registerView` surfaces to the user via the "open `<indexHtml>` in a browser" hint rather than "opened in the browser." So a missing opener degrades gracefully: the build is reported successful and the user is told how to open it manually.