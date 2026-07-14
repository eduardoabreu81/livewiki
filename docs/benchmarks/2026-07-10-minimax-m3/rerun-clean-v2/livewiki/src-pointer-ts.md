---
title: src-pointer-ts
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

# src-pointer-ts

Opt-in append of a delimited `<!-- livewiki:start -->` … `<!-- livewiki:end -->` block in `AGENTS.md` or `CLAUDE.md`. Implements SPEC rule #2: pointer mutations are **only** triggered by an explicit `--write-pointer` flag or interactive confirmation — never automatic. Mutations are idempotent block replaces.

This module is the **single documented exception** to `safe-io.ts`'s allowlist of safe directories (`livewiki/` + `.livewiki/`). All pointer writes pass through `safe-io` with `allowPointer: true`, and a double-check validates that the target file is one of the allowed pointer files before any I/O.

## Allowed files and block markers
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#_internal -->

- `POINTER_START` — `"<!-- livewiki:start -->"`. Stable start marker (external parsers may depend on it).
- `POINTER_END` — `"<!-- livewiki:end -->"`. Stable end marker.
- `POINTER_FILES` — `["AGENTS.md", "CLAUDE.md"] as const`. The only legal target files.
- `_internal` — re-exports `{ nodeFs }` so `node:fs/promises` stays encapsulated inside this module.

## Pure string transforms
<!-- lw:anchors packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#pickPointerFile -->

- `pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)` — selects the target file. Honors an explicit `requested`; otherwise prefers an existing `AGENTS.md`, then `CLAUDE.md`, defaulting to `AGENTS.md` when neither exists.
- `buildPointerBlock()` — produces the default block: the two markers wrapping one short PT-BR paragraph that links to `./livewiki/quickstart.md`. Deliberately concise; no wiki content is duplicated inline.
- `findPointerBlock(content)` — pure parser. Returns `{ startIdx, endIdx, inner }` of the first block, or `null` if absent. Tolerates whitespace around markers (CRLF/BOM defense) and treats a truncated block (missing end marker) as absent to avoid corruption.
- `applyPointerReplace(content, newBlock)` — pure replace-or-append. Returns `{ content, action }` with `action ∈ { "inserted" | "replaced" | "unchanged" }`. An `unchanged` action is reported when the normalized output equals the input, guarding against no-op writes.
- `applyPointerRemove(content)` — pure removal. Returns `{ content, removed }`. Cleans up adjacent blank lines so the surrounding document stays tidy.

## Filesystem operations
<!-- lw:anchors packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile -->

- `insertPointer(repoRoot, opts?)` — Inserts or replaces the block in the target file. Idempotent: existing block is replaced in place via `applyPointerReplace`; absent block is appended. Skips writes when the result is `unchanged`. Throws on a target file outside `POINTER_FILES` (defense in depth on top of `safe-io`).
- `removePointer(repoRoot, opts?)` — Removes the block via `applyPointerRemove`. No-op (returns `action: "unchanged"`) when the file or block is absent. Validates the target file before any I/O.
- `readPointerStatus(repoRoot, opts?)` — Reports `{ file, present, inner? }`. When `opts.file` is given, inspects only that file; otherwise scans both `AGENTS.md` and `CLAUDE.md` and returns the first hit.
- `ensurePointerFile(repoRoot, file)` — Low-level helper. Creates the target file as empty if it does not exist. Exposed for tests and callers that want to guarantee the file before calling `insertPointer`.

All filesystem entry points resolve `repoRoot` via `nodePath.resolve`, validate the requested file is a member of `POINTER_FILES`, and delegate reads/writes to `safe-io` with `{ allowPointer: true }` — the only place this opt-in is granted.
