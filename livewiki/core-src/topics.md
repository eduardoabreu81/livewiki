---
title: Topic planning
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

# Topic planning

Topic planning produces the closed set of cross-module topic pages that stage 5 of the livewiki pipeline generates, deriving every module, flow, and source-anchor identity deterministically from the already-accepted page inventory.

## When to use this page

- **Add** a new cross-cutting topic by extending the deterministic plan with an extra concern group (e.g. a new deployment-like surface) or by widening the anchor-evidence budget in `TopicPlanValidationOptions`.
- **Diagnose** why a topic candidate was rejected or trimmed — `topic_plan_unknown_reference`, `topic_plan_auxiliary_disconnected`, `topic_plan_anchor_overlap`, `topic_plan_source_budget`, and the `topic_plan_*` validation codes emitted by `validateTopicPlan` map back to specific steps here.
- **Reconcile** the planner-side source-char estimate against the generator-side `buildTopicDocContext` block — `renderTopicSourceSpan` and `estimateTopicSourceChars` are the shared math.
- **Tune** import-graph clustering rules — the D2 spoke/overview fallback in `clusterModulesByImportGraph`, the `capClusterSize` 6-module budget, and the deterministic title/intent construction in `proposeTopicPlanDeterministically`.

## How it fits

`packages/core/src/topics.ts` is the topic-planning module under `packages/core/src/`, the layer that turns accepted evidence into the structured plan that the generator batch loop then turns into prose. It sits between the inventory-building modules it depends on (`modules.ts` for `Module`, `PathRole`, `PathRoleConfig`, `classifyModuleRole`, `classifyPathRole`, and `matchesAnyPathPattern`; `frontmatter.ts` for `parseFrontmatter` and `getAnchors`; `flows.ts` for `FlowCandidate`; `db.ts` for `openIndex`; `hashes.ts` for `sha256`; `safe-io.ts` for filesystem reads; `rationale-evidence.ts` for the rationale block the generator also renders) and the LLM-planner call the batch driver makes: `validateTopicPlan` is what gates the LLM's JSON, while `proposeTopicPlanDeterministically` and `repairTopicPlanSourceBudgetMechanically` are the offline fallbacks that produce an equivalent `TopicCandidate[]` when the model refuses or converges on a bad batch.

The file owns the closed planner vocabulary (`TOPIC_GROUP_NAMES` — contract, state, output, failure — and `TOPIC_SOURCE_SPAN_SEPARATOR`), the shared evidence-span math between planner and generator (`renderTopicSourceSpan` / `estimateTopicSourceChars`), the inventory assembly (`buildTopicPlanningInventory` / `serializeTopicPlanningInventory`), the validation surface (`validateTopicPlan`, `parseProposal`, `toCandidate`, `normalizeGroups`, `compareProposalPreference`, `errorAt`, `addDuplicateError`, `isRecord`, `isStringArray`, `stripOuterJsonFence`), the deterministic clustering pipeline (`clusterModulesByImportGraph`, `capClusterSize`, `DEPLOYMENT_PATH_PATTERNS`, `collectConcernTopicClusters`, `selectTopicAnchors`, `assignTopicKeySections`, `proposeTopicPlanDeterministically`), the mechanical source-budget repair (`repairTopicPlanSourceBudgetMechanically`), and the per-page evidence helpers (`measureTopicAnchorEvidence`, `extractH2Titles`, `extractSectionBullets`, `extractOpeningSentence`, `classifyTopicSignals`, `uniqueSorted`, `normalizeLabel`).

## Inventory construction: closed, sorted evidence from accepted pages
<!-- lw:anchors packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#measureTopicAnchorEvidence packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#uniqueSorted -->

The inventory constructor begins by accepting pages as the single source of truth. `buildTopicPlanningInventory` takes a repository root, a list of modules, optional path-role and flow-slug filters, an import-edge list, and a map of flow candidates; it returns a `Promise<TopicPlanningInventory>` whose contents are derived strictly from the markdown files that already exist on disk and parse cleanly.

```ts
export async function buildTopicPlanningInventory(opts: {
  repoRoot: string;
  modules: Module[];
  pathRoleConfig?: PathRoleConfig;
  allowedFlowSlugs?: ReadonlySet<string>;
  edges?: ReadonlyArray<{ from: string; to: string }>;
  flowCandidates?: ReadonlyArray<FlowCandidate>;
}): Promise<TopicPlanningInventory>
```

In words: the function takes a repository root plus the planned modules, edges, and candidate flows, and returns an inventory object describing each accepted page.

The module pass sorts `opts.modules` by id so the inventory is stable, then for each module it asks `safeIo.exists` whether `livewiki/<id>/index.md` is present — a missing folder page is silently skipped, since "no page" means "no evidence." If the file is readable, the source is parsed through `parseFrontmatter`; any parse error or a missing frontmatter block again causes the module to be skipped. The module's path role is resolved with `classifyModuleRole`, and its title is taken from frontmatter when present and trimmed, falling back to the module id.

Anchors are gathered in two passes. First, `uniqueSorted(getAnchors(parsed.frontmatter))` reads the anchors declared on the folder page itself. Then the function resolves the sibling directory `livewiki/<id>` and, for every `.md` file other than `index.md`, attempts to read and parse it; any file that fails to parse or has no frontmatter contributes nothing. The union is run through `uniqueSorted` again so the final list is closed (no duplicates) and sorted. Each anchor key's path role is cached into `anchorRoles` via `classifyPathRole`, with later writes for the same key never overwriting an earlier classification — roles established while scanning modules are sticky.

