---
title: Anchor ledger
owner: generated
anchors:
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/anchor-ledger.ts#collectWikiPages
  - packages/core/src/anchor-ledger.ts#createDebt
  - packages/core/src/anchor-ledger.ts#detectMoves
  - packages/core/src/anchor-ledger.ts#endOfLine
  - packages/core/src/anchor-ledger.ts#escapeRegex
  - packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody
  - packages/core/src/anchor-ledger.ts#findFrontmatterEnd
  - packages/core/src/anchor-ledger.ts#hasOpenDebt
  - packages/core/src/anchor-ledger.ts#hashContent
  - packages/core/src/anchor-ledger.ts#isDelimiterLineAt
  - packages/core/src/anchor-ledger.ts#nextLineStart
  - packages/core/src/anchor-ledger.ts#orchestrate
  - packages/core/src/anchor-ledger.ts#reconcileManualBlocks
  - packages/core/src/anchor-ledger.ts#rewriteBodyMarkers
  - packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList
  - packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage
  - packages/core/src/anchor-ledger.ts#run
  - packages/core/src/anchor-ledger.ts#upsertAnchor
  - packages/core/src/anchor-ledger.ts#upsertDocPage
  - packages/core/src/anchor-ledger.ts#upsertUndocumented
---

# Anchor ledger

This page is the technical reference for the anchor-ledger module, which keeps the wiki's anchor tables in sync with the code index and produces the change debt that other surfaces consume.

## When to use this page

- **Run** the `ledger` phase of livewiki to refresh anchors and debt after a code index pass.
- **Debug** spurious `changed` / `moved` / `deleted` debt by tracing which step recorded the row.
- **Investigate** why a moved symbol's anchor was rewritten in Markdown or skipped because of manual-block or human-owner rules.

## How it fits

The anchor-ledger sits in the `packages/core/src` repository tree and depends on three sibling modules: `safe-io` for path-allowlisted disk reads and writes, `db` for opening the SQLite index and the row types it stores, and `anchors` for parsing each wiki page's frontmatter and section markers. Hashing is delegated to `hashes` and Markdown masking to `markdown-mask`. Its single exported entry point is `run`, which prepares the `.livewiki/` cache directory, resolves the SQLite path through the safe-io validator, opens the database, and calls `orchestrate`. The orchestrator then walks the wiki pages, upserts `doc_pages` and `anchors`, reconciles the `manual_blocks` multiset, detects symbol moves, rewrites Markdown anchor references when a move is safe, diffs each anchor against the live symbol index, and expires pages that no longer exist on disk.

Most user-facing terminology in this module is specific to livewiki: an **anchor** is a `(doc_page_id, section_slug, symbol_key)` triple stored in the SQLite `anchors` table; a **debt** is a row in the `debt` table marking a `changed`, `moved`, or `deleted` event that a human or agent must reconcile; a **manual block** is a Markdown region wrapped in `lw:manual` markers that the automated rewrite paths must never touch; the **owner** is the frontmatter field (`generated`, `human`, or `mixed`) that decides who is responsible for a page's anchors; the **assignee** is the agent or human that the debt is routed to.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-anchor-ledger.mmd
```

## Entry point and lifecycle

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate -->

The `run` function is the public command surface. It resolves the repository root, ensures the `.livewiki/` directory exists via `safeIo.mkdir`, validates the database path through `safeIo.resolveAndValidate`, opens the SQLite index, and finally delegates to `orchestrate`. The orchestrator returns a `LedgerResult` that the CLI streams as JSON or human-readable output, and the database is closed in a `finally` block so a thrown error never leaks the open connection.

```ts
export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult>
```

`run` accepts a repository root path and an optional `LedgerOptions` bag, and returns a promise that resolves to a `LedgerResult` describing what was upserted, how much debt was created, and which symbol pairs were treated as moves. The function closes the database it opened in a `finally` block; an error thrown by `orchestrate` re-raises after that cleanup.

```ts
async function orchestrate(
  db: import("better-sqlite3").Database,
  absRoot: string,
  opts: LedgerOptions,
): Promise<LedgerResult>
```

`orchestrate` is the single pipeline that walks the wiki, upserts rows, computes moves, and records debt. It collects pages, snapshots the current state of `doc_pages`, `anchors`, and `symbols` into in-memory maps, and then runs the staged pipeline described in the following sections; the function returns the populated `LedgerResult` and emits no other side effects beyond the SQLite mutations and the Markdown rewrites it orchestrates.

## Page collection and failure-tolerant parsing

<!-- lw:anchors packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

The first stage of the pipeline enumerates the wiki pages that matter to the ledger. `collectWikiPages` walks `livewiki/` recursively, descending only into non-hidden directories (dot-prefixed directories are skipped; dot-prefixed files such as `.github.md` are still collected as long as they end in `.md`). Returned paths are POSIX-style relative paths anchored at the repository root, which is the canonical form stored in `doc_pages.wiki_path`.

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
```

