---
title: core-src-04
owner: generated
anchors:
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#parseSource
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
---

## Parser (tree-sitter WASM wrapper)
<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#initParser packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#parseSource -->

`packages/core/src/parser.ts` is a thin wrapper around `web-tree-sitter` with a per-name `Language` cache. The WASM grammars live in `packages/core/grammars/` and the folder is located by walking up from this module's `package.json` (dev: `./package.json`; build: `../package.json`), so resolution works in both layouts.

`initParser()` is idempotent. Subsequent calls return the same `Promise<void>` produced by the first `Parser.init()`; both modes (single await and multiple callers) are safe.

`grammarsDir()` is the internal helper that picks the first `package.json` reachable from `import.meta.url` and returns its `grammars/` sibling. It throws only when neither relative location exists.

`loadLanguage(name)` resolves `${grammarsDir()}/tree-sitter-${name}.wasm`, throws a descriptive error if the file is missing, then memoizes the resulting `Language` in `languageCache`. MVP grammars ship: `typescript`, `tsx`, `javascript`, `python`.

`grammarForExtension(ext)` looks up the grammar name for a (lower-cased) extension. Mapping covers `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`.

`parseSource(ext, source)` ensures the parser is initialized, looks up the grammar for `ext`, calls `loadLanguage`, and returns the tree. A `null` tree (extremely rare) is converted into an error rather than propagated.

`listSupportedGrammars()` lists `tree-sitter-*.wasm` files in `grammarsDir()` after stripping the prefix and suffix; it returns `[]` when the directory is missing.

`_grammarToExtensionForTest(grammar)` is the inverse lookup exposed only for tests, so coverage can assert that every shipped grammar is reachable through an extension.

## Pointer (AGENTS.md / CLAUDE.md opt-in block)
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#_internal packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#removePointer -->

`packages/core/src/pointer.ts` is the only module allowed to touch `AGENTS.md` or `CLAUDE.md`. It is gated by an explicit opt-in (CLI flag or interactive confirmation); automatic writes are forbidden. The module exports the stable block markers as plain strings — external parsers may depend on the literal characters.

The markers and the allowed-file tuple are exported as constants:
- `POINTER_START` — opening HTML-comment marker.
- `POINTER_END` — closing HTML-comment marker.
- `POINTER_FILES` — readonly tuple `["AGENTS.md", "CLAUDE.md"]`; the `PointerFile` type is derived from it.

`pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)` decides which file to write: an explicit request wins; otherwise preference is `AGENTS.md` if present, then `CLAUDE.md`, otherwise the default target is `AGENTS.md` (creation path).

`buildPointerBlock()` returns the canonical block content. It is deliberately short: the start/end markers plus one PT-BR paragraph linking to `./livewiki/quickstart.md`. No wiki content is duplicated here.

`findPointerBlock(content)` is a pure string parser — it locates the start marker (tolerant of leading whitespace), then the end marker, and returns `{ startIdx, endIdx, inner }`. A truncated block (start without end) is treated as absent to avoid corrupting the document.

`applyPointerReplace(content, newBlock)` either splices the new block over the existing one or appends it (with a blank separator if the file is non-empty), and reports the action as `"inserted" | "replaced" | "unchanged"`.

`applyPointerRemove(content)` returns the residual content with the block excised, plus metadata describing what was removed — used by `removePointer`.

`insertPointer(repoRoot, opts)` is the I/O-side counterpart to `applyPointerReplace`. It locates or creates the target file through `safe-io` paths, decides the target via `pickPointerFile`, writes through `ensurePointerFile`, and returns a `PointerInsertResult`.

`removePointer(repoRoot, opts)` reads the target file, calls `applyPointerRemove`, and writes back when a block was found. `readPointerStatus(repoRoot)` reports whether a block exists, in which file, and how many bytes.

`ensurePointerFile(repoRoot, file)` is the write primitive: it lazily creates the file (with parent directory) through the safe-io layer and returns its absolute path.

