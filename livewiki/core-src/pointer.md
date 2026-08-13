---
title: livewiki pointer block insertion
owner: generated
anchors:
  - packages/core/src/pointer.ts#POINTER_END
  - packages/core/src/pointer.ts#POINTER_FILES
  - packages/core/src/pointer.ts#POINTER_START
  - packages/core/src/pointer.ts#_internal
  - packages/core/src/pointer.ts#applyPointerRemove
  - packages/core/src/pointer.ts#applyPointerReplace
  - packages/core/src/pointer.ts#buildPointerBlock
  - packages/core/src/pointer.ts#ensurePointerFile
  - packages/core/src/pointer.ts#findPointerBlock
  - packages/core/src/pointer.ts#insertPointer
  - packages/core/src/pointer.ts#pickPointerFile
  - packages/core/src/pointer.ts#readPointerStatus
  - packages/core/src/pointer.ts#removePointer
---

# livewiki pointer block insertion

This module owns the opt-in, append-only insertion of a small "livewiki pointer" block into either `AGENTS.md` or `CLAUDE.md` at the repository root.

## When to use this page

- **Add or refresh a wiki pointer** in `AGENTS.md` / `CLAUDE.md` via the `livewiki` CLI behind an explicit `--write-pointer` flag.
- **Parse or replace the pointer block** from a Markdown string for tests or tooling without touching disk.
- **Inspect whether the pointer is already present** in either of the two allowed files.

## How it fits

