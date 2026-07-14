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

## Pointer module — block markers and AGENTS.md/CLAUDE.md insertion
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module owns the only sanctioned exception to the safe-io allowlist: appending a delimited block to `AGENTS.md` or `CLAUDE.md`. The two HTML-comment markers — `POINTER_START` (`<!-- livewiki:start -->`) and `POINTER_END` (`<!-- livewiki:end -->`) — are stable strings that external parsers may depend on, so they are exported as constants rather than inlined. `POINTER_FILES` constrains the set of valid target filenames to `AGENTS.md` and `CLAUDE.md`, and `pickPointerFile` decides which one to write: an explicit `requested` argument wins, otherwise an existing `AGENTS.md` is preferred, then `CLAUDE.md`, otherwise the function falls back to `AGENTS.md` for creation.

`buildPointerBlock` returns the default block content — a single short paragraph in PT-BR pointing at `./livewiki/quickstart.md`, bracketed by the two markers. The block is deliberately minimal so no wiki content is duplicated into the host repo's agent instructions. `findPointerBlock` is a pure, disk-free parser: it locates the first `start` marker, the first `end` marker after it, and returns the `{ startIdx, endIdx, inner }` slice. It tolerates surrounding whitespace and treats a truncated block (no end marker) as absent to avoid corrupting the document.

Two pure string transforms sit on top of the parser. `applyPointerReplace` either replaces the existing block in place or appends a new one with a single blank-line separator; it returns `{ content, action }` where `action` is `"replaced"`, `"inserted"`, or `"unchanged"`. `applyPointerRemove` strips the block when present. The async entry points — `insertPointer`, `removePointer`, `readPointerStatus`, and `ensurePointerFile` — are wrappers around these pure helpers plus safe-io I/O. `_internal` re-exports the `nodeFs` module reference to allow test code to substitute the filesystem layer.

## Presets table — known LLM provider configurations
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset -->

