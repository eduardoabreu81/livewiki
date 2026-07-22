---
title: core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning
owner: generated
anchors:
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE
  - packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET
  - packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE
  - packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES
  - packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#boundEncodeLongRuns
  - packages/core/src/prompts.ts#buildFlowGroupBlock
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#buildStage5Prompt
  - packages/core/src/prompts.ts#buildStage5RepairPrompt
  - packages/core/src/prompts.ts#buildTopicPlanPrompt
  - packages/core/src/prompts.ts#buildTopicPlanRepairPrompt
  - packages/core/src/prompts.ts#buildTopicPrompt
  - packages/core/src/prompts.ts#buildTopicRepairPrompt
  - packages/core/src/prompts.ts#formatTopicGroups
  - packages/core/src/prompts.ts#longestRunOf
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
  - packages/core/src/prompts.ts#selectSafeFence
  - packages/core/src/prompts.ts#wrapInSafeFence
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#remove
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/status.ts#run
  - packages/core/src/symbols.test.ts#parse
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#toSymbolRecord
  - packages/core/src/symbols.ts#walkNode
  - packages/core/src/topics.test.ts#budgetInventory
  - packages/core/src/topics.test.ts#budgetProposal
  - packages/core/src/topics.test.ts#inventory
  - packages/core/src/topics.test.ts#proposal
  - packages/core/src/topics.ts#TOPIC_GROUP_NAMES
  - packages/core/src/topics.ts#addDuplicateError
  - packages/core/src/topics.ts#buildTopicPlanningInventory
  - packages/core/src/topics.ts#classifyTopicSignals
  - packages/core/src/topics.ts#compareProposalPreference
  - packages/core/src/topics.ts#errorAt
  - packages/core/src/topics.ts#extractH2Titles
  - packages/core/src/topics.ts#extractOpeningSentence
  - packages/core/src/topics.ts#extractSectionBullets
  - packages/core/src/topics.ts#isRecord
  - packages/core/src/topics.ts#isStringArray
  - packages/core/src/topics.ts#measureAnchorSourceChars
  - packages/core/src/topics.ts#normalizeGroups
  - packages/core/src/topics.ts#normalizeLabel
  - packages/core/src/topics.ts#parseProposal
  - packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically
  - packages/core/src/topics.ts#serializeTopicPlanningInventory
  - packages/core/src/topics.ts#stripOuterJsonFence
  - packages/core/src/topics.ts#toCandidate
  - packages/core/src/topics.ts#uniqueSorted
  - packages/core/src/topics.ts#validateTopicPlan
---

# core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning

This page documents the livewiki core package slice that bundles prompt templates for the LLM batch pipeline, the allowlisted disk I/O boundary, the status report, tree-sitter symbol extraction, and the topic-plan validator and inventory builder.

## When to use this page

- **Audit** prompt templates and editorial rules before changing how the LLM is invoked.
- **Trace** a write or read in `safe-io.ts` to understand allowlist, symlink-defense, and validation behavior.
- **Validate** a topic plan JSON payload, repair it mechanically, and serialize the planner inventory.

## How it fits

The slice lives in `packages/core/src/` and groups five concerns that the higher-stage pipeline (indexing → batching → topic planning → page generation) depends on. `prompts.ts` is the editorial contract for the LLM and is consumed by the batch and flow stages. `safe-io.ts` is the only module authorized to touch disk for `livewiki/` and `.livewiki/`; every other module funnels reads, writes, and removals through it. `status.ts` reads the SQLite index produced by phase 1, adds phase-2 debt and undocumented counts, and may call into `update-metrics.ts` for the incremental token-accounting snapshot. `symbols.ts` walks a tree-sitter tree to produce `SymbolRecord`s with stable `path#name` and `path#Class.method` keys. `topics.ts` consumes those symbols plus frontmatter to build a closed planning inventory and to validate or repair LLM-produced topic proposals. Test fixtures (`*.test.ts`) accompany each module to fix behavior in code, not in prose.

## Prompt budget constants and editorial rule constants
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE -->

`prompts.ts` exposes the budget knobs and shared rule strings that every batch prompt must include so initial and repair prompts cannot drift.

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
```

`PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, and `TOPIC_PAGE_PROMPT_RULES` are `as const` arrays of strings consumed verbatim by the corresponding builders. `LITERAL_SIGNATURE_PROMPT_RULE` and `EXCEPTION_BRANCH_PROMPT_RULE` are short rule strings the builders splice into per-symbol instructions. The source excerpt does not establish exhaustive behavior for every rule — only the visible string fragments and shapes — so additional rules beyond those visible in the truncated source may exist.

