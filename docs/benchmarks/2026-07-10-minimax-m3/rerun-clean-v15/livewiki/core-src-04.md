---
title: core-src-04
owner: generated
anchors:
  - packages/core/src/pointer.ts#POINTER_END
  - packages/core/src/pointer.ts#POINTER_FILES
  - packages/core/src/pointer.ts#POINTER_START
  - packages/core/src/pointer.ts#_internal
  - packages/core/src/pointer.ts#applyPointerRemove
  - packages/core/src/pointer.ts#applyPointerReplace
  - packages/core/src/pointer.ts#buildPointerBlock
  - packages/core/src/pointer.ts#ensurePointerFile
  - packages/core/src/pointer.ts#findPointerBlock
  - packages/core/src/pointer.ts#insertPointer
  - packages/core/src/pointer.ts#pickPointerFile
  - packages/core/src/pointer.ts#readPointerStatus
  - packages/core/src/pointer.ts#removePointer
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
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
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
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
---

## Pointer block (pointer.ts)

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module manages an opt-in append of a `<!-- livewiki:start -->` / `<!-- livewiki:end -->` delimited block in `AGENTS.md` or `CLAUDE.md`. Marker strings are exposed as stable constants so external parsers can rely on them. `POINTER_FILES` is the closed tuple of allowed target files and drives the `PointerFile` type alias.

`pickPointerFile` selects the target file based on which of `AGENTS.md` / `CLAUDE.md` already exists, honoring an explicit `requested` override. `buildPointerBlock()` produces the default paragraph-and-link body. `findPointerBlock` is a pure parser that locates the block in a string (tolerant of leading whitespace and stray spacing around markers, returning `null` if the block is truncated), while `applyPointerReplace` and `applyPointerRemove` perform idempotent string-only substitutions over existing or appended blocks.

`insertPointer` and `removePointer` are the disk-touching counterparts that write through `safe-io`'s allowlist. `readPointerStatus` reports whether a target file contains a pointer block and `ensurePointerFile` creates the chosen pointer file when absent. `_internal` re-exports `nodeFs` for tests that need a passthrough handle.

## Provider presets (presets.ts)

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`PRESET_TABLE` is the embedded map from `PresetName` to `ProviderPreset` covering the supported providers (anthropic, openai, openrouter, deepseek, kimi, minimax, gemini, nvidia, ollama, lmstudio). Each entry carries `adapter`, `baseUrl`, `envVar`, default `pricing`, operational `notes`, plus optional `thinkingDefault`, `preferMaxCompletionTokens`, and `defaultMaxOutputTokens` fields for adapter-specific tuning. `AVAILABLE_PRESETS` is the readonly list of preset names derived from the table.

`UnknownPresetError` is thrown for unrecognized names; its constructor captures both the requested name and the `available` list to surface a helpful message. `isKnownPreset` narrows `string` to `PresetName` via a type guard. `resolvePreset` returns the preset entry or throws `UnknownPresetError`, while `resolveProviderConfig` merges a preset with user-provided field overrides from a config file or CLI args.

## Pricing table (pricing.ts)

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

The pricing module ships an embedded `PRICING_TABLE` of best-effort USD-per-1M-token rates annotated by `PRICING_REFERENCE_DATE` ("2026-07-09"), allowing users to gauge whether reported costs use fresh or stale numbers. `lookupPricing` resolves a model via user override first, then the embedded table; missing entries produce a `tokensOnly` lookup rather than fabricated numbers. `calculateCostUsd` multiplies token counts against the resolved rates (per 1M) and returns `null` when the model has no price so callers can render an explicit "no price" marker. `formatCost` renders the cost as a `$x.xxxx` string or the explicit `(no price for model X)` placeholder.

## Prompt templates (prompts.ts)

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

Templates are authored in English regardless of target `language` so contributors can audit the prompts directly. `DEFAULT_CONTEXT_TOKEN_BUDGET` (30 000) and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4 000) are the per-module defaults used by callers when truncating source and sizing expected outputs.

`neutralizeUntrustedControlMarkers` replaces any `<!-- lw:* -->`-shaped substring inside untrusted text (such as repo comments or prior LLM output) with same-length whitespace, leaving no visible token an LLM could accidentally quote. `neutralizeUntrustedControlMarkersExceptValidAnchors` is the repair-candidate variant that preserves an `lw:anchors` marker verbatim only when every whitespace-separated key inside it appears in the supplied `closedKeyList`.

`buildStage4Prompt` produces the module-page prompt pair (system + user) with the closed list of canonical keys embedded verbatim. `buildStage2RefinePrompt`, `buildRepairPrompt`, `buildQuickstartPrompt`, and `buildOverviewPrompt` cover the other batch stages (refinement of an existing draft, repair of a verify rejection, the quickstart guide, and the project overview respectively).

