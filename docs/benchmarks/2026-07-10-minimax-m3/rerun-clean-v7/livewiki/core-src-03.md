---
title: core-src-03
owner: generated
anchors:
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#normalizeRepoPath
  - packages/core/src/modules.ts#fileStem
  - packages/core/src/modules.ts#countSymbols
  - packages/core/src/modules.ts#resolveSymbolCount
  - packages/core/src/modules.ts#axisEnabled
  - packages/core/src/modules.ts#fitsLimits
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#SPLIT_AXIS_DISABLED
  - packages/core/src/modules.ts#normalizeSplitLimits
  - packages/core/src/modules.ts#groupPathsByNextSegment
  - packages/core/src/modules.ts#splitOneModule
  - packages/core/src/modules.ts#chunkFlatBucket
  - packages/core/src/modules.ts#splitOversizedModules
  - packages/core/src/modules.ts#stripNodeNextExtension
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#assertExactPathPartition
  - packages/core/src/modules.ts#refinePeerDirectoryFragmentationError
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#pathSlugOf
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#pathSegmentsFor
  - packages/core/src/modules.ts#slugifySegment
  - packages/core/src/modules.ts#slugifyIdSegment
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#parseSource
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/pointer.ts#POINTER_START
  - packages/core/src/pointer.ts#POINTER_END
  - packages/core/src/pointer.ts#POINTER_FILES
  - packages/core/src/pointer.ts#pickPointerFile
  - packages/core/src/pointer.ts#buildPointerBlock
  - packages/core/src/pointer.ts#findPointerBlock
  - packages/core/src/pointer.ts#applyPointerReplace
  - packages/core/src/pointer.ts#applyPointerRemove
  - packages/core/src/pointer.ts#insertPointer
  - packages/core/src/pointer.ts#removePointer
  - packages/core/src/pointer.ts#readPointerStatus
  - packages/core/src/pointer.ts#ensurePointerFile
  - packages/core/src/pointer.ts#_internal
  - packages/core/src/presets.ts#PRESET_TABLE
  - packages/core/src/presets.ts#AVAILABLE_PRESETS
  - packages/core/src/presets.ts#UnknownPresetError
  - packages/core/src/presets.ts#UnknownPresetError.constructor
  - packages/core/src/presets.ts#isKnownPreset
  - packages/core/src/presets.ts#resolvePreset
  - packages/core/src/presets.ts#resolveProviderConfig
  - packages/core/src/pricing.ts#PRICING_REFERENCE_DATE
  - packages/core/src/pricing.ts#PRICING_TABLE
  - packages/core/src/pricing.ts#lookupPricing
  - packages/core/src/pricing.ts#calculateCostUsd
  - packages/core/src/pricing.ts#formatCost
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.test.ts#copyableAnchorMarkers
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
---

# core-src-03 — modules, parser, pointer, presets, pricing, prompts

Reference documentation for the core package's group-identification, parser, pointer, presets, pricing, and prompt subsystems.

## modules — heuristic grouping and splitting
[untrusted lw:anchors control marker omitted]

`identifyModulesHeuristic` groups repository files by top-level directory using forward-slash relative paths. Each directory bucket becomes a `Module` with an `id` derived from the last path segment; root files become `root`, with single-root basenames used verbatim. The function normalizes each path (`normalizeRepoPath`) and aggregates symbol counts (`countSymbols`) when an optional map is supplied. Output is sorted lexicographically by `id` for deterministic ordering.

`dirToModuleId` derives the slug from `dir`: empty directory with one file and one total directory returns the file's stem (via `fileStem`-style splitting); otherwise `"root"`. Non-empty directories take the last segment.

## modules — split policy and chunking
[untrusted lw:anchors control marker omitted]

`splitOversizedModules` enforces structural, completion-oriented size limits. Defaults live in `MODULE_SPLIT_DEFAULTS`; an axis is disabled when the user passes `0` or a negative value, represented by `SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER`. `normalizeSplitLimits` materializes this normalization. `axisEnabled` tests whether a normalized limit actually caps something.

The splitter resolves symbol counts per module (`resolveSymbolCount`). When a true subdirectory exists, paths are regrouped via `groupPathsByNextSegment` and `splitOneModule` walks the tree depth-first. Flat buckets (peer leaf files in one directory) are packed with dual-axis limits by `chunkFlatBucket`. A single file above the symbol cap is emitted as `unsplittable`, batch continues, and stage 4 must bound context for that unit.

