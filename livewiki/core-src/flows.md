---
title: Flow candidate detection (stage 5)
owner: generated
anchors:
  - packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH
  - packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET
  - packages/core/src/flows.ts#assignFlowKeySections
  - packages/core/src/flows.ts#buildCandidate
  - packages/core/src/flows.ts#buildSeedKeyGroups
  - packages/core/src/flows.ts#capGroupsToSeedKeys
  - packages/core/src/flows.ts#compareLongestFirst
  - packages/core/src/flows.ts#comparePathLex
  - packages/core/src/flows.ts#computeModuleSignals
  - packages/core/src/flows.ts#crossesBoundary
  - packages/core/src/flows.ts#detectFlowCandidates
  - packages/core/src/flows.ts#displayName
  - packages/core/src/flows.ts#isExternalSpecifier
  - packages/core/src/flows.ts#isProperPrefix
  - packages/core/src/flows.ts#isTestPath
  - packages/core/src/flows.ts#matchedPatterns
  - packages/core/src/flows.ts#normalizeFileMap
---

# Flow candidate detection (stage 5)

Stage-5 detection decides WHICH cross-module product flows exist in a repository, deterministically and without any LLM or database access.

## When to use this page

- **Read the stage-5 contract** when you need to understand what counts as a "flow" before the LLM writes the narrative.
- **Trace the enumeration pipeline** when you are debugging why a flow was emitted, dropped, ranked differently, or skipped.
- **Inspect the seed-key / anchor taxonomy** (T1–T5 groups, two-pass fill, K-a/K-b skips, overlap cap) when changing the anchor budget or the section-assignment rule.
- **Compare pre-LLM skips against the LLM-side skips** (e.g. `duplicate_anchor`, `seed_key_overlap`) to localize a duplicate-anchor failure mode.

## How it fits

This module lives at `packages/core/src/flows.ts` and is the deterministic gatekeeper for the livewiki stage-5 "Semantic product-flow layer". It receives the indexed module list, the module import graph, the active symbol keys per file, the external import specifiers per file, and (optionally) the resolved internal import edges and a set of proven cross-module call-graph callees. From those facts alone — no disk I/O, no DB, no LLM — it enumerates entry→sink walks, ranks them, caps duplicates, and emits a small set of `FlowCandidate` records with their seed-key groups and any pre-LLM skip codes.

It depends on `modules.ts` for path-role classification and the default signal patterns, on `diagrams.ts` for `moduleSlug`, on `config.ts` for `CONFIG_DEFAULTS`, and on `import-resolution.ts` for `ResolvedImportEdge`. Callers feed it inputs and consume the ranked candidates downstream (the LLM-side prompt generation and the validator).

## Diagram

```mermaid
%% livewiki/diagrams/core-src-flows.mmd
```

## Tunable limits

<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET -->

Two constants cap the enumeration so a single well-connected root cannot starve the rest of the graph. They are the only knobs that bound DFS output; everything downstream operates on the bounded result.

```ts
export const FLOW_PER_ROOT_PATH_BUDGET = 64;
export const FLOW_MAX_PATH_LENGTH = 8;
```

`FLOW_PER_ROOT_PATH_BUDGET` is the cap on the number of simple paths enumerated per walk root. The DFS at the heart of `detectFlowCandidates` increments an `enumerated` counter for each step and short-circuits when it reaches this budget — without ever consuming another root's budget. The cap is an upper limit only; roots with fewer than 64 simple paths are unaffected, and there is no lower bound enforced.

`FLOW_MAX_PATH_LENGTH` is the cap on the length (in modules) of any single walk. The DFS returns from a path branch once `path.length >= FLOW_MAX_PATH_LENGTH`, so no walk contains more modules than this constant. The entry module counts as 1, so a fully extended walk has exactly 8 module ids. There is no minimum-length constant — the caller checks `path.length >= 2` separately inside `detectFlowCandidates`.

## Signal computation

<!-- lw:anchors packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#isExternalSpecifier -->

Every module in the graph is reduced to a small bundle of booleans and evidence lists before enumeration starts. The booleans drive which modules can be roots, which walks cross a boundary, and which count toward ranking. The evidence lists flow into the candidate's `signals` payload and the seed-key classification. Together they ensure every later decision is a pure function of the per-module bundle.

