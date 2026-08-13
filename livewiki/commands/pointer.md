---
title: Pointer command (`livewiki pointer`)
owner: generated
anchors:
  - packages/cli/src/commands/pointer.ts#registerPointer
  - packages/cli/src/commands/pointer.ts#promptYesNo
  - packages/cli/src/commands/pointer.ts#formatPointerResult
  - packages/cli/src/commands/pointer.ts#formatStatusHuman
  - packages/cli/src/commands/pointer.ts#_internal
---

# Pointer command (`livewiki pointer`)

This page documents the `livewiki pointer` subcommand, which manages an opt-in "pointer" block inside an `AGENTS.md` or `CLAUDE.md` file at the repository root.

## When to use this page

- **Register** the `livewiki pointer` command on a top-level `commander` program so end users can run it from the CLI.
- **Read or write** the livewiki pointer block in `AGENTS.md` / `CLAUDE.md` while enforcing the project's "never automatic" opt-in rule.
- **Format** the human-readable output that the command prints for status, write, and remove operations.
- **Implement** an interactive y/N confirmation prompt that cooperates with `commander` and respects non-TTY stdin.

## How it fits

This module lives in `packages/cli/src/commands/pointer.ts`. It is one of the `commander` subcommand registrars in the `packages/cli` workspace: it wires the `pointer` command into the top-level program, resolves a target repository root through `resolveRepoRoot` from `../cli.js`, and delegates the actual file mutation to `@livewiki/core/pointer` (`insertPointer`, `removePointer`, `readPointerStatus`, `POINTER_FILES`, `buildPointerBlock`). Human and JSON output is funnelled through the local `emit` helper from `../output.js`. Because the pointer block lives outside the `livewiki/` directory, the command enforces a project-wide "Inviolable rule": it must never write automatically — it requires either an explicit flag or interactive confirmation.

## Diagram

```mermaid
%% livewiki/diagrams/commands-pointer.mmd
```

## Registering the command

`registerPointer` is the public surface that the CLI bootstraps call. It owns the lifecycle of the subcommand: defining options, validating input, choosing between status, write, and remove modes, enforcing the opt-in rule, and routing results through `emit`. Every other symbol in this file exists to support one branch of that lifecycle.

```ts
export function registerPointer(program: Command): void
```

The function takes a `commander.Command` and returns nothing; its job is to attach a configured `pointer` subcommand to that program.

### Options and validation

The subcommand declares six flags (`--write-pointer`, `--remove`, `--file <name>`, `--yes`, `--block <text>`, plus the implicit `--json`/`--repo` from the global options). When the action runs, it first re-reads the merged options with `command.optsWithGlobals<PointerOptions>()`, resolves the target repository with `nodePath.resolve(process.cwd(), resolveRepoRoot(opts.repo))`, and — only when `--file` is supplied — checks that the value is a member of `POINTER_FILES`. If the value is not one of the allowed files (`AGENTS.md` or `CLAUDE.md`), the function writes an error to stderr, sets `process.exitCode = 1`, and returns without performing any file operation.

### Status mode (no flags)

When neither `--write-pointer`, `--yes`, nor `--remove` is present, the command treats the invocation as a read. It calls `readPointerStatus(repoRoot, …)` from `@livewiki/core/pointer` and emits the result through `formatStatusHuman` so the user sees either "not present" or the existing inner block.

### Write mode and the opt-in rule

The write branch is where Inviolable rule #2 lives. The flow is:

1. Decide `wantsWrite = Boolean(opts.writePointer || opts.yes)`.
2. If `wantsWrite` is false **and** `process.stdin.isTTY`, the command asks the user to confirm via `promptYesNo`, showing the block that `buildPointerBlock()` would produce.
3. If `wantsWrite` is false **and** stdin is **not** a TTY, the command fails closed: it writes an explanatory message to stderr explaining that `--write-pointer` (or `--yes`) is required in non-interactive mode, sets `process.exitCode = 1`, and returns. It never writes silently.
4. If the user cancels the prompt, the command emits a `cancelled` payload via `emit` and returns.
5. Otherwise, it calls `insertPointer(repoRoot, …)`, forwarding an optional `file` override and, when provided, the `--block` text. The result is formatted with `formatPointerResult(result, "wrote")`.

### Remove mode

`--remove` deletes the pointer block. Because removal is destructive, the command treats it more cautiously: if `--write-pointer`/`--yes` are absent **and** stdin is a TTY, it prompts via `promptYesNo`. If the flags are absent **and** stdin is **not** a TTY, it again fails closed with the same exit code and a stderr message. On success it calls `removePointer` and formats the result with `formatPointerResult(result, "removed")`. On a confirmed cancellation it emits a `cancelled` payload via `emit`.

### Error funnel

Any thrown error from `readPointerStatus`, `insertPointer`, or `removePointer` lands in a single `catch` that writes `livewiki pointer: error — <message>` to stderr, sets `process.exitCode = 1`, and returns — so the action never crashes the surrounding CLI process. The `PointerOptions` interface, declared alongside the imports, is the structural type that `commander` populates from the parsed flags; it is not a separately exported symbol.

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer -->

These anchors identify indexed symbols whose implementation is part of this module.

## Interactive y/N confirmation

`promptYesNo` is the only place in this file that talks to stdin directly, and it exists specifically so the opt-in rule can be honoured interactively.

```ts
async function promptYesNo(question: string): Promise<boolean>
```

The function takes a human-readable question (which it writes to stdout verbatim) and resolves to `true` only when the user types `y` or `yes` (case-insensitive, trimmed). It listens for the first newline on stdin — at which point it unsubscribes, pauses stdin, and resolves — and also resolves on stdin `end` for non-TTY callers that close immediately. Because it resolves with `false` for any other input, the caller's default behaviour matches a "no" answer, which is what Inviolable rule #2 requires.

<!-- lw:anchors packages/cli/src/commands/pointer.ts#promptYesNo -->

These anchors identify indexed symbols whose implementation is part of this module.

## Human-readable output shaping

Two small pure functions turn the structured results from `@livewiki/core/pointer` into the strings that end up on the terminal.

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string
```

`formatPointerResult` takes a write/remove result and a mode verb, and renders a two-line message: the first line is `livewiki pointer: <verb> <file>` where the verb reflects both the requested mode and the actual action (`inserted`/`replaced` for writes, or `unchanged` when nothing changed; `removed` for removals). The second line is the signed byte delta and is omitted entirely when `bytesWritten` is zero.

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string
```

`formatStatusHuman` renders the read-only status path. When the block is absent it returns a single hint line instructing the user to re-run with `--write-pointer`; when the block is present it returns a `livewiki pointer: present in <file>` header followed by the captured inner block fenced between `---` markers so the user can see exactly what was registered.

<!-- lw:anchors packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman -->

These anchors identify indexed symbols whose implementation is part of this module.

## Test-only export

The module re-exports a tiny namespace as `_internal`. The comment in the source marks it as a test seam, not a public API.

```ts
export const _internal = { nodeFs }
```

It bundles the imported `node:fs/promises` namespace so tests can exercise or stub filesystem behaviour without going through the public CLI surface.

<!-- lw:anchors packages/cli/src/commands/pointer.ts#_internal -->

These anchors identify indexed symbols whose implementation is part of this module.