`_internal` re-exports `nodeFs` to expose the Node `fs` namespace seam for tests that need to inject stubs without touching the public surface.

## Presets (provider tables)
<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`packages/core/src/presets.ts` is the data table of known LLM providers. Adding a provider is a one-line edit to `PRESET_TABLE`; no new code is required beyond filling the per-entry shape.

`PRESET_TABLE` is a `Record<PresetName, ProviderPreset>` keyed by literal preset names (`anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`). Each entry carries `adapter`, `baseUrl`, `envVar` (never the value), `pricing`, `notes`, and optional `thinkingDefault` / `preferMaxCompletionTokens` / `defaultMaxOutputTokens`.

`AVAILABLE_PRESETS` is a readonly ordered tuple of the preset keys derived from the table; it is the source of truth for help text and unknown-preset error messages.

`UnknownPresetError` extends `Error` and carries `presetName` plus `available` so callers can render an actionable message that lists the supported presets.

`UnknownPresetError.constructor(name, available)` builds the message, sets `name = "UnknownPresetError"`, and assigns the readonly fields.

`isKnownPreset(name)` is a type guard that narrows `string` to `PresetName` — used wherever an unvalidated name comes from CLI arguments or config.

`resolvePreset(name)` returns the `ProviderPreset` for a known name and throws `UnknownPresetError` otherwise. It is the canonical lookup path.

`resolveProviderConfig(args)` merges preset defaults with user overrides from `.livewiki/config.json` so the rest of the pipeline only sees a fully-resolved provider config.

## Pricing (USD cost lookup)
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost packages/core/src/pricing.ts#lookupPricing -->

`packages/core/src/pricing.ts` keeps a small, best-effort, embedded pricing table that the report layer uses to attribute real USD cost to each LLM call. Prices are USD per 1M tokens and are intentionally short — user overrides are the supported extension mechanism.

`PRICING_REFERENCE_DATE` is the ISO date when `PRICING_TABLE` was compiled. Every cost report carries it so consumers can tell at a glance whether the numbers are fresh or stale.

`PRICING_TABLE` is a `Record<string, ModelPrice>` covering the Anthropic Claude 4.5 family and common OpenAI-compat models. Models not listed here will surface as "no price" rather than guessed.

`lookupPricing(model, override?)` resolves a model in this order: (1) override map supplied by the caller, (2) embedded table, (3) `{ tokensOnly: true }`. The non-empty branch returns `inputUsd`, `outputUsd`, and `refDate`.

`calculateCostUsd(inputTokens, outputTokens, model, override?)` multiplies token counts by per-million rates and returns a breakdown with the reference date. When the lookup is `tokensOnly`, the function returns `null` rather than fabricating a number.

`formatCost(cost, model)` renders a `{ total } | null` cost as either `"$X.YYYY"` or the explicit string `"(no price for model <name>)"`, making absence of data visible in the human report.

## Prompts (LLM templates and neutralization)
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

`packages/core/src/prompts.ts` defines all LLM-facing templates. Templates are written in English so contributors can audit them directly; the `${language}` parameter only controls the language of the *output* documentation, never the wording of the template.

`DEFAULT_CONTEXT_TOKEN_BUDGET` is the default size cap on the code slice fed to the LLM per module; `DEFAULT_OUTPUT_TOKEN_BUDGET` is the default cap on the generated Markdown response. Both are exported so the CLI can surface them and tests can pin them.

`buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language?)` is the primary per-module documentation prompt. It returns a `PromptPair` (`{ system, user }`); the system prompt carries the persona and rules (including the closed-list distribution requirement), while the user prompt carries module metadata, the canonical key list verbatim, the symbol table, and the truncated source.

`buildStage2RefinePrompt` produces the prompt used after stage 1 to refine a candidate page against the verifier's feedback. `buildRepairPrompt` produces the prompt used by the repair loop when verification fails.

`buildOverviewPrompt` and `buildQuickstartPrompt` build the optional high-level pages (`overview.md` and `quickstart.md`) using the same closed-key discipline.