```ts
function uniqueSorted(values: readonly string[]): string[]
```

`uniqueSorted` takes a list of strings, trims each value and drops empties, deduplicates with a `Set`, and returns the survivors sorted; it is the small helper that closes and orders every list of keys and paths in this section.

The body of the folder page is then mined for narrative evidence. `extractOpeningSentence` strips a leading `#`-level heading, splits on the first blank line, collapses whitespace, and returns the resulting paragraph unless it is empty or starts with `## ` (a section heading) — that rule keeps the "responsibility" field from accidentally holding the first H2.

```ts
function extractOpeningSentence(body: string): string | null
```

`extractOpeningSentence` takes the page body and returns the first non-heading paragraph as a single-line string, or `null` when the page only has headings.

The "When to use this page" bullets are pulled by `extractSectionBullets`, which locates an `## <title>` heading via a case-insensitive regex, captures everything up to the next `##` heading or end of document, and then walks the lines collecting `- …` / `* …` items, trimming each bullet.

```ts
function extractSectionBullets(body: string, title: string): string[]
```

`extractSectionBullets` takes the body and a section title and returns the trimmed list of bullet lines under that section, or an empty array if the section is absent.

The full structural outline of the page comes from `extractH2Titles`, a one-line scanner over lines beginning with `## `; each match's captured title is trimmed and the result is an array in document order, which doubles as the `sections` field on the module evidence.

```ts
function extractH2Titles(body: string): string[]
```

`extractH2Titles` takes the body and returns every `##` heading in source order, with surrounding whitespace removed.

`classifyTopicSignals` produces a small vocabulary tag set for the module: it joins the module's paths with the H2 titles (lowercased), and for each of five regex families — configuration, persistence/state, validation/recovery, output, entry/boundary — pushes the matching tag. The output is the intersection of "what this module's code paths are about" and "what its narrative sections talk about," without any scoring or ranking.

```ts
function classifyTopicSignals(paths: readonly string[], body: string): string[]
```

`classifyTopicSignals` takes the module's paths and body and returns a list of coarse signal labels drawn from a fixed vocabulary.

`importNeighbors` is derived purely from `opts.edges`: every edge whose endpoint matches the module id contributes the other endpoint, and the union is run through `uniqueSorted` so the neighbor list is closed and sorted.

The module record is then assembled with id, title, sorted paths, role, responsibility, when-to-use bullets, sections, closed anchor list, neighbors, and signals — all of which are themselves either arrays or primitive fields, never lazy references to disk.

The flow pass mirrors the same disk-truth policy against `livewiki/flows/`. For every `.md` page other than `index.md`, the slug is taken as the filename without extension; if an `allowedFlowSlugs` set was supplied, any slug not in it is skipped, and the function additionally checks for `livewiki/diagrams/flow-<slug>.mmd` on disk — a flow without its Mermaid diagram is not accepted evidence. After reading and parsing, pages without a string `title` or with a non-array `modules` field are dropped, and any parse failure is silently swallowed ("invalid pages are not accepted evidence and remain outside the plan").

For each accepted flow, `uniqueSorted(getAnchors(parsed.frontmatter))` closes and sorts the anchor list. New anchors that have not yet been seen by the module pass are routed through `classifyPathRole` and merged into `anchorRoles`, again without overwriting earlier classifications. The flow record then composes its `modules` field with `uniqueSorted(rawModules)` and pulls entry/boundary/sink keys and signal sets from the matching `FlowCandidate` supplied in `opts.flowCandidates`; absent candidates yield empty sets and an empty signal record, never invented values.

Once both passes have run, `measureTopicAnchorEvidence` is awaited to learn which anchor keys are still backed by an active symbol span in `.livewiki/index.db`. The function builds a parameterised SQL query over the `symbols` table, joins through `files`, and filters on `s.status = 'active'` for every key in one round-trip. Each row's source file is read once and cached in a `Map`, so multiple anchors in the same file only pay one read; the rendered span length (via `renderTopicSourceSpan`) is recorded as `anchorSourceChars[row.key]`. A second query pulls every rationale row whose file path is in the touched set, ordered by path then start line, and groups them under `anchorRationaleRows[path]` so that downstream planning can show the human-readable explanations next to their symbols. The database handle is closed in a `finally` block, and the function returns both maps even when no keys match — the empty case is handled up front.

```ts
export async function measureTopicAnchorEvidence(repoRoot: string, keys: string[]): Promise<TopicAnchorEvidence>
```

`measureTopicAnchorEvidence` takes the repo root and a list of anchor keys, and returns per-key rendered source-character counts together with the rationale rows for each touched file.

The final closure step is the "active filter": `activeKeys` is built from the keys actually present in `anchorSourceChars`, and the inventory is rebuilt so that every module's `anchors`, every flow's `anchors`/`entryKeys`/`boundaryKeys`/`sinkKeys`, and the `anchorRoles` map only retain keys that survived the measurement. This is the moment the inventory becomes "closed, sorted evidence from accepted pages" — anchors that point to vanished symbols, dropped flow pages, or unwritten file pages simply do not appear.

```ts
export function serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string
```

`serializeTopicPlanningInventory` takes the inventory and returns a pretty-printed JSON string containing only the modules, flows, and `anchorSourceChars` — the rationale rows and role map are intentionally excluded from the wire form, since the inventory is meant to be diffed as a planning artifact, not as a complete evidence record.

