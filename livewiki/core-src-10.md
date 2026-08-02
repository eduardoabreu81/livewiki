---
title: core prompts, presets, pricing, and README export
owner: generated
anchors:
  - packages/core/src/presets.ts#AVAILABLE_PRESETS
  - packages/core/src/presets.ts#PRESET_TABLE
  - packages/core/src/presets.ts#UnknownPresetError
  - packages/core/src/presets.ts#UnknownPresetError.constructor
  - packages/core/src/presets.ts#isKnownPreset
  - packages/core/src/presets.ts#resolvePreset
  - packages/core/src/presets.ts#resolveProviderConfig
  - packages/core/src/pricing.ts#PRICING_REFERENCE_DATE
  - packages/core/src/pricing.ts#PRICING_TABLE
  - packages/core/src/pricing.ts#calculateCostUsd
  - packages/core/src/pricing.ts#formatCost
  - packages/core/src/pricing.ts#lookupPricing
  - packages/core/src/prompts.test.ts#copyableAnchorMarkers
  - packages/core/src/prompts.test.ts#outerFenceFor
  - packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE
  - packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET
  - packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE
  - packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE
  - packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES
  - packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES
  - packages/core/src/prompts.ts#boundEncodeLongRuns
  - packages/core/src/prompts.ts#buildFlowGroupBlock
  - packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock
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
  - packages/core/src/prompts.ts#formatTopicGroups
  - packages/core/src/prompts.ts#longestRunOf
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
  - packages/core/src/prompts.ts#renderProseEvidenceBlock
  - packages/core/src/prompts.ts#renderRationaleEvidenceBlock
  - packages/core/src/prompts.ts#selectSafeFence
  - packages/core/src/prompts.ts#wrapInSafeFence
  - packages/core/src/rationale-evidence.ts#renderRationaleEvidence
  - packages/core/src/readme-export.test.ts#readOrNull
  - packages/core/src/readme-export.test.ts#write
  - packages/core/src/readme-export.test.ts#writeFixtureWiki
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
  - packages/core/src/repair-contract.test.ts#err
---

# core prompts, presets, pricing, and README export

This module assembles the LLM prompt templates, provider presets, pricing table, and the deterministic README exporter that drive the batch documentation pipeline.

## When to use this page

- **Audit** what goes into the LLM call by reading the stage 4 / stage 5 / topic / repair prompt templates and their shared rule constants.
- **Resolve** a provider preset via `PRESET_TABLE` and `resolvePreset` when wiring a new LLM client to a known provider.
- **Estimate** USD cost with `lookupPricing` / `calculateCostUsd` and render the result with `formatCost` for batch reports.
- **Export** a README.md from the wiki with `generateReadmeContent` / `exportReadme` while respecting rule #6 (human-authored files are never overwritten).

## How it fits

The module lives under `packages/core/src/` and is consumed by the batch orchestrator. The preset and pricing tables are pure data the rest of the pipeline reads; the prompt templates encapsulate the editorial contract enforced by the verifier; the README exporter turns a generated wiki into a repo-level README without invoking the LLM. Tests under `*.test.ts` next to each source file lock the prompt rules, the pricing math, and the README contract.

## Provider presets
<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

The preset module is a data table: every entry in `PRESET_TABLE` carries the adapter, base URL, env-var name, default pricing, operational notes, and a thinking-reasoning policy sufficient to run the provider without further configuration. `AVAILABLE_PRESETS` exposes the closed list of `PresetName` keys used for validation and CLI help.

`resolvePreset` is the canonical lookup:

```ts
export function resolvePreset(name: string): ProviderPreset {
```

When the name is not in `PRESET_TABLE`, `resolvePreset` throws `UnknownPresetError` whose constructor accepts the offending name and the available list so the error message can list the choices:

```ts
constructor(name: string, available: readonly string[]) {
```

`isKnownPreset` is the type guard: `export function isKnownPreset(name: string): name is PresetName {`, usable before doing config resolution. `resolveProviderConfig` merges the preset with user overrides from `.livewiki/config.json`, letting the config override any field except the env-var name (which is never serialized).