`collectWikiPages` takes an absolute repository root and returns a promise that resolves to an array of objects whose `relPath` is the POSIX-style relative path of every `.md` file under `livewiki/`. The function skips hidden directories and silently treats a missing `livewiki/` directory as an empty collection, so the ledger can still run on a fresh checkout.

For each page, the orchestrator reads the source through `safeIo.readText` and parses it with `extractAnchors`. A read failure or a parse failure counts as a skipped page, emits a warning when `opts.quiet` is false, and the page is intentionally left out of the in-memory `currentAnchors` list so its persisted rows survive untouched until a successful run. The `AnchorParseError` class is the explicit error type callers can rely on when a parse fails; it wraps the underlying cause and prefixes the message with the failing wiki path.

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
    super(`Falha ao parsear âncoras em ${wikiPath}: ${cause.message}`);
    this.name = "AnchorParseError";
  }
}
```

`AnchorParseError` accepts a wiki path and a `cause` Error, sets `name` to `"AnchorParseError"`, and forwards a `super` message that names the offending path and the inner cause. The constructor only sets `name` and forwards the message; no other fields are assigned.

## Anchor identity and persistence

<!-- lw:anchors packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor -->

The ledger converts each parsed page into durable `doc_pages` and `anchors` rows. The anchor identity is `(doc_page_id, section_slug, symbol_key)`, and the orchestrator keeps a single in-memory map keyed by `${doc_page_id}|${section_slug ?? ""}|${symbol_key}` so duplicated identities in the same pass collapse onto one row rather than overwriting unrelated anchors.

```ts
function hashContent(content: string): string
```

`hashContent` accepts a Markdown string and returns the SHA-256 hex digest, delegating directly to the project's shared hash helper so the ledger and the index use the same encoding.

```ts
function upsertDocPage(
  db: import("better-sqlite3").Database,
  wikiPath: string,
  owner: Owner,
  contentHash: string,
  existing: Map<string, { id: number; content_hash: string; owner: string }>,
): number
```

`upsertDocPage` returns the integer `doc_pages.id` for the page: it updates the existing row in place when the path is already tracked (also refreshing `owner`, `content_hash`, and `updated_at`), otherwise it inserts a new row and returns the freshly assigned id. The return value is the row id, which is what every downstream anchor row keys against.

```ts
function upsertAnchor(
  db: import("better-sqlite3").Database,
  docPageId: number,
  sectionSlug: string | null,
  symbolKey: string,
  owner: Owner,
  inManualBlock: boolean,
  existing: Map<string, AnchorRow>,
  initialHash: string,
): number
```

`upsertAnchor` returns the anchor row id, reusing the existing row when the identity already exists (refreshing `in_manual_block` if the user edited a manual block) or inserting a new row keyed by the triple above. The first insertion records the symbol's current hash as `symbol_hash_at_doc` so the very first run cannot trigger a bogus `changed` event on the next pass, and the in-memory map is updated immediately so a duplicate occurrence of the same identity in the same pass cannot insert a second row.

## Manual block reconciliation

<!-- lw:anchors packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

Reconciliation runs per page after the page's anchors are upserted. The `manual_blocks` table has no UNIQUE constraint, so the module maintains a deliberate multiset semantics: duplicate historical rows are collapsed, exact-position matches preserve the stored baseline hash, content matches that move within the page only update offsets, and unmatched existing rows are left in place so verification can detect a removed or altered block later.

```ts
function reconcileManualBlocks(
  db: import("better-sqlite3").Database,
  docPageId: number,
  currentBlocks: ReadonlyArray<{
    start: number;
    end: number;
    contentHash: string;
  }>,
): void
```

`reconcileManualBlocks` keeps the `manual_blocks` multiset for a single page coherent with the current Markdown. It returns nothing; the reconciliation operates entirely on the database plus the page's analysis result. The visible contract is: exact-position rows preserve the stored baseline hash (step 2a), moved blocks update offsets only (step 2b), unmatched current blocks are inserted as fresh baselines, and unmatched existing rows are intentionally left untouched so verification can detect the change.

## Move detection and Markdown rewrite

<!-- lw:anchors packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#escapeRegex -->

Move detection runs after every page is parsed. The orchestrator loads every deleted symbol and every active symbol, and `detectMoves` pairs them up by content hash first and by name-plus-signature in a different file as a fallback. The conservative twin policy enforced here is the heart of the file: a disappeared symbol is accepted as `moved` only when no other active symbol with the same short name and same kind survives anywhere; otherwise the disappearance is classified as `changed` or `deleted` by the normal diff loop and the original anchor is preserved.

```ts
function detectMoves(
  deletedSymbols: Map<string, SymbolRow>,
  activeSymbols: Map<string, SymbolRow>,
  movedMap: Map<string, string>,
  result: LedgerResult,
): void
```

`detectMoves` accepts the deleted and active symbol maps, an empty `movedMap` to populate, and the `LedgerResult` it appends the detected pairs to. It returns nothing; the caller's responsibility is to consume the map during the move handling step. Self-pairs (`oldKey === newKey`) and cases where a same-name same-kind twin survives are skipped, so the rewrite path only fires for true relocations.

When a move is accepted, the orchestrator rewrites the corresponding anchor in the Markdown before touching the database. `rewriteSymbolKeyInPage` reloads the page through `safeIo.readText`, locates the frontmatter boundary, and edits the frontmatter and body in independent slices so a length change in one cannot invalidate offsets in the other. Manual block ranges and code spans are skipped, and the rewrite is idempotent because the second pass finds no `oldKey` to replace.

```ts
async function rewriteSymbolKeyInPage(
  absRoot: string,
  wikiPath: string,
  oldKey: string,
  newKey: string,
): Promise<boolean>
```

`rewriteSymbolKeyInPage` rewrites every occurrence of `oldKey` in the page's anchor lists and markers, returning `true` when the file was modified and `false` otherwise. If the page has been deleted from disk by the time the rewrite runs, the function returns `false` silently because the anchor row has already been removed by the page-deletion path.

The slice edits are delegated to two pure helpers. `rewriteFrontmatterAnchorsList` locates the top-level `anchors:` field and replaces list entries that match `oldKey`, leaving inline YAML comments and other top-level fields untouched. `rewriteBodyMarkers` walks the masked body, skipping any marker that sits inside a manual block or inside a code span (fenced or inline), and applies edits from highest offset to lowest so length differences between `oldKey` and `newKey` cannot corrupt earlier offsets. `extractManualBlockRangesFromBody` returns the body-local byte ranges of `lw:manual` blocks, and `escapeRegex` is the shared helper that lets the replacement regex treat `oldKey` literally.

```ts
function findFrontmatterEnd(source: string): number
```

`findFrontmatterEnd` accepts the full source string and returns the offset where the body starts, computed from the closing `---` line of the frontmatter. It returns `0` when the source has no real frontmatter; otherwise it returns the offset immediately after the closing line's terminator (or `source.length` if the file ends right after the closing line).

```ts
function isDelimiterLineAt(source: string, offset: number): boolean
```

`isDelimiterLineAt` returns `true` when the line starting at `offset` is a real delimiter line: the first three characters are `---` and the remainder, after stripping spaces and tabs, is empty. The line terminator is not consumed by this check.

```ts
function endOfLine(source: string, lineStart: number): number
```

`endOfLine` returns the offset immediately after the terminator that ends the line at `lineStart`, accounting for CRLF and LF line endings. A line that runs to EOF without a terminator returns `source.length`.

```ts
function nextLineStart(source: string, lineStart: number): number
```

`nextLineStart` returns the offset of the start of the line after the line that begins at `lineStart`, or `-1` when the line runs to EOF without a terminator.

```ts
function extractManualBlockRangesFromBody(
  body: string,
): Array<{ start: number; end: number }>
```

`extractManualBlockRangesFromBody` accepts the body slice and returns body-local byte ranges for every open/close pair of `lw:manual` markers it finds. The ranges are used downstream to protect human content from automated rewrites while ensuring that a literal `lw:manual` written inside a frontmatter value cannot accidentally shield body markers.

```ts
function rewriteFrontmatterAnchorsList(
  fmSegment: string,
  oldKey: string,
  newKey: string,
): string
```

`rewriteFrontmatterAnchorsList` accepts the frontmatter segment and the `oldKey`/`newKey` pair, and returns the rewritten frontmatter segment. List entries that match `oldKey` are replaced with `newKey`; trailing YAML comments are preserved byte-for-byte; non-`anchors` lists are skipped.

```ts
function rewriteBodyMarkers(
  body: string,
  oldKey: string,
  newKey: string,
  manualRangesInBody: ReadonlyArray<{ start: number; end: number }>,
): string
```

`rewriteBodyMarkers` accepts the body slice, the `oldKey`/`newKey` pair, and the manual-block ranges, and returns the rewritten body with the matched `lw:anchors` markers replaced. Markers inside manual blocks or inside code spans are skipped, and edits are applied from highest offset to lowest.

```ts
function escapeRegex(s: string): string
```

`escapeRegex` accepts a string and returns the same string with regex metacharacters escaped so the calling code can interpolate the symbol key into a regular expression safely.

## Debt creation and dedup

<!-- lw:anchors packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#assigneeFor -->

The diff loop produces debt rows after the move handling step. For every current anchor, the orchestrator looks up the persisted row and the live symbol. A missing symbol triggers deleted debt (unless a row with the same anchor id and event is already open), a changed hash triggers changed debt (again only if there is no open row for the same anchor id and event), and the persisted hash is updated so the next run sees a stable baseline.

```ts
function createDebt(
  db: import("better-sqlite3").Database,
  anchorId: number | null,
  event: DebtEvent,
  assignee: Assignee,
  detail: string | null,
  symbolKey: string,
  docPageId: number | null,
): void
```

`createDebt` inserts a single `debt` row carrying the anchor id, the event name, the assignee, an optional JSON detail payload, the symbol key, and the durable `doc_page_id`. The function returns nothing; the caller's responsibility is to compute the assignee and supply the dedup-friendly identifiers.

```ts
function hasOpenDebt(
  db: import("better-sqlite3").Database,
  anchorId: number,
  event: DebtEvent,
): boolean
```

`hasOpenDebt` returns `true` when the `debt` table already holds an unresolved row (`resolved_at IS NULL`) for the given `(anchorId, event)`. The partial index `idx_debt_open` makes the lookup O(1) in the visible schema.

```ts
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee
```

`assigneeFor` accepts the page's `Owner` and a boolean indicating whether the anchor sits inside a manual block, and returns `"human"` for any anchor that lives inside a manual block (regardless of the page-level owner) and otherwise returns `"human"` for human-owned pages and `"agent"` for generated or mixed pages. The visible contract is the conservative rule: manual blocks always route to human review, even on a generated page.

## Undocumented symbol telemetry and finalization

<!-- lw:anchors packages/core/src/anchor-ledger.ts#upsertUndocumented -->

The last ledger step refreshes the `undocumented` table so it lists every active symbol that no current anchor references. Move handling and the earlier reconciliation step have already trimmed stale rows, so the diff loop's `currentAnchors` array is the authoritative list of documented symbols.

```ts
function upsertUndocumented(
  db: import("better-sqlite3").Database,
  activeSymbols: Map<string, SymbolRow>,
  anchors: Array<{ symbolKey: string }>,
  result: LedgerResult,
): void
```

`upsertUndocumented` accepts the active symbol map, the current `anchors` array, and the in-flight `LedgerResult`, truncates the `undocumented` table, and re-inserts one row per active symbol that has no current anchor. It returns nothing; the function updates `result.undocumentedSymbols` in place so the caller can report the count.

After this step, the orchestrator expunges deleted symbol rows that have an active replacement (supersession noise from file edits), records `last_ledger_at` in the `meta` table, and returns the populated `LedgerResult`.

## Tests

Covered by `packages/core/src/anchor-ledger.test.ts` (same-name test file on disk).
