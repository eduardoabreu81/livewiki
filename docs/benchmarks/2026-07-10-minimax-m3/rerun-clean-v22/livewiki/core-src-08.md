---
title: Core prompt, I/O allowlist, symbol extraction, status and topic planning
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
  - packages/core/src/topics.ts#serializeTopicPlanningInventory
  - packages/core/src/topics.ts#stripOuterJsonFence
  - packages/core/src/topics.ts#toCandidate
  - packages/core/src/topics.ts#uniqueSorted
  - packages/core/src/topics.ts#validateTopicPlan
---

# Core prompt, I/O allowlist, symbol extraction, status and topic planning

This module groups the runtime helpers that sit between the LLM and the on-disk wiki: prompt construction for each generation stage, the strict disk-write allowlist, tree-sitter symbol extraction, status reporting against the index, and stage-5 topic-plan validation.

## When to use this page

- **Build** stage-4 (page), stage-5 (flow, topic plan), stage-2 refine, quickstart, overview and repair prompts from a closed anchor list using the shared editorial rules.
- **Audit** the `safe-io` allowlist when adding a new writable directory, or when investigating a `PathOutsideAllowlistError` or `InvalidRelativePathError` raised by a writer.
- **Extend** the symbol extractor with a new language or node kind by following the `walkNode` switch conventions.
- **Validate** an LLM-proposed topic plan against the closed inventory with `validateTopicPlan` before accepting it.

## How it fits

`packages/core/src/prompts.ts` owns the prompt templates consumed by the LLM client during the batch pipeline; every template pulls from shared rule constants so initial and repair prompts cannot drift. `packages/core/src/safe-io.ts` is the only module authorised to touch the filesystem on behalf of the orchestrator, and it enforces the `livewiki/` + `.livewiki/` allowlist plus a realpath revalidation that defeats symlink-escape attacks. `packages/core/src/symbols.ts` walks the tree-sitter AST produced by the parser module to emit `SymbolRecord`s that feed both the SQLite index and the prompt context. `packages/core/src/status.ts` reads that index (and the token-economics snapshot) to produce a human or JSON report. `packages/core/src/topics.ts` validates stage-5 topic plans against a closed inventory of accepted pages and flows, producing deterministic `TopicCandidate`s. The four `*.test.ts` files exercise each subsystem in isolation; they are not exported as part of the public surface.

## Prompt templates and shared rules
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildTopicPlanPrompt packages/core/src/prompts.ts#buildTopicPlanRepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#formatTopicGroups packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence -->