`neutralizeUntrustedControlMarkers(text)` strips any `<!-- lw:* … -->` control-marker syntax found inside untrusted source embedded in a prompt by replacing each match with a pure-whitespace run of equal length. The substitution leaves nothing copyable in its place, preventing the LLM from parroting a marker it should have produced itself.

`neutralizeUntrustedControlMarkersExceptValidAnchors(text, closedKeyList)` is the repair-candidate variant: an `lw:anchors` marker is preserved *verbatim* only when every key inside it is byte-for-byte a member of `closedKeyList`; any other marker (or an anchors marker with unknown keys) is whitespace-neutralized identically to the general pass.

`copyableAnchorMarkers(text)` (in `prompts.test.ts`) is the test helper that harvests every `lw:anchors` body from a prompt string as `string[][]`, letting tests assert that the closed-list keys appear verbatim and unmodified.

## Safe-IO (single disk-writer)
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`packages/core/src/safe-io.ts` is the only module authorized to write to disk. It enforces the allowlist (`livewiki/` + `.livewiki/` inside `repoRoot`) on every operation and rejects anything else. The pointer exception (`AGENTS.md` / `CLAUDE.md` in the repo root) lives in `pointer.ts`, not here — `safe-io` only knows about the two safe directories, plus an opt-in `allowPointer` that selectively admits the two root files.

Defenses include prefix-with-separator matching (so `livewiki-evil/` is *not* a prefix hit), depth-first realpath resolution to defeat symlink redirection, and a `strict allowlist predicate on the canonicalized path` re-check before any write.

`ALLOWED_DIRS` is the readonly tuple `["livewiki", ".livewiki"]` and the literal source for the `AllowedDir` type union.

`PathOutsideAllowlistError` and `InvalidRelativePathError` are the two typed failures. `PathOutsideAllowlistError.constructor(repoRoot, attempted, allowlist)` records the triple on the instance; `InvalidRelativePathError.constructor(relPath, reason)` does the same for malformed relative paths. Both set `name` explicitly so consumers can match by class.

`allowlistFor(opts)` returns the effective allowlist, appending `"AGENTS.md"` and `"CLAUDE.md"` only when `opts.allowPointer` is true.

`allowedAbs(repoRoot, dir)` returns the absolute, validated path of `dir` inside `repoRoot`, asserting internally that the literal cannot escape the root.

`isInsideAllowlist(repoRoot, absPath, opts?)` is the pure decision predicate: it returns `true` only if the absolute target falls under one of the allowed directories (with separator-aware comparison) or matches an allowed pointer file with `allowPointer=true`.

`validateDeclared(repoRoot, relPath, opts)` performs the cheap, pre-symlink checks: rejects absolute paths, rejects `..` traversal, rejects any path outside the allowlist on the *declared* surface, and returns the resolved absolute path.

`findDeepestExisting(absPath)` walks up until it finds an ancestor that exists, used during symlink defense so `realpath` can be called safely.

`resolveAndValidate(repoRoot, relPath, opts?)` is the public entry point: it runs `validateDeclared`, then resolves symlinks with `findDeepestExisting`, and re-applies `isInsideAllowlist` on the canonicalized path before returning the safe absolute path.

The `exists`, `readText`, `writeText`, `mkdir`, and `remove` functions are thin async wrappers around `node:fs/promises` that all funnel through `resolveAndValidate`, ensuring every I/O call respects the same allowlist semantics.

`detectSymlinkSupport()` (in `safe-io.test.ts`) probes a temp directory for symlink capability at test-boot. It is consumed via `it.runIf` so symlink-sensitive tests skip cleanly on platforms (e.g. Windows without Developer Mode) where the kernel refuses symlink creation.

## Status (wiki state report)
<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman packages/core/src/status.ts#run -->

`packages/core/src/status.ts` produces the consolidated state report — files indexed, symbols by kind, top-N heaviest files, debt breakdown, undocumented symbols, and incremental update metrics.

