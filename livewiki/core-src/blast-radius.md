---
title: Computing the change-impact blast radius for a symbol
owner: generated
anchors:
  - packages/core/src/blast-radius.ts#computeBlastRadius
  - packages/core/src/blast-radius.ts#findAffectedPages
---

# Computing the change-impact blast radius for a symbol

This page documents the module that answers the question "if I change symbol X, what breaks and which wiki pages document the dependents?"

## When to use this page

- **Trace** which code calls a symbol directly and transitively before refactoring it.
- **Find** the wiki pages that document any caller in a symbol's blast radius so reviewers know what to update.
- **Tune** the walk's `maxDepth`/`maxNodes` bounds when a central utility reports `truncated: true`.
- **Distinguish** direct (`extracted`) edges from inferred name‑guess edges via `callerConfidence`.

## How it fits

`packages/core/src/blast-radius.ts` lives in `packages/core/src` alongside the rest of the core indexer/querier code. It depends on the `better-sqlite3` `Database` handle and on the `CallConfidence` type re-exported from `./symbols.js`. The module reads two SQLite tables populated elsewhere in the pipeline: `calls` (the resolved call graph used to walk callers backwards) and `anchors` joined to `doc_pages` (used to map symbol keys back to wiki pages). The companion module `call-resolution.ts` (referenced in the file's rationale evidence) is responsible for resolving raw call sites into `resolved_callee_key` edges, so this file can rely on them being trustworthy. The exported `computeBlastRadius` is the public entry point, and `findAffectedPages` is an internal helper that joins callers to documentation.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-blast-radius.mmd
```

## Bounded backward walk over the call graph

<!-- lw:anchors packages/core/src/blast-radius.ts#computeBlastRadius -->

The headline entry point is `computeBlastRadius`, which traverses the `calls` table in reverse — from a symbol out to its callers, and from each of those callers to their callers — until it either runs out of callers or hits one of the configured safety bounds.

```ts
export function computeBlastRadius(
  db: Database.Database,
  symbolKey: string,
  opts: BlastRadiusOptions = {},
): BlastRadiusResult {
```

`computeBlastRadius` takes a live `better-sqlite3` database handle, the canonical key of the symbol being inspected, and an optional `BlastRadiusOptions` (with `maxDepth` defaulting to `5` and `maxNodes` defaulting to `200`). It returns a `BlastRadiusResult` describing direct callers, transitive callers, the affected wiki pages, the per-caller confidence, and a `truncated` flag.

The walk is implemented as a breadth-first search seeded with the target symbol itself. A prepared statement — `SELECT caller_key, MAX(confidence = 'extracted') AS has_extracted FROM calls WHERE resolved_callee_key = ? GROUP BY caller_key` — is reused for every frontier node; only rows with a non-null `resolved_callee_key` are reachable through this query, which is the file's way of trusting only edges the resolution stage could confidently attribute. The `has_extracted` aggregation collapses multiple edges from the same caller into one row and records whether at least one of them was an `extracted` (direct-evidence) edge; that boolean is later mapped into the `'extracted'` vs `'inferred'` value stored in `callerConfidence`.

Two bounds are enforced independently during the BFS:

- **Depth** (`maxDepth`): the outer `for` loop runs at most `maxDepth` times, so the walk never follows a chain of more than `maxDepth` caller-of-caller hops. If the loop exits because the depth counter reached `maxDepth` while the current `frontier` is still non-empty, the code sets `truncated = true` — that path distinguishes "the bound ended the search" from "we simply ran out of callers".
- **Width** (`maxNodes`): `visited.size - 1` (excluding the target itself) is checked before each frontier expansion and after each new caller is appended; once it would exceed `maxNodes`, the walk stops and sets `truncated = true`. This cap protects against hub symbols whose entire reachable caller subgraph would otherwise be enumerated.

Callers discovered at depth `0` (the first expansion from the target itself) are pushed into `directCallers`; callers discovered at any later depth are pushed into `transitiveCallers` in BFS discovery order. Each caller is added to `visited` before being pushed so the walk never re-enters the same node, and its confidence is recorded as `'extracted'` when `has_extracted` is truthy, otherwise `'inferred'` — matching the rule that a caller with both edge kinds reports `'extracted'`.

Once the walk finishes (whether by exhaustion or by truncation), `computeBlastRadius` assembles the final key list as `[symbolKey, ...directCallers, ...transitiveCallers]` and hands it to `findAffectedPages` to discover which wiki pages cite any symbol in that set, then returns the assembled `BlastRadiusResult`.

## Resolving callers to wiki pages

<!-- lw:anchors packages/core/src/blast-radius.ts#findAffectedPages -->

The second function is `findAffectedPages`, the helper that turns a list of symbol keys into the documentation surfaces that depend on them.

```ts
function findAffectedPages(db: Database.Database, symbolKeys: string[]): AffectedPage[] {
```

`findAffectedPages` takes the same `better-sqlite3` database handle and a non-empty array of symbol keys, and returns one `AffectedPage` record per distinct wiki page that cites at least one of them. An empty input short-circuits to `[]`.

The query it prepares joins `anchors` against `doc_pages` on `a.doc_page_id = dp.id`, filters rows whose `a.symbol_key` appears in the supplied list, and orders by `(wiki_path, symbol_key)` so that a `Map<string, string[]>` can group rows by `wikiPath` while preserving lexicographic ordering of the cited symbol keys within each page. Because the SQL placeholder list is built from `symbolKeys.map(() => "?").join(",")`, every key in the input array becomes a bound parameter — there is no string interpolation of caller keys into the SQL.

After the rows are fetched, `findAffectedPages` walks them once to populate the map, deduplicating `symbolKey` per page via an `includes` check before pushing. The final `AffectedPage[]` is produced by spreading the map's entries into `{ wikiPath, citedSymbolKeys }` objects, so callers receive one entry per wiki page that mentions any symbol in the blast radius, with the exact set of cited keys attached.

## Tests

Covered by `packages/core/src/blast-radius.test.ts` (same-name test file on disk).
