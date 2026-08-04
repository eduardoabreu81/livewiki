---
title: Core prompt templates, repair contract, README export, and risk-weighted debt ranking
owner: generated
anchors:
  - packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE
  - packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE
  - packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET
  - packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE
  - packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE
  - packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES
  - packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#boundEncodeLongRuns
  - packages/core/src/prompts.ts#buildFlowGroupBlock
  - packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock
  - packages/core/src/prompts.ts#buildModuleDiagramPromptRules
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#buildStage5Prompt
  - packages/core/src/prompts.ts#buildStage5RepairPrompt
  - packages/core/src/prompts.ts#buildSurgicalRepairPrompt
  - packages/core/src/prompts.ts#buildTopicPrompt
  - packages/core/src/prompts.ts#buildTopicRefinePrompt
  - packages/core/src/prompts.ts#buildTopicRepairPrompt
  - packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock
  - packages/core/src/prompts.ts#buildUnderstandingPrompt
  - packages/core/src/prompts.ts#buildUnderstandingRepairPrompt
  - packages/core/src/prompts.ts#formatTopicGroups
  - packages/core/src/prompts.ts#longestRunOf
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
  - packages/core/src/prompts.ts#renderProseEvidenceBlock
  - packages/core/src/prompts.ts#renderRationaleEvidenceBlock
  - packages/core/src/prompts.ts#selectSafeFence
  - packages/core/src/prompts.ts#wrapInSafeFence
  - packages/core/src/rationale-evidence.ts#renderRationaleEvidence
  - packages/core/src/readme-export.ts#README_END
  - packages/core/src/readme-export.ts#README_REL_PATH
  - packages/core/src/readme-export.ts#README_START
  - packages/core/src/readme-export.ts#ReadmeExportError
  - packages/core/src/readme-export.ts#ReadmeExportError.constructor
  - packages/core/src/readme-export.ts#applyReadme
  - packages/core/src/readme-export.ts#buildReadme
  - packages/core/src/readme-export.ts#canonicalBlock
  - packages/core/src/readme-export.ts#exportReadme
  - packages/core/src/readme-export.ts#extractDigests
  - packages/core/src/readme-export.ts#extractHubLinks
  - packages/core/src/readme-export.ts#extractPurpose
  - packages/core/src/readme-export.ts#findReadmeBlock
  - packages/core/src/readme-export.ts#firstPlainParagraph
  - packages/core/src/readme-export.ts#fullFileContent
  - packages/core/src/readme-export.ts#generateReadmeContent
  - packages/core/src/readme-export.ts#readWikiPage
  - packages/core/src/readme-export.ts#refusalMessage
  - packages/core/src/readme-export.ts#sectionLines
  - packages/core/src/readme-export.ts#stripFrontmatter
  - packages/core/src/readme-export.ts#synthesizePurposeFromDigests
  - packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES
  - packages/core/src/repair-contract.ts#PAGE_KINDS
  - packages/core/src/repair-contract.ts#SUPPORTED_FIXES
  - packages/core/src/repair-contract.ts#UNCLASSIFIED
  - packages/core/src/repair-contract.ts#collectUnclassified
  - packages/core/src/repair-contract.ts#formatUnrepairableMessage
  - packages/core/src/repair-contract.ts#isUnrepairableErrorSet
  - packages/core/src/repair-contract.ts#renderActionDirective
  - packages/core/src/repair-contract.ts#renderReportOnlyBlock
  - packages/core/src/risk.ts#bandPoints
  - packages/core/src/risk.ts#collectGitChurn
  - packages/core/src/risk.ts#compareByRisk
  - packages/core/src/risk.ts#computeTestCoverageAndFanIn
  - packages/core/src/risk.ts#derivePathFromSymbolKey
  - packages/core/src/risk.ts#parseGitChurnOutput
  - packages/core/src/risk.ts#runGitLog
  - packages/core/src/risk.ts#scoreDebtItem
---

# Core prompt templates, repair contract, README export, and risk-weighted debt ranking

This module bundles four concerns the livewiki pipeline shares across generation stages: the prompt templates sent to the LLM, the closed repair contract that maps validation codes to action directives, deterministic README synthesis from the wiki, and the deterministic risk score used to rank open debt.

