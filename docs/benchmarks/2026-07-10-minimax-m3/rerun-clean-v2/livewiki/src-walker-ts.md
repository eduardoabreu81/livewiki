---
title: src-walker-ts
owner: generated
anchors:
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
---

# src-walker-ts

Recursive directory walker for the repository, respecting `.gitignore` semantics. Emits indexable files as relative POSIX paths with an inferred language tag.

## Purpose

- Per SPEC §Fase 1: respect `.gitignore`.
- Uses the npm `ignore` library — same semantics as git.
- Always ignores (defense in depth): `node_modules/`, `.git/`, `.livewiki/`, `dist/`, `coverage/`.
- Output paths are relative to `repoRoot`, forward-slash separated (cross-platform).
- Does not follow symlinks (SPEC §Fase 1 does not require it).

## Extension → language map

<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG -->

`EXTENSION_LANG` maps a lower-cased file extension to a canonical language identifier used elsewhere in the indexing pipeline. Extensions not present in this table are skipped during the walk.

Recognised entries (MVP):

- `.ts` → `typescript`
- `.tsx` → `tsx`
- `.js` → `javascript`
- `.jsx` → `tsx`
- `.mjs` → `javascript`
- `.cjs` → `javascript`
- `.py` → `python`

## Ignore filter construction

<!-- lw:anchors packages/core/src/walker.ts#buildIgnore -->

`buildIgnore(repoRoot, opts)` constructs the combined ignore filter used by the walk:

1. Start with an empty `ignore()` instance.
2. Add defense-in-depth defaults (see above).
3. Attempt to read `<repoRoot>/.gitignore`. Failure is swallowed silently — only defaults apply when the file is missing.
4. Append any `opts.extraIgnores` patterns.

Returns a promise resolving to an `ignore`-library filter ready to test relative POSIX paths.

## Repository walk

<!-- lw:anchors packages/core/src/walker.ts#walkRepo -->

`walkRepo(repoRoot, opts?)` performs a stack-based recursive traversal of `repoRoot` and returns `WalkResult[]` sorted by `path` (stable ordering for diff-friendly output).

Behaviour:

- Uses a stack of absolute directories to avoid call-stack overflow on deep repos.
- One `readdir({ withFileTypes: true })` call per directory.
- For each entry, computes a relative POSIX path and consults the ignore filter.
- Directories that pass the filter are pushed onto the stack.
- Files that pass the filter are inspected: `lang` is looked up via `EXTENSION_LANG`. Files with unknown extensions are skipped.
- Unreadable directories are logged via `console.warn` and skipped (race conditions / permission errors).
- Symlinks are ignored (`isFile`/`isDirectory` both false); this is intentional and documented in the module header.

## Types

```ts
export interface WalkOptions {
  /** Additional patterns to ignore (beyond .gitignore + defaults). */
  extraIgnores?: readonly string[];
}

export interface WalkResult {
  /** Path relative to repoRoot, forward slashes. */
  path: string;
  /** Language inferred from extension via EXTENSION_LANG. */
  lang: string;
}
```

## Invariants

- Output paths always use `/` regardless of host platform.
- Sort order: `path.localeCompare` ascending.
- Symlinks: not followed (see module header).
- TODO: document any error-handling guarantees beyond the per-directory `console.warn`.