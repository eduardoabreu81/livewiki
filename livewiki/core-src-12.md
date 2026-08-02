---
title: Topic planning, update metrics, and verify surfaces
owner: generated
anchors:
  - packages/core/src/topics.test.ts#budgetInventory
  - packages/core/src/topics.test.ts#budgetProposal
  - packages/core/src/topics.test.ts#candidate
  - packages/core/src/topics.test.ts#clusterInventory
  - packages/core/src/topics.test.ts#deploymentModules
  - packages/core/src/topics.test.ts#fourGroupInventory
  - packages/core/src/topics.test.ts#inventory
  - packages/core/src/topics.test.ts#mod
  - packages/core/src/topics.test.ts#pairModules
  - packages/core/src/topics.test.ts#proposal
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
  - packages/core/src/update-metrics.test.ts#readLedger
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#listUpdateMetrics
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.test.ts#git
  - packages/core/src/update.test.ts#gitCommitAll
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#SNIPPET_WINDOW
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/view-activity.test.ts#batch
  - packages/core/src/view-activity.test.ts#pkg
  - packages/core/src/view-activity.test.ts#resolved
  - packages/core/src/view-activity.test.ts#write
---

# Topic planning, update metrics, and verify surfaces

This module owns the deterministic topic-planning pipeline, the per-repo update metrics ledger, and the wiki verification surface that together drive stage 5 of the documentation flow.

## When to use this page

- **Validate** a candidate topic plan against the closed inventory before it is rendered into pages.
- **Inspect** how the per-repo update metrics ledger accumulates package/write/debt/batch events and exposes a snapshot.
- **Verify** the wiki against the code index to catch broken anchors, broken internal links, and altered manual blocks.
- **Reuse** the test fixtures (`budgetInventory`, `budgetProposal`, `clusterInventory`, `fourGroupInventory`, `pairModules`, `deploymentModules`, `candidate`, `mod`, `inventory`, `proposal`) when authoring new planner or update tests.

## How it fits

`topics.ts` defines the planner's evidence shape, the deterministic cluster formation rules, the proposal validation pipeline, and the mechanical source-budget repair that keeps generated pages from overflowing. The tests in `topics.test.ts` exercise those paths with hand-built inventories (`inventory`, `budgetInventory`, `clusterInventory`, `fourGroupInventory`) and proposal builders (`proposal`, `budgetProposal`, `candidate`, `mod`). `update-metrics.ts` is a small JSON ledger under `.livewiki/` that `update.ts` appends to whenever a work package is emitted or a doc is written back; `update.test.ts` exercises that flow end-to-end. `verify.ts` walks the wiki from disk, validates anchors and links, and emits structured issues; `verify.test.ts` covers anchor and link failure modes, while `view-activity.test.ts` builds an activity dashboard model on top of the same metrics.

## Topic-planning inventory and span math

<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#TOPIC_SOURCE_SPAN_SEPARATOR packages/core/src/topics.ts#DEPLOYMENT_PATH_PATTERNS packages/core/src/topics.ts#renderTopicSourceSpan packages/core/src/topics.ts#estimateTopicSourceChars packages/core/src/topics.ts#measureTopicAnchorEvidence packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray -->

`TOPIC_GROUP_NAMES` enumerates the four closed groups (`contract`, `state`, `output`, `failure`) every proposal must populate, and `TOPIC_SOURCE_SPAN_SEPARATOR` is the `"\n\n"` join the generator places between consecutive evidence spans. `DEPLOYMENT_PATH_PATTERNS` lists the regexes used to flag deployment-style modules so they can be grouped into a concern cluster.

