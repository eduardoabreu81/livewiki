---
title: Call Resolution
owner: generated
anchors:
  - packages/core/src/call-resolution.ts#computeCallerCentrality
  - packages/core/src/call-resolution.ts#computeCrossModuleCallees
  - packages/core/src/call-resolution.ts#resolveCalls
---

# Call Resolution

This page documents the module that fills in the `resolved_callee_key` column on the `calls` table for call edges the indexer just emitted with it unset.

## When to use this page

- **Audit** how a code-base's call edges get linked from a bare `callee_name` to a concrete symbol key, and which edges stay unresolved.
- **Inspect** the two derived analytics — `computeCrossModuleCallees` and `computeCallerCentrality` — that the flow detector and topic-planner consume.
- **Reason** about staleness or retro-active resolution behaviour when symbols are added, renamed, or moved between files.

## How it fits

`packages/core/src/call-resolution.ts` is a small, DB-only, synchronous module living inside the indexer's package. It runs during the indexer's write transaction, right after the symbol and call inserters drop new rows; its job is purely to pointing bare-identifier callees at the symbol they almost certainly refer to. Filename/key splits, tsconfig-aware module boundaries, and async filesystem lookups are deliberately out of scope here — those live in `import-resolution.ts`. The module contributes two derived analytics that other consumers query: `computeCrossModuleCallees` is consumed by `detectFlowCandidates` in `flows.ts` to break ties inside the cross-module seed-key group, and `computeCallerCentrality` is consumed by `selectTopicAnchors` in `topics.ts` to rank anchors inside a bucket.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-call-resolution.mmd
```

## Resolve-call pass

<!-- lw:anchors packages/core/src/call-resolution.ts#resolveCalls -->

This step is the file's main responsibility: it converts unresolved `calls` rows into real, key-anchored edges. It runs synchronously inside the indexer's write transaction immediately after the inserter drops raw call rows, so the database stays consistent without an async round-trip.

```ts
export function resolveCalls(db: Database.Database): ResolveCallsResult
```

`resolveCalls` takes a `better-sqlite3` database handle and returns a `ResolveCallsResult` object whose `resolved` field counts the rows whose `resolved_callee_key` changed from `NULL` to a real key during this pass.

The pass is implemented as two statements that both run inside the same transaction:

1. **Same-file match.** The first `UPDATE` scans only rows whose `resolved_callee_key IS NULL` and writes the `key` of the unique active `function`/`export` symbol in the same file with a matching `name`. The `WHERE ... = 1` subquery enforces the "exactly one candidate" rule — if zero or more than one symbol in the same file match, the row stays `NULL` rather than guessing. Per the file-level docstring, this is the highest-confidence path because the symbol must literally be defined next to the call.
2. **Global-unique match (fallback).** The second `UPDATE` repeats the same pattern but unrestricted to `file_id`, so a row still unresolved after step 1 will be filled if exactly one active `function`/`export` symbol *anywhere* in the repo carries that name. Per the file-level docstring, an explicitly called name that is unique in the whole repo is strong cross-module evidence, and the flow tie-break relies on exactly this.

The visible branch behaviour is: both `UPDATE`s have a "zero or multiple candidates" side door — when the count subquery is not equal to `1`, the row is simply skipped and the `resolved_callee_key` stays `NULL`. Method calls (`obj.method()`) are out of scope for v1: the `callee_name` is the bare right-most identifier, and a method symbol's `name` is qualified (`Class.method`), so it never matches.

The function returns `resolved: sameFile.changes + globalUnique.changes` — both deltas are summed, not overwritten, so a row that already has a real key from a previous run is never re-examined here. The accompanying docstring notes the consequence: a call-edge that was already resolved to a previous file becomes stale if the target symbol later moves to a different file, and the edge is only repaired when the *calling* file itself is reindexed (which clears the column back to `NULL` first).

## Cross-module callee set

<!-- lw:anchors packages/core/src/call-resolution.ts#computeCrossModuleCallees -->

This derived view tells the flow detector which callee keys have at least one resolved call whose caller lives in a *different* module — the difference between "there is an import from module A to module B" and "module A actually calls into module B by name". It is read-only and DB-only, so it can sit alongside the resolve pass without ever touching the database from the flow side.

```ts
export function computeCrossModuleCallees(
  db: Database.Database,
  modules: ReadonlyArray<{ id: string; paths: readonly string[] }>,
): Set<string>
```

`computeCrossModuleCallees` takes the database and the project's module-to-paths mapping, and returns a `Set<string>` of symbol keys that are proven cross-module callees by an indexed call.

The flow is straightforward:

1. Build a `file → module.id` lookup by iterating every `module.paths` entry. Module identity here is the project's logical grouping, not a filesystem boundary — the caller passes the whole mapping.
2. Run a single read query that selects `(caller_key, resolved_callee_key)` pairs where `resolved_callee_key IS NOT NULL` and `confidence = 'extracted'`. The `extracted` filter is the visible trust gate: member-access name guesses (`obj.open()`) are tagged `inferred` at extraction time and are excluded here because a name guess is not evidence of a cross-module dependency.
3. For each row, split both keys on `#` to recover the file path part, look up the module each side belongs to, and — if both lookups succeed and the modules differ — add `resolved_callee_key` to the result set.

The visible degenerate branches are silent: a row whose `caller_key` or `resolved_callee_key` is `undefined` after splitting is skipped, and a row whose caller or callee file is not registered in the module mapping is also skipped. The function does not throw on either case; the caller sees a smaller set. Because every surviving row is `extracted`, the resulting set is the canonical "flow tie-break evidence" handed to `detectFlowCandidates`.

## Callee centrality proxy

<!-- lw:anchors packages/core/src/call-resolution.ts#computeCallerCentrality -->

This derived view is the cheap, graphless centrality signal the topic-plan proposer uses to rank anchors inside a bucket. It treats the existing `calls` table as a directed graph and counts, per callee key, how many *distinct* resolved callers point at it. There is no Leiden-style community detection; a key that is missing from the returned map simply has zero resolved callers and is treated as centrality 0 by the consumer.

```ts
export function computeCallerCentrality(db: Database.Database): Map<string, number>
```

`computeCallerCentrality` takes the database and returns a `Map<string, number>` from `resolved_callee_key` to its distinct resolved-caller count.

The whole reducer is a single SQL statement:

```sql
SELECT resolved_callee_key AS key, COUNT(DISTINCT caller_key) AS callers
FROM calls
WHERE resolved_callee_key IS NOT NULL AND confidence = 'extracted'
GROUP BY resolved_callee_key
```

The `COUNT(DISTINCT caller_key)` is the load-bearing detail: a callee that is hit from many call sites still counts each caller once, so a single noisy file that calls the same function in a hundred places does not dominate the ranking. The `confidence = 'extracted'` filter mirrors the cross-module callee view — only edges that an explicit bare-identifier call produced count, so `obj.method()` noise cannot rank anchors. The result is fanned into a `Map<string, number>` because `selectTopicAnchors` does repeated lookups and a map is the cheap shape to expose; the function never returns anything more elaborate than a count.

## Tests

Covered by `packages/core/src/call-resolution.test.ts` (same-name test file on disk).
