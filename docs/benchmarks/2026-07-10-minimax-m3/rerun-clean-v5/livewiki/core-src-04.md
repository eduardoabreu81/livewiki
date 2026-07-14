---
title: livewiki core-src-04 reference
owner: generated
anchors:
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#remove
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/status.ts#run
  - packages/core/src/symbols.test.ts#parse
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#walkNode
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/walker.test.ts#write
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
---

# packages/core/src/safe-io.ts

Safe-I/O is the only module authorized to write to disk. Inviolable rule #1
of the SPEC: every write goes through here. All writes are validated against
the allowlist (`livewiki/` + `.livewiki/` inside `repoRoot`). Paths outside
the allowlist = error. No exceptions, not even in tests.

Defense against symlinks: after validating that the declared path is inside
the allowlist (fast, fail-early), walk from the target up to the deepest
existing ancestor, realpath it, reconstitute the final path, and RE-VALIDATE
the allowlist. This closes attacks of the form:

- `livewiki` is a symlink to `/tmp/` → realpath shows /tmp, outside
- `livewiki/sub` is a symlink to `../src` → realpath shows src, outside
- `livewiki/leaf` is a symlink to `/etc/x` → realpath shows /etc, outside

## `## packages/core/src/safe-io.ts#ALLOWED_DIRS`

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

Directories inside `repoRoot` where writing is allowed. The `AllowedDir`
type is derived from this tuple.

## `## packages/core/src/safe-io.ts#PathOutsideAllowlistError`

Error class raised when an I/O operation targets a path that is not inside
the allowlist.

### `### packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor`

```ts
constructor(repoRoot: string, attempted: string, allowlist: readonly string[])
```

Stores `repoRoot`, `attempted`, and `allowlist` as readonly fields and
formats a descriptive message identifying the refusing I/O and the active
allowlist.

## `## packages/core/src/safe-io.ts#InvalidRelativePathError`

Error class raised when a relative path is malformed (absolute, traversal,
etc.).

### `### packages/core/src/safe-io.ts#InvalidRelativePathError.constructor`

```ts
constructor(relPath: string, reason: string)
```

Formats the reason into a single message and sets `name =
"InvalidRelativePathError"`.

## `## packages/core/src/safe-io.ts#allowlistFor`

```ts
function allowlistFor(opts: SafeIoOptions): readonly string[]
```

Builds the effective allowlist. When `opts.allowPointer` is true, `AGENTS.md`
and `CLAUDE.md` are appended (that flag is consumed by the pointer module
in Phase 5, not by safe-io itself).

## `## packages/core/src/safe-io.ts#allowedAbs`

```ts
function allowedAbs(repoRoot: string, dir: AllowedDir): string
```

Absolute path of an allowed directory inside `repoRoot`. Throws if
`repoRoot` is invalid or the resolved directory escapes it.

## `## packages/core/src/safe-io.ts#isInsideAllowlist`

```ts
export function isInsideAllowlist(
  repoRoot: string,
  absPath: string,
  opts?: SafeIoOptions,
): boolean
```

Pure: does not touch disk. Compares by prefix + separator (not substring) to
prevent `livewiki-evil` from being accepted as inside `livewiki/`. Used both
in the initial (fast) validation and in the post-realpath revalidation.

## `## packages/core/src/safe-io.ts#validateDeclared`

```ts
function validateDeclared(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions,
): string
```

Validates the declared path WITHOUT considering symlinks. Fails early on
absolute paths, traversal, or allowlist violations.

## `## packages/core/src/safe-io.ts#findDeepestExisting`

Walks up from the target to the deepest existing ancestor so the post-realpath
revalidation can be applied correctly.

## `## packages/core/src/safe-io.ts#resolveAndValidate`

```ts
export async function resolveAndValidate(
  repoRoot: string,
  relPath: string,
  opts?: SafeIoOptions,
): Promise<string>
```

Returns the absolute path of `relPath` after both declared validation and
the symlink-defensive revalidation. Throws `InvalidRelativePathError` or
`PathOutsideAllowlistError` on failure.

