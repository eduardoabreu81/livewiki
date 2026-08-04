---
title: core topics, understanding, update metrics, update, and verify
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
  - packages/core/src/understanding.ts#UNDERSTANDING_EVIDENCE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_MAX_OUTPUT_TOKENS
  - packages/core/src/understanding.ts#UNDERSTANDING_MAX_SURFACES
  - packages/core/src/understanding.ts#UNDERSTANDING_ONLY_TARGET
  - packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MIN_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_REL_PATH
  - packages/core/src/understanding.ts#UNDERSTANDING_SURFACE_MAX_CHARS
  - packages/core/src/understanding.ts#UNDERSTANDING_TASK_PREFIX
  - packages/core/src/understanding.ts#buildUnderstandingEvidence
  - packages/core/src/understanding.ts#computeUnderstandingEvidenceHash
  - packages/core/src/understanding.ts#hasUnderstandingBasis
  - packages/core/src/understanding.ts#loadUnderstandingSynthesis
  - packages/core/src/understanding.ts#parseUnderstandingPage
  - packages/core/src/understanding.ts#renderUnderstandingEvidence
  - packages/core/src/understanding.ts#validateUnderstandingArtifact
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#listUpdateMetrics
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#SNIPPET_WINDOW
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
---

# core topics, understanding, update metrics, update, and verify

This page documents the five source files in `packages/core/src/` that together implement stage-5 semantic topic planning, the repository-understanding synthesis, the incremental `update` work-package flow, its append-only metrics ledger, and the wiki `verify` command.

## When to use this page

- **Inspect** the stage-5 topic planner (`topics.ts`) when you need to reason about how a topic plan is built deterministically from a closed inventory, how cluster origins (`spoke`, `overview`, `concern`) are pinned, or how the source-budget is estimated.
- **Audit** the repository-understanding layer (`understanding.ts`) when you need to confirm how the synthesis page is regenerated, how its evidence hash powers idempotent task targets, or why the artifact carries no anchors.
- **Inspect** the incremental `update` work-package (`update.ts`) and its metrics ledger (`update-metrics.ts`) when you need to trace how a package is assembled, how snippet windows are bounded, or how write-back accounting is recorded.
- **Trace** the `verify` command (`verify.ts`) when you need to understand how anchors, internal links, manual-block preservation, and Mermaid diagrams are checked against the disk and the index.

## How it fits

The module groups five files in the `packages/core/src/` source root that sit at the seam between the index (`db.ts`), the navigation/manifest/status helpers (`navigation.ts`, `manifest.ts`, `status.ts`), and the batch orchestration. `topics.ts` and `understanding.ts` produce closed, deterministic inputs that downstream batch stages consume; `update.ts` and `update-metrics.ts` together implement the incremental write path and its append-only ledger; `verify.ts` reads the wiki fresh from disk and compares it to the SQLite index. The five files import from shared helpers (`safe-io.js`, `frontmatter.js`, `hashes.js`, `modules.js`, `orientation.js`, `navigation.js`) and from `change-impact.js` (a hoisted cross-import documented in `update.ts`). They do not depend on each other directly except where `update.ts` calls into `update-metrics.ts` for accounting and where `verify.ts` opens the same index the others write through.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-10.mmd
```

## Topic group constants and source-span helpers

<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#TOPIC_SOURCE_SPAN_SEPARATOR packages/core/src/topics.ts#DEPLOYMENT_PATH_PATTERNS packages/core/src/topics.ts#renderTopicSourceSpan packages/core/src/topics.ts#estimateTopicSourceChars packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray -->

The shared vocabulary for a topic plan begins with three exported constants and the span-rendering helpers they pair with.

`TOPIC_GROUP_NAMES` enumerates the four topic key groups a candidate must populate — `["contract", "state", "output", "failure"]` — and is the source of the `TopicGroupName` union type used throughout the planner.

```ts
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
```

`TOPIC_SOURCE_SPAN_SEPARATOR` is the exact byte sequence `buildTopicDocContext` in `batch.ts` places between consecutive evidence spans; the planner's source-budget estimate uses the same string length so the two stay byte-equal.

```ts
export const TOPIC_SOURCE_SPAN_SEPARATOR = "\n\n";
```

`DEPLOYMENT_PATH_PATTERNS` is the path-pattern list consumed by `collectConcernTopicClusters` to identify deployment/concern paths; the visible export is an array literal (full pattern text is not shown in the excerpt).

`renderTopicSourceSpan` is the shared evidence-span math used by both the planner and the generator context. It computes a clamped window: file lines from `max(0, symbol.startLine - 1 - 6)` to `min(lines.length, symbol.endLine + 10)`, prefixed by a `// === <key> (<path>:<start+1>-<end>) ===` header line, joined with `"\n"`. The visible upper bound clamps above the symbol's end line; nothing in the excerpt clamps below the lower bound beyond the `Math.max(0, …)` floor that prevents negative indices.