Default budgets cap the amount of code shipped per request and the size of the Markdown the model is allowed to emit:

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
```

`PAGE_OPENING_PROMPT_RULES`, `FLOW_PAGE_PROMPT_RULES` and `TOPIC_PAGE_PROMPT_RULES` are frozen `as const` arrays of editorial bullets. They are inlined verbatim into both the initial and repair prompts so the contract cannot drift between attempts. `LITERAL_SIGNATURE_PROMPT_RULE` and `EXCEPTION_BRANCH_PROMPT_RULE` are single-string rules reinforcing the "copy signatures byte-for-byte" and "describe visible exception branches" invariants when the supplied source actually shows them.

`FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const` is the budget the orchestrator enforces on extracted Mermaid diagrams; several focused flows must be preferred over a single mega-diagram.

Fence-safety helpers guard against the model injecting a literal fence that would break the verifier's outer Markdown parser. The longest contiguous run of a fence character in the payload is measured by:

```ts
function longestRunOf(text: string, char: "`" | "~"): number
```

Anything longer than the safe threshold is wrapped by `boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string` which splits the offending runs. `selectSafeFence(enclosed: string): { fence: string; content: string }` chooses a fence length strictly greater than the longest run already in `enclosed`, and `wrapInSafeFence(enclosed: string): string` then composes the final code-fenced block. Together these prevent a model output from prematurely closing the verifier's own fences.

Two control-marker scrubbers run over model output. `neutralizeUntrustedControlMarkers(text: string): string` is the aggressive variant, used when no anchor allowlist is supplied. `neutralizeUntrustedControlMarkersExceptValidAnchors(text, validAnchors): string` keeps the markers whose key is in the closed set (case-sensitive equality) and escapes the rest; the excerpt establishes this contract but does not show the full implementation, so callers should treat the surrounding behaviour as best-effort and consult the verifier.

Stage builders compose the system/user prompt pair consumed by `LlmClient.generate`. Each exposes the canonical contract from the shared rule arrays, then layers stage-specific evidence:

```ts
export function buildStage4Prompt(...)
export function buildRepairPrompt(...)
export function buildStage2RefinePrompt(...)
export function buildQuickstartPrompt(...)
export function buildOverviewPrompt(...)
export function buildStage5Prompt(...)
export function buildStage5RepairPrompt(...)
export function buildTopicPlanPrompt(...)
export function buildTopicPlanRepairPrompt(...)
export function buildTopicPrompt(...)
export function buildTopicRepairPrompt(...)
```

`buildFlowGroupBlock(...)` is an internal helper that serialises the per-group anchor lists for flow prompts. `formatTopicGroups(groups: TopicKeyGroups): string[]` flattens the four topic groups (`contract` / `state` / `output` / `failure`) into presentation strings used inside the topic-plan prompt.

## Disk allowlist and writers
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText -->

The allowlist is the literal pair shipped to every writer:

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

`allowedAbs(repoRoot: string, dir: AllowedDir): string` returns the absolute path of one of those directories inside the resolved `repoRoot`, and throws an internal error if the literal ever escapes the root — defence in depth against an `ALLOWED_DIRS` edit that would re-introduce traversal. `allowlistFor(opts: SafeIoOptions): readonly string[]` extends the allowlist with the root-level pointer files `AGENTS.md` and `CLAUDE.md` only when `allowPointer: true` is opted in; the default is to fail closed.

Two error classes surface the rejection reasons. `PathOutsideAllowlistError` carries `repoRoot`, `attempted`, and `allowlist` so callers can render a useful audit message; the `super(...)` call builds that message from those fields. `InvalidRelativePathError` is raised for absolute paths or `..` traversal segments; both constructors copy the supplied context into the formatted message and set `this.name` for `instanceof`-style checks.

```ts
export function isInsideAllowlist(repoRoot: string, absPath: string, opts: SafeIoOptions = {}): boolean
```

is the pure allowlist predicate. It resolves both inputs, then for `allowPointer: true` accepts an exact `repoRoot/AGENTS.md` or `repoRoot/CLAUDE.md` match; otherwise it walks `ALLOWED_DIRS` and accepts when the relative path from the allowed directory neither starts with `..` nor is absolute. The prefix is matched with the path separator in mind, so `livewiki-evil/foo.md` is rejected even though it shares a prefix with `livewiki/`.

`validateDeclared(repoRoot: string, relPath: string, opts: SafeIoOptions): string` runs the cheap, pre-realpath validation: it rejects absolute paths, rejects any segment equal to `..` after `path.normalize`, and otherwise resolves the target and re-runs `isInsideAllowlist` on the declared path. The function throws `InvalidRelativePathError` or `PathOutsideAllowlistError` and returns the resolved absolute path on success.

`findDeepestExisting(from: string, stopAt: string)` walks from `from` toward `stopAt` using `fs.existsSync` and returns the deepest ancestor that already exists plus the suffix that does not. It is synchronous because the loop only consults `existsSync`; the async `realpath` is invoked once on the result. If the walk reaches the filesystem root without finding `stopAt`, it falls back to `[stopAt, relative(stopAt, from)]` so the caller still has a usable tuple — this is the documented fail-safe path.

The public surface combines both halves:

```ts
export async function resolveAndValidate(repoRoot: string, relPath: string, opts: SafeIoOptions = {}): Promise<string>
```

validates the declared path, then resolves the deepest existing ancestor through `findDeepestExisting`, calls `realpath` on it, re-concatenates the suffix, and re-runs `isInsideAllowlist` on the canonical absolute path. If `realpath` rejects, the error propagates; if the canonical path leaves the allowlist, `PathOutsideAllowlistError` is raised. This is what closes the symlink-escape class of attacks — the excerpt confirms the intent but is truncated before the revalidation block, so callers should treat the post-realpath failure mode as established by the surrounding design rather than by a complete source reading.

The remaining exports are thin wrappers that route through `resolveAndValidate` before touching the disk:

```ts
export async function writeText(repoRoot: string, relPath: string, content: string, opts?: SafeIoOptions): Promise<void>
export async function readText(repoRoot: string, relPath: string, opts?: SafeIoOptions): Promise<string>
export async function exists(repoRoot: string, relPath: string, opts?: SafeIoOptions): Promise<boolean>
export async function mkdir(repoRoot: string, relPath: string, opts?: SafeIoOptions): Promise<void>
export async function remove(repoRoot: string, relPath: string, opts?: SafeIoOptions): Promise<void>
```

Each one resolves the target through the allowlist first and only then invokes the corresponding `node:fs/promises` operation; this is the choke point every other module uses when it needs to persist anything under the repo root.

The test-only helper `detectSymlinkSupport(): Promise<boolean>` probes whether the host filesystem supports `fs.symlink` (Windows requires admin or Developer Mode). The test file caches the result in `canSymlink` and gates symlink-attack tests with `it.runIf(canSymlink)`; when symlinks are unavailable the relevant cases are skipped rather than failing.

## Tree-sitter symbol extraction
<!-- lw:anchors packages/core/src/symbols.test.ts#parse packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#walkNode -->

The public entry point takes a parsed `Tree`, the repository-relative path and the source string, and returns one `SymbolRecord` per accepted declaration:

```ts
export function extractSymbols(tree: Tree, relPath: string, source: string): SymbolRecord[]
```

Internally it accumulates `ExtractedSymbol` candidates via `walkNode`, sorts them by `(start_line, source_start_byte, discoveryOrder)`, and keeps the first occurrence of each `key`. This guarantees stable ordering across runs and coalesces object-literal methods while preserving qualified class methods (`Foo.bar`) as distinct entries — the relevant tests assert both shapes.

`walkNode(node: Node, source: string, relPath: string, parentClassName: string | null, out: ExtractedSymbol[]): void` is the recursive visitor. It dispatches on `node.type`:

- `function_declaration` and `generator_function_declaration` emit one `function` record (no descent into the body, since nested functions are not surfaced).
- `class_declaration` and Python's `class_definition` emit one `class` record and then manually walk their named children with `parentClassName` set, so the contained `method_definition` or `function_definition` nodes qualify as `Class.method`.
- `method_definition` outside a class still emits a `method` record without qualification.
- `export_statement` is special-cased: an `export class` or `export function` is emitted once (the inner declaration is *not* re-emitted on the descent); `export const foo = ...` emits one `export` record per declarator.
- Python `function_definition` qualifies against `parentClassName` to produce `method` records inside classes and `function` records at the top level.

The per-node helper that turns a node into an `ExtractedSymbol` is:

```ts
function makeRecord(node: Node, source: string, relPath: string, name: string, kind: SymbolKind): ExtractedSymbol
```

It computes `key = relPath + "#" + name` (matching the closed-list format), records `start_line` and `end_line` from the node, hashes the exact source slice covered by the node via `sha256Slice`, and leaves `signature` populated by `signatureFor(node, source): string | null`, which returns the first line of the node text. `toSymbolRecord(symbol: ExtractedSymbol): SymbolRecord` strips the `source_start_byte` helper field before exposing the record.

The test helper `parse(ext: string, src: string)` is a thin wrapper over `parseSource` that exists so the test file can call it from multiple `describe` blocks after a single `initParser()` in `beforeAll`.

## Status reporting
<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman packages/core/src/status.ts#run -->

`run(repoRoot: string, opts: StatusOptions = {}): Promise<StatusReport>` is the public entry point. It resolves `.livewiki/index.db` through `safe-io`, opens it via `openIndex`, calls `collect(db, topN ?? 10)`, and then snapshots the update metrics. The metrics call is wrapped in a `try { ... } catch { report.metrics = null }` block, so a metrics failure degrades to `null` rather than aborting the report — that is the documented fail-open path.

`collect(db: import("better-sqlite3").Database, topN: number): StatusReport` aggregates the four sub-reports directly from SQLite:

- `files`: filtered to `status = 'active'`, grouped by `lang`, and joined to symbols to compute a `top` array sorted by symbol count descending and sliced to `topN`.
- `symbols`: filtered to `status = 'active'` and grouped by `kind`.
- `debt`: LEFT JOINs `anchors` and `doc_pages`, filters to unresolved rows (`resolved_at IS NULL`), and tallies by event and by assignee. `items` is the full row projection.
- `undocumented`: rows with `dismissed = 0`, exposing `total` and a `sample` of up to 20 `symbol_key`s.

The schema version and the two timestamps are read from the `meta` table via `parseInt(value, 10)`; missing keys yield `0` and `null` respectively. `metrics` is initialised to `null` inside `collect` and overwritten by `run` after the snapshot.

`formatHuman(report: StatusReport): string` produces a multi-line text rendering. It prints the header `livewiki status` followed by an underline, then the file count, the language breakdown (when present), the top-N file list with explicit counts, the symbol kind breakdown, the debt roll-up by event and assignee, each `DebtItem` as `[event] assignee symbol_key wiki_path`, the undocumented count and sample, and finally the meta block with ISO-8601 timestamps. The empty and populated test cases pin every section title and the ISO format.

## Topic planning inventory and validation
<!-- lw:anchors packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#validateTopicPlan -->

The stage-5 planner ships the canonical group set as a literal tuple so proposals, validators and prompts all agree:

```ts
export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
```

The closed inventory is built by:

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

For each module sorted by `id`, it checks that `livewiki/<id>.md` exists via `safeIo.exists` (returning `false` instead of throwing on read failure), reads the body, parses frontmatter, and skips pages that lack a parseable frontmatter block. Each accepted module contributes: a `title` from `frontmatter.title` (trimmed, falling back to `module.id`), `role` from `classifyModuleRole`, `anchors` from `uniqueSorted(getAnchors(...))`, `importNeighbors` derived from the optional `edges`, `signals` from `classifyTopicSignals`, `responsibility` from `extractOpeningSentence`, `whenToUse` from the bullets under the `When to use this page` H2, and `sections` from every H2 title. The same loop populates `anchorRoles` for every anchor using `classifyPathRole(sourcePath, ...)`.

For flows, it checks `livewiki/flows/` exists, lists non-`index.md` files, optionally filters by `allowedFlowSlugs`, requires a companion `livewiki/diagrams/flow-<slug>.mmd`, and parses each flow page's frontmatter to extract `title` and `modules`. The excerpt is truncated before the per-flow signal extraction is fully visible, so consumers should treat the flow-evidence shape as established but consult the file directly for the exact field derivation.

The inventory is serialised back into a deterministic JSON envelope by `serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string`, which is the form shipped to the LLM. The round-trip is what allows the validator to compare two inventories that came in different module orderings and still produce the same candidate set.

Validation is performed by:

```ts
export function validateTopicPlan(raw: string, inventory: TopicPlanningInventory, opts: TopicPlanValidationOptions): TopicPlanValidationResult
```

It first calls `stripOuterJsonFence(raw: string): string` to peel any model-emitted ```json fence, then parses JSON and walks `topics`. For each proposal it runs `parseProposal(value, index, errors)`, which checks the proposal shape (title, intent, modules, flows, groups) via `isRecord` and `isStringArray` and accumulates `TopicPlanValidationError`s through `errorAt(code, proposalIndex, message)`. `addDuplicateError(errors, code, proposalIndex, message)` records duplicate title or intent violations.