```ts
function computeModuleSignals(
  module: Module,
  files: string[],
  ctx: {
    indegree: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
  },
): ModuleSignals
```

`computeModuleSignals` returns the `ModuleSignals` bundle for one module — `entry`, `persistence`, `external`, `product` booleans plus the matched patterns / packages that justify each signal.

The entry boolean is `indegree === 0 || entryMatch`, where `entryMatch` is the combined gitignore matcher over the module's files (the same `matchesAnyPathPattern` that `classifyPathRole` uses, so negations apply across the whole list). The product boolean is the module-role classification. Persistence is the OR of the path channel (combined matcher over files against the persistence patterns) and the import channel (combined matcher over the filtered external specifiers against `persistenceImportPatterns`). External is true when at least one external specifier survives the per-occurrence filter. The import channel's specifiers and the patterns matched by `matchedPatterns` are the evidence lists.

```ts
function matchedPatterns(inputs: string[], patterns: string[]): string[]
```

`matchedPatterns` returns the subset of patterns that matched at least one input — a pattern only counts for inputs the combined `matchesAnyPathPattern` accepts, so a negated-out input contributes neither the boolean signal nor an evidence entry. The returned patterns are sorted ascending.

```ts
function isExternalSpecifier(spec: string): boolean
```

`isExternalSpecifier` decides whether a single import specifier counts as a third-party package reference. The empty string, anything starting with `node:`, and anything starting with `.` or `/` return false; everything else returns true. There is no check for `@scope/...` specifically — bare non-relative / non-absolute / non-`node:` strings are treated as external.

## Enumeration pipeline

<!-- lw:anchors packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#displayName -->

The pipeline in `detectFlowCandidates` is a pure, deterministic sequence: prepare sorted inputs, compute per-module signals, identify walk roots, enumerate simple paths with a per-root budget, drop prefixes, keep only the longest walk per entry+sink pair, compute slugs and centrality, build candidates, rank, apply the overlap cap, slice to `maxFlows`. Every step is a stable transform over the previous step's output, so shuffling input arrays or map insertion orders never changes the result.

```ts
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
```

`detectFlowCandidates` takes a `FlowDetectionOptions` bundle and returns the bounded, ranked set of `FlowCandidate` records for the stage-5 run. A `maxFlows <= 0` or empty `modules` input returns `[]` immediately — no error, no candidates.

The first phase normalizes the inputs. The modules array is sorted by id then by first path; the first module in id-order wins on duplicate ids. Input maps (`symbolsByFile`, `externalImportsByFile`) are copied once into a normalized-path lookup via `normalizeFileMap`; from that point on they are only looked up, never iterated. Edges are deduped (same `from`/`to` pair), restricted to known modules, and sorted ascending. The resolved-edge lookup is a `Set` of `"<file>\0<specifier>"` keys, also lookup-only.

The second phase computes signals. For each module, `computeModuleSignals` returns a bundle; the function uses the combined matcher for the boolean signals (so negations apply correctly across the whole list) and `matchedPatterns` for the per-pattern evidence lists.

The third phase picks walk roots. A walk root must carry the `entry` signal AND must NOT be a module whose every file is a test path. The test-only guard is the post-2026-07-23 fix: zero indegree is as true of a real product entry point as it is of a test-only module, so without the guard every zero-indegree test module becomes a valid root and the resulting flow's entry tier is made of unittest test methods rather than product code.

The fourth phase is the DFS. For each root (in sorted order), `detectFlowCandidates` runs an inner `visit` function that appends a candidate whenever the current path has length ≥ 2 AND `crossesBoundary` returns true, then walks sorted outgoing edges, skipping any neighbor already in the path. The `enumerated` counter and the per-path-length check are the two stops that enforce the per-root budget and the maximum walk length.

```ts
function crossesBoundary(path: string[], signalsById: Map<string, ModuleSignals>): boolean
```

`crossesBoundary` returns true when at least one module along the walk has the `persistence` or `external` signal. The function does not check the length of the path; the surrounding DFS only calls it when `path.length >= 2`, so a single-module path is never qualified.

```ts
function isProperPrefix(p: string[], q: string[]): boolean
```

`isProperPrefix` is the prefix predicate used to drop shorter walks that are entirely contained in a longer one. It returns false when `p.length >= q.length` (including equal-length paths) or when any position differs; otherwise true.