```ts
export function renderTopicSourceSpan(
  symbol: { key: string; path: string; startLine: number; endLine: number },
  lines: readonly string[],
): string {
  const start = Math.max(0, symbol.startLine - 1 - 6);
  const end = Math.min(lines.length, symbol.endLine + 10);
  return `// === ${symbol.key} (${symbol.path}:${start + 1}-${end}) ===\n${lines.slice(start, end).join("\n")}`;
}
```

`estimateTopicSourceChars` is the planner-side twin of the generator's measurement. It sums `inventory.anchorSourceChars[key]` for keys present in the index, adds `TOPIC_SOURCE_SPAN_SEPARATOR.length * (measured.length - 1)`, and — when `rationaleMaxChars > 0` — appends `renderRationaleEvidence(...)` for the distinct seed-key file paths. Keys absent from `anchorSourceChars` contribute zero span and zero separator, exactly mirroring the generator's skip semantics.

`uniqueSorted` deduplicates and lexicographically sorts a string array; it backs the `importNeighbors` list, anchor lists, and cluster IDs. `extractOpeningSentence`, `extractH2Titles`, and `extractSectionBullets` are the small Markdown body parsers used to fill module evidence; they read raw bodies from `livewiki/<id>.md` after `parseFrontmatter`. `classifyTopicSignals` derives a free-form signal list from a module's paths and body. `normalizeLabel`, `isRecord`, and `isStringArray` are the shape guards used by `parseProposal` and `stripOuterJsonFence`.

## Topic inventory construction

<!-- lw:anchors packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#measureTopicAnchorEvidence -->

The closed planner inventory is built and serialized here.

`buildTopicPlanningInventory` walks accepted modules (sorted by `id.localeCompare`), reads `livewiki/<id>.md` through `safeIo`, parses frontmatter, classifies each anchor's role via `classifyPathRole`, and emits a `TopicPlanningInventory` containing modules, flows, `anchorRoles`, `anchorSourceChars`, and optional `anchorRationaleRows`. Pages missing on disk, unreadable, or with a `parseFrontmatter` throw are silently skipped via `.catch` and `try`/`continue` paths — there is no other visible error branch in the excerpt. The function also reads `livewiki/flows/*.md` paired against `livewiki/diagrams/flow-<slug>.mmd`, restricted by `opts.allowedFlowSlugs`.

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

`serializeTopicPlanningInventory` is the symmetric inverse used by tests and fixtures; it turns an inventory back into a string. `measureTopicAnchorEvidence` is the async sidecar that computes `anchorSourceChars` and `anchorRationaleRows` by opening the index and rendering each anchor's span — its signature is the visible `async` form shown in the symbol table.

## Cluster formation and origin pinning

<!-- lw:anchors packages/core/src/topics.ts#clusterModulesByImportGraph packages/core/src/topics.ts#capClusterSize packages/core/src/topics.ts#collectConcernTopicClusters -->

These three exports turn a flat module list into the structured `TopicModuleCluster` array that `proposeTopicPlanDeterministically` consumes.

`clusterModulesByImportGraph` returns one `TopicModuleCluster[]`: connected components of the product-module import graph plus their directly-connected auxiliary modules. Auxiliary neighbours are computed via `opts.edges` (the same edge list the inventory records as `importNeighbors`).

`capClusterSize` is a non-exported helper that bounds a single cluster — the visible signature accepts a `TopicModuleCluster` and returns one. There is no further visible content in the excerpt beyond the signature.

`collectConcernTopicClusters` is the concern-grouping pass (deployment/testing paths matched against `DEPLOYMENT_PATH_PATTERNS`). It runs after the import-graph clusters when `opts.concernTopics !== false` and emits clusters with `origin: "concern"` — the D2 pin that locks those candidates out of the LLM refine pass.

## Topic proposal planning and validation

<!-- lw:anchors packages/core/src/topics.ts#proposeTopicPlanDeterministically packages/core/src/topics.ts#selectTopicAnchors packages/core/src/topics.ts#assignTopicKeySections packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError -->

This section groups the deterministic proposal pipeline and its validation surface.

`proposeTopicPlanDeterministically` is the planner's main entry point: given an inventory and the cluster list, it produces a sorted proposal list whose titles and intents are byte-stable for `concern` clusters and use the deterministic title recipe for import-graph components. `selectTopicAnchors` chooses the bounded anchor set per candidate; `assignTopicKeySections` partitions those keys across the four `TOPIC_GROUP_NAMES`.

`validateTopicPlan` enforces the proposal contract end-to-end. It accepts `TopicPlanValidationOptions` (capping `maxTopics`, `maxAnchors`, optional `minimumProductAnchorRatio`, `maximumOverlapRatio`, `maxSourceChars`, `concernTopics`, `rationaleMaxChars`) and returns `{ ok, candidates, errors }` with `TopicPlanValidationError` rows carrying one of the visible error codes (`topic_plan_invalid_json`, `topic_plan_unknown_reference`, `topic_plan_source_budget`, `topic_plan_duplicate_title`, …).

`repairTopicPlanSourceBudgetMechanically` is the bounded mechanical repair pass that drops excess spans until the estimate falls under `maxSourceChars`. The visible normal path shrinks the candidate; the visible failure path falls through to `validateTopicPlan` returning `ok: false` with a `topic_plan_source_budget` error.

`compareProposalPreference` orders proposals by planner preference (deterministic, content-derived — the excerpt shows the signature only). `parseProposal` parses one unknown value into a `TopicPlanProposal | null`, appending `TopicPlanValidationError` rows via `errorAt` and `addDuplicateError` when shape checks fail; `stripOuterJsonFence` strips an outer JSON fence before parsing. `toCandidate` upgrades a `TopicPlanProposal` into a `TopicCandidate` with `planOrder`, `evidenceHash`, `slug`, `seedKeys`, and an optional `origin: "concern"` pin. `normalizeGroups` is the shape normalizer used between parse and validate.

## Understanding synthesis: constants and basis check

<!-- lw:anchors packages/core/src/understanding.ts#UNDERSTANDING_REL_PATH packages/core/src/understanding.ts#UNDERSTANDING_ONLY_TARGET packages/core/src/understanding.ts#UNDERSTANDING_TASK_PREFIX packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MIN_CHARS packages/core/src/understanding.ts#UNDERSTANDING_PURPOSE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_MAX_SURFACES packages/core/src/understanding.ts#UNDERSTANDING_SURFACE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_EVIDENCE_MAX_CHARS packages/core/src/understanding.ts#UNDERSTANDING_MAX_OUTPUT_TOKENS packages/core/src/understanding.ts#hasUnderstandingBasis -->

The understanding layer exposes the path, the `--only` target, and the bounded prompt parameters up front.

```ts
export const UNDERSTANDING_REL_PATH = "livewiki/understanding.md";
export const UNDERSTANDING_ONLY_TARGET = "understanding";
export const UNDERSTANDING_TASK_PREFIX = "understanding:";
export const UNDERSTANDING_PURPOSE_MIN_CHARS = 40;
export const UNDERSTANDING_PURPOSE_MAX_CHARS = PURPOSE_MAX_CHARS;
export const UNDERSTANDING_MAX_SURFACES = 10;
export const UNDERSTANDING_SURFACE_MAX_CHARS = 160;
export const UNDERSTANDING_EVIDENCE_MAX_CHARS = 20_000;
export const UNDERSTANDING_MAX_OUTPUT_TOKENS = 2_048;
```

`UNDERSTANDING_REL_PATH` is the on-disk location of the synthesis page (inside the rule-#1 allowlist). `UNDERSTANDING_ONLY_TARGET` is the `--only` CLI target that reruns the understanding task for the current evidence; `UNDERSTANDING_TASK_PREFIX` prefixes the batch_tasks target `understanding:<evidenceHash>`. `UNDERSTANDING_PURPOSE_MIN_CHARS` and `UNDERSTANDING_PURPOSE_MAX_CHARS` bound the purpose paragraph (the max mirrors `orientation.ts`'s `PURPOSE_MAX_CHARS`); `UNDERSTANDING_MAX_SURFACES` caps the key-surfaces list at 10 items and `UNDERSTANDING_SURFACE_MAX_CHARS` caps each bullet at 160 chars. `UNDERSTANDING_EVIDENCE_MAX_CHARS` bounds the rendered evidence block embedded in the prompt; truncation is marked explicitly by the renderer. `UNDERSTANDING_MAX_OUTPUT_TOKENS` is the fixed 2,048-token ceiling for the synthesis output (the artifact is anchor-free and tiny).

`hasUnderstandingBasis` returns `true` when the evidence inventory has at least one accepted wiki page (module/flow/topic) or a README purpose excerpt. An empty inventory is a deterministic no-op — the excerpt shows no throw path.

```ts
export function hasUnderstandingBasis(evidence: UnderstandingEvidence): boolean {
  return (
    evidence.modules.length > 0 ||
    evidence.flows.length > 0 ||
    evidence.topics.length > 0 ||
    evidence.readmePurpose !== null
  );
}
```

## Understanding synthesis: evidence build, hash, and render

<!-- lw:anchors packages/core/src/understanding.ts#buildUnderstandingEvidence packages/core/src/understanding.ts#computeUnderstandingEvidenceHash packages/core/src/understanding.ts#renderUnderstandingEvidence packages/core/src/understanding.ts#parseUnderstandingPage packages/core/src/understanding.ts#loadUnderstandingSynthesis -->

These four exports implement the closed, deterministic synthesis pipeline.

`buildUnderstandingEvidence` walks the final module plan in prioritization order, loads module digests via `loadModuleDigests` (capped at `UNDERSTANDING_MODULE_DIGEST_CAP = 24`), pulls flow and topic presentations, and merges orientation surfaces plus the README purpose excerpt. The returned `UnderstandingEvidence` is byte-stable per (index plan + wiki on disk) pair.

```ts
export async function buildUnderstandingEvidence(opts: {
  repoRoot: string;
  modules: Module[];
  ordered: Module[];
  pathRoleConfig?: PathRoleConfig | undefined;
}): Promise<UnderstandingEvidence>
```

`computeUnderstandingEvidenceHash` `sha256`-hashes a JSON serialization of the evidence. The batch task target embeds this hash (`understanding:<hash>`): unchanged evidence on resume finds the done task and skips the LLM; changed evidence yields a fresh task with one regeneration — the same idempotence pattern as the topics' `topic:<evidenceHash>` tasks.

`renderUnderstandingEvidence` produces the bounded prompt text. It emits sectioned bullets for modules, flows, topics, entry-point surfaces, and the README purpose excerpt; if the joined text exceeds `maxChars` it truncates and appends `(evidence truncated to the character budget)`. Truncation is the only visible overflow branch — there is no throw on overflow.

`parseUnderstandingPage` parses one synthesized page body into a `UnderstandingSynthesis | null`. `loadUnderstandingSynthesis` reads `UNDERSTANDING_REL_PATH` from disk through `safe-io`, returning `null` when the file is absent or unreadable (the visible `safeIo.readText(...).catch(...)` path).

## Understanding artifact validation contract

<!-- lw:anchors packages/core/src/understanding.ts#validateUnderstandingArtifact -->

`validateUnderstandingArtifact` enforces a dedicated strict contract for the understanding page — separate from the anchor-centric `ArtifactPageKind` validator in `artifact.ts`. The contract is exhaustive:

```ts
export function validateUnderstandingArtifact(content: string): UnderstandingValidationError[]
```

Errors carry a `location` of `frontmatter`, `body`, or `global`, and a `code` drawn from the `UnderstandingValidationCode` union. The visible checks include: frontmatter presence and `owner: generated` (`missing_owner`, `wrong_owner`); absence of `anchors` frontmatter key or any `lw:anchors` marker (`anchors_forbidden`); absence of an `lw:manual` block (`model_invented_manual`); exactly one H1 (`missing_h1`, `multiple_h1`); exactly one purpose paragraph between the H1 and the next heading/EOF (`missing_purpose`, `purpose_not_single_paragraph`) with length in `[UNDERSTANDING_PURPOSE_MIN_CHARS, UNDERSTANDING_PURPOSE_MAX_CHARS]` (`purpose_too_short`, `purpose_too_long`); at most one `## Key surfaces` bullet section, with at most `UNDERSTANDING_MAX_SURFACES` bullets, each capped at `UNDERSTANDING_SURFACE_MAX_CHARS` (`unexpected_section`, `empty_surfaces_section`, `surfaces_not_a_list`, `too_many_surfaces`, `surface_too_long`); no fenced or inline code spans (`code_span_forbidden`); no Markdown links or images (`link_forbidden`); and a literal `TODO`/`TBD`/`FIXME`/`XXX`/`PLACEHOLDER` check (`todo_marker_present`). An empty returned list means the artifact is valid.

## Update metrics ledger

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#listUpdateMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

The metrics file lives at `.livewiki/update_metrics.json` as a versioned append-only JSON document (`{ version: 1, entries: UpdateMetric[] }`).

`metricsPath` resolves the file via `safeIo.resolveAndValidate`:

```ts
async function metricsPath(repoRoot: string): Promise<string>
```

`readMetrics` returns the parsed file or, on any read/parse failure or schema mismatch (`version !== 1`, non-array `entries`), resets to `{ version: 1, entries: [] }` — the visible "corrompido — recomeça do zero" branch. `writeMetrics` persists via `safeIo.writeText` with a trailing newline.

```ts
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
```

`recordUpdateMetric` is the fire-and-forget append entry point: it reads, appends, writes, and swallows any error inside a `try/catch` so a metrics failure cannot break the main update flow.

```ts
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void>
```

`snapshotMetrics` aggregates the ledger into `UpdateMetricsSnapshot`: package and write totals, `efficiencyRatio = totalWriteTokens / totalPackageTokens` when `totalPackageTokens > 0` (else `null`), the latest entry of each kind, `debtResolvedTotal`, `batchRuns`, `batchInputTokens`, `batchOutputTokens`, and `recent` (last 10 entries, oldest first).

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
```

`listUpdateMetrics` returns the full ledger history (oldest first) for the Phase 7 Activity view; on read failure it returns `[]` rather than throwing. `clearMetricsForTests` is a destructive test helper — it ensures `.livewiki/` exists via `safeIo.mkdir` and rewrites the file to an empty ledger; the comment explicitly forbids production use.

## Update work package and snippet extraction

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#SNIPPET_WINDOW packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

The incremental `update` command assembles a focused work package for the in-session agent.

`CHARS_PER_TOKEN` is the ~4 chars/token heuristic used to estimate package size; `SNIPPET_WINDOW` is the default ±20-line snippet window around a symbol. The constants are the only exported upper bounds; the visible package code enforces them as defaults, not as caps.

```ts
export const CHARS_PER_TOKEN = 4;
export const SNIPPET_WINDOW = 20;
```

`loadWorkPackage` is the main entry point. It reads the manifest, pulls debt items via `runStatus(absRoot)` from `status.ts`, computes bounded snippets (window ±3 lines around the symbol) for up to `maxSnippets ?? 50` debt items, deduplicates `validAnchors` from the debt `symbol_key`s, attaches the additive `ChangeImpact` from `computeChangeImpact(absRoot)` (degrades to `notGitRepo: true` outside git — never throws), serializes the package, fills `tokensEstimated` (`Math.ceil(json.length / CHARS_PER_TOKEN)`) and `bytes`, and finally records a `package_emitted` metric. A missing manifest sets `manifest: null`; the visible code paths do not throw on absent manifest, status failure surfaces as a thrown error from `runStatus` (not handled here).

```ts
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage>
```

`snippetForSymbol` is the hoisted helper used by both `update.ts` and `change-impact.js` (backlog #2). It splits the symbol key on `#`, reads the source, scans lines for a defining `function|class|def|const|export … <symName>` match, falls back to `lookupSymbol` when the name scan misses, and finally falls back to the first `window` lines of the file as a minimal snippet. Returns `null` when the file is unreadable; returns the rendered snippet on the normal path.

```ts
export async function snippetForSymbol(
  absRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null>
```

`lookupSymbol` queries the SQLite index for `start_line, end_line` of an active symbol; returns `null` when no row matches. `recordDocWrittenBack` records a `write_received` metric with `wikiPath`, `bytes`, `tokensEstimated` — the OUTPUT side of the package/efficiency accounting.

## Verify command: page walk, anchors, links, and Mermaid

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`verify.ts` is the CI-friendly command that walks the wiki fresh from disk and compares it to the SQLite index. The exported `run` is the entry point.

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
```

The visible checks inside `run` are:

- **Anchors.** For each page, every page-anchor and section-anchor from `extractAnchors(source)` is matched against the active symbols map. A missing active symbol produces a `broken_anchor` error — the Fix-C anti-hallucination promise that doc freshly written by an LLM is validatable without re-running `index`.
- **Manual blocks.** Stored manual blocks per wiki path are compared by multiset of `sha256` hashes; the visible multiset match tolerates reordering and offset drift (`start_offset` is documented as not an identity). Any unmatched stored block emits a `manual_block_altered` error.
- **Internal links.** The source is run through `maskCodeSpans` so links inside fences/inline code are excluded. A regex matches `[text](path.md|path.mmd)(#section)?`. Each link is resolved by `resolveWikiLink(page.relPath, linkPathRaw)` against three cases: `livewiki/…` (absolute in namespace, used as-is), `/…` (absolute at repo root), and `./`, `../`, bare `…` (relative to the page's directory). Resolved links are checked by `isInsideWiki` and `existingArtifactPaths`; missing targets emit a `broken_internal_link` warning. Section slugs are loaded once via `collectSectionSlugs` and checked against the link's `#section` fragment. A link resolving outside `livewiki/` is reported as a warning (`verify` is read-only).
- **Mermaid diagrams.** Every `livewiki/.../*.mmd` is read and run through `validateMermaidSyntax`; failures become `invalid_mermaid_diagram` errors.
- **Missing wiki paths.** Doc pages present in the DB but absent from the disk walk produce a `missing_wiki_path` warning.

The result returns `{ ok, pagesChecked, issues }`; `ok` is `true` only when there are zero error-severity issues (warnings do not fail CI). The DB is closed in a `finally` block.

The four supporting helpers are file-scoped:

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
export async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>>
export function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
export function isInsideWiki(wikiPath: string): boolean
export function formatHuman(result: VerifyResult): string
```

`collectWikiPages` walks `livewiki/` depth-first; directories unreadable on `readdir` are silently skipped via `try/catch/continue`. `collectWikiArtifactPaths` returns the union of `.md` pages and `.mmd` diagrams so a link to either is checkable. `collectSectionSlugs` parses H2/H3 headings from a page (slugified via `slugify`) into a per-page set. `resolveWikiLink` applies the three-case resolution; malformed paths return `null` and are skipped silently — there is no throw path. `isInsideWiki` is a containment check that accepts only paths inside the `livewiki/` namespace. `formatHuman` is the human-readable report formatter for the CLI.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (5 files, ~117k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