Accepted proposals are turned into `TopicCandidate`s via `toCandidate(proposal, planOrder)`. `normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups` is applied first to canonicalise per-group anchor ordering and dedup within each group. `uniqueSorted(values: readonly string[]): string[]` and `normalizeLabel(value: string): string` are the shared string hygiene helpers used across the file. `compareProposalPreference(a, b)` orders candidates deterministically so two inventories that agree on evidence produce identical `seedKeys`. `measureAnchorSourceChars(repoRoot: string, keys: string[]): Promise<Record<string, number>>` powers the per-anchor source-character budget check, and `classifyTopicSignals(paths: readonly string[], body: string): string[]` derives the planner-facing signal tags from a module's paths and body text.

The validator's contract is encoded in the `TopicPlanValidationCode` union: proposals that reference modules or anchors outside the inventory produce `topic_plan_unknown_reference`; topics that consist only of auxiliary anchors are flagged with `topic_plan_auxiliary_only` and `topic_plan_auxiliary_disconnected`; competing topics whose anchor evidence overlaps beyond `maximumOverlapRatio` produce `topic_plan_anchor_overlap`; missing required groups produce `topic_plan_missing_group`; and the module, anchor, source-character and text-character budgets each surface their own code. `validateTopicPlan` returns `{ ok: candidates.length > 0 && errors.length === 0, candidates, errors }` — the caller is expected to inspect both fields before accepting a plan, since a non-empty `errors` array with an empty `candidates` array is the documented rejection shape.

