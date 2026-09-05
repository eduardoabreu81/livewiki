---
title: Baseline Lifecycle Operations
owner: generated
anchors:
- packages/core/src/baseline-operations.ts#acceptBaseline
- packages/core/src/baseline-operations.ts#advanceContractBaseline
- packages/core/src/baseline-operations.ts#assertSymbolKey
- packages/core/src/baseline-operations.ts#assertSymbolsStillCurrent
- packages/core/src/baseline-operations.ts#assertWikiPath
- packages/core/src/baseline-operations.ts#bootstrapBaseline
- packages/core/src/baseline-operations.ts#compareText
- packages/core/src/baseline-operations.ts#createGitReader
- packages/core/src/baseline-operations.ts#extractHistoricalSymbols
- packages/core/src/baseline-operations.ts#groupByPage
- packages/core/src/baseline-operations.ts#hasCurrentContractBaseline
- packages/core/src/baseline-operations.ts#isConcurrentWrite
- packages/core/src/baseline-operations.ts#loadActiveSymbols
- packages/core/src/baseline-operations.ts#loadFreshSymbols
- packages/core/src/baseline-operations.ts#migrateBaselineKey
- packages/core/src/baseline-operations.ts#obligationIdentity
- packages/core/src/baseline-operations.ts#relocateBaselineEntry
- packages/core/src/baseline-operations.ts#removeBaselineEntry
- packages/core/src/baseline-operations.ts#removeBaselinePages
- packages/core/src/baseline-operations.ts#requireAvailableBaseline
- packages/core/src/baseline-operations.ts#runGit
- packages/core/src/baseline-operations.ts#yieldToConcurrentWriter
---

# Manage the Documentation Baseline Lifecycle

This page explains the mechanics of this module, which governs the lifecycle of documentation obligations by creating, accepting, migrating, relocating, and removing entries in the repository's baseline file.

## When to use this page

- Understand how the documentation baseline is initialized from Git history.
- Determine when to accept, migrate, relocate, or retire obligations.
- Follow how concurrent-write conflicts are handled with retries.
- Trace how symbol freshness is validated before any baseline mutation.

## How it fits