## Evidence span math shared with the generator
<!-- lw:anchors packages/core/src/topics.ts#renderTopicSourceSpan packages/core/src/topics.ts#estimateTopicSourceChars packages/core/src/topics.ts#TOPIC_SOURCE_SPAN_SEPARATOR -->

The shared span math is the bridge between the core's planning inventory and the generator that materializes topics, so two helpers do the work: one slices a window of source lines around a symbol and labels it, the other tallies how many characters those slices will consume once they are joined and have rationale appended.

`TOPIC_SOURCE_SPAN_SEPARATOR` is the glue string between adjacent spans, defined as the two-character sequence `\n\n`. It appears as a first-class constant because `renderTopicSourceSpan` only ever produces one labelled block, yet the planning layer needs to know exactly how much inter-block padding will be inserted when several blocks are concatenated. Centralizing the literal means cost estimates and rendered output stay aligned: the separator used in the final string is the same one `estimateTopicSourceChars` charges for.

```ts
export function renderTopicSourceSpan(
  symbol: { key: string; path: string; startLine: number; endLine: number },
  lines: readonly string[],
): string
```

`renderTopicSourceSpan` takes a symbol descriptor (its key, file path, and one-based start and end line numbers) together with the full line array of its containing file, and returns a single labelled string slice ready to be embedded in a topic prompt. It starts by clamping the visible window: the beginning is the symbol's first line minus six (so callers get a little context above the declaration), floored at zero; the end is the symbol's last line plus ten, capped at the total line count. The `Math.max(0, …)` and `Math.min(lines.length, …)` pair turns the request into a safe `slice` range, which is what the function then extracts and joins with single newlines. The returned string opens with a banner of the form `// === <key> (<path>:<start+1>-<end>) === <NL>`, where the reported start is `start + 1` so the header lines up with the original 1-based line numbers rather than the 0-based slice indices. The whole block is therefore self-describing: a reader of the generated topic sees which symbol this evidence belongs to and the inclusive line range it covers, and the planner can index into it by the same line numbers it stored.

```ts
export function estimateTopicSourceChars(
  keys: readonly string[],
  inventory: TopicPlanningInventory,
  rationaleMaxChars = 0,
): number
```

`estimateTopicSourceChars` takes the list of symbol keys the topic will include, the `TopicPlanningInventory` produced by earlier planning, and an optional `rationaleMaxChars` budget, and returns the total character count those evidence spans will occupy once rendered. It splits the requested keys into two groups: the ones whose `inventory.anchorSourceChars[key]` was actually measured, and any that were not. Only the measured keys drive the estimate; if none were measured the function short-circuits to `0`, which is the signal that planning has nothing to budget for. For the measured subset, it sums the per-symbol character counts and then adds `TOPIC_SOURCE_SPAN_SEPARATOR.length * (measured.length - 1)` to account for the blank line that will sit between each adjacent span. The minus one is intentional: a separator is placed *between* blocks, so `N` blocks incur `N - 1` separators.

When `rationaleMaxChars` is greater than zero, the function also charges for the rationale evidence that will be appended alongside the spans. It derives the unique file paths from the measured keys by splitting each key on `#` and taking the first segment, deduplicates and sorts them, then flattens `inventory.anchorRationaleRows` across those paths into a single row list. That list is fed to `renderRationaleEvidence(rows, rationaleMaxChars)`, and the resulting string's length is added to the running total. The sum of measured span characters, separators, and (optionally) rendered rationale is what the caller uses to decide whether the planned topic fits within its evidence budget before any actual rendering is attempted.

## Type guards and error helpers
<!-- lw:anchors packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#normalizeGroups -->

At the bottom of `topics.ts` sits a small utility layer that every validation routine above depends on. It does not decide policy on its own; instead it provides the safe predicates, error constructors, and string-canonicalization primitives that the rest of the module composes. Reading these helpers in the order they appear in the source shows the pipeline the validators rely on.

The earliest helper is the structural predicate `isRecord`. Its signature is `function isRecord(value: unknown): value is Record<string, unknown>`. In plain terms it takes any unknown runtime value and tells the caller whether that value is a plain non-array, non-null object suitable for property access. The body checks three things in sequence: the value is not `null`, its `typeof` is `"object"`, and it is not an array. Only when all three hold does TypeScript treat the input as a `Record<string, unknown>`, which is the precondition every later step needs before reading keys.

Right next to it sits `isStringArray`, with the signature `function isStringArray(value: unknown): value is string[]`. It returns `true` only when the input is a real `Array.isArray` collection whose every element is a non-empty trimmed string. The `value.every` walk also rejects blanks via `item.trim() !== ""`, so callers can rely on the fact that anything passing this guard is a list of meaningful labels with no stray whitespace or non-string slots.

The error layer begins with the factory `errorAt`, declared as `function errorAt(code: TopicPlanValidationCode, proposalIndex: number, message: string): TopicPlanValidationError`. It takes a validation code, the zero-based index of the offending proposal, and a human message, and returns the canonical `TopicPlanValidationError` shape `{ code, proposalIndex, message }`. Every error in the file is built through this single constructor, which keeps the shape uniform for the orchestrator downstream.

The factory is consumed by `addDuplicateError`, whose signature is

```ts
function addDuplicateError(
  seen: Map<string, number>,
  value: string,
  index: number,
  code: "topic_plan_duplicate_title" | "topic_plan_duplicate_intent",
  label: string,
  errors: TopicPlanValidationError[],
): void
```

