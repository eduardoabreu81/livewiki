---
title: Semantic Topic Planning for Linked Module Evidence
owner: generated
anchors:
  - packages/core/src/topics.ts#DEPLOYMENT_PATH_PATTERNS
  - packages/core/src/topics.ts#TOPIC_GROUP_NAMES
  - packages/core/src/topics.ts#TOPIC_SOURCE_SPAN_SEPARATOR
  - packages/core/src/topics.ts#addDuplicateError
  - packages/core/src/topics.ts#assignTopicKeySections
  - packages/core/src/topics.ts#buildTopicPlanningInventory
  - packages/core/src/topics.ts#capClusterSize
  - packages/core/src/topics.ts#classifyTopicSignals
  - packages/core/src/topics.ts#clusterModulesByImportGraph
  - packages/core/src/topics.ts#collectConcernTopicClusters
  - packages/core/src/topics.ts#compareProposalPreference
  - packages/core/src/topics.ts#errorAt
  - packages/core/src/topics.ts#estimateTopicSourceChars
  - packages/core/src/topics.ts#extractH2Titles
  - packages/core/src/topics.ts#extractOpeningSentence
  - packages/core/src/topics.ts#extractSectionBullets
  - packages/core/src/topics.ts#isRecord
  - packages/core/src/topics.ts#isStringArray
  - packages/core/src/topics.ts#measureTopicAnchorEvidence
  - packages/core/src/topics.ts#normalizeGroups
  - packages/core/src/topics.ts#normalizeLabel
  - packages/core/src/topics.ts#parseProposal
  - packages/core/src/topics.ts#proposeTopicPlanDeterministically
  - packages/core/src/topics.ts#renderTopicSourceSpan
  - packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically
  - packages/core/src/topics.ts#selectTopicAnchors
  - packages/core/src/topics.ts#serializeTopicPlanningInventory
  - packages/core/src/topics.ts#stripOuterJsonFence
  - packages/core/src/topics.ts#toCandidate
  - packages/core/src/topics.ts#uniqueSorted
  - packages/core/src/topics.ts#validateTopicPlan
---

# Semantic Topic Planning for Linked Module Evidence

This file defines how the system plans, validates, and deterministically organizes topic pages that cross-link evidence from multiple modules and flows in the livewiki knowledge base.

## When to use this page

- Understand how topic pages get their anchor evidence and group structure without relying on free-form language model output.
- Learn how the deterministic planner clusters related modules and selects source anchors to stay within configurable budgets.
- See how topic plan proposals are validated against the closed inventory of modules, flows, and anchors.
- Debug why a topic failed validation or was excluded from the final plan due to source character, anchor, or module limits.

## How it fits

This module implements the "stage 5" semantic topic planning for the livewiki project. After earlier stages have produced a set of accepted pages—module documentation, flow diagrams, and source evidence—this file's job is to turn the accumulated evidence into one or more topic pages that tell a coherent cross-cutting story. It does this through two complementary mechanisms: a deterministic orchestrator (`proposeTopicPlanDeterministically`) that derives topic proposals entirely from the accepted evidence inventory without needing the language model, and a validation layer (`validateTopicPlan`) that any planner output—whether deterministic or language-model-generated—must pass before those proposals become real pages.

The file exposes shared evidence-span math (`renderTopicSourceSpan`, `estimateTopicSourceChars`) that must stay byte-exact with the generator side in batch.ts, so the planner's character estimates never drift from what the generator will actually measure. The surrounding repository builds the module and flow inventories in other core modules and feeds them into this planner. The deterministic path also implements the "Workstream B" clustering approach, which groups modules by import graph connectivity as a fallback that guarantees valid topic proposals even when the language model proposes none.

## Inventory Construction from Accepted Evidence
<!-- lw:anchors packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#measureTopicAnchorEvidence packages/core/src/topics.ts#renderTopicSourceSpan packages/core/src/topics.ts#TOPIC_SOURCE_SPAN_SEPARATOR packages/core/src/topics.ts#uniqueSorted -->

The `buildTopicPlanningInventory` function is the orchestrator of the evidence-acceptance pipeline. It takes a proposed module set, optional path-role configuration, and optional flow candidates, and returns a `TopicPlanningInventory` — a filtered, deduplicated, and enriched snapshot of what the wiki actually contains on disk. The function works in four stages: it unions anchor evidence from file pages, assembles module records, collects flow records, and then filters everything through a single measurement pass that decides which anchors are truly "active."

