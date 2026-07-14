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

## Pointer module — block delimiters and pure helpers
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The `pointer` module owns the opt-in `<!-- livewiki:start -->` / `<!-- livewiki:end -->` block appended to `AGENTS.md` or `CLAUDE.md`. Per SPEC §"Regras invioláveis" #2, pointer writes only happen with the explicit `--write-pointer` flag (or interactive confirmation) and never automatically; the modification is an idempotent append of a delimited block.

The marker constants `POINTER_START` and `POINTER_END` are exported as stable strings so external parsers may depend on their byte-exact values. The `POINTER_FILES` tuple enumerates the two allowed files, and is the source of the `PointerFile` literal-union type.

`pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)` decides the default target: an explicit `requested` always wins, otherwise `AGENTS.md` is preferred if it already exists, then `CLAUDE.md`, and falling back to `AGENTS.md` for fresh creation.

`buildPointerBlock()` synthesizes the default block content — a short Portuguese paragraph pointing at `./livewiki/quickstart.md`. The block is deliberately minimal: the wiki is not duplicated into `AGENTS.md`.

`findPointerBlock(content)` is a pure parser that locates an existing block in markdown text. The search tolerates leading whitespace before the start marker and accepts end markers with surrounding whitespace, but treats a start-without-end pair as absent rather than corrupting the file.

`applyPointerReplace(content, newBlock)` either substitutes the first existing block or appends a new one with a separating blank line; the action label (`inserted` | `replaced` | `unchanged`) is returned alongside the rewritten string. `applyPointerRemove(content)` is the symmetric helper that strips the block.

The I/O-coupled entry points live further down: `insertPointer(repoRoot, opts)` writes the block (or a custom `opts.block`) into the chosen file idempotently and returns a `PointerInsertResult`. `removePointer(repoRoot, opts)` strips the block if present. `readPointerStatus(repoRoot)` reports whether the block exists without mutating anything. `ensurePointerFile(repoRoot)` materializes the target file's parent directory and returns the resolved absolute path.

The internal export `_internal` exposes `nodeFs` for test seams; it is not part of the public surface.

## Presets — provider table and resolution
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`presets.ts` holds the embedded provider catalog described by SPEC §"Stack" (Fase 5): a literal-union `PresetName` enumerates `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, and `lmstudio`. Each preset is data, not code — adding a provider means adding a row, not writing a new client.

`PRESET_TABLE: Record<PresetName, ProviderPreset>` is the authoritative registry. Every row supplies `adapter`, `baseUrl`, `envVar`, `pricing`, `notes`, an optional `thinkingDefault` (`disabled` | `adaptive` | `omit` | `n/a`), the `preferMaxCompletionTokens` flag, and a `defaultMaxOutputTokens` suggestion for stage-4. The `envVar` key is the name of the environment variable, never the secret value — secrets are not persisted.

`AVAILABLE_PRESETS` is derived as a `readonly` array of preset names so callers can iterate or render lists without touching the table's structure.

`UnknownPresetError` is thrown by the resolution path. Its constructor takes the unrecognized `name` and the `available` list, joins them into the message, and stores both as readonly fields for downstream inspection.

`isKnownPreset(name)` is a type predicate that narrows `string` to `PresetName`. `resolvePreset(name)` looks up the table and throws `UnknownPresetError` on misses; it accepts the resolved `ProviderPreset` otherwise. `resolveProviderConfig(args)` composes preset data with config overrides into the final provider configuration.

## Pricing — embedded table and lookup
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`pricing.ts` implements SPEC §"Contabilidade de tokens (Fase 3)" — cost is measured against real API usage, never estimated. The policy is deliberate: an embedded best-effort table supplies defaults, the user can override per-model via `.livewiki/config.json`, and unknown models report tokens without inventing USD.

`PRICING_REFERENCE_DATE = "2026-07-09"` records when the embedded table was compiled; every cost line carries this date so the user can tell stale data from fresh data.

`PRICING_TABLE` is a `Record<string, ModelPrice>` covering popular Claude 4.5 family models and common OpenAI-compat endpoints (`gpt-4o`, `gpt-4o-mini`). Each `ModelPrice` is `{ input: number; output: number }` in USD per 1M tokens.

`lookupPricing(model, override?)` returns a `PricingLookup` discriminated union. The override map wins, then the embedded table; on miss it returns `{ tokensOnly: true }` so the reporter can show tokens without inventing USD.

`calculateCostUsd(inputTokens, outputTokens, model, override?)` consumes a `PricingLookup`. On `tokensOnly` it returns `null`; otherwise it scales the per-1M-token rates and returns `{ input, output, total, refDate }`.

`formatCost(cost, model)` renders the human report: numeric costs become `$0.1234` with four decimals, and a null cost becomes the explicit `(no price for model X)` so the absence of data is impossible to miss.

## Prompts — budget constants and stage builders
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

The `prompts` module is the template library consumed by the stage-4 LLM call. Templates are written in English so contributors can audit exactly what ships to the model; `${language}` controls the doc output language without altering the prompt text.

`DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000` and `DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000` bound the input and output token envelope per module.

`neutralizeUntrustedControlMarkers(text)` strips livewiki-style control markers (e.g. the `#`-anchored ones emitted by the orchestrator) found inside untrusted content, replacing every match with same-length whitespace. This prevents the LLM from copying marker-shaped strings from source code, prior outputs, or attacker-supplied text as if they were real anchors. A direct prompt placeholder was tried first and caused leakage; the current implementation leaves no visible token at all.