```ts
function compareLongestFirst(a: string[], b: string[]): number
```

`compareLongestFirst` orders paths longest first and breaks ties lexicographically (`comparePathLex`). `detectFlowCandidates` uses it to pick the longest walk per entry+sink pair.

```ts
function comparePathLex(a: string[], b: string[]): number
```

`comparePathLex` compares two module-id arrays element-by-element via `localeCompare`, returning the first non-zero difference; when all compared positions are equal it returns the length difference. It is the canonical ordering tie-breaker used throughout the pipeline.

The fifth phase keeps only the longest walk per entry+sink pair (the `bestByPair` map, ties broken by `compareLongestFirst`). The sixth phase computes slugs and centrality. Base slugs are `moduleSlug("<entry>-to-<sink>")` (empty slug falls back to `"flow"`); collisions are resolved with `-2`, `-3`, … after sorting by base-slug-asc then path-asc, so the assignment does not depend on enumeration or ranking order. Centrality is the count of qualified walks in the union that share at least one module id with the candidate; the candidate's own walk is in the union, so centrality is at least 1.

The seventh phase is `buildCandidate`, which materializes one `FlowCandidate` record from a path and the per-run context. The eighth phase ranks by product-role count desc, then centrality desc, then slug asc (`maxFlows` applies AFTER ranking). The ninth phase applies the round-5 overlap cap: walked in order, a candidate whose seed-key set overlaps an already-accepted candidate's set above `flowMaxOverlap` (intersection over the smaller set) is dropped with a recorded `seed_key_overlap` skip; candidates already carrying a K-a/K-b skip never block others and are never blocked themselves. The pipeline returns `ranked.slice(0, maxFlows).map((r) => r.candidate)`.

```ts
function buildCandidate(
  path: string[],
  slug: string,
  ctx: {
    moduleById: Map<string, Module>;
    filesByModule: Map<string, string[]>;
    signalsById: Map<string, ModuleSignals>;
    symbolsLookup: Map<string, string[]>;
    maxAnchors: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    resolvedEdges?: ResolvedImportEdge[] | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
    resolvedCrossModuleCallees?: ReadonlySet<string> | undefined;
  },
): FlowCandidate
```

`buildCandidate` takes a single walk path and the per-run context and returns the `FlowCandidate` record. It pulls the entry and sink module from `moduleById`, accumulates signal evidence into sorted sets, builds the seed-key groups via `buildSeedKeyGroups`, and spreads the groups onto the base record. There is no signal-side skip produced here — the only candidates that carry a `skip` field are the ones the two-pass fill cannot satisfy.

```ts
function displayName(module: Module): string
```

`displayName` returns the module's display title for the candidate's `titleSeed` — `module.displayTitle ?? module.id`. The fallback is module id, not module path; a module with no `displayTitle` shows up in the seed text by its id.

## Seed-key groups and the two-pass fill

<!-- lw:anchors packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#isTestPath -->

The seed-key taxonomy is what turns a path into a content-ready candidate: every key of the walk is classified into exactly one of five groups (T1 entry, T2 crossing, T3 boundary-sink, T4 product-with-no-role, T5 auxiliary) AND into a closed `seedKeys` list (capped at `flowMaxAnchors`). The closed list drives the LLM prompt's anchor set, and the group boundaries drive the post-LLM validator. Both must agree on every key: the union of the five groups MUST equal `seedKeys` exactly.

```ts
function buildSeedKeyGroups(
  path: string[],
  ctx: {
    filesByModule: Map<string, string[]>;
    symbolsLookup: Map<string, string[]>;
    signalsById: Map<string, ModuleSignals>;
    maxAnchors: number;
    entryPatterns: string[];
    persistencePatterns: string[];
    persistenceImportPatterns: string[];
    externalLookup?: Map<string, string[]> | undefined;
    resolvedLookup?: ReadonlySet<string> | undefined;
    resolvedEdges?: ResolvedImportEdge[] | undefined;
    pathRoleConfig?: PathRoleConfig | undefined;
    resolvedCrossModuleCallees?: ReadonlySet<string> | undefined;
  },
): SeedKeyGroups
```

`buildSeedKeyGroups` is the heart of the taxonomy. It builds three semantic-role file sets (T1 entry, T2 crossing, T3 boundary-sink), assigns every walk key to its module-walk-position and to the set of roles its file holds, partitions the keys into the five groups (product-first, auxiliary-fallback for T1/T2/T3, pure product for T4, pure auxiliary for T5), and then runs the two-pass closed-list fill.