The pipeline starts with module discovery. `buildTopicPlanningInventory` sorts the incoming modules by id and, for each, checks whether a canonical folder page exists at `livewiki/<id>/index.md`; if the file is missing, unreadable, or malformed, the module is skipped entirely. For a surviving module it parses the frontmatter and extracts the anchor keys via `getAnchors`, but a comment in the source notes issue #29: anchors actually live on the *file pages* inside the folder's wiki directory, not on the folder page itself, which is an anchor-less synthesis. So the function lists every other `.md` file in `livewiki/<id>/`, parses each one's frontmatter, and unions all those anchors into the same array. Disk is the truth here — a failed file task leaves no page and contributes no evidence. The merged list is deduplicated and sorted by `uniqueSorted`, which takes a readonly array of strings, trims each value, drops empties, removes duplicates via a `Set`, and returns the sorted result.

```ts
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}
```

Before constructing the module record, the function assigns each anchor a path role. For every unique anchor it splits the key at the `#` to recover the source path, then calls `classifyPathRole` (with the optional `pathRoleConfig`) and stores the result in the shared `anchorRoles` map. Then it builds the record itself, pulling the title from frontmatter (falling back to the module id if absent), the sorted paths, and the role, along with several derived fields computed from the body and paths. The body-derived fields are:

- **Responsibility** — from `extractOpeningSentence(parsed.body)`, which strips a leading H1, takes the first paragraph, collapses whitespace, and returns `null` if there is no paragraph or if that paragraph is itself an H2.
- **When-to-use bullets** — from `extractSectionBullets(parsed.body, "When to use this page")`, which finds the matching `##` section (with the title regex-escaped) and collects every `-` or `*` list item under it.
- **Section titles** — from `extractH2Titles(parsed.body)`, a simple regex scan for all `##` headings.
- **Signals** — from `classifyTopicSignals(module.paths, parsed.body)`, which builds a lowercase "haystack" by joining the paths and the H2 titles, then runs five keyword regexes against it to tag the module as `configuration`, `persistence/state`, `validation/recovery`, `output`, and/or `entry/boundary`.
- **Import neighbors** — computed from the `edges` option by flat-mapping each edge to the other endpoint when the module is on either side.

After all modules are built, the flow stage mirrors the module logic but for `livewiki/flows`. The function lists `.md` files there (excluding `index.md`), derives each slug from the filename, skips any slug not in `allowedFlowSlugs` when that set is provided, and requires a matching diagram at `livewiki/diagrams/flow-<slug>.mmd`. Each eligible file is parsed; its frontmatter must include a string `title` and an array `modules`. Anchors are gathered the same way and any not already in `anchorRoles` get a path role. The record is completed with `flowCandidates` data looked up by slug — entry, boundary, and sink keys plus declared signals. Invalid pages are swallowed and simply left out of the plan.

The final stage is the acceptance filter. The function calls `measureTopicAnchorEvidence` with every anchor key seen anywhere, which opens the SQLite index at `.livewiki/index.db` and queries for active symbols matching those keys:

```ts
export async function measureTopicAnchorEvidence(repoRoot: string, keys: string[]): Promise<TopicAnchorEvidence> {
```

This function takes a repository root and the anchor keys, and returns a `TopicAnchorEvidence` object holding two maps: `anchorSourceChars` (key → character count) and `anchorRationaleRows` (file path → rows of rationale evidence). It early-returns empty maps if `keys` is empty. Otherwise it joins the `symbols` and `files` tables to get each active symbol's source path and line span. For each row it lazily reads the source file once and caches the split lines in a `Map`, then calls `renderTopicSourceSpan` to compute the character length of the span. That helper takes a symbol object plus its file's lines and produces a comment-bordered excerpt, padding the start down by 6 lines and the end up by 10 (clamped to file bounds), and joins it with the `TOPIC_SOURCE_SPAN_SEPARATOR` constant — which is simply two newlines, though in practice the separator's role is carried by the comment banner itself.

```ts
export function renderTopicSourceSpan(
  symbol: { key: string; path: string; startLine: number; endLine: number },
  lines: readonly string[],
): string {
```

Given the symbol's key, path, and line range plus the file's line array, this function builds a fenced quote-style excerpt — a comment line naming the key and location, followed by the sliced lines joined with newlines — and returns that string; its length is what counts as the anchor's "source character" weight. For rationale evidence, the function collects the distinct paths from the matched rows, queries the `rationales` table for rows in those files, groups them per path, and returns everything in the `TopicAnchorEvidence`.

Back in `buildTopicPlanningInventory`, the returned `anchorSourceChars` map is treated as the authoritative set of *accepted* anchors. Any module anchor not present in that map is filtered out, and the same filtering is applied to flow anchors, with entry/boundary/sink keys additionally constrained to the flow's surviving anchor set. Finally, `anchorRoles` is pruned to only the active keys, and the function returns the inventory with all four pieces: filtered modules, filtered flows, active roles, and the measurement maps that justify the acceptances.

## Stable Inventory Serialization for the Planner Prompt
<!-- lw:anchors packages/core/src/topics.ts#serializeTopicPlanningInventory -->

