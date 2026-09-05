---
title: Anchor Ledger — Wiki Anchor Reconciliation and Documentation Debt
owner: generated
anchors:
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#abortedResult
  - packages/core/src/anchor-ledger.ts#addDesiredBaselineDebt
  - packages/core/src/anchor-ledger.ts#addDesiredMoveDebt
  - packages/core/src/anchor-ledger.ts#applyLedger
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/anchor-ledger.ts#baselineDebtIdentity
  - packages/core/src/anchor-ledger.ts#collectWikiPages
  - packages/core/src/anchor-ledger.ts#createDebt
  - packages/core/src/anchor-ledger.ts#deleteOpenDebt
  - packages/core/src/anchor-ledger.ts#detectMoves
  - packages/core/src/anchor-ledger.ts#endOfLine
  - packages/core/src/anchor-ledger.ts#escapeRegex
  - packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody
  - packages/core/src/anchor-ledger.ts#findFrontmatterEnd
  - packages/core/src/anchor-ledger.ts#hasOpenDebt
  - packages/core/src/anchor-ledger.ts#hasOpenDebtByAnchor
  - packages/core/src/anchor-ledger.ts#hashContent
  - packages/core/src/anchor-ledger.ts#isDelimiterLineAt
  - packages/core/src/anchor-ledger.ts#nextLineStart
  - packages/core/src/anchor-ledger.ts#orchestrate
  - packages/core/src/anchor-ledger.ts#planLedger
  - packages/core/src/anchor-ledger.ts#promoteOpenDebtToHuman
  - packages/core/src/anchor-ledger.ts#reconcileManualBlocks
  - packages/core/src/anchor-ledger.ts#revalidateLedgerPlan
  - packages/core/src/anchor-ledger.ts#rewriteBodyMarkers
  - packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList
  - packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage
  - packages/core/src/anchor-ledger.ts#run
  - packages/core/src/anchor-ledger.ts#runPendingRewrites
  - packages/core/src/anchor-ledger.ts#syncBaselineDebt
  - packages/core/src/anchor-ledger.ts#upsertAnchor
  - packages/core/src/anchor-ledger.ts#upsertDocPage
  - packages/core/src/anchor-ledger.ts#upsertUndocumented
---

# Anchor Ledger — Wiki Anchor Reconciliation and Documentation Debt

This module synchronizes wiki content with the code index, detecting changes, moves, and deletions, and generating documentation debt for work items.

## When to use this page

- Understand how wiki pages are validated against code symbols to identify outdated or missing documentation
- Learn how moved symbols trigger Markdown rewrites or create documentation tasks
- Trace how documentation debt is created, deduplicated, and assigned to agents or humans

## How it fits

The anchor ledger operates between the code indexer (which populates `symbols` in SQLite) and the validate/verify stage. After the indexer scans source files, `run()` reconciles every Markdown page under `livewiki/` against the indexed symbols, then records any divergence as rows in the `debt` table for later pickup by task runners or the CLI.

This module is the source of truth for wiki state transitions: it owns the `anchors`, `doc_pages`, and `debt` table mutations for each reconciliation cycle, runs strictly inside a single write transaction, and defers any Markdown file edits until after that transaction commits so a crash can never leave the database and filesystem disagreeing about a move.

## Entry point and run phases
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#abortedResult packages/core/src/anchor-ledger.ts#revalidateLedgerPlan packages/core/src/anchor-ledger.ts#runPendingRewrites packages/core/src/anchor-ledger.ts#collectWikiPages -->

`run` is the single entry point for the ledger update pipeline. It takes a repository root and options, and returns a `LedgerResult` describing what happened. Its signature:

```typescript
export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult>
```

It accepts the path to the wiki repository and optional configuration (such as a quiet flag), returning a structured result that reports counts of processed pages, anchors upserted, moved pairs, and other diagnostics, or an aborted status with a reason. The function deliberately phases the work: it first resolves the root to an absolute path, ensures the `.livewiki/` cache directory exists, and resolves the path to the index database. Then it proceeds through four phases, each with a distinct failure profile.

Phase 1 is filesystem scanning and planning, performed entirely read-only. The code calls `planLedger(absRoot, opts)`. If planning fails — for instance, because a page cannot be read or parsed — the function returns early with an `abortedResult` containing the reason. This early abort is intentional: the ledger reconciliation is destructive, and applying it from a partial view of the wiki would delete anchors whose pages merely could not be opened. `abortedResult` constructs a `LedgerResult` with zeroed counters, a status of `"aborted"`, and the supplied reason string. By failing fast here, the whole run avoids making any irreversible changes based on incomplete information.

Phase 2 is a cheap staleness check. Since the plan was built outside any lock, the wiki may have changed between planning and application. The code calls `revalidateLedgerPlan(absRoot, planned.plan)`. Its signature:

```typescript
async function revalidateLedgerPlan(
  absRoot: string,
  plan: LedgerPlan,
): Promise<string | null>
```

It takes the absolute root and the planned ledger, returning either a reason string if the plan is stale or `null` if it is still valid. To check, it first calls `collectWikiPages(absRoot)` to enumerate the current wiki pages. Then it compares the set of current paths against the set of paths in the plan, in both directions: if a page appears that is not in the plan, or a planned page is missing, it returns a message describing the divergence. For each planned page, it also re-stats the file on disk, comparing its size and modification time against what was recorded during planning; any mismatch, or any unreadable file, yields an abort message. If all checks pass, it returns `null`, and `run` proceeds. This step guarantees that what gets applied matches what was observed, avoiding the risk of acting on a plan that no longer reflects the repository state.