The T1 set is the union of files matched by the combined entry patterns over every walk module, plus — for an indegree-only root (entry signal with no pattern evidence) — the first file of the first resolved internal edge leaving the root, falling back to the root's non-auxiliary files when no edge exists. The T2 set is the source/target files of any `ResolvedImportEdge` whose endpoints belong to two different walk modules. The T3 set is every walk file matched by the combined persistence patterns, plus every file that has an external specifier (after the per-occurrence resolved-edge filter) matching `persistenceImportPatterns`, plus every file of the sink module.

The per-key classification uses a canonical order — module walk position first, then key asc within the module — and the first walk position wins on collisions. `auxiliary` is true when the file is NOT classified as "product" by `classifyPathRole` OR is a test path (which is the narrower, flow-specific signal: `classifyPathRole` deliberately still counts test source as "product"; `isTestPath` is the flow-specific exclusion).

The two-pass fill builds `seedKeys` from a reservation step (one key per non-empty T1/T2/T3 group; multi-role keys count once) and a priority-fill step (round-robin across walk modules in tier priority T1→T5, one key per module per round, keys sorted within a module) up to `flowMaxAnchors`. The K-a skip fires when the reservation itself cannot fit under the cap. The K-b skip fires when the reservation plus a top-up to 3 distinct keys still holds fewer than 3 (the three required flow sections each need their own anchor; a key may not repeat across markers).

A real third-key short scenario — the K-b top-up — explicitly walks the remaining pool in the same T1→T5 priority order as pass 2; it is not strictly T4/T5, so a 3-key flow whose third key sits in an already-reserved group is not artificially skipped.

```ts
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups
```

`capGroupsToSeedKeys` enforces the closed-list invariant: each of the five groups keeps only keys present in `seedKeys`, preserving order. The union of the capped groups equals `seedKeys` exactly, so a key truncated from `seedKeys` can never leak into a prompt or validator group. The function is called twice in `buildSeedKeyGroups` — once before a K-a/K-b skip is recorded, once at the very end — to keep the invariant on every return path.

```ts
export function isTestPath(path: string): boolean
```

`isTestPath` is the deterministic test-path predicate used by both the root guard and the `auxiliary` classification. It returns true when the filename has a `.test.` or `.spec.` infix, the path contains a `__tests__` segment, the filename matches `test_*.py` or `*_test.py` / `*_test.go`. A bare `test` or `tests` directory segment is deliberately NOT matched here — the function targets filename conventions only.

## Section assignment

<!-- lw:anchors packages/core/src/flows.ts#assignFlowKeySections packages/core/src/flows.ts#normalizeFileMap -->

Section assignment is the deterministic bridge from the seed-key taxonomy to the three required flow-page sections. It exists because the LLM previously decided per-call where to place each key, and that produced inconsistent validator collisions. The mechanical replacement makes the placement a total function of the candidate, so neither the prompt nor the validator has to invent a rule.

```ts
export function assignFlowKeySections(candidate: FlowCandidate): FlowKeySectionMap
```

`assignFlowKeySections` returns a `ReadonlyMap<string, FlowRequiredSection>` that maps every entry of `candidate.seedKeys` to exactly one of `"purpose"`, `"ordered-flow"`, `"failure-and-recovery"`. The policy is: T1 (entry) keys → `"purpose"`; T3 (sink) keys → `"failure-and-recovery"`; everything else (T2, T4, T5) → `"ordered-flow"`. When a key belongs to multiple groups, T1 wins over T3 wins over the rest — never ambiguous, never re-decided per call. The map is total over `seedKeys`; no key in the closed list is left unmapped.

```ts
function normalizeFileMap(map: Map<string, string[]>): Map<string, string[]>
```

`normalizeFileMap` is the shared map-normalization helper used by `detectFlowCandidates` to copy `symbolsByFile` and `externalImportsByFile` into a path-keyed lookup. Each input entry's key is `normalizeRepoPath`'d and its values are appended to the output bucket (a collision concatenates lists). The output is then lookup-only inside the rest of the pipeline, so the input insertion order never leaks into the result.

## Tests

Covered by `packages/core/src/flows.test.ts` (same-name test file on disk).