The prompts test helper `copyableAnchorMarkers` extracts the per-section marker bodies from a prompt string so tests can assert closed-list coverage and forbid placeholder/ellipsis keys.

## Safe I/O (safe-io.ts)

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`safe-io` is the sole authorised writer: every disk mutation passes through it. `ALLOWED_DIRS` is the closed tuple `["livewiki", ".livewiki"]` (with `AllowedDir` derived from it). `isInsideAllowlist(repoRoot, absPath, opts)` is a pure predicate that decides whether an absolute path sits inside one of those directories, with prefix-on-separator semantics so `livewiki-evil` is not confused with `livewiki/`. When `opts.allowPointer` is set, it additionally accepts `AGENTS.md` and `CLAUDE.md` at the repo root.

`PathOutsideAllowlistError` (with its constructor capturing `repoRoot`, `attempted`, and `allowlist`) and `InvalidRelativePathError` (capturing the offending `relPath` and a `reason`) are thrown for the two main rejection modes. `allowlistFor` returns the effective allowlist including pointer files when opted in; `allowedAbs` computes the absolute path of an allowed directory and aborts if it would escape `repoRoot`.

`validateDeclared` performs the early declared-path check (absolute paths, `..` traversal, allowlist prefix), `findDeepestExisting` walks up to the deepest existing ancestor for symlink resolution, and `resolveAndValidate` runs both phases plus realpath-based revalidation to defeat symlink-escape attacks. The thin wrappers `writeText`, `readText`, `exists`, `mkdir`, and `remove` perform their respective operations through the validated path.

The test helper `detectSymlinkSupport` probes once per run whether symlinks can be created (admin / Developer Mode is required on Windows) so individual tests can skip via `it.runIf(canSymlink)`.

## Status report (status.ts)

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`run(repoRoot, opts?)` opens the index database via `safe-io.resolveAndValidate`, calls `collect` to assemble a `StatusReport`, and merges the latest `UpdateMetricsSnapshot` (best-effort, errors swallowed). `collect` aggregates active files (totals, language breakdown, top-N files by symbol count), active symbols (kind breakdown), open debt rows grouped by event and assignee with item details, undocumented symbols, and meta fields like `schemaVersion` and last-indexed timestamps. `formatHuman` renders the same report as a multi-line plain-text summary for terminal output.

## Symbol extraction (symbols.ts)

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.test.ts#parse -->

`extractSymbols` walks the tree-sitter AST once, then deduplicates by `key` while preserving source order (sorted by `start_line`, `source_start_byte`, and discovery order) so identical-named entries collapse deterministically. Supported kinds are `function`, `class`, `method`, and `export`. `walkNode` descends the tree, emitting qualified names like `Class.method`, collapsing `export class`/`export function` to avoid duplicating with their inner declarations, and skipping anonymous arrow functions and IIFEs.

`makeRecord` builds the internal `ExtractedSymbol` (including `source_start_byte` for ordering), `toSymbolRecord` strips that field to yield the public `SymbolRecord` (key, name, kind, signature, line range, content hash), and `signatureFor` extracts the first line of the node as a representative header for anchor rendering.

The test helper `parse(ext, src)` is a thin wrapper around the parser initialised in `beforeAll`, used across the TypeScript/Python extraction tests.

## Update metrics (update-metrics.ts)

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

Metrics live in `.livewiki/update_metrics.json` (a separate append-only JSON file rather than a SQLite table) to keep schema migrations untouched and to make the data trivially reconstructible. `metricsPath` resolves the file via `safe-io.resolveAndValidate`; `readMetrics` parses it and falls back to an empty `{version:1, entries:[]}` on missing-file or corruption; `writeMetrics` persists it through `safe-io.writeText`.

`recordUpdateMetric` is the fire-and-forget append entry point — a `UpdateMetric` is either `package_emitted` (token estimate, byte count, debt count) or `write_received` (wiki path, byte count, token estimate) — and any write failure is swallowed so it never blocks the main `update` flow. `snapshotMetrics` folds all entries into an `UpdateMetricsSnapshot` (totals for packages/writes, the `efficiencyRatio = totalWriteTokens / totalPackageTokens` proxy for the product thesis, and the latest entry of each kind). `clearMetricsForTests` resets the file between tests.

The update test helpers `writeCode` and `writeWiki` write into a per-test `mkdtemp` workspace, and `setupWithAnchor` indexes a sample `foo.ts#bar` symbol, generates the corresponding debt via the anchor ledger, and seeds the wiki frontmatter so ledger rules (debt = anchor changed) can fire.