Phase 3 applies the ledger inside a single synchronous transaction. The code opens the index database, calls `applyLedger(db, planned.plan)`, and closes the database in a `finally` block. This phase performs no `await` and no filesystem access — it is purely a transactional update to the anchor index. The result of this phase is a structure containing both the applied `LedgerResult` and any `pendingRewrites` (rewrites that are needed to keep Markdown files consistent with moved symbol keys). Because this phase is synchronous and atomic, a crash during it rolls back cleanly; there is no partial application.

Phase 4 handles side effects that must occur after the commit, and only for legacy reasons. The code calls `runPendingRewrites(absRoot, applied.pendingRewrites, opts)`. Its signature:

```typescript
async function runPendingRewrites(
  absRoot: string,
  rewrites: readonly PendingRewrite[],
  opts: LedgerOptions,
): Promise<string | null>
```

It takes the absolute root, a read-only list of pending rewrites (each describing a wiki page and an old-to-new symbol key mapping), and the original options. The function iterates each rewrite and attempts to perform it via `rewriteSymbolKeyInPage`. Failures are collected rather than thrown. If all rewrites succeed, it returns `null`. If any fail, it returns a reason string stating that the ledger committed but a given number of Markdown rewrites failed, noting that the database is correct and that a future run or a verification step will repair the divergence. Unless the quiet flag is set, it also emits a console warning with that reason. Back in `run`, when failures occur, the returned result's status is set to `"applied_with_pending_rewrites"` with the failure message as the reason; it does not mark the work as failed, because the ledger itself is durable and correct. When rewrites succeed, the applied result is returned as-is.

The helper `collectWikiPages` is used by the revalidation step to list the current state of wiki content:

```typescript
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
```

It performs an iterative depth-first walk of the `livewiki/` directory starting from the repository root, returning an array of relative paths to Markdown pages. It skips any directories whose names begin with a dot (so hidden dirs are never descended), while dot-prefixed files that end in `.md` are still collected, since tier-2 modules from hidden source directories can legitimately yield pages like `livewiki/.github.md`. Files are included only when they end with `.md`. If the `livewiki/` directory is missing entirely, the walk silently produces an empty list, allowing the ledger to run and generate debt for missing pages. The function returns paths using forward slashes regardless of the host platform, normalizing them via `nodePath.relative` and replacing path separators.

## Planning the wiki snapshot
<!-- lw:anchors packages/core/src/anchor-ledger.ts#planLedger packages/core/src/anchor-ledger.ts#hashContent -->

`planLedger` is the entry point for turning the current state of a wiki into a structured snapshot that downstream reconciliation can trust. Its job is to gather every page, verify each one is readable and parseable, and package those results together with an optional baseline into a single plan object. The function starts by loading a baseline with `readBaseline(absRoot)`, which determines two things: whether a baseline file exists at all, and whether that file is usable. If no baseline is present, `portableBaselineMode` is set to `false` and `repositoryBaseline` is `null`; if one exists, even if it is structurally incompatible, `portableBaselineMode` is `true` because the presence of a baseline file alone is treated as definitive evidence of documentation identity, and `repositoryBaseline` holds the actual baseline content.

Next, `planLedger` collects all wiki pages via `collectWikiPages(absRoot)` and iterates over each one. For every page, it resolves and validates the absolute path with `safeIo.resolveAndValidate`, then reads both the file stats (size and modification time) and its full text. If either operation fails — because the file was listed but cannot be read — the entire function aborts early, returning `{ plan: null, reason: ... }` with a message explaining that the snapshot would be incomplete. The same fail-closed behavior applies when `extractAnchors(source)` throws during parsing: the function returns no plan rather than risk reconciling on malformed content. Only when both reading and parsing succeed does the page get promoted into the plan.

For each surviving page, the function builds a `PlannedPage` record. It stores the relative path, the raw source text, a `contentHash` computed by `hashContent(source)`, and the file metadata from the stat call. The structural data comes from the `extracted` result: the documentation `owner`, the page-level anchors copied as an array, each section anchor mapped to a compact object carrying its `sectionSlug`, copied `symbolKeys`, and the `inManualBlock` flag, and finally the manual blocks themselves. Each manual block is recorded by its start and end offsets plus a hash of the exact byte range it covers — `sha256(source.slice(mb.start, mb.end))` — so that later phases can detect whether the human-owned content inside a manual region changed between runs.

Once all pages are processed, `planLedger` optionally collects a baseline documentation inventory with `collectBaselineDocumentationInventory(absRoot)`, but only when `repositoryBaseline` is non-null; otherwise that field stays `null`. A defensive warning is emitted when no pages survive planning but at least one was listed, a state the author notes should be unreachable but kept explicit so that "no pages" and "every page failed" cannot be conflated in future refactors. The function returns `{ plan: { portableBaselineMode, repositoryBaseline, pages, baselineInventory } }` — a single package holding everything the reconciliation step needs: whether to treat the index as documentation identity, the prior baseline (if any), the freshly planned pages, and the inventory of baseline documentation.