## `## packages/core/src/safe-io.ts#writeText`

```ts
export async function writeText(
  repoRoot: string,
  relPath: string,
  content: string,
): Promise<void>
```

Validates the path, ensures the parent directory exists (via `mkdir`),
and writes `content` as UTF-8.

## `## packages/core/src/safe-io.ts#readText`

```ts
export async function readText(
  repoRoot: string,
  relPath: string,
): Promise<string>
```

Validates the path and reads the file as UTF-8.

## `## packages/core/src/safe-io.ts#exists`

```ts
export async function exists(
  repoRoot: string,
  relPath: string,
): Promise<boolean>
```

Validates the path and returns whether the file or directory is present on
disk.

## `## packages/core/src/safe-io.ts#mkdir`

```ts
export async function mkdir(
  repoRoot: string,
  relPath: string,
): Promise<void>
```

Validates the path and creates the directory (recursive).

## `## packages/core/src/safe-io.ts#remove`

```ts
export async function remove(
  repoRoot: string,
  relPath: string,
): Promise<void>
```

Validates the path and removes the file or directory (recursive).

# packages/core/src/status.ts

Status — full report of the wiki + index state.

Phase 1: indexed files, symbols by kind, breakdown by language, top-N files
by symbol count. Phase 2: open debt (changed/moved/deleted) by assignee,
undocumented symbols. Human mode: multi-line text. JSON mode: complete
structured object (for agents).

## `## packages/core/src/status.ts#run`

```ts
export async function run(
  repoRoot: string,
  opts?: StatusOptions,
): Promise<StatusReport>
```

Opens the index, calls `collect`, and best-effort attaches the metrics
snapshot (failure to read metrics does not break the status run).

## `## packages/core/src/status.ts#collect`

```ts
function collect(db: Database, topN: number): StatusReport
```

Pure-ish: queries the open SQLite database for files, symbols, debt,
and undocumented rows, then aggregates them into the report shape. No
disk writes.

## `## packages/core/src/status.ts#formatHuman`

```ts
export function formatHuman(report: StatusReport): string
```

Formats the structured report into the multi-line text representation used
by `--human` output.

# packages/core/src/symbols.ts

Symbols — extracts `SymbolRecord`s from the tree-sitter AST.

Coverage by language:

- TypeScript / TSX / JavaScript:
  - `function_declaration` → kind: "function"
  - `generator_function_declaration` → kind: "function"
  - `class_declaration` → kind: "class"
  - `method_definition` → kind: "method" (parent = class)
  - arrow function with a name → kind: "function" (assigned to const)
  - `export_statement` → kind: "export" (covers re-exports)
- Python:
  - `function_definition` → kind: "function"
  - `class_definition` → kind: "class"
  - `decorated_definition` → kind wraps fn/class

Symbol keys (per SPEC):

- top-level: `path/relative.ext#Name`
- method: `path/relative.ext#Class.method`
- Python decorator: `path/relative.py#decorated_fn`

Extraction is "honest" — only declared symbols are emitted. Anonymous
functions are skipped because the symbol key must be referenceable.

## `## packages/core/src/symbols.ts#extractSymbols`

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
```

Walks the tree-sitter root node and returns all collected `SymbolRecord`s.
`relPath` is the forward-slash relative path coming from the walker.

## `## packages/core/src/symbols.ts#walkNode`

```ts
function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: SymbolRecord[],
): void
```

Recursive descent. Special-cases `class_declaration` (TS) / `class`
(Python) to descend into methods with `parentClassName` set, and
`export_statement` to avoid duplicating `class`/`function` entries.

## `## packages/core/src/symbols.ts#makeRecord`

```ts
function makeRecord(
  node: Node,
  source: string,
  relPath: string,
  name: string,
  kind: SymbolKind,
): SymbolRecord
```

Builds a `SymbolRecord` with `key`, `name`, `kind`, `signature`,
`start_line`/`end_line`, and the `content_hash` over the node's source
slice.

## `## packages/core/src/symbols.ts#signatureFor`

