---
title: Core source — prompts, safe I/O, status, symbols, topics
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

# Core source — prompts, safe I/O, status, symbols, topics

This module groups five internal services that back livewiki's stages: the LLM prompt templates used by stages 4 and 5, the path-allowlisted I/O layer that gates every disk write, the status report aggregator, the tree-sitter based symbol extractor, and the topic-planning validator.

## When to use this page

- **Audit** the LLM-facing prompt templates and shared editorial rules before changing stage-4 or stage-5 output shape.
- **Trace** how a relative path becomes a validated, symlink-safe absolute path under `safe-io` before any read or write.
- **Verify** the status report (`status.run`) and the symbol-extraction contract (`extractSymbols`) when investigating indexer drift.
- **Diagnose** the topic-plan validator and the mechanical budget repair when stage-5 replanning keeps failing the same inventory.

## How it fits

The five files in this module sit between livewiki's CLI commands and its supporting modules (`db`, `parser`, `hashes`, `frontmatter`, `modules`, `flows`, `diagrams`). `prompts.ts` exports prompt builders that consume `Module` and `FlowCandidate` shapes and emit system/user `PromptPair`s for the LLM client. `safe-io.ts` is the only sanctioned disk gateway: it resolves and validates relative paths against the `livewiki/` + `.livewiki/` allowlist and re-validates after a `realpath` walk to defeat symlink-escape attacks. `status.ts` opens the SQLite index, materialises a `StatusReport` snapshot, and renders it as either structured JSON or human-readable text. `symbols.ts` walks a parsed tree-sitter tree and emits deduplicated `SymbolRecord`s used by the indexer and the frontmatter contract. `topics.ts` builds a closed `TopicPlanningInventory`, validates model-emitted proposals against that inventory, and can mechanically trim proposals that exceed the source-character budget.

The accompanying `*.test.ts` files live next to each source module and exercise both the normal path and the visible failure branches (path traversal, allowlist rejection, symlink attacks, content-hash determinism, plan validation, mechanical budget repair).

## Prompt templates and editorial rules

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE -->

`prompts.ts` exports the budget constants the LLM client caps the prompt against and the shared editorial rule arrays that the initial and repair prompts both cite. The supplied excerpt establishes:

- `export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;`
- `export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;`
- `export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;`

`PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, and `TOPIC_PAGE_PROMPT_RULES` are string arrays that describe the frontmatter + H1 + `When to use this page` + `How it fits` opening, the `Purpose` / `Ordered flow` / `Diagram` / `Invariants` / `Failure and recovery` / `Related pages` flow-page outline, and the topic-page contract respectively. `LITERAL_SIGNATURE_PROMPT_RULE` instructs the LLM to copy symbol signatures verbatim; `EXCEPTION_BRANCH_PROMPT_RULE` instructs it to scope prose to the normal path and to surface visible `throw`/`catch` branches instead of speaking in absolutes.

The module comment notes that prompt text is in English by design — `${language}` controls only the output language, not the prompt string — and that the closed list of symbol keys is the only canonical key source the LLM receives.

## Stage-4 prompt builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

`buildStage4Prompt` and its `buildRepairPrompt` companion produce the module-page stage-4 prompt pair, sharing `PAGE_OPENING_PROMPT_RULES` so initial and repair output cannot drift. `buildStage2RefinePrompt` produces a stage-2 refinement prompt and operates on the same constant set. Each builder composes a system string that embeds the closed key list and a user string that names the module under generation; the supplied excerpt truncates before the full body, so user-message shape is not established here.

The fence-safety helpers (`longestRunOf`, `boundEncodeLongRuns`, `selectSafeFence`, `wrapInSafeFence`) exist to keep user-supplied or LLM-emitted Markdown safe to embed without breaking Markdown fences. `neutralizeUntrustedControlMarkers` and `neutralizeUntrustedControlMarkersExceptValidAnchors` strip or neutralise any `lw:*` control markers that appear in untrusted text before it reaches the renderer; the latter preserves only keys that match the supplied closed-list allowlist.

## Stage-5 prompt builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#formatTopicGroups -->

`buildStage5Prompt` and `buildStage5RepairPrompt` produce the stage-5 page-prompt pair, also sharing the editorial rule constants to keep both prompts aligned. `buildQuickstartPrompt` and `buildOverviewPrompt` produce the project-level landing prompts. `buildFlowGroupBlock` and `formatTopicGroups` shape the topic-group evidence block into the system prompt; the supplied signatures establish:

- `function buildFlowGroupBlock(`
- `function formatTopicGroups(groups: TopicKeyGroups): string[] {`

`formatTopicGroups` accepts the four-group `TopicKeyGroups` shape (`contract`, `state`, `output`, `failure`) and returns one string per group ready to drop into the prompt. Both helpers interact with the topic planning flow documented in the topics section below.

## Topic-plan prompt builders

<!-- lw:anchors packages/core/src/prompts.ts#buildTopicPlanPrompt packages/core/src/prompts.ts#buildTopicPlanRepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt -->

`buildTopicPlanPrompt`, `buildTopicPlanRepairPrompt`, `buildTopicPrompt`, and `buildTopicRepairPrompt` produce the prompts used by stage 5 to plan and write per-topic pages. The supplied excerpt does not establish the exact parameter shapes for these builders, so this section limits itself to the names and kinds visible in the symbol table. They share `TOPIC_PAGE_PROMPT_RULES` with the rest of the prompt family and consume the closed `TopicPlanningInventory` produced by `topics.ts`.

## Path-allowlisted disk gateway

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting -->

`safe-io.ts` centralises every disk read and write. The supplied module comment and source establish:

- `export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;`
- `export function isInsideAllowlist(repoRoot: string, absPath: string, opts: SafeIoOptions = {}): boolean {`
- `function validateDeclared(repoRoot: string, relPath: string, opts: SafeIoOptions): string {`
- `function findDeepestExisting(from: string, stopAt: string): readonly [ancestor: string, suffix: string] {`
- `function allowlistFor(opts: SafeIoOptions): readonly string[] {`
- `function allowedAbs(repoRoot: string, dir: AllowedDir): string {`

`validateDeclared` performs the fast syntactic pass — it rejects absolute paths (`InvalidRelativePathError`), rejects `..` traversal segments, and rejects paths whose resolved absolute target is outside `ALLOWED_DIRS` (`PathOutsideAllowlistError`). `findDeepestExisting` then walks up from the target to the deepest existing ancestor and returns `[ancestor, suffix]`; the calling code calls `realpath` on that ancestor and re-runs `isInsideAllowlist` against the real path to defeat symlink-escape attacks. `allowlistFor` extends the allowlist with `AGENTS.md` and `CLAUDE.md` only when `opts.allowPointer` is explicitly set. `allowedAbs` defends in depth by asserting that the literal `ALLOWED_DIRS` entries resolve inside `repoRoot`; if they ever escape, `allowedAbs` `throw`s an internal error rather than succeeding.

The two error classes carry the context needed for callers to format useful messages: `PathOutsideAllowlistError` exposes `repoRoot`, `attempted`, and `allowlist`; `InvalidRelativePathError` exposes the offending `relPath` and the `reason`. The supplied constructors are:

- `constructor(repoRoot: string, attempted: string, allowlist: readonly string[]) {`
- `constructor(relPath: string, reason: string) {`

## Safe I/O operations

<!-- lw:anchors packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

`resolveAndValidate` is the public entrypoint: it accepts a relative path, runs `validateDeclared`, then performs the `findDeepestExisting` + `realpath` + re-validation sequence and returns a final absolute path. The exported operations all wrap this resolution:

- `export async function resolveAndValidate(`
- `export async function writeText(`
- `export async function readText(`
- `export async function exists(`
- `export async function mkdir(`
- `export async function remove(`

Failure paths visible in the supplied excerpt include `InvalidRelativePathError` for absolute or `..`-bearing paths, `PathOutsideAllowlistError` for paths outside `ALLOWED_DIRS`, and a defensive `throw` inside `allowedAbs` if a literal allowlist entry ever resolves outside `repoRoot`. The symlink revalidation that closes `resolveAndValidate` is established conceptually but its tail block is truncated in the excerpt.

## Safe I/O test fixtures

<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport` is the test-only helper:

- `async function detectSymlinkSupport(): Promise<boolean> {`

It writes a probe file in `os.tmpdir()`, attempts a `node:fs/promises.symlink` against it, returns `true` if the symlink is created and `false` otherwise. Symlink-sensitive tests then gate on `it.runIf(canSymlink)` so Windows runners without Developer Mode skip rather than fail. The supplied excerpt ends inside the symlink-attack suite, so the full set of attack fixtures is not shown here.

## Status report entrypoint and rendering

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#formatHuman -->

`status.ts` exports:

- `export async function run(repoRoot: string, opts: StatusOptions = {}): Promise<StatusReport> {`
- `export function formatHuman(report: StatusReport): string {`

`run` resolves `.livewiki/index.db` through `safeIo.resolveAndValidate`, opens it with `openIndex`, calls `collect` to build the full `StatusReport`, then best-effort calls `snapshotMetrics(absRoot)` and assigns the result to `report.metrics`; if `snapshotMetrics` throws, `run` swallows the error and leaves `metrics = null`. Finally `run` closes the database in a `finally` block. `formatHuman` renders the same `StatusReport` as a multi-line text block beginning with the literal line `livewiki status`; the supplied excerpt truncates the function body, so the complete line list is not established here.

## Status collection

<!-- lw:anchors packages/core/src/status.ts#collect -->

`function collect(db: import("better-sqlite3").Database, topN: number): StatusReport {` is the internal aggregation function. It reads active files and symbols from the SQLite database, builds `byLang` and `byKind` histograms, computes a top-N list of files by symbol count, joins `debt` with `anchors` and `doc_pages` to materialise open debt items grouped by event (`changed`/`moved`/`deleted`) and assignee (`agent`/`human`), reads `undocumented` rows for the sample list, and reads `schema_version`, `last_indexed_at`, and `last_ledger_at` from the `meta` table. `collect` returns `metrics: null`; `run` overwrites it after collection. The supplied excerpt truncates `formatHuman`'s rendering loop, so the exact line order is not documented here beyond the visible `Indexed files`, `Extracted symbols (active)`, `Open debt`, `Undocumented`, and `last_indexed_at` lines asserted by the test fixture.

## Symbol extraction entrypoint

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord -->

`extractSymbols` is the public API:

- `export function extractSymbols(tree: Tree, relPath: string, source: string): SymbolRecord[] {`

It walks the root node, collects candidate `ExtractedSymbol`s, sorts them by `start_line` then `source_start_byte` then discovery order, deduplicates by `key` (first occurrence wins), and strips the auxiliary `source_start_byte` field via `toSymbolRecord`. The `walkNode` switch dispatches on tree-sitter node type — `function_declaration`, `generator_function_declaration`, `class_declaration`/`class`, `method_definition`, `export_statement`, `function_definition` — and emits the appropriate `SymbolKind`. For `export class` / `export function` it intentionally suppresses the inner declaration so the symbol is not emitted twice; for `export const` it emits one `kind: "export"` entry per declarator. `makeRecord` constructs the raw `ExtractedSymbol` (with `source_start_byte`); `toSymbolRecord` returns the public `SymbolRecord`; `signatureFor` produces the header slice used for anchor text.

The file's preamble states extraction is "honest": anonymous arrows and IIFEs are intentionally skipped because they cannot carry a referencable symbol key.

## Symbol test fixture

<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

`parse` is the test-local wrapper:

- `async function parse(ext: string, src: string) {`

It delegates to `parseSource` from the shared `parser.js` module after `beforeAll(initParser)`. The supplied excerpt establishes that the test suite asserts: top-level `function_declaration` extraction, class + qualified-method extraction, `export class` and `export function` non-duplication, `export const` extraction as `kind: "export"`, multiline signature capture, content-hash sensitivity to body changes, content-hash determinism, and collapse/coalesce behavior for same-named object methods vs class-qualified methods.

## Topic planning inventory and serialization

<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#classifyTopicSignals -->

`topics.ts` defines `TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const` and the `TopicKeyGroups` mapping. The supplied entry signature is:

- `export async function buildTopicPlanningInventory(opts: { repoRoot: string; modules: Module[]; pathRoleConfig?: PathRoleConfig; allowedFlowSlugs?: ReadonlySet<string>; edges?: ReadonlyArray<{ from: string; to: string }>; flowCandidates?: ReadonlyArray<FlowCandidate>; }): Promise<TopicPlanningInventory> {`

`buildTopicPlanningInventory` iterates the supplied modules sorted by `id`, reads each `livewiki/<id>.md` through `safeIo.exists` / `safeIo.readText`, parses its frontmatter, classifies the path role of every anchor, derives the responsibility sentence via `extractOpeningSentence`, derives `whenToUse` from the `When to use this page` bullets via `extractSectionBullets`, derives the list of H2 sections via `extractH2Titles`, derives `importNeighbors` from the optional edges, and derives `signals` via `classifyTopicSignals`. The helpers established in the symbol table are:

- `function extractOpeningSentence(body: string): string | null {`
- `function extractH2Titles(body: string): string[] {`
- `function extractSectionBullets(body: string, title: string): string[] {`
- `function classifyTopicSignals(paths: readonly string[], body: string): string[] {`

`extractOpeningSentence` returns the first non-empty sentence of the page body used as the `TopicModuleEvidence.responsibility` summary. `extractH2Titles` returns the ordered H2 headings used as `sections`. `extractSectionBullets` returns the bullet items under the named H2 (the "When to use this page" list). `classifyTopicSignals` produces the `signals` array (e.g. `entry/boundary`, `persistence/state`, `output`) by combining path patterns with body evidence.

The inventory builder then walks `livewiki/flows/<slug>.md` (skipping `index.md`) and matches each one against `allowedFlowSlugs` and a companion `livewiki/diagrams/flow-<slug>.mmd` before adding it to the inventory. `serializeTopicPlanningInventory` renders the inventory as a deterministic string for the LLM; `uniqueSorted` is the helper used to stabilise anchor and neighbor lists.

## Topic plan validation

<!-- lw:anchors packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError -->

`validateTopicPlan` consumes the raw LLM JSON, slices off any outer json fence via `stripOuterJsonFence`, parses it, and dispatches each proposal through `parseProposal`. The supplied excerpt establishes the `validateTopicPlan` export but its body is truncated; downstream helpers visible in the excerpt and symbol table are:

- `function parseProposal(value: unknown, index: number, errors: TopicPlanValidationError[]): TopicPlanProposal | null {`
- `function toCandidate(proposal: TopicPlanProposal, planOrder: number): TopicCandidate {`
- `function normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups {`
- `function stripOuterJsonFence(raw: string): string {`
- `function compareProposalPreference(`
- `function errorAt(code: TopicPlanValidationCode, proposalIndex: number, message: string): TopicPlanValidationError {`
- `function addDuplicateError(`

`compareProposalPreference` orders competing proposals so the strongest surviving candidate appears first. `errorAt` is the validation-error factory; `addDuplicateError` aggregates duplicate-title / duplicate-intent errors with the proposal index. `validateTopicPlan` returns `{ ok, candidates, errors }` and, when no errors are recorded, produces a stable `TopicCandidate` per accepted proposal with a deterministic `slug`, `planOrder`, `seedKeys` (the union of all four groups), and a `evidenceHash`. The supplied excerpt does not establish the exact ordering of checks inside `validateTopicPlan`, so it is described here to the extent visible: the JSON is unwrapped, each proposal is parsed, duplicates are accumulated, and one candidate per accepted proposal is produced.

## Mechanical budget repair

<!-- lw:anchors packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray -->

`repairTopicPlanSourceBudgetMechanically` is the fallback corrector that fixes a `topic_plan_source_budget` failure without re-querying the LLM. Given a proposal plus `anchorSourceChars` from `measureAnchorSourceChars`, it drops the costliest anchors first (preferring to drop anchors whose role is not `product` before product anchors) until the proposal fits `maxSourceChars`, the per-group groups remain non-empty, and the product-anchor ratio stays above `minimumProductAnchorRatio`. `measureAnchorSourceChars` reads each anchor's source slice through `safe-io` and returns a `Record<key, chars>`; the supplied excerpt truncates the implementation of `repairTopicPlanSourceBudgetMechanically` before its final re-validation call, so the failure path is documented only to the extent described above. `normalizeLabel`, `isRecord`, and `isStringArray` are the small type guards / normalisers used by the validator and the repair function.

## Topic planning test fixtures

<!-- lw:anchors packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.test.ts#budgetInventory packages/core/src/topics.test.ts#budgetProposal -->

The test module supplies four local builders:

- `function inventory(): TopicPlanningInventory {`
- `function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {`
- `function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory {`
- `function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {`

`inventory` and `proposal` build a two-module / six-anchor inventory and a corresponding proposal whose four groups cover every anchor; the suite asserts that the validator accepts the proposal, that reordering the inventory's `modules` array yields the same candidate (order-independence), that unknown module references are rejected with `topic_plan_unknown_reference`, and that competing proposals whose anchor evidence overlaps beyond `maximumOverlapRatio` are rejected with `topic_plan_anchor_overlap`. `budgetInventory` constructs a fixture with six product anchors (100 chars each) and two non-product anchors (3000 chars each) so the product ratio is exactly at the accepted minimum; `budgetProposal` then trips `topic_plan_source_budget` so the test asserts that `repairTopicPlanSourceBudgetMechanically` drops the costliest non-product anchors first and that the resulting proposal re-validates clean.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency and dependent
- [Core module identification, manifest IO, and Markdown masking](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