The helper `hashContent` is a thin wrapper around the already-imported `sha256`:

```ts
function hashContent(content: string): string {
  return sha256(content);
}
```

It takes an arbitrary string and returns the SHA-256 digest of that string as a string. `planLedger` uses it to stamp every page with a content fingerprint, and the manual-block entries reuse the same hashing logic inline so that every piece of content tracked in the ledger — whole pages and manual regions alike — is consistently identified by its cryptographic hash.

## Executing the ledger transaction
<!-- lw:anchors packages/core/src/anchor-ledger.ts#applyLedger packages/core/src/anchor-ledger.ts#orchestrate -->

`applyLedger` is the public entry point that wraps the entire transaction. It defines two parameters — a `better-sqlite3` database instance (`db`) and a `LedgerPlan` object (`plan`) describing the work to perform — and returns an object holding a `LedgerResult` (counters and outcome metadata) plus a list of `pendingRewrites` (files that must be edited on disk after the transaction). Its job is to enforce atomicity:

```ts
function applyLedger(
  db: import("better-sqlite3").Database,
  plan: LedgerPlan,
): { result: LedgerResult; pendingRewrites: PendingRewrite[] } {
  return runWriteTransaction("ledger", db.transaction(() => orchestrate(db, plan)));
}
```

`applyLedger` hands the same arguments to `orchestrate` inside `db.transaction(...)`, all guarded by `runWriteTransaction`, so either every database change in the run is committed together or none is. That single transactional boundary is what makes the ledger safe: a crash mid-run cannot leave the DB half-updated with a rewritten file on disk.

`orchestrate` is where the actual mechanism lives. It accepts the same `db` and `plan` and returns the same shape:

```ts
function orchestrate(
  db: import("better-sqlite3").Database,
  plan: LedgerPlan,
): { result: LedgerResult; pendingRewrites: PendingRewrite[] } {
```

`orchestrate` takes a database connection and a ledger plan — the parsed wiki pages and the baseline configuration — and returns the outcome counters plus the list of file rewrites that must be applied after the DB transaction commits. It is the pipeline that turns the plan's parsed Markdown into a reconciled, debt-tracked database state.

## Step 1 — Snapshot the current database state

`orchestrate` begins by reading every persisted row it will compare against into in-memory maps. It loads `doc_pages` into `existingDocPages` keyed by `wiki_path`, all `anchors` rows into `existingAnchors` keyed by the composite string `` `${doc_page_id}|${section_slug ?? ""}|${symbol_key}` `` — the comment explains why `symbol_key` must be part of the key: the page slot (`section_slug = null`) can hold several symbols from one frontmatter `anchors:` list, so without `symbol_key` in the map key the last-loaded row would overwrite the others and every frontmatter anchor would diff against the wrong symbol, fabricating "changed" debt. It loads active `symbols` into `existingSymbols` and deleted ones into `deletedSymbols`, both keyed by `symbol_key`.

## Step 2 — Parse each page, upsert rows, collect current anchors

The main loop iterates over `wikiPages` from the plan. For each page it records the relative path in `seenDocPages`, increments `result.pagesProcessed`, and calls `upsertDocPage` to insert or update the `doc_pages` row, adding the returned id to `processedDocPageIds` — this set is what decides which pages participate in identity reconciliation later. For every entry in `extracted.pageAnchors` (frontmatter anchors) it seeds an initial hash from `existingSymbols`, calls `upsertAnchor` with `section_slug = null` and `inManualBlock = false`, then pushes a record onto `currentAnchors` and increments `result.anchorsUpserted`. Section anchors from `extracted.sectionAnchors` are handled identically, except each one passes its own `sectionSlug` and its `inManualBlock` flag; a section nested in a manual block is marked accordingly so downstream debt assignment knows the anchor is human-owned. Finally, for each page it calls `reconcileManualBlocks`, which — per the long inline comment — deduplicates historical rows for the page (keeping the smallest id among exact duplicates because the `manual_blocks` table has no UNIQUE constraint and `verify` treats stored rows as a multiset), matches each current block to an unused existing row by exact start/end or by same `content_hash`, preserving the stored baseline hash whenever a match exists, inserts a fresh baseline for new blocks, and leaves unmatched rows in place so `verify` can still detect removed or altered blocks.

## Step 3 — Detect and execute symbol moves

If the plan is not in `portableBaselineMode`, `orchestrate` calls `detectMoves` over `deletedSymbols` and `existingSymbols`, filling `movedMap` (old key → new key) and recording counts in `result`. It then builds `preMoveExpectedByPageId` — a per-page set of `` `${section_slug ?? ""}|${symbol_key}` `` identities from `currentAnchors` as they were parsed from disk before any remap — because stale rows the user removed from Markdown must never take part in move rewriting or debt creation. For each `(oldKey, newKey)` pair it fetches all anchor rows for `oldKey` from the DB, and for every such row whose `(docPageId, sectionSlug, oldKey)` identity is NOT in that pre-move expected set it simply `continue`s, leaving the stale row for reconciliation to delete. For each surviving anchor it:

- pushes a `pendingRewrites` entry `{ wikiPath, oldKey, newKey }` when the anchor is neither in a manual block nor owned by `human` — the code comment stresses this rewrite is *recorded* now but performed after the DB commit, because the old order (file first) would permanently lose the moved debt on a crash between file write and commit; with DB-first ordering the database is durable, `verify` reports the divergence, and the next run repairs the file;
- checks `existingAnchors` for a `newKey` row in the same `(doc_page_id, section_slug)` slot (using the in-memory map for consistent NULL handling, since `sectionPart` is the empty string for the page slot). If a collision exists it DELETEs the oldKey row, UPDATEs the canonical newKey row's `symbol_hash_at_doc` to `newHash`, updates the in-memory entry, and records the canonical id; otherwise it UPDATEs the oldKey row's `symbol_key` and hash in place, preserving the row id, and records that id as canonical;
- finally remaps `ca.symbolKey` on every entry in `currentAnchors` that referred to an oldKey, so later steps all see the post-move names.

## Step 4 — Reconcile by stable identity

`orchestrate` builds `expectedByPageId` from `currentAnchors` after the move remap — the same array the diff loop and undocumented calculation iterate over, so by construction every `currentAnchors` entry is in its page's expected set. For every id in `processedDocPageIds` it SELECTs all persisted anchors for that page, computes each one's `` `${section_slug ?? ""}|${symbol_key}` `` key, and DELETEs any row whose key is not in the expected set, also removing it from `existingAnchors`. Pages skipped during the page loop are deliberately not reconciled — their anchors stay until a successful later run. As the comment notes, removing an anchor never creates changed, deleted, or moved debt, because `debt.symbol_key` is the durable reference and survives anchor removal by design.

## Step 5 — Diff per anchor: changed / deleted / OK

For every entry in `currentAnchors`, `orchestrate` looks up the persisted row via the composite key and the symbol in `existingSymbols`. If the symbol is absent from the index and the run is not in `portableBaselineMode`, it records a `deleted` debt — first calling `promoteOpenDebtToHuman` if `assigneeFor(owner, inManualBlock)` returns `human`, then `hasOpenDebt` to dedupe against already-open debt, and finally `createDebt` with the anchor id (or null) and the page id, incrementing `debtCreated` and `debtByEvent.deleted`. If the symbol exists, it deletes any stale open `deleted` debt (a reappeared symbol makes the prior deletion false), promotes open debt to human when the assignee is `human` (ownership promotion is monotonic and independent of hash divergence, so pre-fix databases self-correct), and if the stored `symbol_hash_at_doc` differs from `sym.content_hash` creates `changed` debt subject to the same open-debt dedup. Regardless of divergence it then UPDATEs the anchor's stored hash to `sym.content_hash` and adds the anchor id to `seenAnchorIds`.

## Step 6 — Move debt

For each `(oldKey, newKey)` pair, `orchestrate` iterates `anchorsByOldKey` again, filtering each anchor against `preMoveExpectedByPageId` exactly as in move handling. For each surviving anchor it looks up the canonical id recorded during move handling under the full new identity key `` `${docPageId}|${sectionSlug}|${newKey}` `` and, if `hasOpenDebtByAnchor` finds none, creates a `moved` debt with the canonical anchor id, assignee from `assigneeFor(info.owner, info.inManualBlock)`, a JSON detail `{ "from": oldKey, "to": newKey }`, and the new key, again incrementing `debtCreated` and `debtByEvent.moved`. The canonical-anchor identity is what makes dedup work across repeated runs even when the underlying row id changes.

## Step 7 — Removed pages

Looping over `existingDocPages`, any path not in `seenDocPages` was absent from disk this run; `orchestrate` DELETEs every anchor row referencing that `doc_page_id`, then the `doc_pages` row itself. This path handles whole pages that never reached the page loop, separate from per-anchor identity reconciliation.

## Step 8 — Undocumented symbols, baseline sync, dead-row cleanup, and metadata

`orchestrate` calls `upsertUndocumented` with `existingSymbols` and `currentAnchors`; since moves have already remapped the keys, reconciliation removed stale rows, and the diff loop has run, `currentAnchors[i].symbolKey` is by construction exactly the set of documented symbols, so every active symbol outside it becomes an undocumented record. When the plan carries a `repositoryBaseline` and `baselineInventory`, it calls `syncBaselineDebt` to align baseline bookkeeping. It then expunges dead symbol rows that have an active replacement — the supersession noise from file edits — while leaving truly deleted symbols in place for audit and future move history. Finally it maintains the ledger metadata: it increments `ledger_runs` (seeding at 2 for databases that already have `last_ledger_at`, so the next run cannot be misclassified as a first-ever comparison) and writes `last_ledger_at` from `Date.now()`.

The function ends by returning `{ result, pendingRewrites }`; `applyLedger` commits the transaction, and the caller is responsible for applying `pendingRewrites` to disk afterward, completing the DB-first ordering that makes the move rewrite crash-safe.

## Upserting pages and anchors
<!-- lw:anchors packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor -->

The two functions `upsertDocPage` and `upsertAnchor` form the atomic write path of the anchor ledger: given an in-memory snapshot of what already exists in the database, each function decides whether to update an existing row or insert a new one, and returns the row ID that the caller must use for further bookkeeping.

`upsertDocPage` handles the `doc_pages` table. Its signature is:

```ts
function upsertDocPage(
  db: import("better-sqlite3").Database,
  wikiPath: string,
  owner: Owner,
  contentHash: string,
  existing: Map<string, { id: number; content_hash: string; owner: string }>,
): number
```

