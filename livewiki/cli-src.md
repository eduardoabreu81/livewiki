---
title: livewiki CLI entrypoint and output formatting
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

# livewiki CLI entrypoint and output formatting

This module is the `@livewiki/cli` package's runtime surface: it parses argv, registers subcommands, resolves the target repository, and formats every line of output.

## When to use this page

- **Read** `cli.ts` when you need to understand how a `livewiki ...` invocation becomes a subcommand and what global flags are wired in.
- **Read** `output.ts` when you are implementing or auditing a command and need to know the canonical way to print human-readable text versus `--json`.
- **Trace** an exit code or `livewiki: fatal error — ...` line on stderr back to the `index.ts` catch path around `run(process.argv)`.
- **Adjust** the `--repo` default or the path the package version is read from when changing packaging layout (`bin` target, `dist/` layout).

## How it fits

`packages/cli/src/` is the `livewiki` bin target: `index.ts` is what `bin` executes and what `npx .` resolves from the package root, and it delegates immediately to `run(process.argv)`. `cli.ts` owns the Commander program, registers every subcommand declared in `SPEC §"CLI commands"` (init, index, status, update, verify, serve, batch, export, view, pointer, install), and exposes the two pure helpers `readVersion` (synchronous package.json read) and `resolveRepoRoot` (turns `--repo <path>` into an absolute path anchored at `process.cwd()`). `output.ts` is the single sink for both stdout modes — multi-line human text and one-line JSON — selected by the `--json` global flag. Subcommands from `./commands/*` consume these helpers to build their `CommandContext`.

## Diagram

```mermaid
%% livewiki/diagrams/cli-src.mmd
```

## Program construction and entrypoint
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#readVersion -->

The `livewiki` Commander program is built by `createProgram`, which configures `name("livewiki")`, the long description, the `--json` global flag for agent-parseable output, and the `--repo <path>` global flag (default `"."`). It then registers every subcommand listed in `SPEC §"CLI commands"` so that `--help` always shows the full surface, regardless of which phase each command's implementation belongs to. The version string is sourced from `@livewiki/cli`'s own `package.json` via `readVersion`, which uses the synchronous `node:fs` `readFileSync` on a URL resolved from `import.meta.url` — kept synchronous because the file is static at build time and the calling `run` is already async.

`createProgram` declares:

```ts
export function createProgram(): Command {
```

The program is exercised by `run`, which simply constructs it and forwards argv:

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

If `parseAsync` rejects (anything not handled inside a subcommand — Commander already covers usage errors), `index.ts` catches and writes `livewiki: fatal error — <message>\n` to stderr, setting `process.exitCode = 1` rather than calling `process.exit(1)`, so Node can drain pending stderr I/O first.

## Repository root resolution
<!-- lw:anchors packages/cli/src/cli.ts#resolveRepoRoot -->

Subcommands build their `CommandContext` against a single absolute repo directory. `resolveRepoRoot` is the helper that turns the `--repo <path>` option into that directory:

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

The implementation anchors the user-supplied path at `process.cwd()` with `nodePath.resolve`, treating both `undefined` and the documented default `"."` (set by Commander on `createProgram`) as "the current working directory". Relative paths are resolved against cwd; an absolute path passed via `--repo` is returned as-is by `path.resolve`. There is no normalization or existence check inside the function — any "is this a real repo?" validation lives in the consuming command.

## Output formatting
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

Every line a subcommand writes to stdout goes through `output.ts`, which enforces the SPEC rule that output must be both human-readable and agent-parseable (`--json` on every command). `emit` is the single helper subcommands are expected to call:

```ts
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void {
```

It dispatches on the `json` flag and never writes both branches — exactly one of `emitJson(data)` or `emitHuman(human)` runs per call.

`emitHuman` writes the supplied text to stdout, appending a newline only if the caller didn't already end the string with one:

```ts
export function emitHuman(text: string): void {
```

`emitJson` serializes its argument with `JSON.stringify` and always appends a single trailing newline, keeping each JSON payload on its own line so a downstream agent can `JSON.parse` it line-by-line:

```ts
export function emitJson(data: unknown): void {
```

The `EmitOptions.json` interface is the contract between commands and this module: when the caller forces JSON mode, `emit` honors it even if `data` is not explicitly supplied by the upstream branch.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [CLI command registry for the livewiki workspace](commands.md) — dependency and dependent
- [CLI source tests](cli-src-tests.md) — dependent
<!-- livewiki:navigate:end -->