This file lives at `packages/core/src/pointer.ts` inside the `@livewiki/core` package. The package's general filesystem rules are enforced by a sibling module, `safe-io.ts`, which only permits writes under `livewiki/` and `.livewiki/`. The pointer block is the single, deliberate exception: `pointer.ts` is the only consumer that passes `{ allowPointer: true }` into `safe-io`, and only when writing `AGENTS.md` or `CLAUDE.md` at the repository root. Higher layers (the CLI, the `livewiki init` flow) call into `insertPointer`, `removePointer`, and `readPointerStatus`; the pure helpers (`findPointerBlock`, `applyPointerReplace`, `applyPointerRemove`, `buildPointerBlock`, `pickPointerFile`) are reused by tests and by anything that needs to reason about the block without performing I/O.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-pointer.mmd
```

## Block markers and target files

The block is delimited by two HTML-comment markers that are intentionally stable so external parsers can rely on them. The set of files the pointer may ever touch is also a closed, exported constant; both are used by every other helper in the module.

<!--lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES-->

- `export const POINTER_START = "<!-- livewiki:start -->";`
- `export const POINTER_END = "<!-- livewiki:end -->";`
- `export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;`

These three lines encode the rule the module exists to enforce: the only files that may carry a pointer block are `AGENTS.md` and `CLAUDE.md`, and the block is bounded by a single start and end marker. Everything below — pure parsers, I/O wrappers, status readers — defers to these constants rather than re-encoding the strings inline.

## Pure block parser and transformer

The file separates "what the block is" from "how it gets on disk" by providing three string-only functions. They are the parts you can unit-test without `node:fs`.

### Choosing the default block content

`buildPointerBlock` produces the canonical one-paragraph pointer body — a short PT-BR sentence and a single link to `livewiki/quickstart.md` — wrapped by the `POINTER_START` and `POINTER_END` markers. It is deliberately short: a human or agent reading `AGENTS.md` should see only a pointer, not duplicated wiki content.

<!--lw:anchors packages/core/src/pointer.ts#buildPointerBlock-->

```ts
export function buildPointerBlock(): string
```

`buildPointerBlock` returns the full delimited block as a single string and takes no parameters.

### Locating an existing block in Markdown

`findPointerBlock` scans a string for the start/end markers and, when both are present, returns their byte indices plus the inner text between them. It is tolerant to leading whitespace before the start marker (defending against CRLF/BOM quirks) and treats a truncated block — start marker without an end marker — as if the block were absent, so callers never try to overwrite half a block.

<!--lw:anchors packages/core/src/pointer.ts#findPointerBlock-->

```ts
export function findPointerBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null
```

`findPointerBlock` takes a Markdown string and returns either the marker indices and inner content, or `null` when no well-formed block is found.

### Mutating the block in a string

`applyPointerReplace` and `applyPointerRemove` operate only on the in-memory string. `applyPointerReplace` either splices a new block in place of the existing one (when `findPointerBlock` returned a match) or appends it to the end of the content with a blank-line separator (when there is no match). It then classifies the result as `inserted`, `replaced`, or `unchanged` so callers can decide whether a disk write is warranted.

<!--lw:anchors packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove-->

```ts
export function applyPointerReplace(
  content: string,
  newBlock: string,
): { content: string; action: PointerAction }
```

`applyPointerReplace` takes the current content plus a replacement block and returns the new content along with a `"inserted" | "replaced" | "unchanged"` action tag.

```ts
export function applyPointerRemove(content: string): {
  content: string;
  removed: boolean;
}
```

`applyPointerRemove` takes a Markdown string and returns the new content together with a boolean flag indicating whether a block was actually excised. It also trims one of the surrounding newlines when the block is removed so the file is not left with a blank-line gap; on the no-block path the original string is returned unchanged and `removed` is `false`.

## Picking the target file

The pointer must land in exactly one of `AGENTS.md` or `CLAUDE.md`. `pickPointerFile` is the single decision point: an explicit `requested` argument wins; otherwise the function prefers `AGENTS.md` when it already exists, falls back to `CLAUDE.md` if only that file exists, and defaults to creating `AGENTS.md` when neither does.

<!--lw:anchors packages/core/src/pointer.ts#pickPointerFile-->

```ts
export function pickPointerFile(
  hasAgentsMd: boolean,
  hasClaudeMd: boolean,
  requested?: PointerFile,
): PointerFile
```

`pickPointerFile` takes flags describing which of the two files already exist plus an optional explicit request, and returns the single filename that should be targeted. The visible branches are: an explicit request always wins; otherwise `AGENTS.md` is preferred if present, then `CLAUDE.md`, with `AGENTS.md` as the final default for brand-new repos.

## Disk-backed operations

The async functions wrap the pure helpers in `safe-io` calls. Every one of them resolves `repoRoot` via `nodePath.resolve`, validates the chosen file against `POINTER_FILES`, and passes `{ allowPointer: true }` to `safe-io` — the documented, single exception to the package's "only touch `livewiki/` and `.livewiki/`" rule. If the existence probe itself throws, `insertPointer` and `removePointer` swallow that into `false` so a transient filesystem error does not abort a status read.

### Inserting or replacing the block

`insertPointer` probes the repository for the existence of `AGENTS.md` and `CLAUDE.md`, calls `pickPointerFile` to choose the target, reads the current contents through `safe-io`, applies `applyPointerReplace`, and writes back only when the action is not `unchanged`. The function rejects any file name that is not in `POINTER_FILES` with an explicit error, even though `safe-io` would already block it — defense in depth.

<!--lw:anchors packages/core/src/pointer.ts#insertPointer-->

```ts
export async function insertPointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult>
```

`insertPointer` takes a repository root and optional `{ file, block }` overrides, and returns the targeted file, an `"inserted" | "replaced" | "unchanged"` action, and a byte-delta. On the `unchanged` branch it short-circuits before any write, so a no-op call produces zero bytes written and no git diff.

### Removing the block

`removePointer` is the symmetric counterpart: it picks the same target file via `pickPointerFile`, reads it, runs `applyPointerRemove`, and writes the trimmed content only when something was actually removed. If the file does not exist or contains no block, the call returns an `unchanged` result without performing a write.

<!--lw:anchors packages/core/src/pointer.ts#removePointer-->

```ts
export async function removePointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult>
```

`removePointer` takes a repository root plus optional `{ file, block }` (the `block` override is accepted for API symmetry but unused on the remove path) and returns the same `{ file, action, bytesWritten }` shape as `insertPointer`.

### Reading current status

`readPointerStatus` reports whether a pointer is already present, in either a specific file (when `opts.file` is given) or in whichever of the two files contains it first. When a block is found it also returns the trimmed inner content, which lets the CLI surface the existing pointer text to the user.

<!--lw:anchors packages/core/src/pointer.ts#readPointerStatus-->

```ts
export async function readPointerStatus(
  repoRoot: string,
  opts: { file?: PointerFile } = {},
): Promise<{
  file: PointerFile | null;
  present: boolean;
  inner?: string;
}>
```

`readPointerStatus` takes a repository root and an optional target filename, and returns the file holding the block (or `null`), a `present` flag, and the inner text when present.

### Ensuring the target file exists

`ensurePointerFile` is a thin helper that creates an empty `AGENTS.md` or `CLAUDE.md` if it does not already exist. It exists so callers can guarantee the file is present before calling `insertPointer`, even though `insertPointer` already handles the missing-file case via the append branch of `applyPointerReplace`.

<!--lw:anchors packages/core/src/pointer.ts#ensurePointerFile-->

```ts
export async function ensurePointerFile(
  repoRoot: string,
  file: PointerFile,
): Promise<void>
```

`ensurePointerFile` takes a repository root and one of the two allowed filenames, and resolves once the file is guaranteed to exist (creating it empty when needed) — it throws if the file argument is not in `POINTER_FILES`.

## Internal export

The file ends with a single internal handle, `export const _internal = { nodeFs };`, which re-exports the `node:fs/promises` module under a named slot. The intent is to make any direct filesystem use easy to audit: tests and other modules can import `_internal` instead of pulling `node:fs/promises` themselves, keeping `pointer.ts` the only place that mixes `node:fs` calls with `safe-io`.

<!--lw:anchors packages/core/src/pointer.ts#_internal-->

```ts
export const _internal = { nodeFs };
```

`_internal` is a frozen-shaped re-export bundle whose only member is the `node:fs/promises` module, exposed for test introspection rather than for general use.

## Tests

Covered by `packages/core/src/pointer.test.ts` (same-name test file on disk).