`neutralizeUntrustedControlMarkersExceptValidAnchors(text, closedKeyList)` is the repair variant: it preserves `lw:anchors` markers verbatim if and only if every whitespace-separated key inside is byte-for-byte present in `closedKeyList`; every other `lw:*` marker is whitespace-neutralized like the general variant.

`buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language = "en")` produces the main `{ system, user }` `PromptPair`. The system prompt fixes the persona and the closed-list distribution rules (every canonical key must appear exactly once in frontmatter and exactly once across section markers, no aggregate markers, no `TODO` placeholders, fully closed Markdown). The user prompt carries the module identity, the closed key list, the symbol table, the truncated source, and the language instruction.

`buildRepairPrompt(module, closedKeyList, symbolsTable, truncatedSource, priorCandidate, diagnostics, language)` embeds the full prior candidate (truncated to budget) alongside validator diagnostics, so a follow-up call can fix completeness and key-coverage failures without losing context.

`buildStage2RefinePrompt` produces the refinement prompt used between stage passes; `buildQuickstartPrompt` and `buildOverviewPrompt` produce the short role-specific prompts used to seed the wiki.

`copyableAnchorMarkers(text)` is the test helper that extracts every `lw:anchors` marker body from a prompt string and returns them as `string[][]` — one inner array per marker occurrence.

## Safe I/O — allowlist and disk primitives
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`safe-io` is the only module authorized to touch the disk. Per SPEC rule #1, all writes pass through it and are gated against the allowlist (`livewiki/` and `.livewiki/` inside the repo root). Rule #2's pointer exception is implemented in `pointer.ts`, not here — `safe-io` only knows the two safe directories unless `SafeIoOptions.allowPointer` is explicitly set.

The exports `ALLOWED_DIRS = ["livewiki", ".livewiki"]` and `AllowedDir` anchor that policy in code.

`PathOutsideAllowlistError` is thrown when a declared or resolved path escapes the allowlist. Its constructor takes `(repoRoot, attempted, allowlist)` and stores all three as readonly fields. `InvalidRelativePathError` is thrown for absolute paths, traversal segments, and other structurally invalid input; its constructor takes `(relPath, reason)`.

`allowlistFor(opts)` returns the active list: just `ALLOWED_DIRS` by default, plus `"AGENTS.md"` and `"CLAUDE.md"` when `allowPointer` is enabled. `allowedAbs(repoRoot, dir)` materializes one allowed directory as an absolute path and asserts it stays inside `repoRoot` (defense-in-depth even though `dir` is a literal).

`isInsideAllowlist(repoRoot, absPath, opts?)` decides membership purely in-memory; it compares by directory prefix plus separator (not substring) so `livewiki-evil` cannot slip past `livewiki/`. With `allowPointer` it also accepts `AGENTS.md` and `CLAUDE.md` strictly at the repo root.

`validateDeclared(repoRoot, relPath, opts)` is the cheap first pass — rejects absolute paths and traversal before any fs call. `findDeepestExisting(repoRoot, absPath)` is the symlink defense: it walks from the target up to the deepest existing ancestor, calls `realpath` on that ancestor, reconstructs the final path, and lets the caller revalidate. This blocks `livewiki` → `/tmp/` style redirects and `livewiki/sub` → `../src` escapes.

`resolveAndValidate(repoRoot, relPath, opts?)` composes both phases and returns the safe absolute path.

The disk primitives are narrow: `writeText(repoRoot, relPath, content)`, `readText(repoRoot, relPath)`, `exists(repoRoot, relPath)`, `mkdir(repoRoot, relPath, opts?)`, and `remove(repoRoot, relPath)` — each delegates validation to `resolveAndValidate` so the allowlist is enforced uniformly.

`detectSymlinkSupport()` is the test helper that probes whether the host can create symlinks (admin or Developer Mode is required on Windows). The boolean it returns gates tests that depend on symlink behavior.

## Status — wiki health report
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`status` produces a structured snapshot of the wiki and index: indexed files and symbols, language/king breakdowns, top-N symbol-heavy files, open debt from the ledger, undocumented symbols, and the incremental token-accounting snapshot from `update-metrics`.