`renderTopicSourceSpan` is the shared span renderer: it produces the `// === <key> (<path>:<start+1>-<end>) ===` header line plus the file lines from `max(0, startLine-1-6)` to `min(lines.length, endLine+10)` joined with `"\n"`, so the planner's estimate and the generator's `buildTopicDocContext` cannot drift. `estimateTopicSourceChars` and `measureTopicAnchorEvidence` consume that same math to budget each proposal before validation. `buildTopicPlanningInventory` is the entry point that walks the repo and emits a `TopicPlanningInventory`, and `serializeTopicPlanningInventory` flattens it to a string the planner can pass to the LLM. The remaining helpers are the small string utilities that keep the planner's parsing and grouping deterministic: `classifyTopicSignals`, `extractH2Titles`, `extractOpeningSentence`, `extractSectionBullets`, `stripOuterJsonFence`, `uniqueSorted`, `normalizeLabel`, `isRecord`, and `isStringArray`.

## Cluster formation and deterministic plan proposal

<!-- lw:anchors packages/core/src/topics.ts#clusterModulesByImportGraph packages/core/src/topics.ts#capClusterSize packages/core/src/topics.ts#collectConcernTopicClusters packages/core/src/topics.ts#selectTopicAnchors packages/core/src/topics.ts#assignTopicKeySections packages/core/src/topics.ts#proposeTopicPlanDeterministically packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically packages/core/src/topics.ts#compareProposalPreference -->

`clusterModulesByImportGraph` decomposes the inventory into connected components of the product-module import graph plus their directly-connected auxiliary modules, then `capClusterSize` enforces an upper cap on each cluster. `collectConcernTopicClusters` re-merges the deployment/testing singletons into concern clusters when `concernTopics` is enabled. `selectTopicAnchors` picks the per-cluster evidence keys, and `assignTopicKeySections` places each key into one of the four `TOPIC_GROUP_NAMES`. `proposeTopicPlanDeterministically` walks those clusters in a stable order to produce the deterministic plan that the optional LLM refine pass is layered on top of. `repairTopicPlanSourceBudgetMechanically` drops expensive non-product anchors first to satisfy the source budget, the 5-anchor floor, the non-empty groups, and the product-ratio minimum. `compareProposalPreference` is the deterministic ordering key used when the planner ranks competing candidates.

## Proposal validation and helpers

<!-- lw:anchors packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError -->

`validateTopicPlan` is the single gate that turns raw LLM JSON into a list of `TopicCandidate` or a list of `TopicPlanValidationError`. `parseProposal` decodes one entry from the `topics` array against the inventory, collecting typed errors, and `toCandidate` stamps it with `planOrder`, `evidenceHash`, `slug`, and `seedKeys`. `normalizeGroups` canonicalizes the four-group key buckets so equal proposals compare equal regardless of insertion order, and the deterministic ordering test in `topics.test.ts` relies on that property. `errorAt` constructs a `TopicPlanValidationError`, and `addDuplicateError` appends a duplicate-title or duplicate-intent violation when the planner submits two proposals with the same identifying string.

## Topic-planning test fixtures

<!-- lw:anchors packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.test.ts#budgetInventory packages/core/src/topics.test.ts#budgetProposal packages/core/src/topics.test.ts#mod packages/core/src/topics.test.ts#clusterInventory packages/core/src/topics.test.ts#fourGroupInventory packages/core/src/topics.test.ts#pairModules packages/core/src/topics.test.ts#deploymentModules packages/core/src/topics.test.ts#candidate -->

`inventory` and `proposal` build the minimal two-module, six-anchor inventory and its matching proposal; they are the basis for the acceptance, unknown-reference, and anchor-overlap tests. `budgetInventory` and `budgetProposal` build the dedicated mechanical-repair fixture (5 cheap product anchors at 100 chars plus 2 expensive non-product anchors at 3000 chars), sized so the only failure tripped is `topic_plan_source_budget`. `mod` constructs a single `TopicModuleEvidence` with sensible defaults, and `clusterInventory`, `fourGroupInventory`, `pairModules`, `deploymentModules` build the larger inventories used by the cluster, deterministic-proposal, and concern-grouping tests. `candidate` constructs a `TopicCandidate` with a chosen `groups` shape.