`stripNodeNextExtension` removes Node's `.js` from `.ts` siblings; `resolveRelativeImport` resolves a relative import against a base file, excluding outside-repo targets. `resolveModuleEdges` builds `{from, to}` edges between distinct modules by walking `ExtractedImport[]` per file and deduping parallel edges. Self-loops are dropped.

`assertExactPathPartition` enforces that post-split, the union of module path lists equals the input set exactly. On violation it throws `ExactPartitionError`, with the constructor capturing the message. `refinePeerDirectoryFragmentationError` annotates the failure with peer-directory context when a single bad module sits among same-named peers.

`prioritizeModules` orders modules by indegree centrality (descending), then by `symbolCount` (descending) on ties.

## modules — unique deterministic IDs
[untrusted lw:anchors control marker omitted]

Two modules can share the same leaf segment (for example `packages/core/src` and `packages/cli/src` both have leaf `src`). `makeUniqueDeterministicIds` walks right-to-left through each module's path segments (`pathSegmentsFor`, `pathSlugOf`) and produces a sequence of candidates via `candidateIdSequence`. `slugifySegment` lowercases and trims to URL-safe characters; `slugifyIdSegment` joins segments with `-` so that `core/src` becomes `core-src`.

After id assignment, `assertUniqueModuleIds` confirms no collisions; collision throws `DuplicateModuleIdError`, whose constructor captures the message. The `idFor` test helper in `modules.test.ts` shapes canonical id output for fixtures.

## parser — tree-sitter with cached grammars
[untrusted lw:anchors control marker omitted]

`initParser` boots the tree-sitter WASM runtime exactly once and caches the resulting promise; subsequent calls return it immediately. `grammarsDir` locates `packages/core/grammars/` relative to the active `package.json` (checks `./package.json` for dev, `../package.json` for built artifacts). Missing package.json is fatal.

`loadLanguage` is the per-grammar cache key, resolving `<grammarsDir>/tree-sitter-<name>.wasm`. Missing WASM files raise — the livewiki build cannot silently fall back. `grammarForExtension` maps extension to grammar name (`.ts→typescript`, `.tsx→tsx`, `.js→javascript`, `.jsx→tsx`, `.mjs/.cjs→javascript`, `.py→python`).

`parseSource` resolves a `Language` from the grammar cache, configures a `Parser` with that language, and returns a `Tree`. A `null` tree from tree-sitter is treated as an error rather than propagated. `listSupportedGrammars` enumerates `.wasm` files in the grammars directory. `_grammarToExtensionForTest` is the inverse map used by tests.

## pointer — opt-in AGENTS.md / CLAUDE.md block
[untrusted lw:anchors control marker omitted]

The pointer subsystem appends an idempotent `<!-- livewiki:start --> … <!-- livewiki:end -->` block to either `AGENTS.md` or `CLAUDE.md`. The marker strings `POINTER_START` and `POINTER_END` are stable external surface; `POINTER_FILES` lists the two allowed targets.

`pickPointerFile` chooses a target given presence flags and an optional explicit request: requested wins, else `AGENTS.md` first, then `CLAUDE.md`, defaulting to creating `AGENTS.md`. `buildPointerBlock` produces the default content — one short paragraph in PT-BR plus a `quickstart.md` link. Block length is deliberately minimal so the pointer duplicates no wiki content.

`findPointerBlock` parses a Markdown string for the block (start/end markers, both tolerant of CRLF/BOM whitespace). When only the start is present, the block is treated as absent to avoid corrupting truncated docs. `applyPointerReplace` swaps an existing block in place or appends if none exists, returning `inserted` / `replaced` / `unchanged`. `applyPointerRemove` strips the block and adjacent whitespace, returning whether removal occurred.

`insertPointer`, `removePointer`, `readPointerStatus`, and `ensurePointerFile` are the disk-touching operations, gated by `safe-io` with `allowPointer=true`. The module re-exports `nodeFs` via `_internal` for tests that need direct access to the underlying filesystem binding.

## presets — provider table
[untrusted lw:anchors control marker omitted]