It encapsulates the entire "have I seen this string before?" flow. Given a `seen` map of previously observed values, the current `value`, its `index`, the appropriate duplicate `code`, a `label` for the message ("Title" or "Intent"), and the running `errors` array, it consults `seen.get(value)`. If a previous index is found, it pushes a new error built by `errorAt` saying that the current proposal duplicates an earlier one (offset by `+1` so the user sees one-based numbering). Otherwise it records the current index in the map so future duplicates can be detected. The function returns nothing — its job is the side effect on `seen` and `errors`.

The string helpers come next and they are all about getting noisy model output onto a canonical footing before any comparison happens. The first is `stripOuterJsonFence`, declared as `function stripOuterJsonFence(raw: string): string`. It takes a raw response string, trims it, and tries to peel off a single outer ```` ```json ... ``` ```` (or plain ```` ``` ... ``` ````) code fence by matching the pattern `^```(?:json)?\s*\n([\s\S]*?)\n```$/i`. If the regex captures an inner body it returns that body, also trimmed; if the input does not actually look like a fenced block it falls back to the trimmed original. This is the only thing standing between a model that wraps its JSON in a Markdown fence and the JSON parser above.

Closely related is `normalizeLabel`, with the signature `function normalizeLabel(value: string): string`. It canonicalizes a label so that two strings the user would consider the same also compare equal. The chain runs `NFKD` normalization, strips the combining diacritic range `\u0300-\u036f`, lowercases, collapses any non-`[a-z0-9]` run into a single space, and trims. The result is a single-space, lowercase, accent-free form of the original — exactly what the duplicate detector needs.

The grouping counterpart is `normalizeGroups`, declared as `function normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups`. It does not change the shape of the input; it just rebuilds each of the four lists — `contract`, `state`, `output`, `failure` — by passing them through a `uniqueSorted` helper and returns a fresh object. The effect is that any group carried into the canonical form of a topic plan has duplicates removed and is sorted, so equality checks against other plans become a simple per-array comparison rather than a fragile order-sensitive one.

Together these helpers form a thin foundation: `isRecord` and `isStringArray` guard the shape of parsed JSON; `normalizeLabel` and `normalizeGroups` put strings and arrays on a canonical footing; `stripOuterJsonFence` rescues the cases where the model wrapped its output in a code fence; and `errorAt` with `addDuplicateError` is the only path through which duplicate-related diagnostics enter the error list. The validation routines above this layer are essentially the orchestration of these primitives against a proposal.

## Clustering: import graph plus spoke/overview and concern fallback
<!-- lw:anchors packages/core/src/topics.ts#clusterModulesByImportGraph packages/core/src/topics.ts#capClusterSize packages/core/src/topics.ts#DEPLOYMENT_PATH_PATTERNS packages/core/src/topics.ts#collectConcernTopicClusters -->

`clusterModulesByImportGraph` is the structural clustering engine that decides which product modules belong together based on how they actually import one another. It takes a `TopicPlanningInventory` and returns an array of `TopicModuleCluster`s, where each cluster pairs a list of product modules with the auxiliary modules that reach into them.

The function's signature is:

```ts
export function clusterModulesByImportGraph(inventory: TopicPlanningInventory): TopicModuleCluster[]
```

In words: it takes the full inventory of modules (both product and auxiliary roles) and returns the clusters it computed.

The mechanism proceeds in four stages.

**Stage 1 — Build a product-only import graph and find connected components.** The function first narrows `inventory.modules` down to those whose `m.role === "product"` and stores their ids in `productIds`. It then constructs a `productAdjacency` map that records, for each product module, the subset of its `importNeighbors` that are also product modules (excluding self-loops via `id !== m.id`). From that adjacency, a BFS over a queue of `[...productIds].sort()` walks every component; visited nodes are marked in `visited`, each BFS run accumulates its members into `component`, and the component is sorted before being pushed onto `components`. The deterministic `[...productIds].sort()` outer iteration is what guarantees the same component boundaries across runs.

**Stage 2 — Split components into multi-member and singleton groups.** Anything whose component has `length >= 2` is kept as `multi` (these are tightly coupled product modules that obviously belong together). The remaining single-id components become `singletonIds` and are sorted. Singletons are product modules that import no other product modules and are imported by none — the building blocks for the heuristic stages that follow.

**Stage 3 — Group singletons that share auxiliary "spokes."** Because a singleton has no product neighbors by construction, the function instead looks at its auxiliary neighbors: for each singleton `id`, `auxNeighborsBySingleton` collects those `importNeighbors` that are not product modules but exist in the inventory. A union-find-style `parent` map is seeded so each singleton is its own root, and `findRoot` flattens the tree with path compression. For every unordered pair `(i, j)` of singletons, the function unions their roots when their auxiliary-neighbor sets intersect (`[...left].some((neighbor) => right.has(neighbor))`). After all unions, `groupsByRoot` re-buckets each singleton under its root. The resulting groups are sorted internally and then by their first member; `spokeClusters` keeps groups of size `>= 2`, and the leftover singletons become `remainder` (flattened and sorted).