## Pricing
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost packages/core/src/pricing.ts#lookupPricing -->

The pricing module is intentionally small: a date stamp, a hard-coded table, and three lookup helpers. `PRICING_REFERENCE_DATE` (currently `"2026-07-09"`) is included in every cost report so the user knows whether the embedded table is fresh. `PRICING_TABLE` covers the MVP models (Claude 4.5 family plus OpenAI-compat staples) and is meant to be short — pricing is best-effort, and a stale entry is worse than a transparent "no price" report.

`lookupPricing` is the priority resolver:

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup {
```

Order: (1) override from `config.pricing.<model>`, (2) embedded `PRICING_TABLE`, (3) `{ tokensOnly: true }`. The fallback path returns `tokensOnly: true` rather than inventing a number; the report then shows tokens without USD. `calculateCostUsd` converts `inputTokens` and `outputTokens` against the per-million rate and returns `null` when the lookup is `tokensOnly`. `formatCost` renders the result as either `$<total>` with four decimals, or the literal `(no price for model <name>)` string — the absence of a price is made explicit instead of glossed over.

## Prompt rule constants
<!-- lw:anchors packages/core/src/prompts.ts#BRANCH_PRECISION_PROMPT_RULE packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#FLOW_DIAGRAM_DEFAULT_BUDGET packages/core/src/prompts.ts#FLOW_PAGE_PROMPT_RULES packages/core/src/prompts.ts#INVENTORY_AUTHORITY_PROMPT_RULE packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#TOPIC_PAGE_PROMPT_RULES -->

The rule constants are the shared editorial contract between the initial generation and the repair prompts, so they cannot drift. `PAGE_OPENING_PROMPT_RULES` fixes the frontmatter + H1 + `When to use this page` + `How it fits` opening; `FLOW_PAGE_PROMPT_RULES` defines the `Purpose` / `Ordered flow` / `Invariants` / `Failure and recovery` / `Related pages` structure flow pages must follow (with the `Diagram` section explicitly forbidden because the orchestrator inserts it deterministically); `TOPIC_PAGE_PROMPT_RULES` adds the topic-page contract. The five single-rule constants encode focused invariants: `LITERAL_SIGNATURE_PROMPT_RULE` (copy signatures byte-for-byte from the symbol table), `EXCEPTION_BRANCH_PROMPT_RULE` (document visible throw / catch / fallback paths), `INVENTORY_AUTHORITY_PROMPT_RULE` (the prompt's file list and closed keys outrank prose), and `BRANCH_PRECISION_PROMPT_RULE` (never generalize a one-sided check).

Budgets are exposed as `DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000` and `DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000`. `FLOW_DIAGRAM_DEFAULT_BUDGET` is the object `{ maxNodes: 12, maxEdges: 20 } as const` that caps the deterministic flow diagram the orchestrator renders between `Ordered flow` and `Invariants`.

## Marker neutralization and safe fences
<!-- lw:anchors packages/core/src/prompts.ts#boundEncodeLongRuns packages/core/src/prompts.ts#longestRunOf packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#renderProseEvidenceBlock packages/core/src/prompts.ts#renderRationaleEvidenceBlock packages/core/src/prompts.ts#selectSafeFence packages/core/src/prompts.ts#wrapInSafeFence packages/core/src/rationale-evidence.ts#renderRationaleEvidence -->

These helpers defend the prompt-assembly pipeline against prompt-injection-style content spliced into the user prompt. `longestRunOf(text, char)` returns the longest contiguous run of backticks or tildes in `text`; `boundEncodeLongRuns(text, char, cap)` then escapes any run longer than `cap` so that the surrounding model output can never accidentally close the LLM's outer fence.

`selectSafeFence` and `wrapInSafeFence` pick a fence longer than the longest inner run and wrap the content in it. `neutralizeUntrustedControlMarkers` strips any `<!-- lw:* -->` styled marker that could be smuggled through rationale or prose evidence; `neutralizeUntrustedControlMarkersExceptValidAnchors` is the allow-list variant that preserves `lw:anchors` markers whose keys are present in the closed list passed to it, while still neutralizing control markers that do not match.

`renderRationaleEvidenceBlock` and `renderProseEvidenceBlock` are the bounded text-renderers used inside stage-4 user prompts. The module-internal `renderRationaleEvidence` in `rationale-evidence.ts` is the shared single source of truth (signature begins `export function renderRationaleEvidence(` returning a `string`), and the prompt-side helper delegates to it so the planner estimate and the generator context never disagree.

## Stage 4 and overview prompts
<!-- lw:anchors packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildTopicPrompt packages/core/src/prompts.ts#buildTopicRefinePrompt -->

`buildStage4Prompt` is the main per-module page generator. It produces a `PromptPair` (`{ system, user }`) from the module, the closed list of canonical keys, the symbol table, the relevant code excerpt, and the target language. The system prompt is in English regardless of `language` (the user prompt carries the language instruction explicitly so contributors can audit the exact text sent to the LLM). `buildQuickstartPrompt` and `buildOverviewPrompt` are the lighter prompts used for repo-level pages. `buildTopicPrompt` produces the topic-page prompt and `buildTopicRefinePrompt` is its post-validator refinement pass.

## Stage 5, flow, and topic section assembly
<!-- lw:anchors packages/core/src/prompts.ts#buildFlowGroupBlock packages/core/src/prompts.ts#buildFlowSectionAssignmentBlock packages/core/src/prompts.ts#buildStage5Prompt packages/core/src/prompts.ts#buildTopicSectionAssignmentBlock packages/core/src/prompts.ts#formatTopicGroups -->

These helpers build the structured blocks embedded inside stage-5 prompts. `buildFlowGroupBlock` and `buildFlowSectionAssignmentBlock` translate a `FlowKeySectionMap` into the textual assignment table the LLM reads; `buildTopicSectionAssignmentBlock` does the same for `TopicKeySectionMap`. `formatTopicGroups` renders `TopicKeyGroups` into the bullet-block the planner emits. `buildStage5Prompt` is the page-level flow prompt that references those blocks.

## Repair prompts
<!-- lw:anchors packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage5RepairPrompt packages/core/src/prompts.ts#buildSurgicalRepairPrompt packages/core/src/prompts.ts#buildTopicRepairPrompt -->

The repair family of prompts is keyed by the `ArtifactValidationError` codes defined in `repair-contract.ts`. `buildRepairPrompt` is the generic module repair; `buildStage2RefinePrompt` is the post-stage-2 refinement pass; `buildStage5RepairPrompt` re-invokes the LLM when a flow page fails verification; `buildSurgicalRepairPrompt` targets only the offending sections identified by `surgicalRepairTargetSections`; `buildTopicRepairPrompt` is the topic-page equivalent. Each repair prompt references the same rule constants its corresponding initial prompt uses, so a validator finding only triggers a target-scope edit rather than a full rewrite.

## Prompt assembly tests
<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor packages/core/src/repair-contract.test.ts#err -->

The test files pin the prompt contract. `copyableAnchorMarkers(text)` extracts every `<!-- lw:anchors ... -->` marker body from a prompt string and returns the list of key arrays; `outerFenceFor(...)` (signature truncated in the excerpt) is the matching helper used to assert the wrapping fence length. In `repair-contract.test.ts`, the local `err(code, extra?)` factory builds an `ArtifactValidationError` with a fixed message and `location: "body"` so the contract tests can iterate over every code × page kind combination without copy-pasting boilerplate.

## README export markers
<!-- lw:anchors packages/core/src/readme-export.ts#README_END packages/core/src/readme-export.ts#README_REL_PATH packages/core/src/readme-export.ts#README_START packages/core/src/readme-export.ts#ReadmeExportError packages/core/src/readme-export.ts#ReadmeExportError.constructor -->

The README exporter uses three module-level constants to delimit the generated block: `README_START = "<!-- livewiki:readme:start -->"`, `README_END = "<!-- livewiki:readme:end -->"`, and `README_REL_PATH = "README.md"` (relative to the repo root). `ReadmeExportError` is the explicitly-typed exception (`export class ReadmeExportError extends Error`) carrying `code: "missing_wiki"`; its constructor signature is `constructor(code: "missing_wiki", message: string) {`. The same `"<!-- livewiki:readme:start -->"` marker discipline mirrors the pointer block parser — whitespace inside the markers is tolerated but the literal strings are the contract.

## README export pipeline
<!-- lw:anchors packages/core/src/readme-export.ts#applyReadme packages/core/src/readme-export.ts#buildReadme packages/core/src/readme-export.ts#canonicalBlock packages/core/src/readme-export.ts#exportReadme packages/core/src/readme-export.ts#findReadmeBlock packages/core/src/readme-export.ts#fullFileContent packages/core/src/readme-export.ts#generateReadmeContent packages/core/src/readme-export.ts#refusalMessage -->

`applyReadme` is the pure rule-#6 contract applier:

```ts
export function applyReadme(
```

It receives the existing README contents (or `null` when absent) and the generated body, and returns either a `{ action, content }` change or a `{ refusal }` object. When the existing file lacks the marker block, it refuses with `refusalMessage()` rather than overwriting. `findReadmeBlock` locates the marker span (returns `null` on missing / truncated markers); `canonicalBlock` and `fullFileContent` produce the standard replacement string and the create-from-scratch file content. `generateReadmeContent` is the high-level entry point that reads the wiki via `safe-io` and assembles the body; `buildReadme` is the same builder at a different layer; `exportReadme` is the top-level wrapper that adds the opt-in `yes` flag and returns a `ReadmeExportResult` with `dryRun`, `bytesChanged`, and `notes`.

## README wiki evidence extraction
<!-- lw:anchors packages/core/src/readme-export.ts#extractDigests packages/core/src/readme-export.ts#extractHubLinks packages/core/src/readme-export.ts#extractPurpose packages/core/src/readme-export.ts#firstPlainParagraph packages/core/src/readme-export.ts#readWikiPage packages/core/src/readme-export.ts#sectionLines packages/core/src/readme-export.ts#stripFrontmatter packages/core/src/readme-export.ts#synthesizePurposeFromDigests -->

The extractors are deterministic parsers over the wiki files. `readWikiPage` reads a wiki page through `safe-io` (`allowReadme: true`); `stripFrontmatter` removes YAML frontmatter via `parseFrontmatter` and returns the body. `sectionLines(lines, headingRe)` returns the lines under a matched `## <heading>`, stopping at the next heading; `firstPlainParagraph` walks the lines looking for the first block of consecutive non-blank, non-heading, non-list, non-provenance-italic lines. `extractPurpose` pulls the "What this repository is" paragraph from the quickstart; on miss it falls through to `synthesizePurposeFromDigests`, which composes the repository description from the digest list. `extractDigests` and `extractHubLinks` parse the quickstart digest bullets and the `livewiki/flows/index.md` / `livewiki/topics/index.md` hubs into structured `ReadmeDigest[]` and `HubLink[]` arrays.

## README export tests
<!-- lw:anchors packages/core/src/readme-export.test.ts#readOrNull packages/core/src/readme-export.test.ts#write packages/core/src/readme-export.test.ts#writeFixtureWiki -->

The fixture harness builds a temp repo root, writes the wiki files needed by the contract tests, and tears it down after each test. `write(rel, content)` joins `repoRoot` with the relative path, creates parent directories, and writes UTF-8; `readOrNull(rel)` returns the file contents or `null` on `ENOENT` so missing-file assertions stay readable. `writeFixtureWiki` is the convenient entry point that writes the quickstart, tasks, flows index, and topics index used by the main `generateReadmeContent` tests.

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency and dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency

> Coverage note: this module's source (9 files, ~266k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