It takes the database handle, the page's `wikiPath`, the `owner` and a `contentHash` for the page's current content, plus a map of already-known pages keyed by path. It returns the numeric row ID for that page. The function first looks up `wikiPath` in the `existing` map; if found, it issues an `UPDATE` that refreshes `owner`, `content_hash`, and `updated_at` (timestamped with `Date.now()`), then returns the existing row's ID unchanged. If not found, it performs an `INSERT` of a new `doc_pages` row carrying all four fields and returns the freshly generated `lastInsertRowid`. This preserves row identity across passes — a page edited in place keeps its ID, while a never-seen page gets one.

`upsertAnchor` mirrors that logic for the `anchors` table, with a deliberately strict identity key. Its signature is:

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

It takes the database, the parent page's `docPageId`, the optional `sectionSlug`, the `symbolKey` identifying the documented symbol, the `owner`, a flag `inManualBlock` indicating whether the anchor lies inside a human-authored manual block, the `existing` map of anchors, and `initialHash` — the symbol's content hash as measured right now. It returns the row ID of the resulting anchor. The function composes the lookup key as `` `${docPageId}|${sectionSlug ?? ""}|${symbolKey}` `` — a key that must include `symbolKey`, per the comment referencing `existingAnchors`, because two anchors for the same page and section but different symbols are distinct identities. If the key exists, the function performs an `UPDATE` that rewrites `symbol_key` and `in_manual_block` (the latter may have changed if the user edited the manual block), mutates the in-memory `existing` entry to stay consistent, and returns `prev.id`. Otherwise it executes an `INSERT` that stores the anchor row with `symbol_hash_at_doc` set to `initialHash` — never an empty string — so a subsequent pass can reliably detect content changes by comparing hashes.

The insertion branch then applies what the code calls the "Remap contract (item 9)": immediately after inserting, it writes the new row's full shape into the `existing` map under the same composite key. This makes the freshly inserted anchor findable by that key without another database read, so that if the same symbol identity occurs again later in the same processing pass, the function hits the `UPDATE` branch and cannot create a duplicate row. Both functions therefore share a single invariant: the in-memory `existing` map is the source of truth for _this pass_, and the database is only consulted for persistence — which is why every branch must update the map before returning.

## Detecting moved symbols
<!-- lw:anchors packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented -->

The mechanism for detecting moved symbols works by comparing symbols that have disappeared from an index against the active set, looking for evidence that a relocation happened rather than a deletion or an edit. Two functions cooperate here: `detectMoves`, which builds the mapping of old keys to new keys, and `upsertUndocumented`, which flags symbols that lack an anchor. The story flows from identifying candidate matches through applying conservative guards against false positives, then finishing with bookkeeping for symbols that are genuinely absent.

### `detectMoves`

function detectMoves(
  deletedSymbols: Map<string, SymbolRow>,
  activeSymbols: Map<string, SymbolRow>,
  movedMap: Map<string, string>,
  result: LedgerResult,
): void

This function takes the set of deleted symbol rows (keyed by their old storage key), the current active symbol rows (keyed by their new key), a map being filled with old-to-new key pairings, and a result object that receives the list of moved pairs. It returns nothing but mutates both `movedMap` and `result`.

The function begins by building two lookup structures from the active symbols for rapid decision-making. It indexes active symbols by their `content_hash` into `activeByHash`, which gives an exact-match path when a deleted symbol's content exists elsewhere. It also counts active symbols per `(name, kind)` pair in `activeCountByNameKind`, storing the tally under a string key like `"foo|function"`. This count is essential for the "conservative twin policy" referenced in the module docblock: a name is only considered truly gone when no other active symbol shares both the name and kind.

With these indexes ready, the function iterates over each entry in `deletedSymbols`, where `deadSym` is the symbol that vanished. It attempts to find a match in two steps. First, it does an exact lookup by `content_hash` — the fastest check that catches a symbol moved byte-for-byte. If that fails, it falls back to scanning `activeSymbols` for a candidate that lives in a different file (`candidate.file_id !== deadSym.file_id`) yet shares both the same `name` and the same `signature`. This fallback handles cases where a move accompanied a content change, meaning the hashes differ but the symbol's identity is preserved.

When a `match` is found and the old key is not already in `movedMap`, the function applies two guards before recording the move. The first guard skips pairs where `match.key === oldKey`. Without this check, a routine edit that soft-deletes and re-inserts an unchanged symbol would register a spurious "move" from a key to itself, contaminating the ledger with fake debt; the guard recognizes this as a re-index supersession, not a relocation. The second guard consults the name-kind counts: it computes how many active symbols share `deadSym`'s name and kind, subtracts one if the match itself is same-name-same-kind, and if the remainder is greater than zero, it declines to call this a move. The reasoning is conservative — if another same-name same-kind symbol still exists, the disappearance is more plausibly an edit or deletion of one instance than a move of the whole identity.

Only after both guards pass does the function record the move. It sets `movedMap.set(oldKey, match.key)` and pushes the pairing `{ from: oldKey, to: match.key }` onto `result.movedPairs`. This ordering means the function only emits a move when it has both a confident content-based or signature-based match and no competing survivor under the same name and kind, keeping the ledger free of false positives from twin symbols or benign file rotations.

### `upsertUndocumented`