**Stage 4 — Attach auxiliary modules, cap size, tag origin, and order the result.** `auxiliaryModules` collects every non-product module. The local `attachAuxiliary(productModuleIds, origin?)` helper builds a cluster by selecting those auxiliary modules whose `importNeighbors` overlap `productModuleIds`, sorts their ids, runs the cluster through `capClusterSize`, and stamps an optional `origin` of `"spoke"` or `"overview"` (multi-component clusters omit the origin tag entirely). The final `clusters` array concatenates: the `multi` clusters (originless), the `spokeClusters` (origin `"spoke"`), and — only when `remainder.length >= 2` — a single overview cluster built from `remainder` (origin `"overview"`). The whole array is sorted by `productModuleIds[0]` so the output ordering is stable.

`capClusterSize` enforces a 6-item ceiling on each cluster. Its signature is:

```ts
function capClusterSize(cluster: TopicModuleCluster): TopicModuleCluster
```

In words: it takes a draft cluster and returns the same shape with overflow trimmed. The rule is "shrink auxiliary before product": the first `while` loop drops auxiliary ids from the tail while the combined size exceeds 6 and any auxiliary ids remain; only if that loop exhausts the auxiliary list (or stops) and the cluster is still over 6 with more than 2 product ids does the second loop trim product ids from the tail. The two-product floor preserves the smallest viable product grouping.

`DEPLOYMENT_PATH_PATTERNS` is a closed list of glob patterns used by concern rules to recognise deployment-shaped evidence. Its signature is:

```ts
export const DEPLOYMENT_PATH_PATTERNS = [
  "**/Dockerfile*",
  "**/docker-compose*",
  "**/*.bat",
  "**/*.ps1",
  "**/scripts/**",
  "**/deploy/**",
]
```

In words: it is an exported array of glob strings that the deployment concern rule pattern-matches against module paths to decide whether a module contributes "deployment" surfaces.

`collectConcernTopicClusters` is the fallback pass that catches topics the import graph cannot express — concerns like deployment, configuration, or testing whose evidence lives in auxiliary files rather than in how product modules import each other. Its signature is:

```ts
export function collectConcernTopicClusters(
  inventory: TopicPlanningInventory,
): Array<{ cluster: TopicModuleCluster; title: string; intentSignal: string; surfaces: string[] }>
```

In words: it takes the same inventory and returns one entry per matched concern, each pairing a cluster with a rule-supplied title, intent signal, and up to four concrete surface basenames.

The mechanism iterates the closed-list `CONCERN_GROUP_RULES`; for each `rule`, it gathers every module where `rule.matches(module)` is true, sorts their ids into `matched`, and short-circuits with `continue` when nothing matches. It then derives `productModuleIds` two ways: first by intersecting `matched` with `productIds`, and — only when that intersection is empty — by falling back to product modules whose `importNeighbors` reach into `matched`. If even the fallback produces no product ids, the rule contributes nothing. With a non-empty `productSet` in hand, the function collects auxiliary ids from `matched` that are not in `productSet` and that have at least one import neighbor in `productSet`, then runs the draft through `capClusterSize` and stamps `origin: "concern"`. Finally, `surfaces` flattens every matched module's `rule.surfacePaths(module)` results, takes the basename of each path via `path.split("/").pop()`, dedupes and sorts via `uniqueSorted`, and truncates to the first 4 entries — a deterministic evidence trail the planner can render in the topic's intent line. Each assembled `{ cluster, title, intentSignal, surfaces }` is pushed onto `results`, which the function returns in rule order.

## Anchor selection and section routing
<!-- lw:anchors packages/core/src/topics.ts#selectTopicAnchors packages/core/src/topics.ts#assignTopicKeySections -->

This stage of the topic pipeline has a single job: given a cluster of modules and a ranked list of anchor candidates, decide which anchors survive the cut and which documentation section each survivor will land in. The work happens in two passes — first `selectTopicAnchors` produces the survivor set, then `assignTopicKeySections` routes every survivor to a section heading.

`selectTopicAnchors` walks the cluster's product and auxiliary modules and pulls out a deduplicated `Entry` for every anchor key found. Each entry carries the anchor's source-character cost, whether it is a "product" anchor, its centrality score from the planning layer, and the topic group implied by the first dominant signal on its module. Entries are then bucketed into the four topic groups (`contract`, `state`, `output`, `failure`) plus an `unclassified` pool, and each bucket is sorted by a `rank` comparator that prefers higher centrality, then smaller source size, then lexicographic key.

```ts
export function selectTopicAnchors(
  cluster: TopicModuleCluster,
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: { maxAnchors: number; maxSourceChars?: number; minimumProductAnchorRatio?: number; rationaleMaxChars?: number },
): TopicKeyGroups | null
```

The function returns a `TopicKeyGroups` object listing the chosen keys per group, or `null` when the cluster has no candidates or fails the post-selection sanity check (at least five anchors). Internally it takes a topic module cluster, a planning inventory, a precomputed centrality map, and option flags for anchor count, source-character budget, and a product-ratio floor; the return is either the populated group map or `null`.

Selection runs in two phases. Phase one guarantees each of the four groups a single "floor" pick: it first tries the group's own bucket, then the unclassified pool, then the globally best remaining entry from any bucket. Borrowing from a sibling group is safe because that sibling already locked in its floor pick earlier in the loop, so it can never be starved. Phase two is an additive fill that loops over groups while there is still budget under `opts.maxAnchors`. For each group it grabs the next-best unused entry from its combined pool (own bucket + unclassified), but only commits the pick when three checks pass: the projected source cost — computed exactly via `estimateTopicSourceChars` over the full picked set plus the candidate, not as an incremental delta — stays within `opts.maxSourceChars` when that cap is set, and adding the entry would not push the running product-to-total ratio below `opts.minimumProductAnchorRatio` (defaulting to `0.75`). Once any group accepts a pick, the budget counter, product counter, picked set, and per-group lists are updated and the round repeats. The loop terminates when no group can accept another anchor under these constraints.