The presets module is a data table, not a registry of code. `PRESET_TABLE` is a `Record<PresetName, ProviderPreset>` keyed by the literal union `PresetName` covering `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, and `lmstudio`. Adding a provider is an entry-add only — no new code. Each `ProviderPreset` carries the adapter to instantiate (`anthropic` or `openai-compat`), the API `baseUrl`, the name of the env var holding the API key (never the value), a best-effort `pricing` table, short operational `notes`, an optional `thinkingDefault` policy, and provider-specific output hints.

`AVAILABLE_PRESETS` is the readonly list of keys derived from `PRESET_TABLE`, suitable for surfacing in `--help` and error messages. `isKnownPreset` is the type-guard (`name is PresetName`) that callers use before indexing into the table. `resolvePreset(name)` returns the matching `ProviderPreset` or throws `UnknownPresetError`, whose constructor captures both the bad `presetName` and the `available` list for actionable error messages.

`resolveProviderConfig({ presetName, configOverride })` is the layered loader: it starts from the preset and applies user overrides from `.livewiki/config.json` field by field. Env var names are surfaced through the preset; values are resolved elsewhere and never logged or persisted (covered by `key-leak.test.ts`). When a provider exposes an Anthropic-compatible endpoint (e.g. MiniMax), the preset uses the `anthropic` adapter so prompt caching is exploited.

## Pricing table — USD cost calculation per model
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

Pricing is intentionally best-effort. `PRICING_REFERENCE_DATE` (`"2026-07-09"`) is the date the embedded table was compiled; every cost report carries this stamp so users know whether the figures are fresh or stale. `PRICING_TABLE` is a `PricingTable` (a `Record<string, ModelPrice>`) with USD prices per 1M tokens for the MVP's popular models — Anthropic Claude 4.5 family entries and a few OpenAI-compat entries like `gpt-4o` and `gpt-4o-mini`. Unknown models are deliberately omitted from the table rather than guessed at.

`lookupPricing(model, override?)` is the single resolution point. It tries, in order: the user's `override` (which always wins), then the embedded table, then returns `{ tokensOnly: true }` when nothing matches. The non-`tokensOnly` branch carries the per-million USD rates and the reference date. `calculateCostUsd(inputTokens, outputTokens, model, override?)` multiplies the token counts by the rates (dividing by 1e6 for per-million semantics) and returns `{ input, output, total, refDate }`, or `null` when the model is unknown — the report renders tokens without inventing USD.

`formatCost(cost, model)` is the human-readable formatter for reports. When `cost` is `null`, it returns the explicit string `(no price for model X)` rather than a placeholder dollar amount, so absence of data stays visible.

## Prompt builders — Stage 4 generation and untrusted-marker neutralization
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

The prompts module owns LLM-facing template construction. `DEFAULT_CONTEXT_TOKEN_BUDGET` (30,000) caps the source code portion per module, and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4,000) caps the generated Markdown. Both can be overridden at the call site. All prompt bodies are written in English so contributors can audit what reaches the model; the `${language}` parameter is passed as an explicit instruction in the user prompt and never mutates the system-prompt text.

`neutralizeUntrustedControlMarkers(text)` is a defensive pass applied to untrusted content (repo source/comments and any prior LLM candidate) before it is embedded in a prompt. It replaces every `<!-- lw:* ... -->` match with whitespace of identical length so the model has nothing left to copy verbatim. `neutralizeUntrustedControlMarkersExceptValidAnchors(text, closedKeyList)` is the repair-pipeline variant: it preserves an `lw:anchors` marker verbatim iff every whitespace-separated key inside it is byte-for-byte a member of `closedKeyList`; all other `lw:*` markers are whitespace-neutralized identically to the general variant.

`buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language)` produces the system/user pair that drives module-page generation. The system prompt encodes the persona, the closed-key rules, the completeness invariants, the primary-section rule, and the prohibition on aggregate or thematic markers. The user prompt embeds the module, the closed canonical key list (so the model distributes without inventing), the symbol table, and the truncated source. `buildStage2RefinePrompt`, `buildQuickstartPrompt`, `buildOverviewPrompt`, and `buildRepairPrompt` are siblings tailored to their respective stages; the repair prompt is what consumes the neutralization helpers above.

The test-only helper `copyableAnchorMarkers(text)` (in `prompts.test.ts`) extracts the bodies of every `lw:anchors` marker in a prompt string as an array of key arrays, supporting assertions that no fake or ellipsis anchor is present.

## Safe I/O — allowlisted filesystem access and error types
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

Safe I/O is the single chokepoint for all disk writes. `ALLOWED_DIRS` is the readonly tuple `["livewiki", ".livewiki"]`; `PathOutsideAllowlistError` and `InvalidRelativePathError` are the two error types thrown when validation fails. Both expose structured fields (`repoRoot`, `attempted`, `allowlist` for the former) so error messages can be rendered without string-parsing.

`allowlistFor(opts)` returns the effective list of allowed roots — `ALLOWED_DIRS` by default, plus `AGENTS.md`/`CLAUDE.md` only when `opts.allowPointer` is true. `allowedAbs(repoRoot, dir)` is an internal helper that resolves an allowed directory to an absolute path inside `repoRoot` and defensively checks that the result does not escape via `..` or an absolute segment. `isInsideAllowlist(repoRoot, absPath, opts)` is the pure prefix-comparison check: it returns true only if `absPath` is `repoRoot/<dir>/...` for some `dir` in the allowlist, with a separator-aware comparison so `livewiki-evil` is not mistaken for `livewiki/`. When `allowPointer` is on, `AGENTS.md` and `CLAUDE.md` are accepted only at the repo root.

`validateDeclared(repoRoot, relPath, opts)` is the first defense — it rejects absolute paths, `..` traversal, and paths outside the declared allowlist before any disk access. `findDeepestExisting` walks the path upward until it finds an ancestor that exists, so `resolveAndValidate` can then `realpath` that ancestor and re-check the allowlist to defeat symlink-based escapes (`livewiki` → `/tmp`, `livewiki/sub` → `../src`, etc.).

`resolveAndValidate(repoRoot, relPath, opts)` is the canonical entry point used everywhere else. It returns an absolute path guaranteed to live inside the allowlist. `writeText`, `readText`, `exists`, `mkdir`, and `remove` are thin async wrappers around `node:fs/promises` that all funnel through `resolveAndValidate`, so no caller can bypass the allowlist. The test-only helper `detectSymlinkSupport()` probes whether the host filesystem permits symlink creation so Windows tests can opt out via `it.runIf(canSymlink)`.

## Status — wiki health report
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

The status module reports the live state of the wiki plus its index. `run(repoRoot, opts)` opens `.livewiki/index.db` (via safe-io), calls `collect` to build the structured report, then best-effort attaches `snapshotMetrics` from `update-metrics` so the Fase 5 token-economics figures ride along — failures in the metrics snapshot are swallowed so status never breaks the user. `collect(db, topN)` queries the indexed `files` and `symbols` tables, computes language/kind breakdowns, joins debt rows to anchors and doc pages to produce per-event and per-assignee debt counts, and pulls a sample of undocumented symbols. `formatHuman(report)` renders the structured `StatusReport` as multi-line text suitable for a TTY.

## Symbols — AST extraction to SymbolRecord
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.test.ts#parse -->

The symbols module is the Fase 1 extraction layer over a tree-sitter tree. `extractSymbols(tree, relPath, source)` is the public entry point: it walks the AST, collects `ExtractedSymbol` candidates, sorts them by `start_line` then `source_start_byte` then discovery order, deduplicates by `key`, and returns `SymbolRecord[]`. Each record carries the canonical `key` (`path#name` or `path#Class.method`), short `name`, `kind` (`function` | `class` | `method` | `export`), a `signature` (header line or first line), `start_line`/`end_line`, and a `content_hash` of the node slice.