The test fixtures expose the building blocks used by the `topic plan validation` suite. `inventory()` returns a two-module inventory with paired `anchors` and `anchorRoles` or `anchorSourceChars` maps populated from those anchors; `proposal(overrides)` returns a fully-populated `TopicPlanProposal` that fills all four groups with the inventory's anchors, and accepts partial overrides for individual fields. The three acceptance tests assert that a closed proposal is accepted and produces a stable candidate regardless of inventory module ordering, that a proposal referencing an unknown module is rejected with `topic_plan_unknown_reference`, and that two proposals whose evidence overlaps beyond the overlap ratio are rejected with `topic_plan_anchor_overlap&#96;.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman packages/core/src/status.ts#run packages/core/src/symbols.test.ts#parse packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#walkNode packages/core/src/topics.test.ts#inventory packages/core/src/topics.test.ts#proposal packages/core/src/topics.ts#TOPIC_GROUP_NAMES packages/core/src/topics.ts#addDuplicateError packages/core/src/topics.ts#buildTopicPlanningInventory packages/core/src/topics.ts#classifyTopicSignals packages/core/src/topics.ts#compareProposalPreference packages/core/src/topics.ts#errorAt packages/core/src/topics.ts#extractH2Titles packages/core/src/topics.ts#extractOpeningSentence packages/core/src/topics.ts#extractSectionBullets packages/core/src/topics.ts#isRecord packages/core/src/topics.ts#isStringArray packages/core/src/topics.ts#measureAnchorSourceChars packages/core/src/topics.ts#normalizeGroups packages/core/src/topics.ts#normalizeLabel packages/core/src/topics.ts#parseProposal packages/core/src/topics.ts#serializeTopicPlanningInventory packages/core/src/topics.ts#stripOuterJsonFence packages/core/src/topics.ts#toCandidate packages/core/src/topics.ts#uniqueSorted packages/core/src/topics.ts#validateTopicPlan -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency and dependent
- [Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
