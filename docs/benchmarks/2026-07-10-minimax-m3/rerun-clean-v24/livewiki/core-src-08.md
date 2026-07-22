---
title: Core product modules — prompts, safe I/O, status, symbols, and topics
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

# Core product modules — prompts, safe I/O, status, symbols, and topics

This page covers the Stage 3–5 product modules in `packages/core/src` that produce wiki content: the prompt templates, the disk I/O allowlist guard, the status reporter, the tree-sitter symbol extractor, and the topic-planning validator.

## When to use this page

- **Audit** the prompt contract the LLM receives by reading `PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, and `TOPIC_PAGE_PROMPT_RULES`.
- **Diagnose** symlink-escape or traversal failures reported by `safe-io` and trace them through `isInsideAllowlist` and `resolveAndValidate`.
- **Review** topic-plan proposals with `validateTopicPlan` and apply the mechanical budget fix via `repairTopicPlanSourceBudgetMechanically`.

## How it fits

These five files sit under `packages/core/src/` and form the late-batch and reporting layer of the pipeline: `prompts.ts` produces the system/user prompt pairs that Stage 4, Stage 5, topic-plan, and repair builders send to the LLM; `safe-io.ts` is the only module permitted to touch disk and gates every read/write inside `livewiki/` and `.livewiki/`; `status.ts` reads the SQLite index built by Phase 1/2 to summarise files, symbols, debt, undocumented symbols, and incremental token metrics; `symbols.ts` walks tree-sitter trees emitted by `parser.ts` to produce the closed symbol list used as anchors; `topics.ts` consumes the closed inventory of accepted pages and validates the LLM's proposed topic groupings against structural and budget constraints. The `*.test.ts` siblings live next to their implementation and exercise the public surface plus a small number of internal helpers.

## Prompt budgets and editorial rules

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET -->

The default code-context and answer budgets are fixed exports:

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
```

`DEFAULT_CONTEXT_TOKEN_BUDGET` caps the slice of source code passed per module; `DEFAULT_OUTPUT_TOKEN_BUDGET` caps the Markdown the LLM may emit. `FLOW_DIAGRAM_DEFAULT_BUDGET` is the upper bound on the Mermaid diagram the Stage 5 flow-page builder asks the LLM to draw — 12 nodes and 20 edges, so a single mega-diagram is rejected in favour of several focused flows.

## Shared editorial rule constants

<!-- lw:anchors packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE -->

`PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, and `TOPIC_PAGE_PROMPT_RULES` are the three rule arrays shared between initial and repair prompts — they must not drift, because the repair prompt inherits the same structural expectations as the initial prompt. `LITERAL_SIGNATURE_PROMPT_RULE` and `EXCEPTION_BRANCH_PROMPT_RULE` are single-string rules injected into Stage 4 / Stage 5 system prompts that require the LLM to copy signatures byte-for-byte from the supplied symbol table and to surface visible `throw`, `catch`, fallback, rollback, or early-return branches rather than inventing them. The supplied source excerpt shows these arrays are non-empty string literals — exact wording is not visible in the truncated portion, so downstream callers should treat them as the canonical contract without re-deriving the text.

## Fence-selection helpers

<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

```ts
function longestRunOf(text: string, char: "`" | "~"): number {
function boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string {
function selectSafeFence(enclosed: string): { fence: string; content: string } {
function wrapInSafeFence(enclosed: string): string {
export function neutralizeUntrustedControlMarkers(text: string): string {
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

`longestRunOf` measures the longest contiguous run of a fence character (`` ` `` or `~`) inside the supplied text. `boundEncodeLongRuns` rewrites runs longer than `cap` so the resulting string can be safely wrapped by a fence that uses the same character. `selectSafeFence` picks a fence character whose length exceeds the longest run inside the content and returns both the fence and the (possibly encoded) content; `wrapInSafeFence` is the convenience wrapper that returns the full fenced block. `neutralizeUntrustedControlMarkers` strips `lw:*` markers from untrusted LLM output, and `neutralizeUntrustedControlMarkersExceptValidAnchors` keeps only the markers whose key appears in a caller-supplied allowlist (typically the closed list). The supplied excerpt does not show the exact body of `neutralizeUntrustedControlMarkersExceptValidAnchors`, so callers should not assume a particular allowlist shape beyond a `Set`-like or array argument.

## Stage 4 and quickstart/overview builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#formatTopicGroups -->

`buildStage4Prompt` is the system+user prompt pair sent for the per-module batch; `buildRepairPrompt` is the prompt the verifier feeds back to the LLM when the previous attempt failed verification. `buildStage2RefinePrompt`, `buildQuickstartPrompt`, and `buildOverviewPrompt` produce the smaller, non-batch prompts used by earlier phases. `buildFlowGroupBlock` and `formatTopicGroups` are formatting helpers — `buildFlowGroupBlock` emits the per-flow evidence block the Stage 5 prompt embeds, and `formatTopicGroups(groups: TopicKeyGroups): string[]` renders the four topic groups (`contract` / `state` / `output` / `failure`) for prompt inclusion. The supplied source excerpt does not include the function bodies, so the exact signatures beyond `formatTopicGroups` are not visible — callers should rely on the symbol table for the precise shape.

## Stage 5 flow-page builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildTopicPlanPrompt packages/core/src/prompts.ts#buildTopicPlanRepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt -->

`buildStage5Prompt` produces the prompt pair for generating a flow page under the `FLOW_PAGE_PROMPT_RULES` contract (purpose → ordered flow → diagram → invariants → failure and recovery → related pages); `buildStage5RepairPrompt` is the matching repair prompt. `buildTopicPlanPrompt` and `buildTopicPlanRepairPrompt` drive the topic-plan proposal step, and `buildTopicPrompt` / `buildTopicRepairPrompt` drive the per-topic page generation. As with the Stage 4 builders, the supplied excerpt does not show the bodies, so the precise argument lists beyond their exported names are not established here.

## Disk I/O allowlist guard

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist -->

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
export function isInsideAllowlist(
```

`ALLOWED_DIRS` is the closed list of directories inside `repoRoot` where the pipeline may read and write; `allowlistFor(opts: SafeIoOptions): readonly string[]` extends this with `AGENTS.md` / `CLAUDE.md` at the root only when `opts.allowPointer === true`. `allowedAbs(repoRoot: string, dir: AllowedDir): string` returns the absolute path of an allowed directory and throws if `dir` would escape `repoRoot` (fail-closed — the supplied excerpt shows this defensive check). `isInsideAllowlist` is pure (no disk I/O), normalises the candidate path, and decides membership by comparing `path.relative(allowed, target)` against `..` and absolute — prefix matches are not substring matches, so `livewiki-evil` is rejected. The two error classes `PathOutsideAllowlistError` and `InvalidRelativePathError` carry `name`, `repoRoot`, `attempted`, and `allowlist` (or `relPath` and `reason`); both set `this.name` so `err instanceof` checks behave under minification.

## Path validation and symlink defence

<!-- lw:anchors packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

```ts
function validateDeclared(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions,
): string
function findDeepestExisting(
  from: string,
  stopAt: string,
): readonly [ancestor: string, suffix: string]
export async function resolveAndValidate(
```

`validateDeclared` is the fast first pass: it rejects absolute paths with `InvalidRelativePathError`, rejects any `..` segment after normalisation, then rejects paths outside the allowlist with `PathOutsideAllowlistError`. `findDeepestExisting(from, stopAt)` walks from `from` toward `stopAt` using `existsSync` and returns `[ancestor, suffix]` so the caller can `realpath` the deepest existing ancestor and re-append `suffix`. `resolveAndValidate` is the public entry point used by every other module: it runs `validateDeclared` for the fast-fail path, then performs the realpath + revalidation dance that closes the symlink-escape attack class described in the file header. `writeText`, `readText`, `exists`, `mkdir`, and `remove` are the thin wrappers that go through `resolveAndValidate` and so inherit the same defence. `detectSymlinkSupport` in the test file is the test-time probe that creates and removes a probe symlink to gate symlink-sensitive test cases via `it.runIf(canSymlink)` on platforms where symlink creation requires admin or Developer Mode.

## Status reporting

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

```ts
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>
function collect(db: import("better-sqlite3").Database, topN: number): StatusReport
export function formatHuman(report: StatusReport): string {
```

`run` is the public entry point: it resolves `.livewiki/index.db` through `safeIo.resolveAndValidate`, opens it via `openIndex`, calls `collect`, then wraps `collect` with a best-effort `snapshotMetrics` that swallows errors and sets `report.metrics = null` on failure. `collect` runs the SQL aggregations for active files (with `byLang` and the `topN` biggest files by symbol count), active symbols (`byKind`), unresolved debt rows (joined to `anchors` and `doc_pages` to populate `symbol_key` and `wiki_path`, with `byEvent` and `byAssignee` tallies), and `undocumented` rows whose `dismissed` flag is zero (returning up to 20 as a sample). `formatHuman` is the multi-line text renderer used by the CLI: it always prints the `livewiki status` banner plus the indexed-files, symbols, debt, undocumented, and meta lines, and only renders a section when there is data to show — `last_indexed_at` and `last_ledger_at` fall back to `never` when null. The supplied excerpt does not show the full body of `formatHuman`, so any line not visible above (for example the per-file breakdown of `top`) is not asserted here.

## Symbol extraction

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord -->

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: ExtractedSymbol[],
): void
function makeRecord(
function toSymbolRecord(symbol: ExtractedSymbol): SymbolRecord
function signatureFor(node: Node, source: string): string | null
```

`extractSymbols` drives the walk and then dedupes candidates: it sorts by `(start_line, source_start_byte, discoveryOrder)`, drops later entries whose `key` is already seen, and maps survivors through `toSymbolRecord`. `walkNode` is the per-node dispatcher — `function_declaration` and `generator_function_declaration` emit a `function` record; `class_declaration` (TypeScript) and `class_definition` (Python, treated via the same `class` switch arm) emit a `class` record and recursively descend so `method_definition` / `function_definition` children emit `Parent.method` records; `export_statement` covers `export function` / `export class` once (so a class isn't double-emitted as both `class` and `export`) and emits each `export const` declarator as `kind: "export"`. `makeRecord` constructs the internal `ExtractedSymbol` (which carries `source_start_byte` for tie-breaking), `toSymbolRecord` strips that private field, and `signatureFor` slices the first line of the node so prompts and anchors can quote a representative header.

## Topic-planning validation surface

<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically -->

```ts
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
export async function buildTopicPlanningInventory(opts: {
  repoRoot: string;
  modules: Module[];
  pathRoleConfig?: PathRoleConfig;
  allowedFlowSlugs?: ReadonlySet<string>;
  edges?: ReadonlyArray<{ from: string; to: string }>;
  flowCandidates?: ReadonlyArray<FlowCandidate>;
}): Promise<TopicPlanningInventory>
export function serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string
export function validateTopicPlan(
export function repairTopicPlanSourceBudgetMechanically(
```

`TOPIC_GROUP_NAMES` is the canonical four-group ordering every proposal must use. `buildTopicPlanningInventory` reads each accepted `livewiki/<moduleId>.md` through `safeIo` (so missing or unreadable pages are skipped silently via `.catch(() => null)`), parses the frontmatter, classifies each anchor's source path via `classifyPathRole`, and produces a deterministic inventory sorted by `module.id`; flow pages are admitted only when their slug is in `opts.allowedFlowSlugs` and the matching `livewiki/diagrams/flow-<slug>.mmd` exists. `serializeTopicPlanningInventory` is the inverse the LLM-facing prompt uses to render the inventory. `validateTopicPlan` parses the LLM JSON, walks each proposal through `parseProposal` → `toCandidate`, then enforces the structural and budget constraints (`topic_plan_invalid_json`, `topic_plan_too_many`, `topic_plan_unknown_reference`, `topic_plan_anchor_overlap`, `topic_plan_insufficient_product_evidence`, `topic_plan_source_budget`, and the rest of the `TopicPlanValidationCode` union) — the supplied excerpt does not show the full body, so callers should not assume which constraint fires first on a given failure. `repairTopicPlanSourceBudgetMechanically` is the deterministic post-pass that drops the costliest non-product anchors first and re-validates clean (the `budgetInventory` / `budgetProposal` fixtures in `topics.test.ts` confirm this ordering).

The helpers below the inventory builders keep proposals honest: `isRecord` / `isStringArray` are the type guards used by `parseProposal`; `normalizeLabel` and `uniqueSorted` canonicalise strings before comparison; `stripOuterJsonFence` lets the validator accept responses wrapped in ```` ```json ... ``` ````; `extractOpeningSentence` / `extractH2Titles` / `extractSectionBullets` parse each page body to populate `TopicModuleEvidence`; `classifyTopicSignals` derives the `signals` array from paths and body; `measureAnchorSourceChars` walks the source for each anchor key to size the budget check; `normalizeGroups`, `compareProposalPreference`, `toCandidate`, `errorAt`, and `addDuplicateError` are the validation internals used by `validateTopicPlan` and `repairTopicPlanSourceBudgetMechanically`. The supplied excerpt does not establish exhaustive behaviour for any of these helpers, so the descriptions above are scoped to what the visible signatures and call sites confirm.

## Topic-planning test fixtures

<!-- lw:anchors packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.test.ts#budgetInventory packages/core/src/topics.test.ts#budgetProposal packages/core/src/symbols.test.ts#parse -->

```ts
function inventory(): TopicPlanningInventory
function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal
function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory
function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal
async function parse(ext: string, src: string)
```

`inventory()` and `proposal()` are the canonical happy-path fixtures: two product modules with six product anchors total, one proposal grouping them across all four groups, and a `validateTopicPlan` run that asserts `ok === true`, an empty errors list, and a stable candidate whose `seedKeys` equal the union of every anchor sorted. `budgetInventory(productChars, nonProductChars)` and `budgetProposal()` are the dedicated mechanical-repair fixtures: six product anchors at `productChars` each (default 100) plus two expensive non-product anchors at `nonProductChars` each (default 3000), with a product ratio of exactly 6/8 = 0.75 — the accepted minimum — so the only failure the fixture trips is `topic_plan_source_budget`, and `repairTopicPlanSourceBudgetMechanically` must drop the expensive non-product anchors first while keeping every constraint satisfied. `parse(ext, src)` is the test-side wrapper around `parseSource` from `parser.ts` used by the symbol-extraction tests.