`assignTopicKeySections` then turns that group structure into a section map. It iterates each group in a fixed order and slots the group's first key into the group's signature heading — `purpose` for `contract`, `when-to-use-this-page` for `state`, `failure-and-recovery` for `failure`, `change-map` for `output` — while every remaining key in the group, including those picked during the fill phase, is parked under `behavioral-contract`. Finally, any key in `candidate.seedKeys` that did not appear in the four groups still gets a home, defaulted to `behavioral-contract`, so a stray seed key never escapes the page unmapped.

```ts
export function assignTopicKeySections(candidate: TopicCandidate): TopicKeySectionMap
```

This function takes a `TopicCandidate` (whose `groups` field carries the keys produced by `selectTopicAnchors`) and returns a `TopicKeySectionMap` — a `Map` from anchor key to the required documentation section that key should occupy. The shape of the map is what later writers consume: one signature section per group, with every other selected anchor documented under `behavioral-contract`.

## Deterministic plan construction with whole-plan validation
<!-- lw:anchors packages/core/src/topics.ts#proposeTopicPlanDeterministically packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#TOPIC_GROUP_NAMES -->

Plan construction in this file is the step that turns raw planning inventory into a strictly ordered, validator-guarded list of topic proposals, and then promotes each surviving proposal into a full candidate. The constants and helpers involved exist to make that pipeline reproducible and to give the whole-plan validator something it can either accept or reject as a unit.

The pipeline begins in `proposeTopicPlanDeterministically`, whose signature is:

```
export function proposeTopicPlanDeterministically(
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: TopicPlanValidationOptions,
): TopicCandidate[]
```

It takes the planning inventory, a precomputed centrality map, and the validator's options, and returns the final ordered list of `TopicCandidate` values. The first thing it does is to cluster the input modules by their import graph via `clusterModulesByImportGraph`, and to build a `Map` from module id to its evidence record so title lookups and role checks are O(1). Because the options passed to `selectTopicAnchors` must not carry `undefined` keys, the function rebuilds a `selectOpts` object that only copies the keys it actually has values for: `maxAnchors`, `maxSourceChars`, `minimumProductAnchorRatio`, and `rationaleMaxChars`. The local helper `flowsWithin` reduces the inventory's flow list to the at-most-two cross-module flows every module in the candidate participates in, sorted ascending by slug, so a candidate only claims flows it can actually cover.

Each cluster is then promoted to a proposal in a fixed order. The candidate's `moduleIds` are the union of product and auxiliary module ids, sorted. A title is built from the first product module's title, optionally joined with the second product module's title when there is one, or fall back to an overview title when the cluster has origin `"overview"`; the resulting string is hard-capped at 80 characters. The `intent` line is built from the cluster's first detected `signals` entry, with a fallback of `"cross-module behavior"`, and is itself capped at 160 characters. After `selectTopicAnchors` returns a non-null groups object, the candidate's `flows` are resolved through `flowsWithin`, and the proposal — `{ title, intent, modules, flows, groups }` — is pushed onto `proposals`.

Concern-grouped candidates (deployment, testing, and similar cross-cutting concerns) are produced in a second pass through `collectConcernTopicClusters`, which only runs when `opts.concernTopics` is not `false`. Each cluster is run against the same `selectTopicAnchors` so a concern with no usable anchors yields no candidate rather than a stub. The resulting `proposal` is added to both the global `proposals` array and to a `concernProposalSet`; the set is the only place where the file remembers which proposals came from the concern pass, and that reminder is what lets the function re-tag them after validation.

Once both passes are merged, the full proposal list is sliced to `opts.maxTopics` before validation. Slicing first is what keeps the validator from rejecting a plan that would otherwise be valid, because `validateTopicPlan` rejects any plan larger than `maxTopics` outright and would discard even the valid prefix. The fixed-point loop then iterates: it serializes the surviving proposals into a `{ topics: … }` JSON envelope and runs `validateTopicPlan` against the whole plan. If validation succeeds, each validated candidate is re-tagged according to the source proposal at the same `planOrder` index — `concernProposalSet.has(proposals[candidate.planOrder]!)` flips the candidate's `origin` to `"concern"` — because validation strips construction metadata. If validation fails, the function collects the bad proposal indexes from the error list, removes them, and loops. The loop terminates either by returning the validated candidates, by returning an empty list when the plan becomes empty, or by returning `[]` when the errors carry no proposal indexes (a non-recoverable structural failure).

The `TOPIC_GROUP_NAMES` constant underpins the shared vocabulary used by every other helper in this section:

```
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
```

It is the canonical, ordered list of the four evidence group names — `contract`, `state`, `output`, `failure` — that every proposal's `groups` object must contain, and every helper below keys its work against this order.

`compareProposalPreference` implements a deterministic tie-breaker between two proposals of equal weight. Its signature is:

```
function compareProposalPreference(
  left: TopicPlanProposal,
  right: TopicPlanProposal,
  moduleById: ReadonlyMap<string, TopicModuleEvidence>,
): number
```