```ts
function signatureFor(node: Node, source: string): string | null
```

Returns a one-line representative snippet (header / first line) suitable
for use in anchors. Returns `null` when no usable signature exists.

# packages/core/src/symbols.test.ts

Vitest suite covering TypeScript and Python symbol extraction: top-level
functions, classes + methods (qualified), generator functions, decorated
Python definitions, export handling (no duplication), signature capture,
and `content_hash` determinism + sensitivity.

## `## packages/core/src/symbols.test.ts#parse`

```ts
async function parse(ext: string, src: string)
```

Initializes the tree-sitter parser once (in `beforeAll`) and exposes a
typed helper that wraps `parseSource(ext, src)`.

# packages/core/src/update-metrics.ts

Update-metrics — incremental accounting for Phase 3 / Phase 5.

Design choice: a JSON file at `.livewiki/update_metrics.json` instead of a
SQLite table. Reasons:

1. Does not touch schema v4 — accounting is incremental; SQL power is
   unnecessary (queries are "latest value" and "sum by kind").
2. Reconstructable: deleting `.livewiki/` simply restarts from zero on
   the next `update` (rule #3: the DB is derived; important data lives
   in versioned markdown / manifest).
3. Append-only is simpler than managing migrations.

Each entry has the shape `{ kind, timestamp, ... }`:

- `kind: "package_emitted"` — emitted by `loadWorkPackage`
- `kind: "write_received"` — emitted when an agent or human returns a
  written doc

## `## packages/core/src/update-metrics.ts#metricsPath`

```ts
async function metricsPath(repoRoot: string): Promise<string>
```

Absolute path of the metrics JSON inside the repo, routed through
`safeIo.resolveAndValidate`.

## `## packages/core/src/update-metrics.ts#readMetrics`

```ts
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
```

