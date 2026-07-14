---
title: src-gitignore-ts
owner: generated
anchors:
  - packages/core/src/gitignore.ts#ensureGitignoreEntries
  - packages/core/src/gitignore.ts#extractManagedBlock
  - packages/core/src/gitignore.ts#mergeBlockLines
  - packages/core/src/gitignore.ts#readGitignore
  - packages/core/src/gitignore.ts#renderBlock
  - packages/core/src/gitignore.ts#replaceManagedBlock
---

# `packages/core/src/gitignore.ts`

Idempotent `.gitignore` entry writer used by `livewiki init`. Ensures the
required entries (e.g. `.livewiki/`) are present inside a managed block
delimited by `# livewiki:start` / `# livewiki:end` markers, without
duplicating existing entries or removing user-added lines.

## Module-level constants

```ts
const BLOCK_START = "# livewiki:start";
const BLOCK_END   = "# livewiki:end";
```

These markers are stable; external parsers may depend on them.

## `EnsureGitignoreResult`

Result type returned by [`ensureGitignoreEntries`](#ensuregitignoreentries).

| Field     | Type       | Description                                                |
| --------- | ---------- | ---------------------------------------------------------- |
| `file`    | `string`   | Absolute path of the `.gitignore`.                         |
| `changed` | `boolean`  | `true` if something was written; `false` if already current. |
| `added`   | `string[]` | Entries that were missing and got added.                   |

## Reading the file
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore -->

### `readGitignore(repoRoot)`

```ts
export async function readGitignore(repoRoot: string): Promise<string>
```

Returns the contents of `<repoRoot>/.gitignore`, or an empty string if the
file does not exist. A thin wrapper over `node:fs/promises.readFile` kept
pure for testability. The repository root is resolved via
`nodePath.resolve` before joining `.gitignore`.

## Public entry point
<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries -->

### `ensureGitignoreEntries(repoRoot, entries)`

```ts
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult>
```

Idempotently ensures every entry in `entries` appears in the repo's
`.gitignore`, inside the managed block.

Behavior:

- File does not exist — created with a managed block.
- File exists without block — the managed block is appended.
- File exists with block — only the block is rewritten; surrounding user
  entries are preserved.
- Entries already present in the block — no-op (no duplicates).
- Membership is checked case-sensitively after trimming.
- Missing entries are detected against the managed block when present,
  otherwise against the non-comment, non-empty lines of the whole file.

Returns `{ file, changed: false, added: [] }` when no work is required,
otherwise writes the new content and returns
`{ file, changed: true, added: missing }`.

There is no opt-out. SPEC §"Inviolable rules" #3 requires `.livewiki/`
(the derived SQLite cache) to be git-ignored; a future `--no-gitignore`
flag on `init` could bypass this.

## Block parsing and rendering
<!-- lw:anchors packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock -->

### `extractManagedBlock(content)`

```ts
function extractManagedBlock(content: string): { lines: string[] } | null
```

Locates the managed block using the regexes
`/^#\s*livewiki:start\s*$/m` and `/^#\s*livewiki:end\s*$/m`. Returns
`null` when either marker is missing (a truncated block is ignored).
The lines between the markers are split on `\r?\n`, trimmed, and
empties filtered out.

### `mergeBlockLines(existing, toAdd)`

```ts
function mergeBlockLines(
  existing: readonly string[],
  toAdd: readonly string[],
): string[]
```

Appends entries from `toAdd` that are not already in `existing` (trimmed,
case-sensitive). Existing entries are emitted first to preserve caller
order.

### `renderBlock(lines)`

```ts
function renderBlock(lines: string[]): string
```

Joins `BLOCK_START`, the given lines, and `BLOCK_END` with `\n`.

## File rewriting
<!-- lw:anchors packages/core/src/gitignore.ts#replaceManagedBlock -->

### `replaceManagedBlock(content, newBlock)`

```ts
function replaceManagedBlock(content: string, newBlock: string): string
```

Rewrites the managed block in `content`. When both markers are present
the exact range between them is replaced; if a separator is required
between the new block and the trailing content, a single `\n` is
inserted. When no block exists, the new block is appended, with
spacing chosen based on whether `content` is empty or already ends in
`\n` (using `""`, `"\n"`, or `"\n\n"` as the separator, and a trailing
`"\n"` after the block).

## Notes

- The managed block is parser-stable so future updates can target it
  surgically.
- Existing user entries outside the block are never removed.
- TODO: `--no-gitignore` opt-out flag is not implemented yet.