`run(repoRoot, opts?)` is the public entry point. It opens the SQLite index through `safe-io.resolveAndValidate`, calls `collect`, attaches an `UpdateMetricsSnapshot` (best-effort: if the metrics file is unreadable, `metrics` is `null` rather than throwing), and returns the report.

`collect(db, topN)` is the pure aggregation step against the SQLite handle: it groups files by language, symbols by kind, builds the top-N list by symbol count, and surfaces the unresolved debt rows joined to their anchors and doc pages.

`formatHuman(report)` renders the `StatusReport` as the multi-line, terminal-friendly text used by the default CLI mode.

## Symbols (tree-sitter AST → SymbolRecords)
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#walkNode packages/core/src/symbols.test.ts#parse -->

`symbols.ts` extracts the canonical `SymbolRecord` list that drives indexing, anchor keys, and the closed-list handed to the LLM. Coverage spans TypeScript, TSX, JavaScript (function declarations, generator declarations, classes, methods, named arrow functions, and `export_statement`), and Python (function/class definitions plus `decorated_definition`).

`extractSymbols(tree, relPath, source)` walks the AST, deduplicates by key, sorts by `(start_line, source_start_byte, discoveryOrder)`, and returns the unique `SymbolRecord[]` consumed by the indexer.

`walkNode(node, source, relPath, parentClassName, out)` is the recursive dispatcher. It maps TypeScript/JavaScript node types to `SymbolKind` (`function` / `class` / `method` / `export`), qualifies method names with `parentClassName`, and descends manually into class bodies so methods keep their class binding. Anonymous arrows and IIFEs are intentionally skipped — anchor keys must be referencable, and anonymous functions are not.

`makeRecord(node, source, relPath, name, kind)` constructs an `ExtractedSymbol` with the qualified key (`relPath#Name` or `relPath#Parent.Name`), the first-line `signature`, line range, content hash, and source byte offset.

`signatureFor(node, source)` selects a representative header for the symbol — used both for the `signature` field and for visibility in the human report.

`toSymbolRecord(symbol)` strips the internal `source_start_byte` to yield the public `SymbolRecord` shape stored in SQLite.

`symbols.test.ts`'s `parse(ext, src)` helper is the test-side adapter over `parseSource`, used to feed fixtures into `extractSymbols` for the AST-coverage cases (classes with methods, exports, generators, multi-line signatures, content-hash determinism, and class+object method coalescing).

## Update Metrics (incremental accounting)
<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics -->

`packages/core/src/update-metrics.ts` records the cost-recovery thesis: an append-only JSON file at `.livewiki/update_metrics.json` that captures `package_emitted` and `write_received` events. The format is `UpdateMetricsFile = { version: 1, entries: UpdateMetric[] }` with a tagged-union `UpdateMetric` per event kind.

`metricsPath(repoRoot)` is the internal helper that resolves the canonical file path through `safe-io.resolveAndValidate` so the metric file lives behind the same allowlist as the rest of the wiki state.

`readMetrics(repoRoot)` loads and parses the file, returning an empty `UpdateMetricsFile` when the file is absent or unreadable; a corrupt payload (wrong `version` or non-array `entries`) is reset to empty, since metrics are derived and reconstructible.

`writeMetrics(repoRoot, file)` persists the file as pretty-printed JSON via `safe-io.writeText`.

`recordUpdateMetric(repoRoot, metric)` is the fire-and-forget append entry point. It reads, pushes the metric, and writes back, swallowing any error so a metrics hiccup never blocks the main `update` flow.

`snapshotMetrics(repoRoot)` aggregates the entries into the `UpdateMetricsSnapshot` returned by `status --json`: counts and totals for `package_emitted` and `write_received`, an `efficiencyRatio` (writes received / packages emitted) that is the headline thesis metric, and the most recent entry of each kind for debugging.

`clearMetricsForTests(repoRoot)` deletes the metrics file through `safe-io.remove` so test runs start from a known-empty state.