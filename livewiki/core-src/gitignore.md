---
title: Gitignore entry manager
owner: generated
anchors:
  - packages/core/src/gitignore.ts#readGitignore
  - packages/core/src/gitignore.ts#ensureGitignoreEntries
  - packages/core/src/gitignore.ts#extractManagedBlock
  - packages/core/src/gitignore.ts#mergeBlockLines
  - packages/core/src/gitignore.ts#renderBlock
  - packages/core/src/gitignore.ts#replaceManagedBlock
---

# Gitignore entry manager

This page documents the `gitignore.ts` module, which idempotently writes the entries that a livewiki project requires in a target repository's `.gitignore` file.

## When to use this page

- **Initialize** a new livewiki project in a repository and verify the required `.gitignore` entries are present.
- **Audit** whether a repository's `.gitignore` already contains the livewiki-managed entries before running other tools.
- **Extend** the module when a new entry must be managed by livewiki without disturbing user-authored entries.

## How it fits

The `gitignore.ts` module lives in `packages/core/src/` and is consumed by the `livewiki init` command. Its job is to keep a repository's `.gitignore` in a state where livewiki's derived cache (the `.livewiki/` directory, which holds a SQLite cache per the "DB is derived" rule) is ignored, without ever duplicating entries or stripping the user's own lines. It does this by carving out a clearly delimited **managed block** inside `.gitignore` so future updates can target that block specifically.

The module has no upstream dependencies beyond Node's `node:fs/promises` and `node:path`; nothing else in the source excerpt calls into it.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-gitignore.mmd
```

## Reading the existing .gitignore

The flow begins by reading whatever `.gitignore` currently exists in the target repository, so every later decision can be made against real evidence rather than assumptions. Reading first matters because the manager's idempotency contract — calling it twice must not duplicate entries — depends on knowing exactly which lines are already there; if the file is missing entirely the rest of the pipeline still has to work, so the read must be tolerant of that case as well.

`readGitignore` resolves the repository root to an absolute path, joins `.gitignore` onto it, and reads it as UTF-8; if the file is missing, the catch returns an empty string instead of throwing.

```ts
export async function readGitignore(repoRoot: string): Promise<string>
```

It takes a repository root path (string) and returns the file's contents as a string, or `""` if no `.gitignore` exists. Resolving to an absolute path first means callers can hand in a relative working directory and the function still locates the right file; swallowing the missing-file case keeps `ensureGitignoreEntries` from needing a separate existence check. Because the function is just a thin wrapper over `nodeFs.readFile` with a swallowed error, it stays trivially testable in isolation and never imposes extra behavior on callers that want to distinguish "no file" from "empty file" (both surface as the empty string).

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore -->

These anchors identify indexed symbols whose implementation is part of this module.

## Extracting the managed block

Before deciding what to add, the writer needs to know whether a previous livewiki run already carved out a managed block in the file. The block is the only region the module is allowed to rewrite, so detecting it correctly is what protects the user's hand-written entries from being clobbered on a re-run.

`extractManagedBlock` runs two anchored regexes (`# livewiki:start` and `# livewiki:end`) against the raw file content and, if both markers are found, returns the non-empty trimmed lines between them; if either marker is missing it returns `null`. A truncated block (only a start marker, no end) is therefore treated as if no block existed — the writer will simply append a fresh block rather than mutate a partial one.

```ts
function extractManagedBlock(content: string): { lines: string[] } | null
```

It takes the full file content (string) and returns the trimmed entry lines inside the managed block, or `null` when no complete block is present. Returning `null` rather than an empty object keeps the call site branching explicit: a missing block and an empty block trigger different downstream behavior (append at end vs. treat the file as the target list). The regexes tolerate arbitrary whitespace around the marker keywords, so a hand-edited comment like `#  livewiki:start ` still counts as the block boundary.

<!-- lw:anchors packages/core/src/gitignore.ts#extractManagedBlock -->

These anchors identify indexed symbols whose implementation is part of this module.

## Determining which entries are missing

The next step figures out, against the live evidence, which requested entries are not yet covered. If everything is already covered, the flow short-circuits with `changed: false` and never touches the file. This check is what enforces the idempotency rule: a second call with the same entries must observe that the block already contains them and bail out before any rewrite.

