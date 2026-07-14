---
title: core/src-04
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

## Pointer block — `pointer.ts`
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#_internal packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#removePointer -->

The pointer module implements the optional append-only block in `AGENTS.md` / `CLAUDE.md`. The block is delimited by stable HTML comment markers, kept short (one paragraph plus one link to the quickstart), and idempotent across invocations. The `POINTER_START` and `POINTER_END` constants are the exact strings used by `findPointerBlock`, and `POINTER_FILES` enumerates the only two filenames the rule permits. `pickPointerFile` decides the target file when none is requested (preferring `AGENTS.md` if present, falling back to `CLAUDE.md`, and defaulting to `AGENTS.md` when neither exists). `buildPointerBlock` produces the default block body in PT-BR. `applyPointerReplace` mutates a string — replacing an existing block in place or appending one — and `applyPointerRemove` strips the block out. `findPointerBlock` is the pure parser: it returns start/end indices plus the inner content, or `null` if no complete block is found (a truncated block without the end marker is treated as absent, to avoid corrupting the document). `insertPointer`, `removePointer`, `readPointerStatus`, and `ensurePointerFile` are the async, on-disk operations that combine the pure helpers with file I/O. `ensurePointerFile` writes the file with the pointer block if it does not already exist. `readPointerStatus` reports whether the target file already carries a block. The `_internal` export exposes the underlying `node:fs/promises` binding for the test suite.

## Provider presets — `presets.ts`
<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`presets.ts` is a data module: each row of `PRESET_TABLE` carries adapter, `baseUrl`, env-var name, default pricing, operational notes, and provider-specific knobs (`thinkingDefault`, `preferMaxCompletionTokens`, `defaultMaxOutputTokens`) — enough to run without further config. `AVAILABLE_PRESETS` is the literal-union list of preset keys (`anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`). `resolvePreset` looks a preset up by name and throws `UnknownPresetError` when the name is not a key in the table; the constructor captures the offending name plus the available list so error messages can list valid options. `isKnownPreset` is a type-guard variant for callers that want to branch on validity. `resolveProviderConfig` layers user overrides from `.livewiki/config.json` on top of the preset: any field the user supplies wins, and the result is the concrete `ProviderPreset` the rest of the pipeline instantiates. The `envVar` field is the env-var *name* — its value is never persisted or logged (covered by the key-leak suite).

## Pricing — `pricing.ts`
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost packages/core/src/pricing.ts#lookupPricing -->

`PRICING_REFERENCE_DATE` is the ISO date the embedded `PRICING_TABLE` was last compiled, exposed on every cost report so consumers know whether the numbers are fresh or stale. `PRICING_TABLE` maps model identifiers to `ModelPrice` (USD per 1M input/output tokens) for the MVP model set — Anthropic Claude 4.5 family and a handful of OpenAI-compat entries. `lookupPricing` resolves a model in three tiers: user override from `.livewiki/config.json`, the embedded table, and finally `{ tokensOnly: true }` for models with no price (the report then shows tokens without inventing USD). `calculateCostUsd` multiplies token counts against the resolved per-million prices, returning `null` when no price is available rather than fabricating a number. `formatCost` renders the result for human-readable reports — returning `(no price for model X)` when the cost is `null` so the absence of data is explicit instead of silently rounded to zero.

## Prompt templates — `prompts.ts` and test helper
<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

System prompts are written in English so contributors can audit them; the `${language}` parameter (BCP-47) controls only the language of the *generated* documentation. `DEFAULT_CONTEXT_TOKEN_BUDGET` (30 000) and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4 000) are the per-module context ceiling and the suggested answer size. `buildStage4Prompt` produces the `{ system, user }` pair for module-page generation — the system carries persona, the closed-list rules, and the completeness invariants; the user carries module metadata, the canonical keys, the symbol table, and the budget-truncated source. `buildStage2RefinePrompt`, `buildRepairPrompt`, `buildOverviewPrompt`, and `buildQuickstartPrompt` cover the other stages of the batch pipeline (stage 2 refinement, repair of a failed verify, and the overview/quickstart pages).

Because repo source and prior LLM output are untrusted, both can contain livewiki control-marker syntax shaped like the directives a generation prompt would emit. `neutralizeUntrustedControlMarkers` rewrites any `lw:*` HTML-comment marker in untrusted text to whitespace of identical length — leaving nothing for the model to copy verbatim. `neutralizeUntrustedControlMarkersExceptValidAnchors` is the repair-candidate variant: it preserves an `lw:anchors` marker only when every key inside it is byte-for-byte present in the supplied closed key list, and whitespace-replaces everything else. The test-helper `copyableAnchorMarkers` extracts the bodies of every `lw:anchors` marker it finds in a string, used by the prompt test suite to verify the closed list appears verbatim.