`serializeTopicPlanningInventory` is the final stage of the inventory-building pipeline: it converts the fully assembled `TopicPlanningInventory` into a deterministic, human-readable string that gets embedded directly into the planner prompt. The function takes the inventory object and returns a JSON string with indentation:

```typescript
export function serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string {
  return JSON.stringify({ modules: inventory.modules, flows: inventory.flows, anchorSourceChars: inventory.anchorSourceChars }, null, 2);
}
```

In plain terms, it accepts a structured inventory and returns a formatted text representation of its contents.

The function operates in a single `JSON.stringify` call that selects exactly three fields from the inventory — `modules`, `flows`, and `anchorSourceChars` — and serializes them with a two-space indent. This explicit field selection is deliberate: it guarantees that only the data the planner needs reaches the prompt. The `modules` array lists every topic module; `flows` captures the cross-module execution sequences; and `anchorSourceChars` provides the stable character-position anchors that let the planner reference exact source locations. Together these three fields give the planner a complete, self-contained map of the topic system without pulling in incidental metadata or runtime state.

The `null` second argument disables any value transformation, and the `2` indentation produces a multi-line layout that is easy for the planner to scan. That readable formatting matters for the prompt's role as a lingua franca between the inventory-building code and the language model — the model parses the serialized structure more reliably when it is properly spaced and nested. The output is deterministic because the inventory fields are already ordered by the steps that built them, so the same source tree always yields the same prompt text, which keeps planning results reproducible across runs.

## Source Budget Estimation Shared with the Generator
<!-- lw:anchors packages/core/src/topics.ts#estimateTopicSourceChars -->

The `estimateTopicSourceChars` function is the shared arbiter of "how big will this topic really be?" for both planning-time and generation-time code paths. The topic-driven source budget must stay identical no matter which side of the pipeline asks, so this single function encodes the rule and both callers invoke it. Its job is to predict the exact character count a generated topic block will occupy in the final Markdown, given a set of keyed anchors and a planning inventory, plus (optionally) evidence rows rendered from rationale content.

`export function estimateTopicSourceChars(keys: readonly string[], inventory: TopicPlanningInventory, rationaleMaxChars = 0): number` — it takes a list of anchor keys to include, the planning inventory that holds measured source sizes, and an optional cap on rationale characters; it returns a predicted total character count.

The function proceeds in four distinct steps. First, it filters the supplied `keys` down to those that actually have a measured size in the inventory: `keys.filter((key) => inventory.anchorSourceChars[key] !== undefined)` yields the `measured` array. When nothing is measured — meaning no anchor in the requested set has known source-length data — the function short-circuits and returns `0`, because there is no basis for any estimate. This guard keeps callers from fabricating a nonzero budget for anchors whose sizes were never recorded during planning.

Second, the function sums the measured sizes: `measured.reduce((sum, key) => sum + inventory.anchorSourceChars[key]!, 0)` accumulates each anchor's recorded character count. The non-null assertion is safe here precisely because the preceding filter already established that every key in `measured` has a value in `inventory.anchorSourceChars`. This base total represents the raw source the anchors themselves will occupy when emitted together.

Third, it adds the separator overhead: `TOPIC_SOURCE_SPAN_SEPARATOR.length * (measured.length - 1)`. Between every pair of adjacent anchors in the emitted sequence there is exactly one separator character span (for example, whitespace or punctuation that delineates two anchors in the source), so `(measured.length - 1)` accounts for the gaps between `measured.length` anchors. This subtlety matters — without it, the budget would undercount every multi-anchor topic and the planner could misjudge whether the topic fits its allotted space.

The final step handles optional rationale evidence. When `rationaleMaxChars > 0`, the function derives the distinct file paths from the measured keys by splitting each key on `"#"` and taking the filename prefix (`key.split("#", 1)[0] ?? ""`), de-duplicating via a `Set`, and sorting for deterministic ordering. For each such path it looks up the pre-rendered rationale rows in `inventory.anchorRationaleRows?.[path]` (using `flatMap` so missing entries contribute nothing), then calls `renderRationaleEvidence(rows, rationaleMaxChars)` to render those rows into a single string. The length of that rendered string is added to the running total, producing the final predicted character count that the function returns.

Because the same estimate is used by the generator for deciding how a topic maps onto a target budget, and by the source-budget planner for laying out or trimming topics, any change to the estimation rule propagates consistently across both stages — the shared function is what keeps their two views of topic size from ever diverging.

## Deterministic Module Clustering from the Import Graph
<!-- lw:anchors packages/core/src/topics.ts#clusterModulesByImportGraph packages/core/src/topics.ts#capClusterSize -->

`clusterModulesByImportGraph` is the entry point that turns a flat module inventory into ordered topic clusters. It accepts a `TopicPlanningInventory` and returns a `TopicModuleCluster[]`, where each cluster groups product modules (the topics a writer will actually produce) with the auxiliary modules they depend on, so downstream planning sees self-contained units.