## When to use this page

- **Review the LLM-facing editorial contract** (page openings, flow/topic/understanding page rules, diagram budgets, branch-precision and inventory-authority rules) when you are changing how the model is asked to write wiki pages.
- **Update the repair contract** (supported fixes vs unclassified codes) when adding or removing a validation code, or when the directive text for an existing code needs to change.
- **Extend README synthesis** (marker block, refusal path, digest/hub extraction, dry-run preview) when changing how `livewiki export readme` composes the output file from the wiki.
- **Adjust the risk rubric** (event points, test-gap, fan-in bands, churn bands) when changing how open debt items are ordered in `livewiki status`.

## How it fits

This module lives under `packages/core/src/` and serves the livewiki generator pipeline. `prompts.ts` provides the LLM-facing templates consumed by stage-4 (module page), stage-5 (flow page), topic page, quickstart, overview, understanding, and the surgical/general repair variants. `repair-contract.ts` is the single source of truth that turns an `ArtifactValidationCode` into either a supported `FixDirective` or an unclassified report-only entry, separated per `PageKind`. `readme-export.ts` is the deterministic, zero-LLM path that composes `README.md` from existing wiki pages under the `livewiki:readme:start` / `livewiki:readme:end` marker block, with explicit refusal when a human-authored README lacks the markers (rule #6). `risk.ts` ranks debt items without any LLM call by combining event points, test gap, fan-in, and git churn; the spawned `git log` degrades gracefully to a null result on any failure. `rationale-evidence.ts` shares the bounded evidence rendering between the generator contexts and the topic planner estimate so per-candidate accounting cannot drift from what the generator assembles.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-08.mmd
```

## Prompt budgets and shared contracts

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES packages/core/src/prompts.ts#UNDERSTANDING_PAGE_PROMPT_RULES packages/core/src/prompts.ts#buildModuleDiagramPromptRules -->

The shared contracts describe the editorial contract the LLM must satisfy. They are kept in English (so contributors can audit what is sent to the model) while `${language}` controls only the language of the generated prose output.

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
export const FLOW_DIAGRAM_DEFAULT_BUDGET = { maxNodes: 12, maxEdges: 20 } as const;
export const PAGE_OPENING_PROMPT_RULES: readonly string[];
export const FLOW_PAGE_PROMPT_RULES: readonly string[];
export const TOPIC_PAGE_PROMPT_RULES: readonly string[];
export const UNDERSTANDING_PAGE_PROMPT_RULES: readonly string[];
export function buildModuleDiagramPromptRules(budget: FlowDiagramBudget): readonly string[];
```

`DEFAULT_CONTEXT_TOKEN_BUDGET` caps the per-module context (code + symbols) sent to the model; `DEFAULT_OUTPUT_TOKEN_BUDGET` caps the Markdown response. `FLOW_DIAGRAM_DEFAULT_BUDGET` mirrors the resolved config and is interpolated into flow/topic prompts so the model writes to the same limits enforced by the diagram gate. `PAGE_OPENING_PROMPT_RULES` is the shared stage-4 contract (opening structure, bullets, anchors discipline); `FLOW_PAGE_PROMPT_RULES`, `TOPIC_PAGE_PROMPT_RULES`, and `UNDERSTANDING_PAGE_PROMPT_RULES` extend that discipline to flow/topic/understanding pages, including the rule that flow pages emit NO `## Diagram` section — the orchestrator generates and inserts the diagram deterministically. `buildModuleDiagramPromptRules` returns the module-page diagram rules for a given budget.

## Editorial and structural prompt rules

<!-- lw:anchors packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE packages/core/src/prompts.ts#DEEP_HIERARCHY_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE -->

These constants are individual rules appended to the prompt context. They enforce branch precision, deep hierarchy guidance, visible exception-branch disclosure, inventory authority (the closed list is authoritative), and the literal-signature rule.

```ts
export const BRANCH_PRECISION_PROMPT_RULE: string;
export const DEEP_HIERARCHY_PROMPT_RULE: string;
export const EXCEPTION_BRANCH_PROMPT_RULE: string;
export const INVENTORY_AUTHORITY_PROMPT_RULE: string;
export const LITERAL_SIGNATURE_PROMPT_RULE: string;
```

`LITERAL_SIGNATURE_PROMPT_RULE` requires the model to copy any function or method signature byte-for-byte from the symbol table rather than reconstructing it. `BRANCH_PRECISION_PROMPT_RULE` and `EXCEPTION_BRANCH_PROMPT_RULE` require the prose to describe the exact branches visible in source (no invented guards, no narration about what the excerpt does not contain). `INVENTORY_AUTHORITY_PROMPT_RULE` reiterates that the closed key list is the only valid set of anchor keys. `DEEP_HIERARCHY_PROMPT_RULE` provides the concept-grouped H2/H3 hierarchy guidance used when modules exceed the symbol-count threshold for grouping.

## Fence-safety helpers and untrusted-marker neutralizers

<!-- lw:anchors packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#renderProseEvidenceBlock packages/core/src/prompts.ts#renderRationaleEvidenceBlock packages/core/src/rationale-evidence.ts#renderRationaleEvidence -->

These helpers ensure that user-supplied or model-supplied text embedded into prompts (or rendered into a fenced block) cannot terminate a code fence, and that untrusted `lw:*` control markers cannot be smuggled into the final page. The visible evidence rendered blocks format rows for prompt injection.

```ts
function longestRunOf(text: string, char: "`" | "~"): number;
function boundEncodeLongRuns(text: string, char: "`" | "~", cap: number): string;
function selectSafeFence(enclosed: string): { fence: string; content: string };
function wrapInSafeFence(enclosed: string): string;
export function neutralizeUntrustedControlMarkers(text: string): string;
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
  text: string,
  validAnchors: ReadonlySet<string>,
): string;
function renderProseEvidenceBlock(proseEvidence: string | undefined): string[];
function renderRationaleEvidenceBlock(rationaleEvidence: string | undefined): string[];
export function renderRationaleEvidence(
  rows: ReadonlyArray<RationaleEvidenceRow>,
  maxChars: number,
): string;
```

`longestRunOf` and `boundEncodeLongRuns` measure consecutive runs of a fence character and re-encode any overlong run so the chosen fence cannot be terminated by the enclosed payload. `selectSafeFence` picks a fence length whose surrounding runs are shorter than any run inside the enclosed payload; `wrapInSafeFence` applies that choice. `neutralizeUntrustedControlMarkers` strips control markers from arbitrary text; `neutralizeUntrustedControlMarkersExceptValidAnchors` is the anchor-aware variant that preserves entries belonging to a caller-supplied valid-set. `renderProseEvidenceBlock` and `renderRationaleEvidenceBlock` format the prose and rationale evidence sections that the prompt builders insert into the user message. `renderRationaleEvidence` (in `rationale-evidence.ts`) is the shared bounded renderer used by both generator contexts and the topic planner estimate, so planner accounting cannot drift from generator assembly.

## Stage-4 module, stage-5 flow, topic, quickstart, overview, and understanding prompt builders

<!-- lw:anchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRefinePrompt packages/core/src/prompts.ts#buildTopicRepairPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildUnderstandingPrompt packages/core/src/prompts.ts#buildUnderstandingRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildSurgicalRepairPrompt packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock packages/core/src/prompts.ts#formatTopicGroups -->

These builders compose the user-message and system-message text for each generation stage. The split between initial and repair builders is intentional: they both consume the shared contract rules so the two prompt surfaces cannot drift.

```ts
export function buildStage4Prompt(input: Stage4Input): PromptPair;
export function buildRepairPrompt(input: RepairInput): PromptPair;
export function buildStage5Prompt(input: Stage5Input): PromptPair;
export function buildStage5RepairPrompt(input: Stage5RepairInput): PromptPair;
export function buildTopicPrompt(input: TopicPromptInput): PromptPair;
export function buildTopicRefinePrompt(input: TopicRefineInput): PromptPair;
export function buildTopicRepairPrompt(input: TopicRepairInput): PromptPair;
export function buildQuickstartPrompt(input: QuickstartInput): PromptPair;
export function buildOverviewPrompt(input: OverviewInput): PromptPair;
export function buildUnderstandingPrompt(input: UnderstandingInput): PromptPair;
export function buildUnderstandingRepairPrompt(input: UnderstandingRepairInput): PromptPair;
export function buildStage2RefinePrompt(input: Stage2RefineInput): PromptPair;
export function buildSurgicalRepairPrompt(input: SurgicalRepairInput): PromptPair;
function buildFlowGroupBlock(groups: FlowKeyGroups): string[];
function buildFlowSectionAssignmentBlock(sectionMap: FlowKeySectionMap | undefined): string[];
function buildTopicSectionAssignmentBlock(sectionMap: TopicKeySectionMap | undefined): string[];
function formatTopicGroups(groups: TopicKeyGroups): string[];
```

`buildStage4Prompt` produces the module-page pair; `buildRepairPrompt` and `buildSurgicalRepairPrompt` are the module repair variants. `buildStage5Prompt` and `buildStage5RepairPrompt` produce the flow-page pair. `buildTopicPrompt`, `buildTopicRefinePrompt`, and `buildTopicRepairPrompt` cover topic generation and repair. `buildQuickstartPrompt`, `buildOverviewPrompt`, `buildUnderstandingPrompt`, and `buildUnderstandingRepairPrompt` cover the wiki orientation pages. `buildStage2RefinePrompt` covers the stage-2 refine path. `buildFlowGroupBlock`, `buildFlowSectionAssignmentBlock`, `buildTopicSectionAssignmentBlock`, and `formatTopicGroups` format the per-section key/role grouping blocks the model is asked to write to. The shared rule lists (`PAGE_OPENING_PROMPT_RULES`, etc.) are interpolated by these builders so initial and repair prompts stay aligned.

## Repair contract: codes, dispositions, and rendering

<!-- lw:anchors packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES packages/core/src/repair-contract.ts#PAGE_KINDS packages/core/src/repair-contract.ts#SUPPORTED_FIXES packages/core/src/repair-contract.ts#UNCLASSIFIED packages/core/src/repair-contract.ts#renderActionDirective packages/core/src/repair-contract.ts#renderReportOnlyBlock packages/core/src/repair-contract.ts#collectUnclassified packages/core/src/repair-contract.ts#isUnrepairableErrorSet packages/core/src/repair-contract.ts#formatUnrepairableMessage -->

The repair contract is the closed map from every `ArtifactValidationCode` to exactly one of two dispositions per `PageKind`: a `SUPPORTED_FIX` directive (the exact action text the repair prompt renders) or an `UNCLASSIFIED` entry with a one-line reason (report-only — never repaired by guessing). The exhaustiveness test asserts every code appears in exactly one of the two maps for every kind.

```ts
export const PAGE_KINDS = ["module", "flow", "topic"] as const satisfies readonly PageKind[];
export const ALL_ARTIFACT_VALIDATION_CODES: readonly ArtifactValidationCode[];
export const SUPPORTED_FIXES: Record<PageKind, Partial<Record<ArtifactValidationCode, FixDirective>>>;
export const UNCLASSIFIED: Record<PageKind, Partial<Record<ArtifactValidationCode, string>>>;
export function renderActionDirective(
  kind: PageKind,
  code: ArtifactValidationCode,
  ctx: FixContext,
): string;
export function renderReportOnlyBlock(
  kind: PageKind,
  code: ArtifactValidationCode,
): string;
export function collectUnclassified(errors: ArtifactValidationError[]): ArtifactValidationError[];
export function isUnrepairableErrorSet(errors: ArtifactValidationError[]): boolean;
export function formatUnrepairableMessage(errors: ArtifactValidationError[]): string;
```

`PAGE_KINDS` enumerates the three page kinds; `ALL_ARTIFACT_VALIDATION_CODES` is the runtime mirror of the `ArtifactValidationCode` union, with a compile-time `AssertExact` guard so a missing or extra entry is a build error. `SUPPORTED_FIXES` and `UNCLASSIFIED` are the per-kind directive maps. `renderActionDirective` returns the action text for one error instance (or `""` when the directive does not apply, so the caller emits a bare error line instead). `renderReportOnlyBlock` formats the unclassified reason block. `collectUnclassified` filters error sets to their unclassified subset; `isUnrepairableErrorSet` and `formatUnrepairableMessage` decide and render the all-unclassified message shown when no repair can be attempted.

## README export: markers, application, and synthesis

<!-- lw:anchors packages/core/src/readme-export.ts#README_START packages/core/src/readme-export.ts#README_END packages/core/src/readme-export.ts#README_REL_PATH packages/core/src/readme-export.ts#ReadmeExportError packages/core/src/readme-export.ts#ReadmeExportError.constructor packages/core/src/readme-export.ts#findReadmeBlock packages/core/src/readme-export.ts#canonicalBlock packages/core/src/readme-export.ts#fullFileContent packages/core/src/readme-export.ts#refusalMessage packages/core/src/readme-export.ts#applyReadme packages/core/src/readme-export.ts#stripFrontmatter packages/core/src/readme-export.ts#sectionLines packages/core/src/readme-export.ts#firstPlainParagraph packages/core/src/readme-export.ts#extractPurpose packages/core/src/readme-export.ts#extractDigests packages/core/src/readme-export.ts#extractHubLinks packages/core/src/readme-export.ts#synthesizePurposeFromDigests packages/core/src/readme-export.ts#readWikiPage packages/core/src/readme-export.ts#buildReadme packages/core/src/readme-export.ts#generateReadmeContent packages/core/src/readme-export.ts#exportReadme -->

The README export is a deterministic, zero-LLM pipeline that synthesizes `README.md` from the wiki. It follows rule #6: a human-authored README without the marker block is never overwritten, only an opt-in via inserting the markers (or removing the existing file) authorizes the export.

```ts
export const README_START = "<!-- livewiki:readme:start -->";
export const README_END = "<!-- livewiki:readme:end -->";
export const README_REL_PATH = "README.md";
export class ReadmeExportError extends Error {
  public readonly code: "missing_wiki";
  constructor(code: "missing_wiki", message: string);
}
export function findReadmeBlock(content: string): { startIdx: number; endIdx: number; inner: string } | null;
function canonicalBlock(inner: string): string;
function fullFileContent(inner: string): string;
function refusalMessage(): string;
export function applyReadme(existing: string | null, generated: string): ReadmeApplyResult;
function stripFrontmatter(content: string): string;
function sectionLines(lines: string[], headingRe: RegExp): string[] | null;
function firstPlainParagraph(lines: string[]): string | null;
function extractPurpose(quickstartBody: string): string | null;
function extractDigests(quickstartBody: string): ReadmeDigest[];
function extractHubLinks(hubBody: string, hubDir: string): HubLink[];
function synthesizePurposeFromDigests(digests: ReadmeDigest[]): string | null;
async function readWikiPage(repoRoot: string, relPath: string): Promise<string | null>;
async function buildReadme(repoRoot: string): Promise<{ content: string; notes: string[] }>;
export async function generateReadmeContent(repoRoot: string): Promise<string>;
export async function exportReadme(repoRoot: string, opts: ExportOptions): Promise<ReadmeExportResult>;
```

`README_START` and `README_END` are the stable marker strings external parsers may depend on; `README_REL_PATH` is the file target. `ReadmeExportError` carries a `code: "missing_wiki"` discriminator; the constructor stores it as a readonly field. `findReadmeBlock` locates the block (tolerating whitespace inside markers); `canonicalBlock` and `fullFileContent` compose the written block and the create-case full file (with the one-line provenance comment). `refusalMessage` returns the rule-#6 opt-in instructions. `applyReadme` is the pure application of the rule-#6 contract — absent file → create, file with markers → replace-block, file without markers → refusal — and never throws. `stripFrontmatter`, `sectionLines`, and `firstPlainParagraph` are the deterministic parsers used by the extractors. `extractPurpose` returns the `## What this repository is` paragraph from the quickstart when present, otherwise the first non-heading paragraph. `extractDigests` parses the `## What you'll find in this wiki` bullets (capped at `README_DIGEST_CAP`). `extractHubLinks` parses flows (`### [t](x)`) and topics (`- [t](x)`) hubs and rewrites the link target to `livewiki/<hubDir>/<target>`. `synthesizePurposeFromDigests` is the deterministic no-purpose fallback that joins the first up-to-three digests into a single sentence. `readWikiPage` reads a wiki page through `safe-io` and returns `null` on failure rather than throwing. `buildReadme` throws `ReadmeExportError` (code `"missing_wiki"`) when `livewiki/quickstart.md` is absent. `generateReadmeContent` exposes the synthesized block content; `exportReadme` is the public entry that plans or applies the write, returning a `ReadmeExportResult` that records the action, dry-run flag, path, byte delta, optional refusal, notes, and (for dry-run) a preview of the first `PREVIEW_LINES`.