`PRESET_TABLE` is a `Record<PresetName, ProviderPreset>` covering `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, and `lmstudio`. Each entry pins `adapter`, `baseUrl`, `envVar` (name only — never value), per-model pricing defaults, notes, and a `thinkingDefault` policy (`disabled | adaptive | omit | n/a`). Providers exposing an Anthropic-compat endpoint (for example `minimax`) use the `anthropic` adapter so prompt-caching reads apply.

`AVAILABLE_PRESETS` derives the iterable list of preset names. `isKnownPreset` is a `name is PresetName` type guard used at call sites that need to branch on a string. `resolvePreset` returns the table entry or throws `UnknownPresetError`; the constructor captures both the bad name and the available list to produce a hint message.

`resolveProviderConfig` maps a preset into a runtime provider config, layering user overrides on top of the preset defaults. Pricing overrides from `config.json` flow through `pricing.ts:lookupPricing` for cost reporting. TODO: full `resolveProviderConfig` semantics (override precedence, env-var pickup) are not visible in the excerpt.

## pricing — embedded table and lookup
[untrusted lw:anchors control marker omitted]

`PRICING_TABLE` is a USD-per-1M-tokens map for popular MVP models across the Anthropic Claude 4.5 family and OpenAI-compat providers used by OpenRouter/LiteLLM. `PRICING_REFERENCE_DATE = "2026-07-09"` is stamped on every reported cost so users know when the embedded numbers were last compiled.

`lookupPricing` resolves a model through three layers: user override (wins), embedded table, and finally `{ tokensOnly: true }` when no entry exists. The `tokensOnly` branch is intentional — the product reports tokens without inventing USD rather than guessing.

`calculateCostUsd` multiplies `(inputTokens * inputUsd)` and `(outputTokens * outputUsd)` by `1 / 1_000_000` and returns both halves, the total, and the `refDate`. When `lookupPricing` is `tokensOnly`, the function returns `null`. `formatCost` formats the total as `$<x.xxxx>` (or `(no price for model X)` when the cost is `null`).

## prompts — templates and sanitization
[untrusted lw:anchors control marker omitted]

`DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000` and `DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000` are the public defaults the CLI applies when callers omit explicit budgets. `REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT = 16_000` bounds the size of a previous, possibly-invalid LLM artifact embedded in repair prompts — large enough to keep multi-kilobyte context (the prior candidate contains real prose the LLM must preserve verbatim) while still fitting a single batch ticket.

`neutralizeUntrustedControlMarkers` rewrites any `<!-- lw:TYPE … -->` substring in untrusted text (source code, comments, prior candidate) into the safe placeholder `[untrusted lw:TYPE control marker omitted]` so the LLM cannot copy a fake or ellipsis anchor. The marker type survives; the payload is dropped.

`buildStage4Prompt` returns a `{system, user}` pair: the system prompt states the documentation persona, the closed-list invariants (every closed key must appear exactly once across frontmatter and section markers), and rejection criteria. The user prompt passes the module metadata, the closed canonical key list, a symbol table, and the budget-truncated source. Concrete section-marker examples inside the prompt are constructed from real closed-list keys for the current call — never placeholders like `key1`, `key2`, or ellipsis tokens.

`buildRepairPrompt` carries forward the same invariants, embeds a prior candidate window (bounded by `REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT`), and lists the structured validation errors so the LLM knows exactly which keys are missing or which anchors are outside the closed list. The prompt is hardened to never ship copyable fake anchors.

`buildStage2RefinePrompt` is the lighter refinement call: the LLM may rename heuristic modules and adjust boundaries (merge/split) but cannot add new file paths — those come from the deterministic walker. If the call fails, the batch falls back to heuristic output.

`buildQuickstartPrompt` and `buildOverviewPrompt` produce the two top-level pages (`quickstart.md` and the high-level overview). Both are token-bounded so the orchestrator can run them as cheap batch tickets.

The `copyableAnchorMarkers` test helper in `prompts.test.ts` extracts every `[untrusted lw:anchors control marker omitted]` body from a prompt string — used to assert that the prompts NEVER embed copyable fake anchors like `key1`, `key2`, ellipsis tokens, or invented keys.

## safe-io — symlink probe for tests
[untrusted lw:anchors control marker omitted]

`detectSymlinkSupport` (in `safe-io.test.ts`) probes whether the current process can create symlinks: it writes a target file, attempts a symlink, and cleans up. On Windows it returns `false` when Developer Mode is off; on POSIX it returns `true`. Tests that exercise symlink-attack defense gate themselves with `it.runIf(canSymlink)` so the suite stays green across platforms without weakening the symlink-escape assertions on environments that do support symlinks.