---
title: Stage-5 planning, prompt templates, and safe disk I/O core
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

# Stage-5 planning, prompt templates, and safe disk I/O core

This page documents the core-side helpers that drive stage-5 semantic topic planning, the prompt templates sent to the LLM, the safe disk I/O allowlist, the SQLite-backed status report, and the tree-sitter symbol extractor.

## When to use this page

- **Build** stage-5 planning prompts with `buildTopicPlanPrompt` / `buildTopicPlanRepairPrompt` and inspect their anchor-group contract.
- **Audit** the prompt template rule constants (`PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES`, `TOPIC_PAGE_PROMPT_RULES`, etc.) and the budget constants when changing how much source is sent to the LLM.
- **Trace** safe disk I/O behavior (`resolveAndValidate`, `isInsideAllowlist`, `PathOutsideAllowlistError`, `InvalidRelativePathError`) when adding new file-touching modules or hardening symlink defense.
- **Diagnose** the `livewiki status` report (`run`, `collect`, `formatHuman`) when indexed-file counts, debt, or undocumented-symbol counts look wrong.

## How it fits

The module groups five cooperating concerns under `packages/core/src`. `prompts.ts` is the template layer that every stage-2/stage-4/stage-5 LLM call uses to compose `system` + `user` prompt pairs and to neutralize untrusted control markers before sending output to disk. `safe-io.ts` is the single chokepoint for disk writes in the repo, enforcing the `livewiki/` + `.livewiki/` allowlist and re-validating after `realpath` to defeat symlink escapes; the matching `safe-io.test.ts` exercises both the declared-path fast-fail and the symlink attack cases. `status.ts` queries the SQLite index (`.livewiki/index.db`) through `safe-io` and renders a human-readable snapshot of files, symbols, debt, and undocumented entries. `symbols.ts` walks tree-sitter ASTs to emit `SymbolRecord` rows, with `extractSymbols` orchestrating the traversal and `walkNode` recursing through TypeScript and Python constructs. Finally, `topics.ts` runs the stage-5 semantic planning pass: it builds a closed inventory of accepted module/flow evidence, sends it through a series of validators (`validateTopicPlan`, `repairTopicPlanSourceBudgetMechanically`), and produces stable `TopicCandidate` rows; `topics.test.ts` carries the fixtures for both happy-path validation and the mechanical source-budget repair.

The set lives entirely in `packages/core/src` and is consumed by higher-level pipeline modules (`update.ts`, `flows.ts`, `modules.ts`, `frontmatter.ts`) — this page only describes what is visible in the five implementation files plus their test files.

## Prompt budgets and shared rule constants

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE -->