```ts
export function clusterModulesByImportGraph(inventory: TopicPlanningInventory): TopicModuleCluster[] {
```

The algorithm proceeds in distinct phases. **Phase one — isolate product modules and build the import adjacency.** The function filters `inventory.modules` to only those with `role === "product"`, then builds a `Map` from each product module id to the ids of its product-only neighbors. It filters out self-imports and modules outside the product set, so the graph only ever connects product modules to each other. This deliberately ignores auxiliary modules at this stage, because the goal is to find communities of *topics* first, then attach dependencies later.

**Phase two — find connected components with BFS.** The function iterates over product ids in sorted order (this determinism matters, see below) and runs a breadth-first search over the product adjacency. Every unvisited id seeds a queue; the search drains the queue, collecting ids into a component and enqueuing any unvisited product neighbors. When the queue empties, that component is sorted and pushed onto `components`. The result is a list of disjoint sets of product modules that are transitively connected by imports — a coarse community structure.

**Phase three — split components into multi-module groups, singletons, and then spoke groups.** Components with two or more members become candidates for their own cluster; those with exactly one node become "singletons". But a singleton isn't necessarily isolated in the real world — it may share a common auxiliary dependency with other singletons. So the function computes, for each singleton, the set of *auxiliary* modules it imports (its non-product, non-self neighbors). Two singletons are considered to "share a spoke" if their auxiliary neighbor sets overlap. The function then runs a union-find over singletons, merging any pair that shares an auxiliary neighbor. The resulting groups of size >= 2 form `spokeClusters`; the leftover singletons that weren't merged with anyone become `remainder`. This is the heuristic that captures the real-world case where several small product modules all load the same utility library — they're topically related even though they don't import each other directly.

**Phase four — attach auxiliary modules to each group.** `auxiliaryModules` is every module that isn't a product. For a given list of product module ids, `attachAuxiliary` collects every auxiliary module that imports at least one member of that product set, sorts those auxiliary ids, and builds a cluster. The `origin` tag marks clusters that came from spoke-sharing or the overview remainder, so the caller can distinguish these heuristic merges from pure connected components. Multi-module components get no `origin` tag; spoke clusters get `"spoke"`; the remainder (if it has at least two members) gets assembled as one `"overview"` cluster.

**Phase five — enforce size caps and sort deterministically.** Every cluster — whether from `multi`, `spokeClusters`, or `remainder` — passes through `capClusterSize` before being added to the result. The final list is sorted by the first product module id of each cluster, and within each phase the inputs were sorted at every step (component members, singleton lists, spoke group members, auxiliary ids). The combination of those sorts with the sorted output means the whole function is a pure function of its input — the same inventory always yields the same cluster order, which is essential for diff-friendly output in planning documents.

`capClusterSize` is the local trimmer that keeps any single cluster from ballooning into an unmanageable planning unit. It accepts a `TopicModuleCluster` and returns a possibly smaller `TopicModuleCluster` with the same fields. Its rule: a cluster may hold at most six modules total. The first `while` loop drops auxiliary modules from the end of their list (they were sorted, so these are alphabetically last) until the total is within limit or no auxiliaries remain. The second loop then spills over into trimming product modules — but only down to two. The `productModuleIds.length > 2` guard means a cluster with a single product module and one auxiliary can never be shrunk below its essential content; the planner must handle whatever size remains. The function returns the trimmed id lists, losing the `origin` tag in the process (hence `attachAuxiliary` re-adds it afterward).

## Concern-Grouped Topic Clusters for Deployment and Testing
<!-- lw:anchors packages/core/src/topics.ts#DEPLOYMENT_PATH_PATTERNS packages/core/src/topics.ts#collectConcernTopicClusters -->

`collectConcernTopicClusters` is the mechanism that turns a flat `TopicPlanningInventory` of modules into grouped topic clusters by concern. It consumes inventory modules tagged with a role, builds clusters of product and auxiliary modules, and returns deterministic metadata used for the topic's title and intent.

The deployment-focused `DEPLOYMENT_PATH_PATTERNS` constant lists glob patterns that match deployment-related artifacts — Dockerfiles, docker-compose files, Windows batch/PowerShell scripts, and `scripts`/`deploy` directories — and serves as a candidate source for identifying modules of that concern.

The function `export function collectConcernTopicClusters(` takes a `TopicPlanningInventory` and returns an array of objects each with `cluster`, `title`, `intentSignal`, and `surfaces`.

The implementation walks through predefined concern-group rules, filtering modules that match each rule, and performs several passes to classify modules:

1. It identifies all "product" modules (those whose role is "product") across the inventory, then filters the matched modules down to those product IDs. If none of the matched modules are products, it looks for product modules whose import neighbors include any matched module — a fallback that still locates a product anchor for the concern.
2. Once a product set is established, it derives "auxiliary" modules: matched modules that are not products but import from at least one product in the set. These auxiliary modules support the product and belong to the same concern cluster.
3. The function computes a list of surface names — basenames of files matched by the rule (e.g., `Dockerfile`, `docker-compose.yml`) — deduplicates and sorts them, and keeps at most four. These surfaces provide concrete evidence for the concern's intent and are used to build a deterministic title; the inline comment notes that a deployment topic would otherwise be titled too generically and miss Docker-related wording, so the surfaces name the concern in the generated intent.
4. For each concern that produced at least one product module, it pushes a result containing the modular cluster (sized via `capClusterSize`, with origin marked `"concern"`), the rule's title and intent signal, and the surfaces. Empty matches are skipped entirely.

The result is stable ordering of concern clusters, each guaranteed to have an anchor product and its supporting modules, with deterministic naming based on the actual files that triggered the match.

## Anchor Selection with Group Floors and Product Ratio
<!-- lw:anchors packages/core/src/topics.ts#selectTopicAnchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES -->

The `selectTopicAnchors` function is the decision engine that turns a raw cluster of candidate topics into a final, balanced set of anchors grouped by their `TOPIC_GROUP_NAMES` categories. `TOPIC_GROUP_NAMES` is defined as the constant array `["contract", "state", "output", "failure"]`, which fixes the order in which groups are processed and guarantees that every returned `TopicKeyGroups` object always has all four keys present.

The selection mechanism operates in three distinct phases: flattening, floor assignment, and ratio-driven expansion.

```ts
export function selectTopicAnchors(
  cluster: TopicModuleCluster,
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: { maxAnchors: number; maxSourceChars?: number; minimumProductAnchorRatio?: number; rationaleMaxChars?: number },
): TopicKeyGroups | null
```

`selectTopicAnchors` takes a cluster of modules, a planning inventory, a centrality map, and options, and returns a grouped set of topic keys or `null`. In plain terms: give it the modules you care about, the universe of candidate topics with their metadata, and a score for each topic, and it tells you which topics become anchors, categorized by group.

**Phase 1 — Flattening the cluster into entries.** The function first gathers the union of product and auxiliary module IDs from the cluster, builds a lookup map from those IDs to their module objects, and reads the minimum product-anchor ratio from options (defaulting to `0.75`). It then iterates over each module in the cluster and, for every module whose ID resolves in the inventory, derives a "dominant group" by scanning the module's signals through a `SIGNAL_TO_TOPIC_GROUP` map and taking the first signal that maps to a non-undefined group, or `null` if none do. For each anchor key in that module (sorted for deterministic order), the code deduplicates against a `seenKeys` set and pushes an `Entry` record capturing the key, the dominant group, the source-character count from the inventory, whether the anchor is marked as a product anchor, and its centrality score. If no entries survive this pass, the function returns `null` immediately — an empty cluster cannot produce anchor groups.

**Phase 2 — Assigning one floor pick per group.** The entries are bucketed into per-group lists (one list per name in `TOPIC_GROUP_NAMES`) plus a separate `unclassified` list for entries whose dominant group was `null`. A comparator, `rank`, orders any two entries by descending centrality, then ascending character count, then alphabetical key as a final tiebreaker. Each group's list and the unclassified list are sorted with this comparator. The function then walks the `TOPIC_GROUP_NAMES` order and, for each group, chooses its best entry: first from that group's own bucket (an entry not yet picked), falling back to the best unclassified entry, and finally to the single highest-ranked entry across *all* entries regardless of bucket. This fallback chain is deliberate — real clusters often concentrate anchors in just one or two signals, so the code guarantees each group gets at least one pick even if its own bucket is empty, while the earlier groups' floor picks ensure those leftovers never starve a later group. If no entry can be chosen at all, the function returns `null`.

