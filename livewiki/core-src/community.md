---
title: Community detection cross-check
owner: generated
anchors:
  - packages/core/src/community.ts#detectFileCommunities
  - packages/core/src/community.ts#comparePartitions
---

# Community detection cross-check

This page documents how `packages/core/src/community.ts` derives file-level communities from the import graph and uses them to cross-check livewiki's stage-2 module partition.

## When to use this page

- **Diagnose** why a file landed in a different module than its connected neighbours — call `comparePartitions` and read the divergent rows.
- **Inspect** the file-level community map produced by `detectFileCommunities` when you need a deterministic, dependency-free grouping for debugging.
- **Verify** that the deterministic label-propagation implementation still honours its byte-reproducibility contract after a change to the algorithm or its inputs.

## How it fits

`packages/core/src/community.ts` is part of the `core` package's partitioning layer. The wider pipeline resolves imports first (so every edge carries the source/target file paths this module needs), then runs the stage-2 module partition, and finally uses this file as a diagnostic cross-check. `detectFileCommunities` consumes the resolved edges and emits a `path → communityId` map; `comparePartitions` then joins that map against the heuristic partition and produces a sorted report. Because label propagation frequently collapses files into singletons or giant components, the report is advisory only — the stage-2 partition is the one livewiki treats as authoritative.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-community.mmd
```

## Label propagation over the file import graph

<!-- lw:anchors packages/core/src/community.ts#detectFileCommunities -->

`detectFileCommunities` is the only clustering primitive in the file, and it is intentionally minimal: synchronous label propagation with a fixed visit order and sorted tie-breaking.

```ts
export function detectFileCommunities(
  filePaths: string[],
  edges: ResolvedImportEdge[],
): Map<string, string>
```

The function takes the list of files (`filePaths`) and the resolved import edges (`edges`), and returns a `Map` from each file path to the label it ends up with — where the label is itself some file path (the winning neighbour or the node's own path). Map insertion order is `localeCompare` path order, so the output is byte-identical regardless of how `filePaths` or `edges` were originally ordered.

The flow inside the function is:

1. **Build a deterministic node list.** `[...new Set(filePaths)].sort((a, b) => a.localeCompare(b))` produces a deduplicated, sorted array of paths. Anything later depends on this order, so dedup plus `localeCompare` is what makes the function reproducible across runs that happened to collect `filePaths` in different orders.
2. **Construct undirected adjacency, dropping invalid edges.** The loop skips self-edges (`e.fromFile === e.toFile`) and any edge whose endpoint is not in `nodeSet`. Surviving edges are added to both endpoints' neighbour sets, so the graph is treated as undirected for propagation purposes.
3. **Seed labels with each node's own path.** A `label` map starts with every node pointing to itself; neighbourless nodes keep this label forever because the per-node loop short-circuits when `counts.size === 0`.
4. **Run up to `MAX_PASSES` (10) propagation passes.** Each pass iterates nodes in their pre-sorted order, counts the labels among a node's neighbours, and adopts the label with the highest count. Ties are broken by `localeCompare` in favour of the smaller label, and ties remain deterministic even when two neighbour labels have identical counts. A node only flips when the best label differs from its current one; a pass that changes nothing ends the loop early.
5. **Return the label map.** Because both the visit order and the tie-breaker are `localeCompare`-based, the returned `Map` reflects a byte-reproducible fixed point of the propagation.

Two failure-adjacent branches are visible in the source: a node with zero neighbours keeps its initial label because the `counts.size === 0` `continue` runs before any "best" comparison, and a pass loop ends as soon as `changed` stays `false` — both are part of the normal path rather than error handling.

## Cross-checking the stage-2 partition

<!-- lw:anchors packages/core/src/community.ts#comparePartitions -->

`comparePartitions` is the diagnostic half of the file. It does not produce a partition; it joins the community map from `detectFileCommunities` against the heuristic module partition and reports where they disagree.

```ts
export function comparePartitions(
  modules: Array<Pick<Module, "id" | "paths">>,
  communities: Map<string, string>,
): CommunityCrossCheckReport
```

It takes the modules produced by the stage-2 partition (each with an `id` and the file `paths` it owns) and the `path → communityId` map from `detectFileCommunities`, and returns a `CommunityCrossCheckReport` containing a per-module row, a disagreement count, and a verdict.

The pipeline inside the function is:

1. **Sort modules deterministically.** `sortedModules` is built from `[...modules].sort((a, b) => a.id.localeCompare(b.id))`, and every downstream computation uses this order. This means the same input order always produces the same report, even if the caller passed modules in a different order.
2. **Resolve file → owning module.** `fileToModule` is populated from `sortedModules` in order, and the `if (!fileToModule.has(p))` guard means the *first* module in sorted order wins when two modules list the same file. The source only handles this overlap deterministically; it does not warn about it.
3. **Build community → module counts.** For every file present in `communities`, the function looks up its owning module and increments a `communityId → moduleId → file count` map. Files without an owning module are silently skipped via `if (moduleId === undefined) continue;`.
4. **Define a `pluralityModule` helper.** Given a community id, it returns the module with the highest file count inside that community; ties are broken by `localeCompare` against the current best. If a community has no entries (e.g. only files that are not owned by any module), it returns `null`.
5. **Count disagreements.** For every file in `communities` that has an owning module, `comparePartitions` compares the file's own module against the community's plurality module. Files whose community's plurality module is `null`, or whose own module is undefined, are not counted as disagreements.
6. **Compute per-module dominant community.** For each module, it counts how many of its files fall into each community, picks the highest-count community (with `localeCompare` tie-breaking), and records both that community id and the share (`bestCount / m.paths.length`). Modules with zero files get `dominantShare: 0` and `dominantCommunity: null` because the ternary around `m.paths.length` short-circuits before any counts are inspected.
7. **Emit the report.** `perModule` is built in `sortedModules` order, `disagreementCount` is the running tally, and the verdict is the literal string `"divergent"` when `disagreementCount > 0` and `"agree"` otherwise. The threshold for `divergent` is fixed at zero — the source notes that threshold tuning is intentionally deferred to a later lot.

Two visible branches govern the "no input" cases: a community with no module-owned files yields a `null` plurality (so those files do not contribute to `disagreementCount`), and a module with no paths yields `dominantCommunity: null` and `dominantShare: 0` rather than dividing by zero.

## Tests

Covered by `packages/core/src/community.test.ts` (same-name test file on disk).