The budget constants are the defaults cited by the prompt builders when no explicit override is passed in by the caller.

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
```

`DEFAULT_CONTEXT_TOKEN_BUDGET` caps how many tokens of source/context a single batch prompt may reference, and `DEFAULT_OUTPUT_TOKEN_BUDGET` caps the response side. `FLOW_DIAGRAM_DEFAULT_BUDGET` is the explicit Mermaid size ceiling (`maxNodes: 12`, `maxEdges: 20`) that the flow-page rules repeat verbatim.

The rule constants are shared between initial and repair prompts so the two prompt builders cannot drift:

- `PAGE_OPENING_PROMPT_RULES` — the canonical structure every product page must follow (H1, responsibility sentence, `When to use this page`, `How it fits`, etc.) and the constraints on frontmatter `anchors` / `lw:anchors` markers.
- `FLOW_PAGE_PROMPT_RULES` — the canonical flow-page structure (`Purpose`, `Ordered flow`, `Diagram`, `Invariants`, `Failure and recovery`, `Related pages`), the diagram budget, and the bare `index.md` target rule for the flows hub.
- `TOPIC_PAGE_PROMPT_RULES` — the topic-page contract for stage-5 (sections, anchor-budget behaviour).
- `LITERAL_SIGNATURE_PROMPT_RULE` — instructs the model to copy signatures byte-for-byte from the supplied symbol table; the excerpts in this module confirm the rule is exported as a string constant.
- `EXCEPTION_BRANCH_PROMPT_RULE` — instructs the model to scope prose to the visible exception/branch when a `throw`/`catch`/early return is present, instead of using absolute language.

The excerpt establishes the constants and their exported shapes; full string contents are truncated by the source budget.

## Untrusted-marker neutralization and safe fence selection

<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

These helpers protect the verifier from LLM output that tries to inject or piggy-back on the orchestrator's own anchor syntax.

```ts
function longestRunOf(text: string, char: "`" | "~"): number {
function boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string {
function selectSafeFence(enclosed: string): { fence: string; content: string } {
function wrapInSafeFence(enclosed: string): string {
export function neutralizeUntrustedControlMarkers(text: string): string {
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

- `longestRunOf` scans `text` for the longest uninterrupted run of backtick or tilde characters and returns its length.
- `boundEncodeLongRuns` splits any run longer than `cap` into bounded chunks so the model cannot smuggle a fence through a verbatim quote.
- `selectSafeFence` picks a backtick/tile fence whose length strictly exceeds the longest run already inside `enclosed`, returning `{ fence, content }` so callers can embed safely.
- `wrapInSafeFence` composes `selectSafeFence` with a chosen wrapping fence and returns the fully-quoted string.
- `neutralizeUntrustedControlMarkers` is the strict-mode scrubber: it escapes any `lw:*` marker-shaped text found in `text` so a misbehaving model cannot forge anchors.
- `neutralizeUntrustedControlMarkersExceptValidAnchors` is the lenient variant — it preserves anchor markers whose keys are on the supplied closed list and escapes the rest.

The visible signatures establish the parameter shapes; truncated source means exhaustive branch coverage (e.g. exact escape sequences) is not asserted here.

## Stage-2, stage-4, and stage-5 prompt builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#formatTopicGroups packages/core/src/prompts.ts#buildFlowGroupBlock -->

These builders compose the per-stage `system`/`user` prompt pair around the shared rule constants.

```ts
export function buildStage2RefinePrompt(
export function buildStage4Prompt(
export function buildRepairPrompt(
export function buildQuickstartPrompt(
export function buildOverviewPrompt(
function formatTopicGroups(groups: TopicKeyGroups): string[]
function buildFlowGroupBlock(
```

- `buildStage2RefinePrompt` is the stage-2 refinement prompt; it composes the shared opening rules with a per-module context block.
- `buildStage4Prompt` is the main batch generator prompt used in stage 4 of the pipeline, embedding the closed key list and the relevant source excerpt.
- `buildRepairPrompt` is the paired stage-4 repair prompt, called when the verifier rejects a page; it embeds the verifier's error context alongside the same rule set as the initial prompt.
- `buildQuickstartPrompt` produces the stage-1 quickstart page prompt (no per-symbol anchors; explains the project at a high level).
- `buildOverviewPrompt` produces the architecture overview page prompt.
- `formatTopicGroups` renders a `TopicKeyGroups` map (the four named groups `contract`, `state`, `output`, `failure`) into the textual block the planner prompt embeds.
- `buildFlowGroupBlock` renders the per-flow entry/boundary/sink groups for the flow-prompt path.

Signatures are taken verbatim from the symbol table; their bodies are truncated by the source budget.

## Stage-5 topic planning prompts and repair prompts

<!-- lw:anchors packages/core/src/prompts.ts#buildTopicPlanPrompt packages/core/src/prompts.ts#buildTopicPlanRepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt -->

These builders wrap the topic-planning inventory plus the topic-page rule set.

```ts
export function buildTopicPlanPrompt(
export function buildTopicPlanRepairPrompt(
export function buildTopicPrompt(
export function buildTopicRepairPrompt(
export function buildStage5Prompt(
export function buildStage5RepairPrompt(
```

- `buildTopicPlanPrompt` is the initial stage-5 planner prompt: it embeds the closed topic inventory (modules + flows + anchor roles + per-anchor source char budgets) and the `TOPIC_PAGE_PROMPT_RULES` contract.
- `buildTopicPlanRepairPrompt` is the repair variant, fed back to the LLM when `validateTopicPlan` rejects the JSON it produced.
- `buildTopicPrompt` emits the per-topic page prompt once a topic has been accepted (uses the same opening rules).
- `buildTopicRepairPrompt` is the paired per-topic repair prompt.
- `buildStage5Prompt` is the umbrella prompt for the stage-5 pass; it composes the topic-plan and topic-page prompts into a single `PromptPair`.
- `buildStage5RepairPrompt` is the umbrella repair variant used when stage-5 verification fails.

The visible signatures establish the entry points; the snippet does not show parameter typing in full.

## Safe I/O allowlist and error types

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
export class PathOutsideAllowlistError extends Error {
  public readonly repoRoot: string;
  public readonly attempted: string;
  public readonly allowlist: readonly string[];
  constructor(repoRoot: string, attempted: string, allowlist: readonly string[]);
}
export class InvalidRelativePathError extends Error {
  constructor(relPath: string, reason: string);
}
function allowlistFor(opts: SafeIoOptions): readonly string[]
function allowedAbs(repoRoot: string, dir: AllowedDir): string
export function isInsideAllowlist(
export function validateDeclared(
export function resolveAndValidate(
export async function writeText(
export async function readText(
export async function exists(
export async function mkdir(
export async function remove(
```

- `ALLOWED_DIRS` is the closed tuple `["livewiki", ".livewiki"]` — the only directory roots where disk writes are accepted by default. Any path outside is rejected by the allowlist checks below.
- `allowlistFor` builds the effective allowlist for a given `SafeIoOptions`; when `allowPointer` is true it appends the special root files `AGENTS.md` and `CLAUDE.md`.
- `allowedAbs` returns the absolute path of a single allowed directory inside `repoRoot`. It throws (fail-closed) if the resolved directory escapes `repoRoot` — a depth-in-defence check that fires only on internal misconfiguration.
- `isInsideAllowlist` is the pure (no I/O) decision function. It compares `absPath` against each allowed root using prefix + separator (so `livewiki-evil` is not treated as inside `livewiki/`). With `allowPointer: true` it also matches `AGENTS.md` / `CLAUDE.md` by exact filename at the repo root.
- `PathOutsideAllowlistError` is thrown when `validateDeclared` or `isInsideAllowlist` rejects the path; the constructor captures `repoRoot`, `attempted`, and `allowlist` for diagnostics.
- `InvalidRelativePathError` is thrown for fast-fail rejections (absolute paths, `..` traversal) before the allowlist check runs; the constructor captures the offending path and a reason string.
- `validateDeclared` performs the fast-fail path-shape check: it rejects absolute paths and `..` segments via `InvalidRelativePathError`, then runs `isInsideAllowlist` and throws `PathOutsideAllowlistError` on miss.
- `findDeepestExisting` walks from a target path back to `stopAt` and returns the deepest existing ancestor plus the trailing non-existent suffix; the source excerpt truncates before the loop tail, but the function exists and is called by the symlink defense path.
- `resolveAndValidate` is the public entry point. It runs `validateDeclared` first (early throw on bad shape), then runs the symlink defense: walk to the deepest existing ancestor, `realpath` it, rebuild the final path, and re-validate with `isInsideAllowlist`. The supplied `safe-io.test.ts` exercises three attack shapes — `livewiki` itself as a symlink, `livewiki/sub` as a symlink, and `livewiki/leaf` pointing at `/etc/x` — and asserts every write is rejected.
- `writeText`, `readText`, `exists`, `mkdir`, `remove` are the public disk operations. They all funnel through `resolveAndValidate`, so an invalid path raises before any filesystem call; the truncated source does not show whether each function performs its own try/catch around the allowlist path, so behaviour on error propagation should be verified against the full file.
- `detectSymlinkSupport` (test-only) probes the OS once per test run by creating a probe symlink and returns `false` on platforms (notably Windows without Developer Mode) that cannot create symlinks. Tests sensitive to symlinks use `it.runIf(canSymlink)` to gate themselves.

The visible `throw` paths covered above are: `PathOutsideAllowlistError` from `validateDeclared` / `isInsideAllowlist`, `InvalidRelativePathError` from `validateDeclared`, and the internal-throw inside `allowedAbs` if the configured `dir` ever escapes `repoRoot`. Behaviour beyond the truncated portion of `findDeepestExisting` and the disk operations is not established by the supplied source.

## SQLite-backed status report

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

```ts
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>
function collect(db: import("better-sqlite3").Database, topN: number): StatusReport
export function formatHuman(report: StatusReport): string
```

- `run` is the public entry point. It resolves `.livewiki/index.db` through `safeIo.resolveAndValidate`, opens it via `openIndex`, calls `collect` with `opts.topN ?? 10`, then attaches a metrics snapshot from `snapshotMetrics` inside a `try/catch` that swallows failures and yields `metrics: null`. The database handle is always closed in a `finally` block.
- `collect` queries the `files`, `symbols`, `debt`, `anchors`, `doc_pages`, `undocumented`, and `meta` tables directly. It computes the per-language breakdown, the per-kind breakdown, the top-N files by symbol count, and the open-debt rollup grouped by `event` (`changed` / `moved` / `deleted`) and `assignee` (`agent` / `human`); it then reads schema version, `last_indexed_at`, and `last_ledger_at` from the `meta` table. `metrics` is left as `null` here — `run` overwrites it after `collect` returns because the snapshot needs `repoRoot` rather than the raw db handle.
- `formatHuman` renders the report as multi-line text. The visible `status.test.ts` asserts the rendered string contains the per-section headers (`Indexed files`, `Extracted symbols (active)`, `Open debt`, `Undocumented`, `last_indexed_at`), the top-N entries (`Top 2 files`), the debt summary (`changed=2`), and the per-debt lines (`[changed] agent src/foo.ts#bar`); `last_indexed_at` timestamps are emitted as ISO 8601 via `toISOString()`. The test for `top-N respected` confirms that when the `top` array contains more than `topN` items, the rendered output reports `Top N files` and not the array's full length.

The truncated source confirms `collect`'s SQL but does not show the full `formatHuman` body; the lines above summarize what the test file establishes.

## Tree-sitter symbol extraction

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.test.ts#parse -->

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
function signatureFor(node: Node, source: string): string | null
function toSymbolRecord(symbol: ExtractedSymbol): SymbolRecord
async function parse(ext: string, src: string)
```

- `extractSymbols` is the public entry point. It invokes `walkNode` on `tree.rootNode`, then sorts candidates by `(start_line, source_start_byte, discoveryOrder)` and dedupes by `key` while preserving first-seen order. The dedupe is what lets the function coalesce same-named object methods (the `coalesces same-named object methods while preserving qualified class methods` test in `symbols.test.ts` pins the exact key ordering for the multi-class multi-stub fixture).
- `walkNode` recurses through the tree-sitter AST. For TypeScript it handles `function_declaration` and `generator_function_declaration` (both → `function`), `class_declaration` / `class` (→ `class`; descends manually into `method_definition` to qualify as `Parent.method`), `method_definition` (→ `method`, qualified if a parent class is in scope), and `export_statement` — where `export function` / `export class` emit one entry of kind `function` / `class` and explicitly do not descend (to avoid duplicating the inner declaration), and `export const` emits the bound identifier as `export`. For Python it handles `function_definition` (qualified as `Class.method` when inside a class, top-level otherwise) and the `class_definition` body. Anon arrow functions and IIFEs are intentionally skipped because they have no referencable symbol name.
- `makeRecord` constructs the internal `ExtractedSymbol` (carrying `source_start_byte`); `toSymbolRecord` strips that field for the public `SymbolRecord` shape. Both `makeRecord` and `toSymbolRecord` exact signatures are truncated by the source budget.
- `signatureFor` captures the representative header line of a node (the `signature captures primeira linha do nó` test in `symbols.test.ts` confirms that a multi-line `function multiLine(...)` declaration has its signature starting with `function multiLine`).
- `parse` is the test-only helper that wraps `parseSource` from `./parser.js` so each `describe` block can simply `await parse(ext, src)`.

The test file pins specific key strings: a top-level function becomes `x.ts#foo`, an exported class becomes a single `x.ts#Foo` (no duplicate `export`), an exported const becomes `x.ts#VERSION` with `kind: "export"`, class methods become `x.ts#Foo.bar`, and Python methods become `x.py#Calculator.add`. The coalesce test asserts an exact key ordering of `["x.ts#First", "x.ts#First.generate", "x.ts#Second", "x.ts#Second.generate", "x.ts#generate"]` for the multi-class plus multi-stub fixture.

## Topic planning constants and inventory builder

<!-- lw:anchors packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#serializeTopicPlanningInventory -->

```ts
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const
function normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups
function extractOpeningSentence(body: string): string | null
function extractSectionBullets(body: string, title: string): string[]
function extractH2Titles(body: string): string[]
function classifyTopicSignals(paths: readonly string[], body: string): string[]
function uniqueSorted(values: readonly string[]): string[]
function normalizeLabel(value: string): string
async function measureAnchorSourceChars(repoRoot: string, keys: string[]): Promise<Record<string, number>>
export async function buildTopicPlanningInventory(opts: {
export function serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string
```

- `TOPIC_GROUP_NAMES` is the closed tuple `["contract", "state", "output", "failure"]` — the four groups every accepted topic proposal must populate.
- `normalizeGroups` dedupes and orders the keys in each `TopicKeyGroups` bucket, enforcing the canonical group ordering.
- `extractOpeningSentence` and `extractSectionBullets` read the responsibility sentence and the `When to use this page` bullets out of an already-accepted page body; `extractH2Titles` collects the H2 outline.
- `classifyTopicSignals` derives coarse signals (`entry/boundary`, `persistence/state`, `output`, `failure`, etc.) from a module's paths and body text; these flow into the planner inventory.
- `uniqueSorted` and `normalizeLabel` are deterministic helpers used everywhere anchor keys and labels need stable ordering.
- `measureAnchorSourceChars` reads each anchor's defining source span plus a small controlling-branch margin through `safe-io`, returning a `Record<string, number>` keyed by anchor. This is what the mechanical source-budget repair uses to decide which anchors are cheap to keep.
- `buildTopicPlanningInventory` is the inventory constructor. It iterates accepted `Module` entries in sorted id order, resolves `livewiki/<module>.md` through `safe-io`, parses its frontmatter, classifies each anchor's role via `classifyPathRole`, and assembles `TopicModuleEvidence` rows. It also scans `livewiki/flows/` for accepted flow pages (gated by `opts.allowedFlowSlugs`) and includes the matching `TopicFlowEvidence`. The visible body ends mid-flow; the inventory shape (`modules`, `flows`, `anchorRoles`, `anchorSourceChars`) is fully established by the interface declaration.
- `serializeTopicPlanningInventory` renders the inventory to a JSON string that the planner prompt embeds verbatim.

The visible behaviour is the inventory builder reading accepted pages through `safe-io`; the source beyond the `TopicFlowEvidence` assembly loop is truncated, so additional inventory fields or normalization steps are not established here.

## Topic-plan validation, parsing, and mechanical repair

<!-- lw:anchors packages/core/src/topics.ts#validateTopicPlan packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#repairTopicPlanSourceBudgetMechanically packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.test.ts#budgetInventory packages/core/src/topics.test.ts#budgetProposal -->

```ts
export function validateTopicPlan(
function parseProposal(value: unknown, index: number, errors: TopicPlanValidationError[]): TopicPlanProposal | null
function compareProposalPreference(
function toCandidate(proposal: TopicPlanProposal, planOrder: number): TopicCandidate
export function repairTopicPlanSourceBudgetMechanically(
function stripOuterJsonFence(raw: string): string
function isRecord(value: unknown): value is Record<string, unknown>
function isStringArray(value: unknown): value is string[]
function errorAt(code: TopicPlanValidationCode, proposalIndex: number, message: string): TopicPlanValidationError
function addDuplicateError(
function inventory(): TopicPlanningInventory
function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal
function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory
function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal
```

- `validateTopicPlan` accepts the raw LLM JSON (often wrapped in a fenced block — see `stripOuterJsonFence`), runs every proposal through `parseProposal`, and applies the full rule set: `maxTopics`, `maxAnchors`, `maxSourceChars`, product-anchor ratio, anchor overlap between competing topics, group completeness (all four of `TOPIC_GROUP_NAMES` must be non-empty), duplicate `title` / `intent`, unknown module or flow references, auxiliary-only topics, auxiliary-disconnected topics, unscoped anchors, and source/text budget overflow. The `accepts closed product evidence and produces a stable candidate` test confirms the validator is order-independent — swapping `modules` order in the inventory still yields the same `TopicCandidate` with a stable `seedKeys` ordering.
- `parseProposal` decodes a single JSON proposal, returns `null` on shape failure, and pushes a `TopicPlanValidationError` into the supplied `errors` array.
- `compareProposalPreference` is the ordering key the validator applies so the final `TopicCandidate` set is deterministic across runs.
- `toCandidate` wraps an accepted `TopicPlanProposal` with `planOrder`, `evidenceHash`, `slug`, and `seedKeys`.
- `repairTopicPlanSourceBudgetMechanically` is the deterministic source-budget fixup: when a plan trips `topic_plan_source_budget` it drops the costliest non-product anchors first (the test fixture gives 6 product anchors at 100 chars each and 2 non-product anchors at 3000 chars each, with `maxSourceChars: 600`, so the repair must drop the 2 expensive ones before re-validating) while preserving the 5-anchor floor, the non-empty group constraint, and the product-ratio minimum. The truncated source confirms the entry point but the full drop loop is not shown.
- `stripOuterJsonFence` strips an outer fenced JSON wrapper from raw LLM output, `isRecord` is a type guard that narrows `unknown` to `Record<string, unknown>`, and `isStringArray` narrows `unknown` to `string[]`; together these are the parsing helpers that tolerate LLM-emitted json fences and reject unexpected shapes.
- `errorAt` and `addDuplicateError` build and append `TopicPlanValidationError` rows.
- `inventory`, `proposal`, `budgetInventory`, and `budgetProposal` are the test-only fixtures. `inventory` produces the two-module baseline (`module-a` + `module-b` with six anchors total, both classified as `product`); `proposal` produces the matching `TopicPlanProposal` populating all four groups. `budgetInventory` produces the 6-product + 2-non-product fixture used specifically by the source-budget repair test, and `budgetProposal` produces the proposal that initially trips the budget.

The visible test cases pin three concrete outcomes: a happy-path proposal with full product evidence validates cleanly and re-runs deterministically (`first.candidates[0]` equals `second.candidates[0]` with the same `seedKeys`); a proposal referencing `missing-module` is rejected with `topic_plan_unknown_reference` and yields no candidates; two competing topics whose anchor evidence overlaps beyond `maximumOverlapRatio` are rejected with `topic_plan_anchor_overlap`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency and dependent
- [core library — manifest, markdown masking, mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