**Phase 3 — Ratio-gated expansion.** After securing the four floor picks, the function enters a loop that fills capacity up to `opts.maxAnchors`. It builds a combined pool per group (the group's own remaining entries plus the unclassified entries, ranked), then repeatedly scans groups in `TOPIC_GROUP_NAMES` order. For each group, it takes the top unpicked entry from that group's pool and evaluates two candidate-aware constraints before committing. First, it computes the *exact* source-character estimate for the would-be expanded set by calling `estimateTopicSourceChars` on the picked keys plus the new key — this is an exact total (spans, separators, and the rationale block) rather than an incremental sum, because the rationale block is bounded per file set with a global cap, so adding one anchor does not add a full rationale block's cost. If the estimate exceeds `opts.maxSourceChars` (when set), the entry is skipped. Second, it checks the product ratio: after tentatively incrementing both the total count and the product count (if the entry is a product anchor), it requires `nextProduct / nextTotal` to be at least the `minimumRatio`; otherwise the entry is rejected. Entries that pass both checks are added to the picked set and pushed into their group's result array, and the loop sets `progressed` to `true` so it revisits earlier groups on the next pass — a single failed entry earlier in the group list may succeed later once the ratio ceiling has shifted. The loop terminates when no progress is made in a full sweep or the total reaches the anchor cap. Finally, if the total picked count is under five — fewer than the group count plus one, which would make the grouping meaningless — the function returns `null`; otherwise it returns the populated `TopicKeyGroups` object.

## Deterministic Planner Orchestration and Whole-Batch Validation
<!-- lw:anchors packages/core/src/topics.ts#proposeTopicPlanDeterministically packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#assignTopicKeySections packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.ts#normalizeLabel -->

The relationship between `proposeTopicPlanDeterministically` and `validateTopicPlan` forms the core of this file's contract: the former generates a batch of topic proposals that must be shaped as valid JSON before the latter can scrutinize them. `proposeTopicPlanDeterministically` begins by computing import clusters from the inventory and builds a map for module lookup. It then constructs a `selectOpts` object that carries over the caller's validation options (such as anchor limits and source-character budgets) so that anchor selection happens against the same constraints that validation will later enforce.

```ts
export function proposeTopicPlanDeterministically(
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: TopicPlanValidationOptions,
): TopicCandidate[]
```
This function takes the inventory of modules and flows, a centrality map used for anchor selection, and the validation options, then returns a list of validated topic candidates.

The function iterates over clusters, calling `selectTopicAnchors` for each to obtain groups of anchors. When a cluster yields groups, it derives a title: an overview-style title if the cluster originates from an overview, otherwise a combination of the first two product module titles. The intent string summarizes how many modules coordinate around the dominant signal from the cluster's product modules. For each cluster it also calls `flowsWithin` to find flows whose modules are entirely contained in the cluster, sorting and truncating to at most two. Each completed proposal carries its title, intent, sorted module list, flows, and anchor groups.

After the import clusters, the function handles concern-grouped candidate construction signaled as the D2 stage. When `opts.concernTopics` is not explicitly disabled, `collectConcernTopicClusters` yields additional clusters representing cross-cutting concerns like deployment or testing. Each of these goes through the same anchor selection and produces a proposal whose intent appends any surface names. Both the title and intent are truncated at the budget, mirroring the cluster-based proposals. A `concernProposalSet` tracks these constructed proposals so that their provenance can be restored after validation.

The merged proposal list is sliced to `opts.maxTopics` before validation. This matters because `validateTopicPlan` rejects an oversized plan entirely with no proposal index on the error; slicing earlier preserves the valid prefix instead of discarding everything.

The deterministic retry loop then serializes the proposals as JSON and hands the string to `validateTopicPlan`. The retry loop is the heart of the deterministic planner. On each iteration it converts the current proposals to a JSON object with a single `topics` property, validates that JSON, and inspects the result. Validation succeeds, the candidates are returned after re-tagging any that originated from concern groups: since `toCandidate` captures `planOrder` as the index within the validated proposals array, the planner can map each candidate back to its source proposal and, when that source is in `concernProposalSet`, set the candidate's `origin` to `"concern"`. When validation reports errors that carry proposal indexes, the planner removes exactly those proposals and tries again — a form of iterative refinement that strips only the offending entries. If validation fails with no proposal-level errors (meaning the entire payload was malformed or empty), the planner returns no candidates at all.

`validateTopicPlan` is what gives the deterministic retry loop its power: it inspects an entire batch of proposals at once, not each in isolation.

```ts
export function validateTopicPlan(
  raw: string,
  inventory: TopicPlanningInventory,
  opts: TopicPlanValidationOptions,
): TopicPlanValidationResult
```
This function accepts the raw JSON text from the planner, the inventory against which references are checked, and the options that bound sizes and ratios, returning either success with candidate topics or failure with a list of errors.

The first structural gate is parsing. `stripOuterJsonFence` handles planners that wrap output in markdown code fences before handing the string to `JSON.parse`; if parsing throws, the function returns early with a generic JSON error rather than proposal-specific codes.

```ts
function stripOuterJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1]?.trim() ?? trimmed;
}
```
This helper removes a surrounding triple-backtick fence (with optional `json` language tag) and returns the inner content, or the original trimmed string if no fence pattern matches.

Once `value` exists, the function normalizes the outer shape: a top-level array counts as the topic list, while an object must contain exactly one key, `topics`, whose value is an array. Any extra top-level keys trigger a shape error. Empty arrays and arrays exceeding `opts.maxTopics` both fail immediately and terminate validation.

The supportive lookups are prepared before the per-proposal loop: `moduleById` maps module IDs to their evidence, `flowBySlug` maps flow slugs, and `knownAnchors` is the union of every anchor declared across modules and flows. Each topic in the raw array goes through `parseProposal`, which is the structural validator for one candidate object.

```ts
function parseProposal(value: unknown, index: number, errors: TopicPlanValidationError[]): TopicPlanProposal | null {
```
This function checks whether an unknown value is a well-formed proposal object, accumulating a shape error and returning `null` when it is not, otherwise returning the normalized proposal.

`parseProposal` first confirms the value is a non-null, non-array object via `isRecord`; then it rejects any keys beyond the allowed set of `title`, `intent`, `modules`, `flows`, and `groups`. Each required field is type-checked: `title` and `intent` must be non-empty strings, `modules` and `flows` must be string arrays per `isStringArray`, and `groups` must be a record. The group names themselves must match the fixed `TOPIC_GROUP_NAMES`, and each group's value must be a string array. Values are copied into fresh arrays, and title and intent are trimmed so that later comparisons see consistent text.

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
```
This type guard confirms a value is a plain object — not null and not an array.

```ts
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}
```
This type guard confirms a value is an array of non-empty (after trimming) strings.

Back in the loop over raw topics, each successfully parsed proposal undergoes a battery of budget and consistency checks. Text budget enforcement rejects titles over 80 characters or intents over 160, and also forbids newlines anywhere in either. Duplicate entries within the modules, flows, or grouped anchor lists are caught by comparing the lengths of the de-duplicated versions against the originals, since an anchor is allowed to appear in exactly one group. Reference integrity is the next gate: every module ID must exist in the inventory, every flow slug must correspond to a real flow, and every anchor key must be among the known anchors; violations collect in a single error listing all unknown references. Anchors that are known but not reachable from any selected module or flow are reported as unscoped, meaning the proposal cites evidence outside the chosen content. Module count rules enforce a broad band of two to six modules unless a single module partners with a flow spanning at least three modules. At least two product-role modules are required unless such a wide flow exists, and at least one product module is mandatory. Auxiliary modules must each be an import neighbor of some selected product module; otherwise they are disconnected from the topic's narrative.

Anchor abundance drives successive checks: between 5 and `opts.maxAnchors` unique anchors are required, and the source characters estimated from those anchors must stay within `opts.maxSourceChars` when that option is set. Every named group must be non-empty, and the proportion of product-role anchors must reach `opts.minimumProductAnchorRatio` (defaulting to 0.75). If any check fails, `errorAt` constructs an error tagged with the proposal's index, which is what enables the retry loop to drop exactly the bad proposal.

```ts
function errorAt(code: TopicPlanValidationCode, proposalIndex: number, message: string): TopicPlanValidationError {
  return { code, proposalIndex, message };
}
```
This factory creates a validation error carrying a machine-readable code, the index of the offending proposal, and a human-readable message.

Each proposal is pushed into the `parsed` array only after this gauntlet, and it is stored with de-duplicated modules, flows, and normalized groups. `normalizeGroups` applies `uniqueSorted` per group to produce deterministic orderings.

```ts
function normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups {
  return {
    contract: uniqueSorted(groups.contract),
    state: uniqueSorted(groups.state),
    output: uniqueSorted(groups.output),
    failure: uniqueSorted(groups.failure),
  };
}
```
This helper orders the anchors within each of the four evidence groups and removes duplicates, returning a fresh groups object.

After the per-proposal loop, validation shifts to batch-level concerns that span multiple proposals. Duplicate titles and intents are detected across the whole batch using `normalizeLabel` as a canonical key so that minor punctuation or diacritic differences do not defeat the check. `addDuplicateError` records the first occurrence and reports each later duplicate against that earlier index.

```ts
function addDuplicateError(
  seen: Map<string, number>,
  value: string,
  index: number,
  code: "topic_plan_duplicate_title" | "topic_plan_duplicate_intent",
  label: string,
  errors: TopicPlanValidationError[],
): void {
```
This function consults the map of already-seen normalized values, appends a duplicate error at the current index when the value was previously seen, and otherwise records the current index as the first occurrence.

```ts
function normalizeLabel(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
```
This normalizer strips diacritics via NFKD decomposition, lowercases the result, collapses non-alphanumeric runs into single spaces, and trims the edges.

Overlap between any pair of proposals is the final batch check. For each unordered pair, the function collects all anchors across every group into a set and computes the size of their intersection divided by the smaller set's size. When that ratio exceeds `opts.maximumOverlapRatio`, the proposal considered less valuable must be the one to fail. `compareProposalPreference` decides which of the pair is preferred by scoring first on the number of non-empty groups (more is better), then on the count of product modules (again, more is better), and finally by lexicographic order of the normalized titles.

```ts
function compareProposalPreference(
  left: TopicPlanProposal,
  right: TopicPlanProposal,
  moduleById: ReadonlyMap<string, TopicModuleEvidence>,
): number {
```
This comparator returns a negative value when the left proposal is preferred, a positive one when the right is preferred, and zero on a tie — using signal availability, product-module breadth, then title ordering to break ties.

The loser's index gets the overlap error, and because that index is recorded, the planner retry loop can drop either the left or the right proposal based on this preference.

A tally of any errors at all short-circuits validation with `{ ok: false }` and accumulates those errors. Otherwise each parsed proposal converts to a final candidate through `toCandidate`.

```ts
function toCandidate(proposal: TopicPlanProposal, planOrder: number): TopicCandidate {
```
This function widens a validated proposal into a full topic candidate by adding a content hash, a deterministic slug, and a flat list of seed keys.

`toCandidate` re-normalizes the groups, then serializes modules, flows, and groups into a JSON string and takes the first 12 hex characters of its SHA-256 digest as `evidenceHash`. The slug derives from a module-style slug of the title, falling back to `"topic"`, and then appends the first 8 characters of the evidence hash so the slug uniquely identifies the exact evidence content while remaining readable. A flat `seedKeys` array collects every anchor from all groups in sorted, de-duplicated order, which downstream content-assembly steps can consume directly. `planOrder` records the candidate's index in the validated proposals array; that is exactly what `proposeTopicPlanDeterministically` uses to re-tag concern candidates.

Finally, a separate exported helper assigns each seed key to a named documentation section so the page builder knows where each anchor's content belongs.

```ts
export function assignTopicKeySections(candidate: TopicCandidate): TopicKeySectionMap {
```
This helper takes a topic candidate and returns a map from anchor keys to the wiki section that should hold their content.

`assignTopicKeySections` walks each of the four groups — `contract`, `state`, `failure`, `output`. The first anchor of the contract group becomes the page's purpose statement; the others are behavioral contract details. The first anchor of the state group sets when-to-use guidance; the remaining state anchors broaden the contract. The first failure anchor names the failure-and-recovery section while later ones remain in the contract. The first output anchor marks the change map with its siblings in the contract. Any seed key that never landed in the four groups — which should be rare given how `selectTopicAnchors` operates — receives a behavioral-contract home as a safety net, since even a stray key needs a deterministic place in the final page.

## Mechanical Source-Budget Repair for Over-Sized Proposals
<!-- lw:anchors packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically -->

`repairTopicPlanSourceBudgetMechanically` is the last-resort repair pass for a topic plan that failed validation because one or more proposals exceed the allowed source-budget. It runs only when `validateTopicPlan` has already reported errors, so its job is to bring a plan back under the character ceiling without touching anything that is already valid. The function takes the raw plan text, the list of validation errors, the topic-planning inventory, and the validation options, and it returns either a repaired document plus a fresh validation result, or `null` when no mechanical repair is possible.

Its first decisions are all guards: it bails out immediately if there were no errors, if `opts.maxSourceChars` is undefined (meaning there is no budget to enforce), or if the raw text cannot be parsed as JSON after `stripOuterJsonFence` removes any outer fence. When the parsed value is an object with a `topics` array — or the array itself — the function collects the proposals. From the errors it builds `flaggedIndexes`, a set of proposal indexes whose error code is `topic_plan_source_budget`; if none exist there is nothing to repair and it returns `null`. It also reads `minimumProductAnchorRatio` from options, defaulting to `0.75`, which will govern how many product anchors may be dropped.

For each flagged proposal, the function inspects the proposal’s `groups` record (returning `null` on malformed shapes) and walks every group name in `TOPIC_GROUP_NAMES`, collecting each anchor key into an `entries` array together with its character count from `inventory.anchorSourceChars` and a boolean marking product anchors. It then calls `estimateTopicSourceChars` over all those keys to get the current `totalChars`; if that already fits under `maxSourceChars`, the proposal needs no work and the loop moves on. Otherwise it enters the dropping logic, which is deliberately conservative: `canRemove` refuses to shrink a group below one remaining key, refuses to drop below five total keys, and — for product anchors — checks that the ratio of remaining product anchors to remaining keys stays at or above `minimumRatio`. The `dropPass` helper sorts a pool of entries by character count descending and removes the largest first, but critically it recomputes the exact estimate after each removal because the rationale block’s per-file-set cap makes marginal costs non-additive. The function runs `dropPass` over non-product entries first, then over product entries only if still over budget, and returns `null` if even that cannot fit — meaning the constraint is unsatisfiable without violating another rule.

After the drops for every flagged proposal, the function replaces each group’s key list with the surviving entries, serializes the whole structure back with `JSON.stringify`, and runs `validateTopicPlan` on the repaired text as a final sanity check. If that validation fails, the repair is considered a failure and `null` is returned; on success it returns both the repaired content string and the fresh validation result so the caller can use or present the corrected plan.

## Tests

Covered by `packages/core/src/topics.test.ts` (same-name test file on disk).