Reads the metrics JSON or returns a fresh empty file when missing or
corrupt (corrupt shapes are replaced per rule #3).

## `## packages/core/src/update-metrics.ts#writeMetrics`

```ts
async function writeMetrics(
  repoRoot: string,
  file: UpdateMetricsFile,
): Promise<void>
```

Persists the file via `safeIo.writeText` (last coherent state wins).

## `## packages/core/src/update-metrics.ts#recordUpdateMetric`

```ts
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void>
```

Append-only. Fire-and-forget: errors here must not break the main
`update` flow.

## `## packages/core/src/update-metrics.ts#snapshotMetrics`

```ts
export async function snapshotMetrics(
  repoRoot: string,
): Promise<UpdateMetricsSnapshot>
```

Aggregates entries into the snapshot exposed by `status --json`:
`packagesEmitted`, `totalPackageTokens`, `writesReceived`,
`totalWriteTokens`, `efficiencyRatio = totalWriteTokens /
totalPackageTokens` (or `null` if no packages), plus `lastPackage` and
`lastWrite` for debugging.

## `## packages/core/src/update-metrics.ts#clearMetricsForTests`

```ts
export async function clearMetricsForTests(
  repoRoot: string,
): Promise<void>
```

Test helper: clears the metrics file. Useful in `beforeEach`.

# packages/core/src/update.ts

Update — incremental mode (heart of the product, Phase 5).

Loads a focused work package: manifest + open debt + source snippets
around affected anchors + valid anchor keys + token estimate. The thesis
("800 tokens instead of re-reading the repo") lives here: the package is
focused, not the whole repo.

Package shape (`WorkPackage`):

- `manifest` — manifest fields, or `null` if the repo was never initialized.
- `debt` — open debt items (`changed`/`moved`/`deleted`) with `assignee`.
- `snippets` — for each debt item with a symbol key, a bounded window of
  source lines centered on `start_line`.
- `validAnchors` — keys of active symbols the agent may anchor against.
- `tokensEstimated` — package size in chars / `CHARS_PER_TOKEN`.
- `bytes` — serialized package byte size.
- `language` — human-message language, currently unused but reserved.

## `## packages/core/src/update.ts#CHARS_PER_TOKEN`

```ts
export const CHARS_PER_TOKEN = 4;
```

Heuristic estimate: ~4 characters per token for code/English.

## `## packages/core/src/update.ts#loadWorkPackage`

```ts
export async function loadWorkPackage(
  repoRoot: string,
  opts?: WorkPackageOptions,
): Promise<WorkPackage>
```

Loads manifest + debt (via `runStatus`) + snippets + valid anchor keys +
token estimate. Does NOT call an LLM. As a side effect, records a
`package_emitted` metric (idempotent rewrite when nothing changed).

## `## packages/core/src/update.ts#snippetForSymbol`

```ts
async function snippetForSymbol(
  repoRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null>
```

Reads the source file and returns a bounded window of lines around the
symbol (default ±20 lines). Returns `null` when the file or symbol
cannot be resolved.

## `## packages/core/src/update.ts#lookupSymbol`

```ts
async function lookupSymbol(
  repoRoot: string,
  symbolKey: string,
): Promise<SymbolRow | null>
```

Looks up a symbol by key in the active set. Used to build the
`validAnchors` list.

## `## packages/core/src/update.ts#recordDocWrittenBack`

```ts
export async function recordDocWrittenBack(
  repoRoot: string,
  wikiPath: string,
  bytes: number,
  tokensEstimated: number,
): Promise<void>
```

Appends a `write_received` metric — used by agents (via the
`document-as-you-go` skill) or by the post-edit CLI hook. Feeds the
efficiency ratio exposed by `status --json`.

# packages/core/src/update.test.ts

Vitest suite covering `update`'s incremental mode. Heart of the product:
`loadWorkPackage` emits a focused package (debt + snippets + validAnchors +
tokensEstimated). The suite covers:

- Package includes manifest when `livewiki` was initialized.
- Package without manifest when the repo was never initialized.
- `changed` debt detection when source is modified against an existing
  anchor.
- Snippets carry the real (modified) source plus context lines.
- `tokensEstimated > 0` when there is debt.
- `status --json` exposes metrics with the write/package efficiency.
- `recordDocWrittenBack` updates the `efficiencyRatio`.

The fixture includes a wiki page with an anchor — without it the ledger
cannot generate debt (rule: debt = anchor changed; without an anchor,
nothing to detect).

## `## packages/core/src/update.test.ts#writeCode`

```ts
async function writeCode(rel: string, content: string): Promise<void>
```

Writes a code file under the temp `repoRoot`, creating parent directories.

## `## packages/core/src/update.test.ts#writeWiki`

```ts
async function writeWiki(rel: string, content: string): Promise<void>
```

Writes a wiki file under the temp `repoRoot`, creating parent directories.

## `## packages/core/src/update.test.ts#setupWithAnchor`

```ts
async function setupWithAnchor(): Promise<void>
```

Writes `src/foo.ts` exporting `bar`, runs `indexer` + `anchor-ledger`,
writes `livewiki/foo.md` with the matching anchor, then re-runs both
pipelines so the baseline is in place.

# packages/core/src/verify.ts

Verify — validates the wiki against the code index.

Checks:

- Anchors (page and section) reference existing symbols in the index.
- Manual blocks are byte-for-byte preserved (rule #6).
- Internal links between wiki pages resolve.

Exit code `!= 0` on error (CI-friendly). The DB is opened only to consult
active symbols and the manual-blocks baseline for rule #6.

The wiki walk is ALWAYS from disk — `doc_pages` from the DB is not relied
on, so ghost pages (created after the last index) are still detected
(anti-hallucination promise: an LLM-written doc is verifiable without
running `index` first).

## `## packages/core/src/verify.ts#run`

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
```

Top-level entrypoint. Ensures `.livewiki/` exists, opens the index,
walks the wiki from disk, and emits `VerifyResult` with `ok`,
`pagesChecked`, and `issues`.

## `## packages/core/src/verify.ts#collectWikiPages`

```ts
async function collectWikiPages(
  absRoot: string,
): Promise<{ relPath: string }[]>
```

Walks the wiki directory under `absRoot` and returns relative paths.
Walked from disk so pages written after the last index are visible.

## `## packages/core/src/verify.ts#collectSectionSlugs`

```ts
async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>>
```

Reads a wiki page and extracts the set of section slugs used by internal
`#section` links.

## `## packages/core/src/verify.ts#resolveWikiLink`

```ts
function resolveWikiLink(
  fromRelPath: string,
  linkRaw: string,
): string | null
```

Resolves a relative markdown link target (using `path.posix` so `..` is
honored) into an absolute-from-repo wiki path, or `null` if the link
escapes the wiki namespace.

## `## packages/core/src/verify.ts#isInsideWiki`

```ts
function isInsideWiki(wikiPath: string): boolean
```

True iff the resolved wiki path lives under the `livewiki/` namespace.

## `## packages/core/src/verify.ts#formatHuman`

```ts
export function formatHuman(result: VerifyResult): string
```

Formats the structured `VerifyResult` into the multi-line text used by
the CLI's human-readable output.

# packages/core/src/verify.test.ts

Vitest suite covering the verify command's criteria:

- Anchor criteria: broken anchor (symbol missing), broken anchor (file
  missing), valid anchor (no issues).
- Internal link that escapes `livewiki/` is reported as
  `broken_internal_link` with severity `warning` (verify is read-only —
  it does not block links that point outside; it just reports).
- Rule #6 byte-for-byte manual-block preservation: unchanged block is OK,
  altered block is reported as `manual_block_altered`.

## `## packages/core/src/verify.test.ts#writeCode`

```ts
async function writeCode(rel: string, content: string): Promise<void>
```

Writes a code file under the temp `repoRoot`, creating parent directories.

## `## packages/core/src/verify.test.ts#writeWiki`

```ts
async function writeWiki(rel: string, content: string): Promise<void>
```

Writes a wiki file under the temp `repoRoot`, creating parent directories.

# packages/core/src/walker.ts

Walker — scans repo files honoring `.gitignore`.

Uses the `ignore` npm package (same semantics as git). Always ignores
(defense in depth, even without `.gitignore`):

- `node_modules/`
- `.git/`
- `.livewiki/`
- `dist/`
- `coverage/`

Output: paths RELATIVE to `repoRoot`, forward-slash separated
(cross-platform). Symlinks are NOT followed — they are rare in source
code and would either loop or error (intentional signal).

## `## packages/core/src/walker.ts#EXTENSION_LANG`

```ts
export const EXTENSION_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};
```

Extension → language map covering the MVP languages.

## `## packages/core/src/walker.ts#buildIgnore`

```ts
async function buildIgnore(
  repoRoot: string,
  opts: WalkOptions,
): Promise<ReturnType<typeof ignore>>
```

Builds the combined ignore filter: defaults + `.gitignore` content
(silently ignored when absent) + `opts.extraIgnores`.

## `## packages/core/src/walker.ts#walkRepo`

```ts
export async function walkRepo(
  repoRoot: string,
  opts?: WalkOptions,
): Promise<WalkResult[]>
```

Stack-based recursive scan (avoids callstack blowups on deep repos).
One `readdir({ withFileTypes: true })` per directory. Filters through
`buildIgnore` and keeps only files whose extension is in
`EXTENSION_LANG`. Output is sorted by path for stable diffs between
runs.

# packages/core/src/walker.test.ts

Vitest suite covering the walker:

- `EXTENSION_LANG` covers TS/TSX/JS/JSX/Python.
- `walkRepo` returns indexable files with the right `lang`.
- `node_modules/`, `.git/`, `dist/`, and `coverage/` are ignored by
  default.
- `.gitignore` is respected.
- `extraIgnores` overlays the `.gitignore` rules.
- Paths are returned with forward slashes (cross-platform).
- Output order is stable.
- Unknown extensions are skipped.
- Walk works without a `.gitignore` (fresh repo).

## `## packages/core/src/walker.test.ts#write`

```ts
async function write(rel: string, content = ""): Promise<void>
```

Writes a file under the temp `repoRoot`, creating parent directories.
`content` defaults to empty.