It first counts how many of the four `TOPIC_GROUP_NAMES` have at least one entry in each proposal's `groups`; the proposal with more populated groups wins. If both proposals cover the same number of groups, it counts how many of their `modules` are tagged with role `"product"` in `moduleById`; the proposal spanning more product modules wins. If both dimensions are still tied, it falls back to a `normalizeLabel(left.title).localeCompare(normalizeLabel(right.title))` so the resulting order is stable across runs.

`parseProposal` is the strict shape-checker used by the validator, with the signature:

```
function parseProposal(value: unknown, index: number, errors: TopicPlanValidationError[]): TopicPlanProposal | null
```

It accepts an unknown value, the proposal's index in the parent array, and the shared error sink, and returns either a parsed `TopicPlanProposal` or `null` after recording each reason it rejected. The function rejects anything that is not a record, and rejects records that carry any field outside the allowed set `{ title, intent, modules, flows, groups }`. Then it verifies that `title` and `intent` are non-empty strings, and that `modules` and `flows` are string arrays and `groups` is a record. The `groups` record is checked twice: first to ensure every key is a member of `TOPIC_GROUP_NAMES`, then to ensure each value is a string array, building a fully populated `parsedGroups` object whose keys appear in the canonical order. The final returned `TopicPlanProposal` carries trimmed strings, copied arrays, and the normalized groups.

`toCandidate` lifts a validated proposal into the candidate shape the rest of the system consumes, with the signature:

```
function toCandidate(proposal: TopicPlanProposal, planOrder: number): TopicCandidate
```

It calls `normalizeGroups` on the proposal's groups, then computes a deterministic `evidenceHash` as the first 12 hex characters of `sha256(JSON.stringify({ modules, flows, groups }))`. The candidate's display slug is built from `moduleSlug(proposal.title)` (falling back to `"topic"`) concatenated with the first 8 characters of `evidenceHash`, which guarantees equal plans collapse to equal slugs. `seedKeys` is the deduplicated, sorted union of every group entry across `TOPIC_GROUP_NAMES`, giving downstream code a stable seed set for further filtering. The returned candidate spreads the original `proposal`, attaches `planOrder`, and carries the normalized groups, the `evidenceHash`, the slug, and the `seedKeys`.

## LLM-plan validation against the closed inventory
<!-- lw:anchors packages/core/src/topics.ts#validateTopicPlan -->

The planner’s raw output must be converted into a trustworthy batch of topic candidates. `validateTopicPlan` enforces that conversion from JSON response to validated inventory-scoped proposals, using the supplied module and flow inventory as the only source of truth. It returns either successful candidates with no errors, or an unsuccessful result containing no candidates and all validation errors found.

```ts
export function validateTopicPlan(
  raw: string,
  inventory: TopicPlanningInventory,
  opts: TopicPlanValidationOptions,
): TopicPlanValidationResult
```

`validateTopicPlan` takes a planner response, the closed topic-planning inventory, and validation limits, then returns validated candidates or a structured failure.

The first stage makes the response structurally usable. The function removes any outer JSON fence and parses the result with `JSON.parse`. A parsing failure immediately returns `topic_plan_invalid_json`, including the parser error in the message. Once parsed, the response must be either an array or an object whose `topics` value is an array. Object responses may contain only the `topics` property. The proposal list must also be nonempty and must not exceed `opts.maxTopics`; violations return `topic_plan_empty` or `topic_plan_too_many`, respectively.

For subsequent per-topic checks, the inventory is indexed for fast lookup. Module IDs map through `moduleById`, flow slugs map through `flowBySlug`, and all declared module and flow anchors are collected into `knownAnchors`. Each item is then passed to `parseProposal`, which fills the shared `errors` collection with proposal-specific issues. Parsable proposals are checked for title and intent budgets, including an 80-character title limit, a 160-character intent limit, and a prohibition on line breaks.

The mechanism then normalizes and scopes every proposal. `uniqueSorted` removes duplicate module IDs, flow slugs, and evidence-anchor keys while sorting the retained values. This also catches an anchor being assigned to more than one evidence group, because a repeated key would be reduced to a single entry. References that do not exist in the inventory produce `topic_plan_unknown_reference`, while a known anchor not belonging to any selected module or flow produces `topic_plan_unscoped_anchor`. The accepted proposal stores these normalized arrays and normalized groups for the overlap and candidate-conversion stages.

Module and flow composition is bounded by role and connectivity. A normal proposal must select two to six modules; the narrower alternative is one module paired with a flow spanning at least three modules. Otherwise the validation adds `topic_plan_module_budget`. The proposal must also contain at least two product-role modules unless it has such a wide accepted flow, it may cite at most two flows, and it must include at least one product module. Auxiliary modules cannot float independently: each must be directly connected to at least one selected product module through that module’s `importNeighbors`, or the function reports `topic_plan_auxiliary_disconnected`.

Evidence must then be sufficient and appropriately weighted. Each accepted group in `TOPIC_GROUP_NAMES` must be nonempty, and every proposal must contain between five anchors and `opts.maxAnchors`. If `maxSourceChars` is configured, `estimateTopicSourceChars` measures the selected evidence and reports an over-budget proposal. The function also calculates the product-anchor ratio from `inventory.anchorRoles`; unless the default minimum of `0.75` is overridden by `opts.minimumProductAnchorRatio`, a lower ratio produces `topic_plan_insufficient_product_evidence`. These checks ensure that an apparently valid topic is not built from thin, irrelevant, or disconnected evidence.