A baseline is a portable record that pairs each wiki page and symbol anchor with a content hash representing accepted source code. This module performs all explicit lifecycle operations on that record, converting an inferred initial state into an explicitly accepted state. It leans on `baseline.ts` for entry identity and comparison, `parser.ts` and `symbols.ts` for source parsing and symbol extraction, `indexer.ts` to refresh the index, `db.ts` for a structured view of symbols, and `safe-io.ts` for atomic writes. The operations belong to task scripts and contract workflows that manage documentation debt; they never index code themselves but instead orchestrate the surrounding pieces.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-baseline-operations.mmd
```

## Baseline Bootstrap and Readiness

<!-- lw:anchors packages/core/src/baseline-operations.ts#bootstrapBaseline packages/core/src/baseline-operations.ts#hasCurrentContractBaseline packages/core/src/baseline-operations.ts#createGitReader packages/core/src/baseline-operations.ts#extractHistoricalSymbols packages/core/src/baseline-operations.ts#requireAvailableBaseline -->

The first lifecycle stage constructs the very first baseline from evidence found in Git history, then later stages let a page ask whether its obligations are currently satisfied.

### Building the initial baseline

`bootstrapBaseline(repoRoot, options)` creates the baseline only once, refusing to run if a baseline already exists. The function obtains the documentation inventory, groups its obligations by page using `groupByPage`, and for each page asks the Git reader for the last commit that touched that wiki page. When no commit exists, each obligation on that page surfaces as a `no_page_history` gap. When a commit is present, the module inspects the source files referenced by the obligations, using `sourcePathForSymbolKey` to map each symbol to its file and `extractionVersionForSymbolKey` to know which extraction is needed.

`createGitReader(repoRoot)` returns a `GitReader` that provides `lastCommitForPath` and `readFileAt`, allowing the bootstrap to reuse the Git access logic. Its methods are wrapped around `runGit` and are injectable so that callers can supply a fake history reader. For each distinct source file, `extractHistoricalSymbols(git, commit, sourcePath)` asks that reader to fetch the file content at the historical commit, normalizes its end-of-line characters, parses the source, and returns a map of the symbols found. If the file is missing from that commit or parsing fails, the helper returns a reason code such as `source_missing` or `parse_failed`, which the bootstrap translates into per-symbol gap records.

Every successfully inferred obligation becomes an entry marked with `provenance: "inferred"`, carrying the symbol's content hash and the applicable extraction version. The entries are sorted by `compareBaselineEntries`, and the whole set is written atomically through `writeBaselineCompareAndSwap(repoRoot, null, baseline)`. Because this is a one-time action, the function refuses to regenerate a baseline once one exists. The result records the number of written entries and every page/commit pairing.

### Checking whether a page is current

`hasCurrentContractBaseline(repoRoot, page, symbolKeys)` reports whether the page's anchors are fully accepted and hash-current.

`export async function hasCurrentContractBaseline(
  repoRoot: string,
  page: string,
  symbolKeys: readonly string[],
): Promise<boolean>`

This function raises an error on a malformed page path, gathers the page's currently anchored symbol keys from the inventory, and returns `false` if none exist or if any anchored key is outside the permitted set. It then loads the baseline and compares the number of stored entries against the page's own obligations. For each page key, it retreives the stored entry and the corresponding fresh symbol, and only returns `true` when all three conditions match: the entry is `accepted`, the extraction version equals the version currently required, and the entry's hash equals the live symbol's content hash. Any mismatch or unavailable baseline drives the result to `false`.

## Validation and Fresh-Symbol Collection

<!-- lw:anchors packages/core/src/baseline-operations.ts#assertWikiPath packages/core/src/baseline-operations.ts#assertSymbolKey packages/core/src/baseline-operations.ts#loadFreshSymbols packages/core/src/baseline-operations.ts#loadActiveSymbols packages/core/src/baseline-operations.ts#assertSymbolsStillCurrent -->

Before mutating the baseline, the module must confirm two things: the inputs are well-formed wiki paths and symbol keys, and the symbol hashes it is about to store still match the live source files.

### Validating path and key syntax

`assertWikiPath(path)` throws when the path fails `validateWikiPath`, and `assertSymbolKey(key)` throws when the key fails `validateSymbolKey`. Every exported operation begins with these checks, guaranteeing that no malformed page or key ever reaches the baseline writer. These are synchronous guards that keep the error clear and local.

### Reading live source content

`loadFreshSymbols(repoRoot, keys)` opens each source file referenced by the requested keys, normalizes its line endings, parses the file, and builds a map from symbol key to its symbol record.

The helper resolves each source path relative to the repository root and groups keys by source so that one file parse serves many symbols. Only symbols actually found in the parse are returned, and the function throws if a key cannot be mapped to a source file. Mutations that need exact current content—relocation and contract advancement—rely on this function instead of the index database.

### Querying the active-symbol index

`loadActiveSymbols(repoRoot, keys)` queries the index database to fetch active symbols. After resolving and validating `.livewiki/index.db`, it prepares a query for rows whose status is `'active'` and whose key matches. Each key is looked up individually, and the returned map holds only the symbols that the database still knows as active. This path suits acceptance, which first refreshes the index with `runIndexer` and then wants the index's authoritative view.

### Re-checking before a write

`assertSymbolsStillCurrent(repoRoot, expected)` re-parses the source files for a set of expected symbols and compares their content hashes against the hashes supplied in the map. When the module accepts or migrates an entry, it uses the active-symbol map from the database, but the source could have changed since indexing. This helper protects against that by parsing each source file fresh and throwing if any symbol's hash differs from the expected hash, so the baseline never records a hash that has already drifted.

## Acceptance and Replacement Operations

<!-- lw:anchors packages/core/src/baseline-operations.ts#acceptBaseline packages/core/src/baseline-operations.ts#migrateBaselineKey packages/core/src/baseline-operations.ts#relocateBaselineEntry packages/core/src/baseline-operations.ts#removeBaselineEntry -->

These exported operations are the primary ways a user or a task changes the baseline's accepted obligations.

### Accepting the current code

`acceptBaseline(repoRoot, options)` explicitly records that the present source code for a page's anchors is correct.

`export async function acceptBaseline(
  repoRoot: string,
  options: AcceptBaselineOptions,
): Promise<AcceptBaselineResult>`

The options must specify either `symbols` or `all`, but not both. After validating the page path, the function runs the indexer quietly, so the database reflects current code. It gathers the page's anchored symbol keys from the inventory, and if `all` is set, selects every key; otherwise it selects the explicitly requested set. Keys not anchored by the page trigger an error. For each selected key, `loadActiveSymbols` pulls the active symbol from the database, and `assertSymbolsStillCurrent` confirms the hash is still fresh before further mutation.

The writer loop then reads the current baseline via `requireAvailableBaseline`, transforms the page's entries in memory, and replaces the whole baseline through `writeBaselineCompareAndSwap`. The new entry carries `provenance: "accepted"`, the symbol's live hash, and the current extraction version. A successful write returns the sorted list of accepted keys; a transactional conflict is caught, recognized by `isConcurrentWrite`, and retried after `yieldToConcurrentWriter` until the fixed attempt budget is exhausted.

`async function requireAvailableBaseline(repoRoot: string): Promise<DocumentationBaseline>` reads the baseline and throws if no baseline exists or if it uses an incompatible schema, otherwise it returns the usable baseline object. This single helper is the gate every mutating path passes through before it can compute the next version of the file.

### Migrating a symbol identity

When a symbol is renamed but its semantics stay put, `migrateBaselineKey(repoRoot, options)` changes the durable identity of the obligation without discarding its accepted hash and provenance.

`export async function migrateBaselineKey(
  repoRoot: string,
  options: MigrateBaselineKeyOptions,
): Promise<MigrateBaselineKeyResult>`

The options name the page, the old key, and the new key. The function verifies that `from` and `to` differ, refreshes the index, and checks the inventory so the old key is no longer anchored while the new one is. It loads the active symbol for the new key and re-validates that hash freshness via `assertSymbolsStillCurrent`. The new extraction version comes from `extractionVersionForSymbolKey`.

The write loop locates the baseline entry matching the old identity and errors if the new identity already exists. The replacement keeps the original `hash` and `provenance` fields, swaps in the new symbol key and extraction version, then writes the mutated list through the compare-and-swap method. A migrated entry that still has identical content stays clean; one that drifted will surface as `changed` debt for a later explicit acceptance.

### Moving an obligation between pages

`relocateBaselineEntry(repoRoot, options)` transfers an existing clean obligation from one wiki page to another.

`export async function relocateBaselineEntry(
  repoRoot: string,
  options: RelocateBaselineEntryOptions,
): Promise<{ written: boolean; fromPage: string; toPage: string; symbol: string }>`

The options give the source page, the destination page, and the shared symbol key. The module validates both page paths, errors if they are identical, and consults the inventory to confirm the source page no longer anchors the symbol while the destination page does. It then reads the live source file for that symbol via `loadFreshSymbols` to get the current hash.

The write loop finds the entry on the source page and errors if the destination already has one under the same identity. It only moves the entry when the symbol is `accepted`, its hash matches the live hash, and its extraction version is current; otherwise the operation throws and tells the caller to accept the documentation first. The replacement copies the original entry and changes only the `wikiPath`, then writes the list after removing the old identity and sorting. Like every mutation here, it retries after a `safeIo` conflict until the budget is gone.

### Removing a single obligation

`removeBaselineEntry(repoRoot, options)` deletes one obligation because its anchor has been removed from the page.

The function validates the page and symbol key, then walks the documentation inventory to confirm the page no longer anchors that symbol. If the anchor still exists, it throws. Otherwise, it reads the current baseline, builds a set of identities that includes the one to remove, and writes a new version in which no entry matches that identity. The returned result tells the caller whether the write happened.

## Contract and Whole-Page Operations

<!-- lw:anchors packages/core/src/baseline-operations.ts#advanceContractBaseline packages/core/src/baseline-operations.ts#removeBaselinePages -->

Two operations act on an entire page's set of obligations rather than one entry at a time.

### Advancing under a trusted boundary

`advanceContractBaseline(repoRoot, page, symbolKeys)` accepts exactly the anchors covered by a contract and refuses to touch anything else.

`export async function advanceContractBaseline(
  repoRoot: string,
  page: string,
  symbolKeys: readonly string[],
): Promise<AdvanceContractBaselineResult>`

The function normalizes the permitted keys, validates the path, and fetches the page's anchored keys from the inventory. If the page currently anchors any key outside the permitted list, it raises an error, preventing contract drift. Only keys allowed by the contract and actually present on the page are selected; an empty selection returns without writing. Fresh symbols come from `loadFreshSymbols`, so the current hash is read directly from source.

The mutation loop replaces every entry for the page with one that carries `provenance: "accepted"`, the live hash, and the current extraction version, and it drops whichever entries are not in the selected set. The result lists the accepted keys when a write goes through, otherwise it reports no write.

### Retiring generated pages

`removeBaselinePages(repoRoot, wikiPaths)` removes authority for every entry whose page appears in the given path list.

The function de-duplicates the paths, validates each with `assertWikiPath`, and returns `false` immediately when the set is empty. For a non-empty set, it reads the baseline, filters out all entries whose `wikiPath` is in the set, and writes the reduced list through the compare-and-swap helper. Conflict handling uses the same retry budget as the other mutations.

## Concurrency Protection and Git Access

<!-- lw:anchors packages/core/src/baseline-operations.ts#isConcurrentWrite packages/core/src/baseline-operations.ts#runGit packages/core/src/baseline-operations.ts#yieldToConcurrentWriter -->

The baseline is a shared file and multiple processes may try to update it at once. This module centralizes the retry behavior and the Git subprocess calls that the bootstrapping path requires.

### Recognizing a concurrent-write failure

`isConcurrentWrite(error)` returns `true` when the error is either a `CompareAndSwapConflictError` or a `WriteLockBusyError` from `safe-io`.

```ts
function isConcurrentWrite(error: unknown): boolean {
  return error instanceof safeIo.CompareAndSwapConflictError ||
    error instanceof safeIo.WriteLockBusyError;
}
```

This check is what lets every mutation distinguish a real race from a genuine failure. When a write throws one of these two errors and the attempt counter has not reached its ceiling, the caller backs off and retries instead of surfacing a spurious exception.

### Backing off from a live writer

`yieldToConcurrentWriter(attempt)` sleeps briefly so the competing writer can release the lock.

```ts
function yieldToConcurrentWriter(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(5 * (attempt + 1), 100)));
}
```

The delay increments by five milliseconds per attempt and stops growing at one hundred milliseconds. This bounds the total backoff so that retries do not exceed a reasonable latency while still giving a busy writer room to finish.

### Invoking Git safely

`runGit(repoRoot, args)` spawns the system `git` with the given arguments and returns its standard output when the exit code is zero.

```ts
function runGit(repoRoot: string, args: readonly string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", repoRoot, ...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let overflow = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      resolve(code === 0 && !overflow ? Buffer.concat(chunks).toString("utf8") : null);
    });
  });
}
```

This helper runs git without a shell, hides the window, and captures only standard output. Any child-process error, a non-zero exit, or an output stream exceeding two megabytes makes the helper resolve `null`. The bootstrapping `GitReader` uses this function for both `git log` and `git show` calls, and the function is intentionally private so all git-side effects stay inside this module.

## Grouping and Ordering Helpers

<!-- lw:anchors packages/core/src/baseline-operations.ts#compareText packages/core/src/baseline-operations.ts#groupByPage packages/core/src/baseline-operations.ts#obligationIdentity -->

To keep entries deterministic across runs, many decisions depend on a consistent text comparison and on organizing records by wiki page.

### Comparing two strings

`compareText(left, right)` performs a lexicographic ordering where `left < right` yields `-1`, `left > right` yields `1`, and equality yields `0`. This comparison feeds the sorted baseline entries and the sorted selection lists returned by `acceptBaseline` and `advanceContractBaseline`, so callers see stable output regardless of how records were gathered.

### Grouping obligation records by page

`groupByPage(items)` takes any list of objects that each carry a `wikiPath` and returns a map from that path to the items sharing it. The implementation pushes each item onto its page's array and then sorts the resulting bucket keys with `compareText`, so iteration over the map follows the same lexical order each time. Bootstrap uses this helper to process obligations page by page and to present pages in deterministic order.

### Identifying an obligation

`obligationIdentity(item)` reduces a record carrying `wikiPath` and `symbolKey` down to just those two fields. This helper is used during bootstrap to emit gap records that point to the exact page and symbol that could not be inferred, without carrying along hashes or provenance. The identity is the same pair that `baselineEntryIdentity` uses for the full entry, so gap reporting aligns with how the baseline stores its obligations.

## Tests

Covered by `packages/core/src/baseline-operations.test.ts` (same-name test file on disk).