## Risk-weighted debt ranking

<!-- lw:anchors packages/core/src/risk.ts#bandPoints packages/core/src/risk.ts#derivePathFromSymbolKey packages/core/src/risk.ts#computeTestCoverageAndFanIn packages/core/src/risk.ts#scoreDebtItem packages/core/src/risk.ts#compareByRisk packages/core/src/risk.ts#parseGitChurnOutput packages/core/src/risk.ts#runGitLog packages/core/src/risk.ts#collectGitChurn -->

The risk module computes a transparent score without any LLM call by combining event points, test-gap, fan-in, and git churn. Ranking never removes obligations; it only orders them.

```ts
function bandPoints(bands: ReadonlyArray<readonly [number, number, number]>, value: number): number;
export function derivePathFromSymbolKey(key: string | null): string | null;
export function computeTestCoverageAndFanIn(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
  goModulePath?: string | null;
  rustCrateName?: string | null;
}): { coveredByTest: Set<string>; fanIn: Map<string, number> };
export function scoreDebtItem(opts: {
  event: "changed" | "moved" | "deleted";
  tier: "anchored" | "prose" | null;
  coveredByTest: boolean;
  fanIn: number;
  churnCount: number | null;
}): RiskScore;
export function compareByRisk(
  a: { id: number; detected_at: number; risk?: RiskScore },
  b: { id: number; detected_at: number; risk?: RiskScore },
): number;
export function parseGitChurnOutput(text: string): Map<string, number>;
function runGitLog(absRoot: string, maxCommits: number, spawnImpl: SpawnImpl): Promise<string | null>;
export async function collectGitChurn(
  absRoot: string,
  maxCommits: number,
  spawnImpl?: SpawnImpl,
): Promise<Map<string, number> | null>;
```