`walkNode` is the recursive descent that dispatches on node type: `function_declaration` and `generator_function_declaration` emit `function`; `class_declaration`/`class` emits `class` and recursively descends into its children with `parentClassName` set so `method_definition` can produce `Class.method` keys; `method_definition` outside a class emits un-qualified; `export_statement` is collapsed with its inner declaration so `export class Foo` and `export function bar` do not duplicate. `makeRecord` builds an `ExtractedSymbol` from a node plus the resolved name/kind, slicing the source by byte range to compute the content hash. `toSymbolRecord` strips the private `source_start_byte` field for the public surface. `signatureFor(node, source)` returns the header line for use in anchor rendering, or `null` when no signature can be derived.

The test-only helper `parse(ext, src)` (in `symbols.test.ts`) is a thin shim around the parser used by every test case to obtain a `Tree` for `extractSymbols`.

## Update metrics — append-only token accounting
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

The update-metrics module persists token-economics figures in `.livewiki/update_metrics.json` rather than SQLite, on the rationale that the file is reconstructible and append-only. The shape is `{ version: 1, entries: UpdateMetric[] }`, where `UpdateMetric` is a discriminated union of `"package_emitted"` (carrying `tokensEstimated`, `bytes`, `debtCount`, `timestamp`) and `"write_received"` (carrying `wikiPath`, `bytes`, `tokensEstimated`, `timestamp`).

`metricsPath(repoRoot)` resolves the metrics file through safe-io. `readMetrics(repoRoot)` parses the JSON or returns an empty `{ version: 1, entries: [] }` when the file is missing or malformed (a corrupted file is treated as fresh per the "everything important lives in versioned markdown" rule). `writeMetrics(repoRoot, file)` serializes and persists through `safe-io.writeText`. `recordUpdateMetric(repoRoot, metric)` appends an entry fire-and-forget — internal errors are swallowed so metrics never block the primary update flow.

`snapshotMetrics(repoRoot)` aggregates the entries into `UpdateMetricsSnapshot`: counts of packages emitted and writes received, sums of their estimated tokens, an `efficiencyRatio` (writes/packages; `null` when no packages yet), and the most recent entry of each kind. `clearMetricsForTests(repoRoot)` is the test-only reset hook used in `update.test.ts` to keep metrics isolated between cases.

## Update tests — incremental mode harness
<!-- lw:anchors packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

The update tests cover Fase 5's incremental flow. `writeCode(rel, content)` and `writeWiki(rel, content)` are tiny `node:fs/promises` helpers that create intermediate directories and write a file under the per-test `repoRoot` tmpdir. `setupWithAnchor` is the standard preamble used by most cases: it writes a small `src/foo.ts`, runs the indexer and anchor-ledger, writes a `livewiki/foo.md` page whose frontmatter anchors `src/foo.ts#bar`, then re-runs the indexer and ledger so the system has a real anchor to detect changes against. Without this setup, the ledger has nothing to flag and the work-package debt assertions cannot fire.