## Fence and marker neutralization helpers
<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

These helpers prevent an LLM from injecting untrusted fences or `lw:*` markers into generated Markdown by choosing a safe fence and by neutralizing marker-like text.

```ts
function longestRunOf(text: string, char: "`" | "~"): number {
function boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string {
function selectSafeFence(enclosed: string): { fence: string; content: string } {
function wrapInSafeFence(enclosed: string): string {
export function neutralizeUntrustedControlMarkers(text: string): string {
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

`longestRunOf` measures how many backticks or tildes already appear consecutively in `enclosed`, so `selectSafeFence` can pick a fence delimiter that does not collide with content; `wrapInSafeFence` applies that fence. `boundEncodeLongRuns` caps runaway backtick or tilde runs before they would otherwise break the fence. `neutralizeUntrustedControlMarkers` strips any `lw:*` marker-like text from LLM output unconditionally. `neutralizeUntrustedControlMarkersExceptValidAnchors` preserves only markers whose keys belong to a supplied valid-anchor set (used so legitimate citations survive). The visible source is truncated, so the precise return semantics of the marker-neutralization variants beyond "return a string" are not fully shown.

## Stage-2, stage-4, overview, quickstart, and repair prompt builders
<!-- lw:anchors packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt -->

These builders assemble the system/user `PromptPair` for each non-flow, non-topic batch stage. `buildStage4Prompt` and `buildStage2RefinePrompt` produce the per-module page-generation prompt and its refine counterpart; `buildRepairPrompt` re-prompts with the rejection reasons so the LLM can fix a previously rejected page; `buildOverviewPrompt` and `buildQuickstartPrompt` cover the top-of-wiki overview and quickstart pages. Each builder takes the context payload (symbols + relevant code, bounded by `DEFAULT_CONTEXT_TOKEN_BUDGET`) and emits a pair that respects `DEFAULT_OUTPUT_TOKEN_BUDGET` as the requested answer size. The visible source is truncated before each builder's body is fully shown, so the exact field names of their arguments are not established here.

## Flow and topic prompt builders
<!-- lw:anchors packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#formatTopicGroups packages/core/src/prompts.ts#buildTopicPlanPrompt packages/core/src/prompts.ts#buildTopicPlanRepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt -->

`buildStage5Prompt` and `buildStage5RepairPrompt` build the prompts that generate semantic product-flow pages and re-issue them when verification rejects them. `buildFlowGroupBlock` formats a flow's grouped evidence into the prompt body. `buildTopicPlanPrompt` and `buildTopicPlanRepairPrompt` drive the planning step that produces topic proposals, and `buildTopicPrompt` plus `buildTopicRepairPrompt` drive per-topic page generation.

```ts
function formatTopicGroups(groups: TopicKeyGroups): string[] {
```

`formatTopicGroups` takes the `TopicKeyGroups` (`contract`/`state`/`output`/`failure`) and returns one string per group, suitable for splicing into the topic prompt. The flow and topic builders all reuse `PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, and `TOPIC_PAGE_PROMPT_RULES` so the initial and repair variants cannot drift. The visible source is truncated, so the exact builder signatures (parameter names and return types) are not fully shown here.

## Safe I/O — allowlist and error types
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist -->

`safe-io.ts` is the only module allowed to read or write disk state for the wiki. The allowlist is the literal array `["livewiki", ".livewiki"]`, plus opt-in `AGENTS.md`/`CLAUDE.md` at the repo root via `allowPointer`.

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
export class PathOutsideAllowlistError extends Error {
export class InvalidRelativePathError extends Error {
```

`PathOutsideAllowlistError` carries `repoRoot`, `attempted`, and `allowlist` on the instance and sets `name` to `"PathOutsideAllowlistError"`. `InvalidRelativePathError` is thrown for absolute paths or `..` traversal. `allowlistFor(opts)` returns `["livewiki", ".livewiki"]` and appends the two pointer filenames when `opts.allowPointer === true`. `allowedAbs(repoRoot, dir)` resolves an absolute allowed dir and throws if it would escape `repoRoot`. `isInsideAllowlist` is pure (no disk access) and decides whether an absolute path falls inside any allowed directory or, with `allowPointer`, exactly matches a pointer file at the repo root.

## Safe I/O — validation, symlink defense, and the I/O operations
<!-- lw:anchors packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

The I/O entry point is `resolveAndValidate`, which first calls `validateDeclared` (fast checks: rejects absolute paths, rejects `..` segments, rejects paths outside the allowlist using the declared path) and then performs symlink defense.

```ts
function validateDeclared(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions,
): string;
function findDeepestExisting(
  from: string,
  stopAt: string,
): readonly [ancestor: string, suffix: string];
export async function resolveAndValidate(
);
```

`findDeepestExisting` walks upward from the target until it finds an existing ancestor (or stops at `repoRoot`), returning a `[ancestor, suffix]` tuple. `resolveAndValidate` then realpaths that ancestor, reconstructs the final path by concatenating the suffix, and re-validates the allowlist — closing symlink attacks where `livewiki/`, `livewiki/sub`, or a leaf is a symlink pointing outside the repo. The visible source is truncated, so the full body of `resolveAndValidate` (including its throw branches for `PathOutsideAllowlistError` after re-validation) is not fully shown.

```ts
export async function writeText(
);
export async function readText(
);
export async function exists(
);
export async function mkdir(
);
export async function remove(
);
```

The four async operations all funnel through `resolveAndValidate` first, then perform their filesystem action. The visible source for these functions is truncated past their signatures, so per-operation failure branches are not established in this excerpt.

## Safe I/O tests — symlink-support probe
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

```ts
async function detectSymlinkSupport(): Promise<boolean> {
```

`detectSymlinkSupport` is a boot-time probe used by `safe-io.test.ts` to gate symlink-specific test cases: it creates a target file, creates a symlink, then deletes both; if any step throws (for example, on Windows without Developer Mode), it returns `false` and `it.runIf(canSymlink)` skips the dependent tests.

## Status — public report shape and entry point
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#formatHuman packages/core/src/status.ts#collect -->

The `status` command produces a `StatusReport` aggregating file counts, symbol counts, debt, undocumented entries, the optional `UpdateMetricsSnapshot`, and metadata.

```ts
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>;
```

`run` resolves `.livewiki/index.db` via `safe-io.resolveAndValidate`, opens it with `openIndex`, calls `collect(db, topN ?? 10)`, then attempts to fill `report.metrics` from `snapshotMetrics(absRoot)` inside a `try/catch` — the catch swallows failures and sets `report.metrics = null`, so status reporting degrades gracefully if the metrics snapshot is unavailable. The database is closed in a `finally`.

```ts
function collect(db: import("better-sqlite3").Database, topN: number): StatusReport;
```

`collect` queries `files` and `symbols` where `status = 'active'`, builds `byLang` and `byKind` maps, then computes the top-N files by symbol count. It also joins `debt` to `anchors` and `doc_pages` for unresolved debt rows (`d.resolved_at IS NULL`) and pulls `undocumented` rows where `dismissed = 0`. `formatHuman` renders the same `StatusReport` as a multi-line text block beginning with `livewiki status`.

## Symbols — extraction entry point and walker
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#signatureFor -->

`symbols.ts` is the tree-sitter-driven extractor that turns a parsed tree into `SymbolRecord`s. The entry point is `extractSymbols`, which walks the root and de-duplicates candidates by key, preserving the earliest start line, the earliest start byte, and the earliest discovery order.

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[];
```

```ts
function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: ExtractedSymbol[],
): void;
```

`walkNode` emits `function_declaration`/`generator_function_declaration` as `"function"`, `class_declaration` (TypeScript) as `"class"`, and recurses into the body with `parentClassName` set so `method_definition` becomes `<Class>.<name>` with `kind: "method"`. `export_statement` is handled specially: an exported `function_declaration`/`class_declaration` emits one entry with the inner kind (not duplicated as `"export"`), while `export const` emits the identifier with `kind: "export"`. For Python, `function_definition` becomes `"method"` only when it lives inside a `class_definition`; otherwise `kind: "function"`. `makeRecord` constructs the internal `ExtractedSymbol`; `toSymbolRecord` strips the internal `source_start_byte` to yield the public `SymbolRecord`.

```ts
function signatureFor(node: Node, source: string): string | null;
```

`signatureFor` extracts a representative header for the symbol (used as the anchor's `signature`). The visible source is truncated, so its exact slicing rule is not established here.

## Symbols tests — parser helper
<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

```ts
async function parse(ext: string, src: string) {
```

`parse` is a thin wrapper around `parseSource` from `parser.ts` used by `symbols.test.ts` to obtain a tree-sitter `Tree` for a given extension and source string.

## Topics — group vocabulary and inventory builder
<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#uniqueSorted -->

Topics are grouped into four named buckets. `TOPIC_GROUP_NAMES` is the closed list.

```ts
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
```

`buildTopicPlanningInventory` reads each accepted module's `livewiki/<id>.md` via `safe-io`, parses frontmatter, then assembles `TopicModuleEvidence` (id, title, paths, role, responsibility, when-to-use bullets, section titles, anchors, import neighbors, signals). It also walks `livewiki/flows/` and `livewiki/diagrams/flow-<slug>.mmd` to assemble `TopicFlowEvidence`. For every anchor it records `anchorRoles` and `anchorSourceChars`. `serializeTopicPlanningInventory` converts the inventory to a stable string for embedding in the LLM prompt. `measureAnchorSourceChars` populates the per-anchor source-size map used by the budget repair. `extractOpeningSentence`, `extractSectionBullets`, and `extractH2Titles` are the body parsers that pull responsibility, when-to-use bullets, and H2 titles from the markdown body. `classifyTopicSignals` derives entry/boundary/persistence/output/external signals from a module's paths and body. `uniqueSorted` is the dedupe helper used everywhere in this module.

## Topics — proposal normalization, parsing, validation, and repair
<!-- lw:anchors packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError -->

The proposal pipeline accepts a raw JSON string (often wrapped in a code fence) and either returns a stable set of `TopicCandidate`s or a list of `TopicPlanValidationError`s.

```ts
export function validateTopicPlan(
);
export function repairTopicPlanSourceBudgetMechanically(
);
```

`stripOuterJsonFence` removes a leading/trailing markdown fence so the inner JSON can be parsed; `isRecord` and `isStringArray` are the type guards used while walking the parsed value; `normalizeGroups` and `normalizeLabel` canonicalize group contents and proposal labels. `parseProposal` validates a single proposal shape and returns either a `TopicPlanProposal` or `null`, collecting errors via `errorAt` and `addDuplicateError` (for `topic_plan_duplicate_title`/`topic_plan_duplicate_intent`). `toCandidate` converts an accepted proposal into a `TopicCandidate` with `planOrder`, `evidenceHash`, `slug`, and `seedKeys`; `compareProposalPreference` orders candidates deterministically (the test excerpt shows the result is stable under module reordering, indicating a stable preference comparator).

`validateTopicPlan` runs all checks: `topic_plan_invalid_json`, `topic_plan_invalid_shape`, `topic_plan_too_many`, `topic_plan_empty`, `topic_plan_unknown_reference`, `topic_plan_auxiliary_only`, `topic_plan_auxiliary_disconnected`, `topic_plan_unscoped_anchor`, `topic_plan_module_budget`, `topic_plan_flow_budget`, `topic_plan_anchor_budget`, `topic_plan_missing_group`, `topic_plan_anchor_overlap`, `topic_plan_insufficient_product_evidence`, `topic_plan_source_budget`, and `topic_plan_text_budget`. When `topic_plan_source_budget` fails, `repairTopicPlanSourceBudgetMechanically` drops costliest non-product anchors first and re-validates; the fixture in `budgetInventory`/`budgetProposal` exercises exactly that path (5 cheap product anchors vs. 2 expensive non-product anchors). The visible source is truncated past the signatures, so per-error return semantics beyond the documented codes are not established here.

## Topics tests — fixtures
<!-- lw:anchors packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.test.ts#budgetInventory packages/core/src/topics.test.ts#budgetProposal -->

```ts
function inventory(): TopicPlanningInventory;
function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal;
function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory;
function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal;
```

`inventory` and `proposal` build the standard two-module fixture used to assert acceptance, rejection of unknown references, and rejection of competing overlapping topics. `budgetInventory` and `budgetProposal` build the dedicated source-budget fixture (6 product anchors vs. 2 non-product anchors, with the non-product anchors sized to exceed `maxSourceChars`) used to assert that `repairTopicPlanSourceBudgetMechanically` drops the costliest non-product anchors first and re-validates cleanly.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency and dependent
- [Manifest persistence, Markdown masking, module partitioning, and mermaid validation](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
