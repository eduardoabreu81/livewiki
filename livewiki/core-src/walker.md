---
title: Repo file walker (gitignore-aware)
owner: generated
anchors:
  - packages/core/src/walker.ts#DENIED_BASENAMES
  - packages/core/src/walker.ts#DENIED_EXTENSIONS
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#isMinified
  - packages/core/src/walker.ts#walkRepo
---

# Repo file walker (gitignore-aware)

The walker module enumerates every indexable file under a repository root while honoring `.gitignore`, hard-coded defaults, and caller-supplied ignore patterns.

## When to use this page

- **Wire up** the indexer's discovery step by calling `walkRepo` against a known repository root.
- **Audit** which files the indexing pipeline will skip by reviewing `DENIED_EXTENSIONS`, `DENIED_BASENAMES`, and `isMinified`.
- **Map** a file's extension to its documentation tier using `EXTENSION_LANG` (tier-1 with a tree-sitter grammar) versus the fallback (tier-2 prose).
- **Tune** ignore behavior for a particular run by passing `extraIgnores` through `WalkOptions`.

## How it fits

`packages/core/src/walker.ts` lives in the `core` package, which owns the indexing pipeline that turns a source tree into wiki input. The walker is the very first stage of that pipeline: it is the only place that decides which files the rest of the system ever sees.

The module leans on the npm `ignore` library to parse `.gitignore` with the same semantics git itself uses, and on `node:fs/promises`'s `readdir({ withFileTypes: true })` to walk the tree one directory at a time. It produces `WalkResult` objects whose `path` is repository-relative with forward slashes (so output is identical on Windows and POSIX), and whose `lang` is either a tree-sitter-recognized name or the extension itself for prose-only files. The walker does not follow symlinks and never throws on unreadable directories; it logs and continues, leaving the caller with a deterministic, sorted list of files.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-walker.mmd
```

## Ignore filter construction

<!-- lw:anchors packages/core/src/walker.ts#buildIgnore -->

The walker must answer one question before touching the filesystem: "which paths are off-limits?" Answering it well means layering several sources of ignore rules in a single, predictable order.

`buildIgnore` assembles that filter:

```ts
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>>
```

It takes the absolute repository root and a `WalkOptions` (currently `{ extraIgnores?: readonly string[] }`) and returns a filter produced by the npm `ignore` library. The filter first receives hard-coded defaults — `.git/`, `node_modules/`, `.livewiki/`, `livewiki/`, `dist/`, `coverage/` — as defense-in-depth in case `.gitignore` is missing or incomplete. It then attempts to read `.gitignore` from the repo root; the `try/catch` around the read silently treats a missing or unreadable file as "no extra rules" rather than failing the walk. Finally, any caller-supplied `extraIgnores` are appended.

The result is a single filter that the walker consults for every candidate path. The visible `try/catch` is the only exception branch: when `.gitignore` cannot be read, the walker falls back to defaults + extras without raising.

## File classification and filtering

<!-- lw:anchors packages/core/src/walker.ts#DENIED_EXTENSIONS packages/core/src/walker.ts#DENIED_BASENAMES packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#isMinified -->

Once a directory has been read, each entry must be classified as in-scope or out-of-scope. Classification is intentionally a denylist rather than an allowlist: the documentation indexer prefers to see too many files over missing a real source file.

Three small data structures and one helper carry that policy:

```ts
export const EXTENSION_LANG: Record<string, string> = { ... }
```

Maps a file extension (including the leading dot) to a tree-sitter language name (`".ts" → "typescript"`, `".py" → "python"`, etc.). Entries here mark the file as "tier 1" — code with a real parser and therefore symbols worth extracting.

```ts
export const DENIED_EXTENSIONS: ReadonlySet<string> = new Set([ ... ])
```

A frozen-style set of extensions that are never documentation input: archives and binaries (`.zip`, `.gz`, `.exe`, `.so`, `.wasm`, `.pyc`, …), media and fonts (`.png`, `.mp4`, `.pdf`, `.woff`, …), and source maps (`.map`).

```ts
export const DENIED_BASENAMES: ReadonlySet<string> = new Set([ ... ])
```

Lockfiles and similar generated artifacts skipped by exact basename, compared case-insensitively (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `cargo.lock`, `Gemfile.lock`, `poetry.lock`, `go.sum`, `composer.lock`).

```ts
function isMinified(nameLower: string): boolean
```

Takes a lowercased filename and returns `true` when it ends in `.min.js` or `.min.css` — minified bundles are generated artifacts and never documentation input.

Inside `walkRepo`'s per-entry loop these are applied as short-circuit skips in order: extensionless files are dropped first (no meaningful language), then `DENIED_EXTENSIONS`, then `DENIED_BASENAMES`, then `isMinified`. Whatever survives has its language resolved as `EXTENSION_LANG[ext] ?? ext.slice(1)` — grammar-mapped extensions keep their canonical name, everything else becomes tier-2 prose indexed by extension alone.

## Stack-based directory walk

<!-- lw:anchors packages/core/src/walker.ts#walkRepo -->

The actual traversal has to be safe on very deep repositories and uniform across platforms, so the walker uses an explicit stack instead of recursion and emits POSIX-style paths.

```ts
export async function walkRepo(repoRoot: string, opts: WalkOptions = {}): Promise<WalkResult[]>
```

It takes the repository root and optional `WalkOptions`, builds the ignore filter via `buildIgnore`, then drives a stack of absolute directory paths. Each iteration pops one directory and calls `nodeFs.readdir(dir, { withFileTypes: true })` — a single call per directory — wrapped in `try/catch` so that permission-denied or vanishing directories log a warning and are skipped instead of aborting the walk.

For every entry it computes `relFromRoot` with `nodePath.relative`, then converts it to POSIX form by replacing `nodePath.sep` with `/`; the `ignore` filter is consulted against that POSIX-relative path. Directories are pushed back onto the stack; files are filtered through the classification chain above and, on survival, pushed onto `out` as `{ path: relPosix, lang }`. Symlinks and other non-file/non-directory entry kinds are silently ignored (the header documents that the walker does not follow symlinks — a visible loop or error is treated as a configuration smell the user must resolve).

After the stack drains, `out.sort((a, b) => a.path.localeCompare(b.path))` produces a stable, lexicographic order so diffs between runs are readable. The final returned list contains only the indexable files, with their inferred language, in a deterministic order.

## Tests

Covered by `packages/core/src/walker.test.ts` (same-name test file on disk).