## Update metrics ledger

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#listUpdateMetrics packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.test.ts#readLedger -->

`metricsPath` resolves `.livewiki/update_metrics.json` against the repo root. `readMetrics` loads and validates the JSON ledger, returning an empty `UpdateMetricsFile` when the file is missing or corrupt (the SPEC rule that metrics are reconstructible and never block the main flow). `writeMetrics` persists the file in a stable, indented form. `recordUpdateMetric` appends a single `UpdateMetric` of any of the four supported kinds, swallowing write errors so the calling operation is never broken. `snapshotMetrics` aggregates the ledger into the `UpdateMetricsSnapshot` exposed by `status --json` — totals per kind, an `efficiencyRatio`, the last 10 entries, and the additive debt/batch counters introduced by roadmap item 14. `listUpdateMetrics` returns the raw entries for higher-level consumers. `clearMetricsForTests` resets the ledger between tests, and `readLedger` is the matching test helper that parses the on-disk JSON back into an `UpdateMetricsFile`.

## Update work package

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#SNIPPET_WINDOW packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#git packages/core/src/update.test.ts#gitCommitAll -->

`CHARS_PER_TOKEN` is the `4` chars-per-token heuristic the package uses to size itself, and `SNIPPET_WINDOW` is the default `20`-line window around each debt symbol. `loadWorkPackage` assembles the `WorkPackage`: the manifest view, the open debt items from `status`, source snippets for each debt symbol, the `validAnchors` subset, a `tokensEstimated` size, a `bytes` size, and the additive bounded `change-impact` context. It records a `package_emitted` metric as a side effect. `snippetForSymbol` resolves the actual file lines for one debt item inside the configured window, and `lookupSymbol` is the lightweight lookup used to detect a missing anchor. `recordDocWrittenBack` appends a `write_received` entry after the agent or a human returns a doc, feeding the efficiency ratio. The test helpers `writeCode`, `writeWiki`, and `setupWithAnchor` create a temporary repo, index it, and seed a wiki page with one anchor so the ledger has something to detect; `git` and `gitCommitAll` invoke `git` for the commit-after-write cases.

## Wiki verification

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`run` opens the index, walks the wiki from disk (the SPEC Fix C guarantee that a freshly written page is validated without a prior `index`), and emits a `VerifyResult` whose `ok` is `true` only when there are zero issues. It checks page and section anchors against active symbols, broken internal links via `resolveWikiLink` plus `isInsideWiki`, stored manual blocks via the multiset-of-hashes comparison (so duplicate blocks are counted correctly even after large offset shifts), invalid Mermaid diagrams, and `missing_wiki_path` entries where the database references a file the wiki walker no longer sees. `collectWikiPages` and `collectWikiArtifactPaths` enumerate `.md` and non-`.md` artifacts so links into diagrams resolve as well. `collectSectionSlugs` builds the per-page set of valid `#section` targets. `formatHuman` renders a `VerifyResult` for the CLI. The test helpers `writeCode` and `writeWiki` create the temporary repo the broken-anchor, broken-link, dot-prefixed-page, and manual-block tests rely on.

## Activity dashboard test fixtures

<!-- lw:anchors packages/core/src/view-activity.test.ts#pkg packages/core/src/view-activity.test.ts#write packages/core/src/view-activity.test.ts#resolved packages/core/src/view-activity.test.ts#batch -->

`pkg` constructs a `package_emitted` `UpdateMetric` with the given timestamp, token estimate, and debt count. `write` constructs a `write_received` `UpdateMetric` pointing at a given wiki path. `resolved` constructs a `debt_resolved` entry via the `mcp` source. `batch` constructs a `batch_run` entry with the given input/output token totals and optional USD cost, defaulting to a completed five-task run. These four builders are the atomic inputs to every `buildActivityModel` and `renderActivityPage` test in this file.

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency

> Coverage note: this module's source (9 files, ~190k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
