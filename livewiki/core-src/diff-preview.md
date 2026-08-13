---
title: Working-tree diff preview of anchor debt
owner: generated
anchors:
  - packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE
  - packages/core/src/diff-preview.ts#formatDiffPreviewHuman
  - packages/core/src/diff-preview.ts#parseGitDiffOutput
  - packages/core/src/diff-preview.ts#previewWorkingTreeDebt
  - packages/core/src/diff-preview.ts#runGitDiff
---

# Working-tree diff preview of anchor debt

This page documents the read-only orchestrator that previews which wiki anchors would be invalidated by an uncommitted working tree.

## When to use this page

- **Run the preview** with `livewiki status --diff` to see which wiki pages your uncommitted edits would invalidate before you commit.
- **Reuse the git-diff parser** when you need a sorted, deduped list of repo-relative POSIX paths from raw `git diff --name-only` output.
- **Understand the read-only guarantee** when reviewing what the module is allowed to write (nothing) and how it stays deterministic.
- **Format the result for humans** by composing `formatDiffPreviewHuman` with `MOVED_SCOPE_NOTE` in your own CLI output.

## How it fits

This module lives in `packages/core/src/diff-preview.ts` and is the pre-commit mirror of the post-commit anchor ledger in `anchor-ledger.ts`. The ledger only learns about anchor debt after a commit is indexed; this module answers the same "which anchors would break?" question against the *uncommitted* working tree, so authors can see the impact before they commit. It reuses the indexer's own read/parse/extract pipeline (`parseSource` + `extractSymbols`) so the symbol keys and content hashes recomputed from disk are bit-identical to those the indexer would store — that is what makes the comparison meaningful. The module opens the index DB only when `.livewiki/index.db` already exists, and only runs `SELECT`s; it never writes debt rows, anchor updates, or index mutations. When the directory is not a git repo, or git is unavailable, the module degrades cleanly to `notGitRepo: true` rather than throwing.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-diff-preview.mmd
```

## Git diff acquisition

This section explains how the module obtains the changed-file list without ever throwing.

<!-- lw:anchors: packages/core/src/diff-preview.ts#runGitDiff packages/core/src/diff-preview.ts#parseGitDiffOutput -->

`runGitDiff` is the single privileged shell call:

```ts
function runGitDiff(absRoot: string): Promise<string | null>
```

It takes an absolute repo root and returns the raw stdout of `git diff --name-only --relative HEAD` (with `core.quotepath=false` so non-ASCII paths are not C-quoted), or `null` on any failure path.

The spawn runs with `shell: false`. The `-c core.quotepath=false` flag is set on the command line so paths containing non-ASCII bytes are not C-quoted — without it, git would emit a quoted form that would never match the indexed file paths. The `--relative` flag keeps emitted paths relative to `absRoot` even when that root is a subdirectory of the git work tree. The promise is settle-once: `child.on("error", ...)` and `child.on("close", code === 0 ? out : null)` both funnel through a `done` guard so a late `error` after a clean `close` cannot resolve twice. Any failure — git missing, not a repo, no HEAD yet, non-zero exit, synchronous spawn throw — resolves to `null`, never rejects.

`parseGitDiffOutput` turns the captured stdout into a sorted, deduped POSIX list:

```ts
export function parseGitDiffOutput(text: string): string[]
```

It takes the raw `git diff --name-only` text and returns a sorted, deduplicated list of repo-relative POSIX paths. The implementation splits on `\r?\n`, trims each line, skips blanks, runs each non-empty line through `normalizeRepoPath` (so the path style matches the index), and returns the resulting set sorted. It is pure — no I/O — and matches the blank-line-tolerant idiom used by `parseGitChurnOutput` in `risk.ts`.

## Read-only working-tree symbol recomputation

This section explains how the preview re-derives the symbol hash table for each changed file without ever indexing them.

<!-- lw:anchors: packages/core/src/diff-preview.ts#previewWorkingTreeDebt -->

The orchestrator inside `previewWorkingTreeDebt` walks `changedFiles` once:

```ts
export async function previewWorkingTreeDebt(repoRoot: string): Promise<DiffPreviewResult>
```

It takes a repo root (which is resolved to an absolute path internally) and returns a `DiffPreviewResult` describing the changed files plus the wiki pages whose anchors would be invalidated. It never throws on a non-git repo — it returns `{ notGitRepo: true, changedFiles: [], pages: [] }` instead.

For each relative path the orchestrator:

1. **Stats the file on disk.** If `stat` fails, the file is treated as deleted in the working tree — its entry in `workingTreeSymbols` is an empty `Map`, so every anchor to its symbols will read as `deleted`.
2. **Honors the indexer's skip rules.** Files larger than `MAX_FILE_BYTES` (over 1 MiB) or whose first `BINARY_SNIFF_BYTES` contain a NUL byte are placed in `skippedFiles` and excluded from the comparison, so their anchors are not false-flagged. Unreadable files follow the same path.
3. **Reads and EOL-normalizes the content.** `rawContent` is read as UTF-8; `normalizeEol` is applied so the hashes match the indexer's own normalization. Without this, a pure CRLF→LF flip would phantom-flag every anchor for that file as `changed`.
4. **Reuses the indexer's parse + extract path.** When `grammarForExtension(ext)` is `undefined` (prose-tier file) the file yields zero symbols, matching the indexer. Otherwise `parseSource` + `extractSymbols` are called; a `parseSource` throw is swallowed and the file contributes zero symbols, again mirroring the indexer's behavior.

The result is a `Map<relativePath, Map<symbolKey, content_hash>>` representing the working-tree state.

## Anchor comparison against the existing index

This section explains how the recomputed working-tree hashes are compared to the ledger.

`previewWorkingTreeDebt` then opens the existing index DB through `safeIo.resolveAndValidate` and `openIndex`. If `.livewiki/index.db` does not exist, the function short-circuits with `pages: []` — the preview never creates the index, so without an existing index there are no anchors to check.

The single `SELECT` joins `anchors` against `doc_pages` and pulls `(symbol_key, symbol_hash_at_doc, wiki_path)` for every anchor. For each row:

- `derivePathFromSymbolKey(row.symbol_key)` maps the anchor's symbol key back to the repo-relative source path. If the path is unknown, the row is skipped.
- If the path is not in `changedSet` or is in `skippedFiles`, the row is skipped — unchanged files and indexer-skipped files cannot produce a hit.
- The working-tree hash is looked up via `workingTreeSymbols.get(path)?.get(row.symbol_key)`. `undefined` → `deleted`. Defined-but-mismatched → `changed`. Matching → no hit.

Hits are bucketed into `hits: Map<wikiPath, Map<symbolKey, event>>`, which dedupes multiple anchor rows that share a `(page, symbolKey)` pair. The final `pages` array is sorted by `wikiPath` and each page's `items` are sorted by `symbolKey`, giving deterministic output. The `db.close()` runs in a `finally` so a thrown comparison step still releases the connection.

## Human formatting and the `moved` scope note

This section explains how the result is rendered for `livewiki status --diff` and why a scope note is always emitted.

<!-- lw:anchors: packages/core/src/diff-preview.ts#formatDiffPreviewHuman packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE -->

```ts
export function formatDiffPreviewHuman(result: DiffPreviewResult): string
```

It takes the orchestrator's `DiffPreviewResult` and returns a multi-line human-readable string suitable for terminal output. The formatter is the only consumer of `MOVED_SCOPE_NOTE`.

The formatter has three branches:

1. **`notGitRepo`**: prints `livewiki status --diff: not a git repository (or git unavailable) — cannot compute the working-tree diff` and returns. The note is *not* appended here — there is no preview to scope.
2. **Clean working tree** (`pages.length === 0`): prints `livewiki status --diff: working tree clean vs anchors (N changed files)` with the proper singular/plural form for `filesWord`.
3. **Invalidating pages**: prints the header `livewiki status --diff: M pages would be invalidated by the working tree (N changed files)`, then one indented line per `wikiPath`, then one further-indented `[event] symbolKey` line per item. The `changed`/`deleted` event appears in square brackets.

In every branch that produced a real preview (clean or invalidating), the formatter appends `note: ${MOVED_SCOPE_NOTE}` as the final line.

```ts
export const MOVED_SCOPE_NOTE =
  "renames (`moved`) are detected by the post-commit ledger (`livewiki index`), not by this preview";
```

`MOVED_SCOPE_NOTE` is the string constant carried by the human output to explain why `moved` events are absent from the preview. The preview deliberately excludes `moved` because the post-commit ledger catches renames with full-repo evidence; guessing from a partial working-tree diff would false-positive. The note is emitted on every valid preview so the absence of `moved` events is self-documenting at the CLI.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE packages/core/src/diff-preview.ts#formatDiffPreviewHuman packages/core/src/diff-preview.ts#parseGitDiffOutput packages/core/src/diff-preview.ts#previewWorkingTreeDebt packages/core/src/diff-preview.ts#runGitDiff -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Covered by `packages/core/src/diff-preview.test.ts` (same-name test file on disk).