The code inside `ensureGitignoreEntries` builds a `targetSet` from either the lines inside the managed block, or — when there is no block — every non-blank, non-comment line in the entire file. Missing entries are then computed by filtering the requested entries against that set with a trimmed, case-sensitive membership test (the visible code uses `Set.has`, so membership is exact match after trim, not a case-insensitive comparison).

```ts
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult>
```

It takes a repository root path and a read-only list of entry strings, and returns an `EnsureGitignoreResult` describing the absolute `.gitignore` path, whether anything changed, and which entries were added. The short-circuit on `missing.length === 0` is the concrete point where a fully-populated block is left untouched on disk — the file's mtime will not change, which is important for tooling that watches `.gitignore`. Choosing "lines inside the block, or the whole file if there is no block" as the comparison universe means a fresh install (no block yet) treats every existing user entry as already-covered, so a re-run after a manual edit still avoids clobbering lines the user put there themselves.

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries -->

These anchors identify indexed symbols whose implementation is part of this module.

## Merging new entries into the block

Once a missing list is known, those entries must be folded into the existing block while preserving the existing order and avoiding internal duplicates. Doing the merge as a pure list operation (rather than by string-matching inside the file) keeps the file edit atomic and lets the rest of the pipeline treat the block as an opaque blob to be swapped in later.

`mergeBlockLines` seeds a working set from the existing block's trimmed lines, copies the existing list verbatim into the result, then appends each new entry whose trimmed form is not already in the set. Existing lines are kept before new ones, and the caller-supplied order of the new entries is the order in which they appear in the result.

```ts
function mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[]
```

It takes the block's existing lines and the new entries to add, both as read-only string arrays, and returns a new array of the merged lines. The function does not sort or deduplicate beyond the trimmed-equality check, so the caller controls both the input order and any later normalization; this matters because gitignore semantics are order-sensitive (a later negation pattern can re-include a previously ignored path). Because the working set is built from the existing lines and updated only as new entries are appended, each new entry is added at most once even if the caller passes the same string twice in `toAdd`.

<!-- lw:anchors packages/core/src/gitignore.ts#mergeBlockLines -->

These anchors identify indexed symbols whose implementation is part of this module.

## Rendering and replacing the managed block

The merged line list must be wrapped back into the canonical start/end markers, and the file must be reassembled around it without losing the user's surrounding content. Splitting this into a renderer (which knows nothing about the file) and a replacer (which knows nothing about the line list) keeps each piece independently testable and lets future callers reuse just the rendering step if they need to.

`renderBlock` joins `BLOCK_START`, the lines, and `BLOCK_END` with single newlines to produce the canonical block string.

```ts
function renderBlock(lines: string[]): string
```

It takes the merged entry lines and returns the rendered block including both marker comments.

`replaceManagedBlock` then substitutes the new block back into the file. If both markers are present it slices the file at the exact marker positions and rejoins the three pieces, inserting a newline separator only when the trailing chunk does not already begin with one. If neither pair of markers is present it appends the block at the end, picking a separator based on whether the file is empty, already ends in a newline, or has content without a trailing newline.

```ts
function replaceManagedBlock(content: string, newBlock: string): string
```

It takes the current file content and the rendered block, and returns the new full file content ready to be written. The careful separator handling — always producing exactly one blank line between the appended block and the preceding content — is what keeps the result readable when the user later opens `.gitignore` in an editor. Keeping the slice anchors exactly at the matched marker positions (rather than at newline boundaries) means a user who adds stray whitespace around the markers still gets a clean cut, and the slice never captures or drops a neighboring user-authored line.

<!-- lw:anchors packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

These anchors identify indexed symbols whose implementation is part of this module.

## Writing the result

The final step writes the rebuilt content back to disk and reports what happened, so the caller can surface that information to the user.

`ensureGitignoreEntries` calls `nodeFs.writeFile` with the reassembled content only when at least one entry was missing; in the no-op path the file is left untouched and `changed: false` is returned. The returned `EnsureGitignoreResult` exposes the absolute `.gitignore` path, the `changed` flag, and the list of entries that were actually added — callers use that to tell the user exactly what was written.

## Tests

Covered by `packages/core/src/gitignore.test.ts` (same-name test file on disk).