`run(repoRoot, opts?)` is the entry point. It resolves `.livewiki/index.db` via `safe-io.resolveAndValidate`, opens the SQLite index with `openIndex`, calls `collect`, and folds in `snapshotMetrics(repoRoot)` best-effort (a metrics failure leaves `metrics: null` but never blocks the report).

`collect(db, topN)` is the SQL-driven aggregator. It pulls active files and symbols from the index, accumulates `byLang` and `byKind`, builds the top-N list by symbol count, and joins `debt` against `anchors` and `doc_pages` to enumerate open items grouped by event and assignee.

`formatHuman(report)` renders `StatusReport` as a multi-line textual summary; the JSON form is the same shape and intended for agents.

## Symbols — AST extraction
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.test.ts#parse -->

`symbols.ts` is the tree-sitter-driven extractor that produces the `SymbolRecord` rows stored by the indexer. SPEC §"Fase 1 — Indexador" defines the covered kinds: `function`, `generator`, `class`, `method`, `export`, and Python's decorated definitions.

`extractSymbols(tree, relPath, source)` walks the tree once, deduplicates by key, sorts by `(start_line, source_start_byte, discoveryOrder)`, and returns the final `SymbolRecord[]`.

`walkNode(node, source, relPath, parentClassName, out)` is the recursive dispatcher over node type: `function_declaration` and `generator_function_declaration` yield `kind: "function"`; `class_declaration` (and the `class` variant) yields `kind: "class"` and recurses with `parentClassName` set; `method_definition` yields `kind: "method"` qualified as `${parentClassName}.${name}`; `export_statement` collapses `export class`/`export function` to a single entry (no duplicate `kind: "export"` row) and emits `kind: "export"` for top-level `export const` and friends. Anonymous arrows are skipped because a referenceable key requires a name.

`makeRecord(node, source, relPath, name, kind)` builds an internal `ExtractedSymbol` with `source_start_byte` set; `toSymbolRecord(symbol)` strips that internal field and yields the public `SymbolRecord`. `signatureFor(node, source)` picks a representative header (e.g. first line of the node) for use inside anchor snippets.

`parse(ext, src)` is the test helper that delegates to the project's `parseSource`/`initParser` and keeps the symbol tests free of parser-internals boilerplate.

## Update metrics — incremental token accounting
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

`update-metrics.ts` materializes SPEC §"Contabilidade de tokens (Fase 3)" as an append-only JSON ledger at `.livewiki/update_metrics.json`. The design is deliberately outside the SQLite schema: it is reconstructible, versionable, and simple — losing the file means `update` simply restarts from zero.

Each `UpdateMetric` entry is a discriminated union: `kind: "package_emitted"` carries `tokensEstimated`, `bytes`, `debtCount`; `kind: "write_received"` carries `wikiPath`, `bytes`, `tokensEstimated`. Both also carry `timestamp`. The stored `UpdateMetricsFile` is `{ version: 1, entries: UpdateMetric[] }`.

`metricsPath(repoRoot)` resolves the absolute path of the metrics file via `safe-io.resolveAndValidate`. `readMetrics(repoRoot)` reads it through `safe-io`, returns `{ version: 1, entries: [] }` on missing or corrupted content (per rule #3: the database is derived, versioned markdown is authoritative). `writeMetrics(repoRoot, file)` persists it pretty-printed with a trailing newline.

`recordUpdateMetric(repoRoot, metric)` appends one entry. The function is intentionally fire-and-forget: failures are swallowed because accounting must never block the main `update` path.

`snapshotMetrics(repoRoot)` aggregates the entries into `UpdateMetricsSnapshot`: total packages emitted, total package tokens, total writes received, total write tokens, the `efficiencyRatio = totalWriteTokens / totalPackageTokens` (lower is more efficient — the product thesis is "tiny package vs rereading the repo"), and the latest entry of each kind for debugging.

`clearMetricsForTests(repoRoot)` resets the file so test cases start with an empty ledger.

## Update test helpers — repo and wiki fixtures
<!-- lw:anchors packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

The shared `update.test.ts` helpers give each test case a fresh temporary repo with `.livewiki/` pre-created and the metrics ledger cleared.

`writeCode(rel, content)` materializes a source file under `repoRoot/<rel>`, creating parent directories as needed. `writeWiki(rel, content)` is the symmetric helper for wiki pages under `livewiki/`.

`setupWithAnchor()` builds the fixture that the incremental tests depend on: it writes a `src/foo.ts` containing `export function bar()`, runs the indexer and the anchor ledger, adds a matching `livewiki/foo.md` page that references `src/foo.ts#bar` in its frontmatter, and re-runs the indexer and ledger. Without an anchored page the ledger cannot emit debt (debt requires an anchor to move), so this setup is the precondition for the changed / moved / deleted assertions.