`bandPoints` evaluates the rubric bands top-down and returns the points for the first matching range (or `0` when no band matches). `derivePathFromSymbolKey` extracts the source path from a `symbol_key` (returns `null` when absent or the key carries no `#`). `computeTestCoverageAndFanIn` resolves import edges (relative specifiers only — workspace packages empty, identical strictness to the module graph without a workspace map) and projects them into `coveredByTest` (files imported by at least one test file per `isTestPath`) and `fanIn` (count of distinct importer files per imported file). `scoreDebtItem` sums the four factors using the rubric weights: event points from `EVENT_POINTS` (`changed`/`deleted` = 10, `moved` = 5), test gap (`TEST_GAP_ANCHORED_UNCOVERED = 40` for anchored uncovered files, `TEST_GAP_PROSE = 10` flat for prose-tier files), fan-in via the `FAN_IN_BANDS` table (always `0` for prose-tier), and churn via the `CHURN_BANDS` table (`null` churn → `0`). `compareByRisk` sorts score desc, then `detected_at` asc, then `id` asc, treating missing `risk` as `0` — deterministic for identical inputs. `parseGitChurnOutput` parses `git log --no-merges --max-count=N --name-only --format=` into a per-file commit count (paths normalized to repo-relative posix). `runGitLog` spawns the command with `-c core.quotepath=false` (so non-ASCII paths are not C-quoted) and `shell: false`; any failure (spawn throw, non-zero exit, error event) resolves `null` rather than rejecting. `collectGitChurn` short-circuits to `null` when `maxCommits <= 0` or is not an integer, otherwise delegates to `runGitLog` and `parseGitChurnOutput`.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (5 files, ~168k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