function upsertUndocumented(
  db: import("better-sqlite3").Database,
  activeSymbols: Map<string, SymbolRow>,
  anchors: Array<{ symbolKey: string }>,
  result: LedgerResult,
): void

This function takes a database connection, the active symbol map, a list of anchor entries each carrying a `symbolKey`, and a result object. It returns nothing, instead writing rows directly to the database and setting a count on `result`.

After `detectMoves` has resolved which disappeared symbols are relocations, `upsertUndocumented` handles the complementary case: symbols that are active but have no corresponding anchor, meaning they were introduced without documentation. The function first collects all anchored keys into a `Set` for constant-time membership checks. It then clears the `undocumented` table entirely with a `DELETE` statement, reflecting the Phase 2 decision that this table is non-historical and should mirror only the current state. With a prepared `INSERT OR IGNORE` statement, it iterates over every active symbol; any symbol whose key is absent from the anchor set gets inserted with the current timestamp and a dismissed flag of zero. Each insertion increments a local counter, and when the loop finishes, that count is assigned to `result.undocumentedSymbols` as the tally of newly discovered undocumented symbols for this run.

## Reconciling anchors and creating debt
<!-- lw:anchors packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#promoteOpenDebtToHuman packages/core/src/anchor-ledger.ts#deleteOpenDebt packages/core/src/anchor-ledger.ts#hasOpenDebtByAnchor -->

The anchor ledger stores debt records, but the logic that answers “who owns this debt?” and “is this debt still open?” lives in the query helpers. These function as the reconciliation layer: when a page is written or an anchor is removed, the writer consults `hasOpenDebt`/`hasOpenDebtByAnchor` to detect stale obligations, then manipulates those rows with `createDebt`, `promoteOpenDebtToHuman`, and `deleteOpenDebt`. The `assigneeFor` classification gates every row creation.

`assigneeFor` narrows a two-input question to one answer:

```ts
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee {
  if (inManualBlock) return "human";
  return owner === "human" ? "human" : "agent";
}
```

It takes the debt's `Owner` and a boolean indicating whether the debt occurs inside an `lw:manual` block, then returns the `Assignee` string. The rule is: any debt inside a manually written block is always human-assigned (an agent shouldn't take credit for human text), otherwise the assignee mirrors the owner — humans stay human, agents become `"agent"`. Every `createDebt` call passes through this gate.

`createDebt` writes a new debt row:

```ts
function createDebt(
  db: import("better-sqlite3").Database,
  anchorId: number | null,
  event: DebtEvent,
  assignee: Assignee,
  detail: string | null,
  symbolKey: string,
  docPageId: number | null,
): void {
```

It takes the database, an optional anchor id, the `DebtEvent` type, the pre-computed assignee, a detail string, a `symbolKey`, and a page id, and inserts into the `debt` table. The notable design choice here is writing `symbolKey` and the page id into their own dedicated columns, not relying on a join through the anchor. That way, if an anchor is later deleted, the debt record survives with enough context to be surfaced by the CLI or MCP client. The `doc_page_id` mirrors this durability: without it, a debt's `symbol_key`/`wiki_path` would vanish via the join once the anchor disappears.

`hasOpenDebt` answers whether a given symbol still has unresolved work:

```ts
function hasOpenDebt(
  db: import("better-sqlite3").Database,
  symbolKey: string,
  docPageId: number | null,
  event: DebtEvent,
): boolean {
```

Internally it queries for any row matching the symbol key, page id, event type, and a `resolved_at IS NULL` filter, short-circuiting with a `LIMIT 1`. The function accepts the db, a symbol key, an optional page id, and an event, and returns whether any matching open debt exists. This is the primary guard used before deciding whether to re-create a debt or skip redundant work.

`promoteOpenDebtToHuman` reassigns an existing unresolved agent-debt to a human:

```ts
function promoteOpenDebtToHuman(
  db: import("better-sqlite3").Database,
  symbolKey: string,
  docPageId: number | null,
  event: DebtEvent,
): void {
```