After individual proposals pass, the validator looks for batch-level collisions. It normalizes titles and intents and uses `addDuplicateError` to report repeated labels as `topic_plan_duplicate_title` or `topic_plan_duplicate_intent`. It then compares every pair of parsed proposals by their combined evidence groups. The overlap ratio is the number of anchors shared by both topics divided by the smaller anchor count, so it measures how much of the smaller topic’s evidence is reused. When overlap exceeds `opts.maximumOverlapRatio`, the function uses `compareProposalPreference` to identify the less-preferred proposal and assigns the error to that proposal rather than either arbitrary member of the pair.

Only a completely error-free plan is accepted. If any errors were recorded, `validateTopicPlan` returns `{ ok: false, candidates: [], errors }`, ensuring that partially invalid output cannot leak into later topic-generation steps. Otherwise, `toCandidate` transforms every parsed proposal into its final candidate form and the function returns `{ ok: true, candidates, errors: [] }`.

## Mechanical source-budget repair for over-budget candidates
<!-- lw:anchors packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically -->

The function `repairTopicPlanSourceBudgetMechanically(raw: string, errors: readonly TopicPlanValidationError[], inventory: TopicPlanningInventory, opts: TopicPlanValidationOptions): { content: string; result: TopicPlanValidationResult } | null` takes a raw topic-plan string, a list of validation errors, a planning inventory, and validation options, and returns either a repaired content/result pair or `null` if no repair is possible.

The first guard short-circuits any work that would be wasted: if there are no errors at all, or the caller never supplied a `maxSourceChars` cap, the function returns `null`. There is nothing to repair and no budget to enforce.

With those prerequisites met, the function attempts to recover the JSON document embedded in `raw`. It calls `stripOuterJsonFence(raw)` to peel off any Markdown code-fence wrapping the string might carry, then `JSON.parse` to turn the remainder into a value. If parsing throws, the function returns `null` — a malformed payload is not something to mutate; the caller will see the original error.

Once parsed, the function extracts the topic list. The accepted shapes mirror the validator's: either a top-level array, or an object with a `topics` array; anything else yields `null`. From this list it derives `flaggedIndexes`, the set of proposal indices whose errors carry the `topic_plan_source_budget` code. If no proposal is actually flagged as over-budget, the function returns `null` — repairing a payload that is not over-budget would only add noise.

For each flagged proposal the function reads its `groups` object. If the proposal is missing or shaped unexpectedly, it bails with `null` rather than guessing. Otherwise, it walks the well-known group order declared by `TOPIC_GROUP_NAMES`, validating each group's value with `isStringArray`, and assembles a flat `entries` table where every row remembers its group, its anchor key, its source-character cost from `inventory.anchorSourceChars`, and whether the key plays a product role (`inventory.anchorRoles[key] === "product"`). This table is the working memory the rest of the function operates on.

The function then asks `estimateTopicSourceChars` for the proposal's current total, passing the kept keys and the rationale cap from `opts.rationaleMaxChars`. If that total is already within `maxSourceChars`, the proposal is left alone and the loop moves on — the flag was either stale or measured differently.

When the total is genuinely over budget, the function builds a `removed` set of entries marked for deletion and defines `canRemove(entry)` to encode three invariants the repair must not violate:

1. **Coverage floor.** After removing the entry, the proposal must still retain at least five keys in total (`remainingKeys >= 5`); dropping below that would invalidate the proposal shape.
2. **Per-group floor.** Each group must keep at least one key (`remainingInGroup > 1`, evaluated against the pre-removal count); a group left empty would also break the validator.
3. **Product-anchor ratio.** If the entry being considered is a product anchor, removing it must not push the surviving product fraction below `opts.minimumProductAnchorRatio ?? 0.75`. The function compares the post-removal product count against the post-removal total and rejects the removal if the ratio would dip under the floor.

If `canRemove` returns `true`, the entry is removable; otherwise it is pinned in place.

Removal proceeds in two passes via `dropPass`. In each pass, the candidate pool is sorted by `chars` descending so the function attacks the largest contributors first. For each candidate, while the estimated total is still above `maxSourceChars`, the function asks `canRemove`; if allowed, it adds the entry to `removed` and immediately re-runs `estimateTopicSourceChars` against the trimmed key list. The recomputation matters: because the per-file-set rationale cap makes the marginal cost of each removal non-additive, only a fresh estimate after every drop yields a trustworthy total.

The first `dropPass` runs over non-product entries only, protecting product anchors from being discarded before cheaper non-product anchors are exhausted. If the budget is still blown, a second pass runs over the product entries under the same rules. If even that second pass cannot bring `totalChars` under `maxSourceChars` without violating one of the invariants, the function returns `null`: this proposal simply cannot be fit within the budget while honoring the other rules, and the caller should fall back to a different repair strategy.

When the loop finishes a proposal that did succeed, the function rewrites `groups` in place, mapping each `TOPIC_GROUP_NAMES` group to the keys of entries that belong to it and were not removed.

After every flagged proposal has been visited, the function re-serializes the entire value with `JSON.stringify` and reruns the full validator via `validateTopicPlan(repairedRaw, inventory, opts)`. If that validation does not return `ok`, the function returns `null` — the mechanical edits may have fixed the source-budget error but introduced another, and the function refuses to ship a payload it cannot stand behind. Only when the revalidation succeeds does it return `{ content: repairedRaw, result }`, handing the caller the corrected raw text and its freshly computed `TopicPlanValidationResult`.

## Tests

Covered by `packages/core/src/topics.test.ts` (same-name test file on disk).
