---
title: livewiki status command
owner: generated
anchors:
  - packages/cli/src/commands/status.ts#registerStatus
---

# livewiki status command

This page documents the CLI command that reports the current health of a livewiki index.

## When to use this page

- Run `livewiki status` to see what `runStatus` and `formatStatusHuman` emit and how `--json` and `--top` reshape that report.
- Inspect `registerStatus` to understand how `--diff` switches the handler from `runStatus` into the `previewWorkingTreeDebt` path.
- Review how the command degrades when the working tree is not a git repository.
- Trace the command-level error handling that funnels unexpected throws into a single non-zero exit code.

## How it fits

`packages/cli/src/commands/status.ts` is one of the subcommand registrations wired into the top-level `livewiki` Commander program. It delegates the actual report and diff work to two sibling modules in `@livewiki/core`: `status` (which produces the index report and a human formatter) and `diff-preview` (which produces the read-only working-tree diff preview and its human formatter). The file itself contains no scanning or git logic — it only adapts CLI flags into the inputs those core helpers expect.

## Diagram

```mermaid
%% livewiki/diagrams/commands-status.mmd
```

## Status command registration

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

The single responsibility of `registerStatus` is to attach a `status` subcommand to the Commander program and to translate its flags into the arguments the core helpers understand.

```ts
export function registerStatus(program: Command): void
```

`registerStatus` takes the shared `Command` instance and returns nothing; it registers the subcommand as a side effect.

Inside the handler, the file first resolves the repository root (`path.resolve(process.cwd(), opts.repo ?? ".")`) and parses `opts.top` into an integer defaulting to `10`, then branches on `--diff`:

- **Without `--diff`** — calls `runStatus(repoRoot, { topN })` to produce the index report. The result is either serialized to stdout as `{ ok: true, ...report }` JSON (when `--json` is set) or rendered through `formatStatusHuman`.
- **With `--diff`** — calls `previewWorkingTreeDebt(repoRoot)` for a read-only pre-commit preview of the anchors the uncommitted working-tree diff would invalidate. The result is again emitted either as JSON or via `formatDiffPreviewHuman`.

When `previewWorkingTreeDebt` reports `notGitRepo`, the command degrades by writing the same preview object to stderr (human form) or stdout (JSON form, with `ok: false`) and sets `process.exitCode = 1` without raising an exception. This is the only path that produces a non-zero exit: every other handled return path exits `0`. The catch block around the handler routes any unexpected throw to stderr as `livewiki status: error — <message>` and again sets `process.exitCode = 1`, so the visible contract is "exit 0 on the normal paths and on `--diff` outside a git repo's degrade, exit 1 only on the not-a-git-repo degrade or an unexpected error".