It takes the db, a symbol key, an optional page id, and an event, and updates every open record matching those criteria whose assignee is still `"agent"`, flipping it to `"human"`. This is the escalation path — if the writer decides humans must track an item (for example, because the agent's prior fix attempt is stale), it promotes rather than duplicating rows.

`deleteOpenDebt` removes a debt entirely once the condition it tracks is no longer present:

```ts
function deleteOpenDebt(
  db: import("better-sqlite3").Database,
  symbolKey: string,
  docPageId: number | null,
  event: DebtEvent,
): void {
```

It takes the same identification triplet (db, symbol key, page id, event) and deletes all unresolved rows matching. Resolved rows are left untouched — the operation only clears the pending obligation, which lets the caller treat a post-cleanup `hasOpenDebt` result as ground truth that the debt is gone.

`hasOpenDebtByAnchor` is a narrow variant used when the caller only knows the anchor id:

```ts
function hasOpenDebtByAnchor(
  db: import("better-sqlite3").Database,
  anchorId: number,
  event: DebtEvent,
): boolean {
```

It takes the db, an anchor id, and an event, and returns whether an unresolved row for that specific anchor and event exists. This is the reconciliation check for the opposite direction: instead of asking “does this symbol still owe work?”, it asks “did this anchor ever produce an unresolved debt?” — which matters when an anchor is being removed or re-created.

## Syncing baseline documentation debt
<!-- lw:anchors packages/core/src/anchor-ledger.ts#syncBaselineDebt packages/core/src/anchor-ledger.ts#addDesiredBaselineDebt packages/core/src/anchor-ledger.ts#addDesiredMoveDebt packages/core/src/anchor-ledger.ts#baselineDebtIdentity -->

`syncBaselineDebt` is the reconciliation step that turns the evaluated baseline into concrete debt rows in the database, and it does so idempotently: each run converges the `debt` table toward the desired state without duplicating rows for problems that already exist. It starts by calling `evaluateBaseline` on the baseline, the current symbol inventory, and the active symbol map to get a `health` result describing each baseline entry's state. From there it builds an in-memory `desired` map — keyed by an identity string and holding the fields needed to create a debt row — that represents every debt that should exist after this sync.

The function iterates over `health.entries`, skipping anything whose provenance is not `"accepted"`, since only accepted docs participate in baseline debt tracking. For an entry in the `"changed"` state it records a change debt via `addDesiredBaselineDebt`; for a `"deleted"` entry it does the same, unless the deletion is actually part of a move already captured in `health.moves` (matched by wiki path and old symbol key). Moves are then handled separately: `addDesiredMoveDebt` serializes the old and new key into a JSON detail string and records a `"moved"` debt under the new key.

With the desired set complete, `syncBaselineDebt` loads existing state from the database — all open (unresolved) debt rows joined to their page paths — and builds an `existing` map using the same identity scheme. Along the way it prunes rows that no longer correspond to any desired debt or that have lost their page or symbol linkage, deleting them outright so stale debt doesn't linger. This cleanup is what makes the sync convergent: rows for problems that have been fixed or whose symbols have vanished are removed rather than left open forever.

Finally, the function reconciles the two maps. For each desired identity already present, it may upgrade the assignee from `"agent"` to `"human"` when the baseline now attributes the issue to a human, but otherwise leaves the row untouched. For identities not yet in the database, it looks up the anchor for the symbol (using the original key for moved entries, since the anchor still points at the old location), then calls `createDebt` to insert the row with the appropriate event, assignee, detail, and page reference, incrementing `result.debtCreated` and the per-event counter. It records `result.movedPairs` as the list of old-to-new key mappings so callers can see what was relocated. The helper functions `addDesiredBaselineDebt`, `addDesiredMoveDebt`, and `baselineDebtIdentity` exist purely to keep this logic readable — the first two populate the `desired` map with properly formed entries, while `baselineDebtIdentity` produces a stable composite key (`wikiPath`, `symbolKey`, and `event` joined by null bytes) that both the desired and existing maps share, which is what lets the sync match them reliably.

## Rewriting Markdown symbol keys
<!-- lw:anchors packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#reconcileManualBlocks packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

The core rewriting routine is `rewriteSymbolKeyInPage`, which orchestrates the entire symbol-key replacement across a Markdown page:

```ts
async function rewriteSymbolKeyInPage(
  absRoot: string,
  wikiPath: string,
  oldKey: string,
  newKey: string,
): Promise<boolean>
```
It takes the wiki root directory, a page's relative path, the old symbol key, and the new key, and returns `true` if the file was modified. The function reads the page from disk, delegates to two specialized rewriting passes, and writes back only when the content actually changed.

## Splitting the page at its frontmatter boundary

The first step is to locate where YAML frontmatter ends so the page can be processed as two independent segments. `findFrontmatterEnd` is the boundary resolver:

```ts
function findFrontmatterEnd(source: string): number {
```
It takes the full page source and returns the character offset just after the closing frontmatter delimiter (or `0` if there is none). This function is lexically strict: it requires the opening line to be a real delimiter line (three hyphens with only trailing whitespace, checked by `isDelimiterLineAt(source, 0)`), otherwise it immediately returns `0`. `isDelimiterLineAt` verifies that a given offset points to exactly `---` followed only by spaces/tabs or an end-of-line, so a source line starting with hyphens inside prose won't be misread as a boundary. The scan then advances line-by-line via `nextLineStart` until a real closing delimiter is found; when it is, `endOfLine` returns the offset immediately after that line's terminator.

Both `endOfLine` and `nextLineStart` are line scanning utilities that share the same logic — they find the end of the current line, handling both `\n` and `\r\n` terminators. `endOfLine` returns the offset just past the terminator (or EOF), while `nextLineStart` returns the start of the following line, or `-1` at EOF. Their shared traversal pattern keeps the boundary scan consistent regardless of line-ending style.

## Rewriting the frontmatter anchors list

With the boundary known, `rewriteSymbolKeyInPage` slices the source into `fmOriginal` (everything before `fmEnd`) and delegates it to `rewriteFrontmatterAnchorsList`, which performs the key substitution only within the `anchors:` list:

```ts
function rewriteFrontmatterAnchorsList(
  fmSegment: string,
  oldKey: string,
  newKey: string,
): string {
```
It takes the frontmatter segment and both keys, and returns the segment with any matching list items rewritten. The function begins by verifying the segment actually starts with `---`; if not, it returns the input unchanged. It then splits the segment into an array alternating between line content and line terminator (`/(\r?\n)/` captures the separator), preserving original bytes so re-joining is lossless. It scans this array for a line matching `^[ \t]*anchors:`, and if none exists, leaves everything untouched. Once located, it walks forward from the line after `anchors:` to find where the list body ends — the next top-level key (detected by `isTopLevelKey`, which requires a key at column zero followed by a colon) or the closing `---`. Within that body range, each line is tested against a regex that matches a list item with the exact old key (allowing only whitespace and a hyphen prefix, plus an optional trailing comment). Matching lines have the key portion replaced with `newKey` while preserving both the prefix and any comment text; the array is then rejoined into a single string.

## Protecting manually authored regions in the body

The body segment (everything after the frontmatter) requires extra care, because some marker lines are intentionally human-owned and must never be overwritten. `extractManualBlockRangesFromBody` locates these protected regions:

```ts
function extractManualBlockRangesFromBody(
  body: string,
): Array<{ start: number; end: number }> {
```
It takes the body string and returns a sorted list of non-overlapping ranges. The function scans the body twice — once for opening `lw:manual` comments and once for closing `/lw:manual` comments — collecting each match as an event with its offset. Events are sorted by offset; then the function walks them with a simple state machine: an opening event when none is currently open begins a range, and a closing event while one is open closes it, pushing a `{ start, end }` pair onto the result. Unmatched events are silently skipped, which makes the mechanism tolerant of malformed markup. Because these ranges are computed from body-local offsets, a `lw:manual` literal inside frontmatter or a code block can never accidentally protect body markers.

## Rewriting body markers while respecting manual blocks and code

The body rewrite itself is handled by `rewriteBodyMarkers`:

```ts
function rewriteBodyMarkers(
  body: string,
  oldKey: string,
  newKey: string,
  manualRangesInBody: ReadonlyArray<{ start: number; end: number }>,
): string {
```
It takes the body plus the two keys and the precomputed manual ranges, and returns either the unchanged body or a version with markers substituted. The function first builds a masking view of the body where every code span (fenced or inline) is blanked to spaces, preserving character positions so masked offsets map 1:1 back to the original. It then scans the masked text with a regex matching `<!--` + optional whitespace + `lw:anchors` + whitespace + a key list + `-->`. For each finding, it checks whether the marker's offset falls inside a manual range (via the `inManual` closure) and skips it if so — this is what keeps human-authored content intact. The key list inside the marker is split on whitespace, and each key compared against `oldKey`; if any match, the marker is rewritten. Instead of constructing the replacement directly, the function records an edit that blanks the entire marker to spaces. This two-phase approach (collect all edits, then apply them) accumulates substitutions of every key inside the marker — for example, a marker listing several keys gets each occurrence of `oldKey` replaced with `newKey` — while a marker that contains no matching key is left completely untouched. Edits are applied from the end of the body backward to avoid invalidating earlier offsets. Finally, the body is reassembled, and `rewriteSymbolKeyInPage` concatenates the rewritten frontmatter and body, compares against the original source, and writes back only when something changed.

## A helper for regex escaping

Both rewrite passes need to treat `oldKey` as a literal string rather than a pattern. `escapeRegex` handles that:

```ts
function escapeRegex(s: string): string {
```
It takes any string and returns a version with all regex metacharacters (`.`, `*`, `+`, `?`, `^`, `$`, braces, parens, brackets, pipes, slashes, and backslashes) escaped with a leading backslash, so the key can be safely embedded inside a `new RegExp(...)` constructor.

## The error type for parse failures

When rewriting goes wrong, the failure surfaces as `AnchorParseError`:

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
```
The constructor takes the wiki page path and the underlying `Error` cause, and builds a message of the form `Failed to parse anchors in {wikiPath}: {cause.message}`, while setting `this.name` to `"AnchorParseError"`. This gives callers a distinct error type to catch when anchor parsing fails, distinguishing those failures from generic I/O or logic errors.

## Reconciling manual blocks with the database

The companion persistence routine `reconcileManualBlocks` keeps the `manual_blocks` table in sync with the actual ranges present in a page after content shifts:

```ts
function reconcileManualBlocks(
  db: import("better-sqlite3").Database,
  docPageId: number,
  currentBlocks: ReadonlyArray<{
    start: number;
    end: number;
    contentHash: string;
  }>,
): void {
```
It takes a database connection, a page id, and the canonical list of manual blocks (offsets plus a content hash that identifies the block's text at baseline). The function first cleans up historical duplicates: it reads all existing rows for the page, groups them by the triple of their own `(start_offset, end_offset, content_hash)`, and deletes every row in a group except the one with the smallest id. It then re-reads the table to work with a duplicate-free set and iterates over each current block. For each one, it first looks for an existing row with the exact same offsets; finding one, it reuses that row (preserving its stored baseline hash) and marks it used. If no exact match exists but an unused row has the same content hash — meaning the block moved without its content changing — it updates that row's offsets and timestamp. When neither strategy finds a match, it inserts a fresh row with the current offsets and hash as the new baseline. Notably, existing rows that match no current block are deliberately left in place rather than deleted; the table is allowed to accumulate history so later rewrites can still recognize a block that temporarily fell out of the page's manual ranges.

## Tests

Covered by `packages/core/src/anchor-ledger.test.ts` (same-name test file on disk).
Likely also exercised by `packages/core/src/anchor-ledger-atomicity.test.ts` (name-prefix match, not verified).