## Safe I/O — `safe-io.ts` and symlink probe
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText -->

`safe-io.ts` is the only module authorized to touch the filesystem. `ALLOWED_DIRS` enumerates the two root-relative directories the rest of the codebase may write into (`livewiki/`, `.livewiki/`). `isInsideAllowlist` is the pure predicate: prefix comparison against each allowed directory after `path.resolve`, using `path.relative` to distinguish `livewiki-evil` from a legitimate child of `livewiki/`. When `SafeIoOptions.allowPointer` is set, it also accepts `AGENTS.md` and `CLAUDE.md` at the repo root by exact filename match. `PathOutsideAllowlistError` carries the repo root, the attempted path, and the allowlist snapshot; its constructor builds a single-line message that names all three. `InvalidRelativePathError` carries the offending relative path and a short reason (absolute, `..` traversal, etc.).

`allowlistFor` returns the array of allowed directory entries (extending with pointer filenames when the option is set). `allowedAbs` resolves a directory entry against `repoRoot` and asserts the result still lives inside the root — a defensive guard in case the literal entry itself is misconfigured. `validateDeclared` is the fast pre-check that rejects absolute paths and traversal before any disk access. `findDeepestExisting` walks a target path upward to the deepest ancestor that exists on disk so the symlink-resolution pass has a real path to `realpath`. `resolveAndValidate` orchestrates declared-path validation, symlink resolution via realpath, and allowlist re-validation. `writeText`, `readText`, `exists`, `mkdir`, and `remove` are the typed wrappers around `node:fs/promises` that funnel every disk operation through `resolveAndValidate`. The test-side `detectSymlinkSupport` probes whether the host can create symlinks (admin or Developer Mode required on Windows) so the symlink-aware tests can be skipped on hosts that cannot exercise that path.

## Status report — `status.ts`
<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman packages/core/src/status.ts#run -->

`run` is the public entry point: it resolves and opens `.livewiki/index.db`, calls `collect` for the structured report, attaches an incremental metrics snapshot (best-effort — failure to read metrics leaves the field `null` rather than aborting the report), and closes the database. `collect` is the synchronous SQL aggregator: it counts files by language, computes symbol totals by kind, ranks the top-N files by symbol count, and joins the debt ledger against anchors and doc pages to produce the open-debt items grouped by event and assignee. `formatHuman` renders the same `StatusReport` as a multi-line text block for terminal output. The metrics field on the report is the bridge to the `update` flow covered next.

## Symbol extraction — `symbols.ts` and parser test helper
<!-- lw:anchors packages/core/src/symbols.test.ts#parse packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#walkNode -->

`extractSymbols` walks a tree-sitter AST and emits a deduplicated, source-ordered list of `SymbolRecord`s. The recursive driver is `walkNode`: it dispatches on node type, qualifying methods with their parent class name (`Parent.child`) and lowering `export class` / `export function` to their inner declaration so a single entry is produced rather than a duplicate `export` row. Anonymous arrows and IIFEs are intentionally skipped — they have no referenceable key. `makeRecord` builds the raw record carrying a `source_start_byte` for tie-breaking; `toSymbolRecord` strips that internal field before returning the public `SymbolRecord`. `signatureFor` returns the first line of the node, used as the per-symbol anchor excerpt. The test-side `parse` is a thin async wrapper around `parseSource` plus `initParser`, used by the symbol-extraction test suite.

## Update metrics — `update-metrics.ts`
<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics -->

Metrics live as a small JSON file at `.livewiki/update_metrics.json` rather than as a SQL table — incremental, derived, and safe to lose on re-init. `metricsPath` resolves the absolute path through `safe-io.resolveAndValidate`. `readMetrics` parses the file or returns `{ version: 1, entries: [] }` on missing/corrupt input (corrupt files are silently reset, since the source of truth is the versioned markdown). `writeMetrics` persists the file via `safe-io.writeText`. `recordUpdateMetric` appends a single `UpdateMetric` (a discriminated union of `package_emitted` and `write_received`) and swallows errors — accounting must never block the main operation. `snapshotMetrics` aggregates the append-only log into an `UpdateMetricsSnapshot` exposing totals, last entries, and the `efficiencyRatio` (write-tokens divided by package-tokens) that operationalizes the product thesis. `clearMetricsForTests` empties the file between test runs so each case starts from a known zero.

## Update test harness — `update.test.ts`
<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

`writeCode` and `writeWiki` are tiny file-write helpers that resolve a repo-relative path against the per-test temp directory and create the parent directory tree. `setupWithAnchor` is the canonical pre-condition builder: it writes a TypeScript source file, indexes the repo, runs the anchor-ledger, writes a wiki page that lists the source symbol in its frontmatter, and re-runs both passes — only with that chain complete does the ledger have anything to flag as debt, which is what the rest of the suite asserts.