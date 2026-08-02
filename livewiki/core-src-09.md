---
title: Core source module 09 — orientation, parser, pointer, output budget, navigation
owner: generated
anchors:
  - packages/core/src/navigation.ts#MODULE_DIGEST_CAP
  - packages/core/src/navigation.ts#RESPONSIBILITY_MAX_CHARS
  - packages/core/src/navigation.ts#buildDisplayTitleFallbacks
  - packages/core/src/navigation.ts#buildModuleCoverageNote
  - packages/core/src/navigation.ts#buildModuleDigestBlock
  - packages/core/src/navigation.ts#buildNavigateBlock
  - packages/core/src/navigation.ts#buildOrientationBlock
  - packages/core/src/navigation.ts#commonDirectory
  - packages/core/src/navigation.ts#compareModules
  - packages/core/src/navigation.ts#compareTopics
  - packages/core/src/navigation.ts#ensureTopicsIndexScaffold
  - packages/core/src/navigation.ts#extractModuleOpeningDigest
  - packages/core/src/navigation.ts#extractModuleResponsibility
  - packages/core/src/navigation.ts#generateAuxiliaryIndex
  - packages/core/src/navigation.ts#generateFlowsIndex
  - packages/core/src/navigation.ts#generateQuickstart
  - packages/core/src/navigation.ts#generateTasksPage
  - packages/core/src/navigation.ts#generateTopicsIndex
  - packages/core/src/navigation.ts#groupTasksModules
  - packages/core/src/navigation.ts#humanizeSegments
  - packages/core/src/navigation.ts#loadFlowPresentations
  - packages/core/src/navigation.ts#loadModuleDigests
  - packages/core/src/navigation.ts#loadModulePresentations
  - packages/core/src/navigation.ts#loadTopicPresentations
  - packages/core/src/navigation.ts#moduleSourceExceedsBudget
  - packages/core/src/navigation.ts#normalizeLabel
  - packages/core/src/navigation.ts#parseModuleOpening
  - packages/core/src/navigation.ts#readHubDeclaredOwner
  - packages/core/src/navigation.ts#sameStrings
  - packages/core/src/navigation.ts#selectRelatedModules
  - packages/core/src/navigation.ts#sumModuleSourceBytes
  - packages/core/src/navigation.ts#syncAuxiliaryIndexHub
  - packages/core/src/navigation.ts#syncFlowsIndexHub
  - packages/core/src/navigation.ts#syncTopicsIndexHub
  - packages/core/src/navigation.ts#synthesizePurposeFromDigests
  - packages/core/src/navigation.ts#updateFlowTopicLinks
  - packages/core/src/navigation.ts#updateModuleNavigateBlocks
  - packages/core/src/orientation.ts#PURPOSE_MAX_CHARS
  - packages/core/src/orientation.ts#clipSentence
  - packages/core/src/orientation.ts#detectSurfaces
  - packages/core/src/orientation.ts#extractPurpose
  - packages/core/src/orientation.ts#extractRepoOrientation
  - packages/core/src/orientation.ts#findFastPathSection
  - packages/core/src/orientation.ts#findPrimaryReadme
  - packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine
  - packages/core/src/orientation.ts#isListLeadIn
  - packages/core/src/orientation.ts#isMeaningfulProse
  - packages/core/src/orientation.ts#readBounded
  - packages/core/src/orientation.ts#readdirNames
  - packages/core/src/orientation.ts#stripHtmlTags
  - packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget
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
  - packages/core/src/orientation.test.ts#write
---

# Core source module 09 — orientation, parser, pointer, output budget, navigation

This page documents the symbols exported from the `packages/core/src` modules collected under the `core-src-09` slice — repository orientation evidence, the tree-sitter parser wrapper, the `AGENTS.md`/`CLAUDE.md` pointer writer, the content-scaled output-token budget, and the navigation-page generators and index syncers.

## When to use this page

- **Parse source code with tree-sitter** by calling `parseSource` with a file extension and source string, after a one-shot `initParser`.
- **Compute a content-scaled `maxTokens`** for module/flow/topic-prose pages via `computeDynamicOutputTokenBudget` with `MODULE_OUTPUT_BUDGET_OPTIONS` (and the smaller `TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS` for the topic-plan refine pass).
- **Insert or remove the livewiki pointer block** in `AGENTS.md` / `CLAUDE.md` using `insertPointer` / `removePointer` (the pure-string helpers `buildPointerBlock`, `findPointerBlock`, `applyPointerReplace`, and `applyPointerRemove` are useful for tests and previews).
- **Generate navigation pages** (`generateQuickstart`, `generateTasksPage`, `generateAuxiliaryIndex`, `generateFlowsIndex`, `generateTopicsIndex`) and keep their hub files in sync (`syncTopicsIndexHub`, `syncFlowsIndexHub`, `syncAuxiliaryIndexHub`, `ensureTopicsIndexScaffold`).

## How it fits

This slice lives under `packages/core/src/` and supplies the deterministic, non-LLM substrate that the higher pipeline layers consume: orientation reads the repository root for evidence (README purpose, fast-path heading, entry-point surfaces) and never invents prose; the parser wrapper wraps `web-tree-sitter` so any later stage can extract AST information from cited files; the pointer writer is the only opt-in writer outside the `livewiki/` and `.livewiki/` safety directories and is gated by `--write-pointer`; the output-budget module replaces the flat `stage4MaxOutputTokens` default with a content-scaled formula after a paid E2E failure showed the fixed ceiling starving large modules; and the navigation module reads accepted module/flow/topic pages back into presentation metadata and emits the reader-digest quickstart, the tasks page, and the auxiliary/flows/topics index hubs together with helpers that update per-module `navigate` blocks and `topics` link sections in flow pages. Callers reach into these exports from the batch flow, the verify stage, and the index sync stages of `packages/core`.

## Orientation evidence

<!-- lw:anchors packages/core/src/orientation.ts#extractRepoOrientation packages/core/src/orientation.ts#findPrimaryReadme packages/core/src/orientation.ts#readdirNames packages/core/src/orientation.ts#readBounded packages/core/src/orientation.ts#extractPurpose packages/core/src/orientation.ts#clipSentence packages/core/src/orientation.ts#PURPOSE_MAX_CHARS packages/core/src/orientation.ts#isMeaningfulProse packages/core/src/orientation.ts#isListLeadIn packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine packages/core/src/orientation.ts#stripHtmlTags packages/core/src/orientation.ts#findFastPathSection packages/core/src/orientation.ts#detectSurfaces packages/core/src/orientation.test.ts#write -->

`extractRepoOrientation` is the single entry point; it resolves the repo root, picks the primary README via `findPrimaryReadme` (tries `README.md`, then `README.en.md`, then any other `README*.{md,markdown}` sorted case-insensitively — `readdirNames` filters non-files and returns an empty array on a read error), reads it through `readBounded` (bounded at 256 KiB; bytes above the cap are read by an explicit `bytesRead` from an opened handle, not by `readFile`), then derives `purpose` from `extractPurpose` and `fastPathSection` from `findFastPathSection`. Every absence degrades to `null`/empty fields rather than throwing.

`export async function extractRepoOrientation(absRoot: string): Promise<RepoOrientation>` returns `{ purpose, surfaces, readmePath, fastPathSection }`. `purpose` is `extractPurpose`'s output clipped to `PURPOSE_MAX_CHARS` (600) at a sentence boundary. The README scanned is capped at `README_MAX_BYTES = 256 * 1024` bytes; `readBounded` calls `nodeFs.stat` first and only opens the file with a `Buffer.alloc(README_MAX_BYTES)` read when the file exceeds the cap.

`export function extractPurpose(markdown: string): string | null` walks the lines with explicit fenced-code and multi-line-HTML bookkeeping; inside a code fence or inside `inTag` the loop only flushes and otherwise continues without further scanning. Within reach, the first paragraph that survives `isMeaningfulProse` and `isListLeadIn` wins; a colon-terminated paragraph (including fullwidth-colon CJK lead-ins) is rejected and scanning continues. `isBadgeOrLinkOnlyLine` keeps language-switchers and badge blocks out of the candidate set, and `stripHtmlTags` removes inline tags from headers (HTML containers are traversed, not skipped). The chosen paragraph is sentence-clipped via `clipSentence` to `PURPOSE_MAX_CHARS`.

`export function clipSentence(text: string, maxChars: number = PURPOSE_MAX_CHARS): string` truncates at a sentence terminator (`.`, `!`, `?`, or the CJK equivalents `。`, `!`, `?`) before the cap, returning the original text when no terminator precedes the cap. `PURPOSE_MAX_CHARS` is exported at 600 chars. `findFastPathSection` returns the heading text whose first matching line matches `/quick ?start|getting started|installation|setup|run locally|local development|usage/i`, or `null`. `detectSurfaces` produces one-line entry-point hints for well-known root files. The test helper `write` (in `orientation.test.ts`) is a sandbox-only async function that `mkdir -p`s a relative path under a temp root and `writeFile`s UTF-8 content — it has no production role.

## Pointer writer

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The marker constants are part of an external contract: `export const POINTER_START = "<!-- livewiki:start -->"` and `export const POINTER_END = "<!-- livewiki:end -->"`. `export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const` is the closed allow-list of pointer files; `export type PointerFile = (typeof POINTER_FILES)[number]` is the matching file-name type. `export const _internal = { nodeFs }` exposes the underlying `node:fs/promises` namespace for diagnostics; the pointer module is the only place outside `safe-io.ts` that touches a file the rest of the pipeline considers off-limits.

The decision of which file to write is `pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)`: a `requested` value of `"AGENTS.md"` or `"CLAUDE.md"` is honored verbatim; otherwise the file that already exists wins (AGENTS preferred over CLAUDE), and when neither exists the function defaults to `"AGENTS.md"`.

`buildPointerBlock()` returns the default block content: a short PT-BR paragraph pointing at `./livewiki/quickstart.md`, bracketed by the `POINTER_START` / `POINTER_END` markers. Its total length is bounded to < 800 chars in tests so the pointer never duplicates wiki content.

`findPointerBlock(content)` is a pure parser: it matches `<!--\s*livewiki:start\s*-->` and `<!--\s*livewiki:end\s*-->` with tolerant whitespace, returns `null` when either side is missing (a truncated or end-only block is treated as absent so the writer never corrupts the doc), and otherwise returns `{ startIdx, endIdx, inner }`. `applyPointerReplace(content, newBlock)` returns `{ content, action }` where `action` is `"inserted"`, `"replaced"`, or `"unchanged"` — appending when no block exists, in-place substitution when one does, and explicitly reporting a no-op write when the byte-identical replacement equals the input. `applyPointerRemove(content)` returns `{ content, removed }` and removes the block plus trailing whitespace when present, otherwise leaves the content untouched.

The disk-touching writers are `insertPointer(repoRoot, opts)`, `removePointer(repoRoot, opts)`, `readPointerStatus(repoRoot, opts)`, and `ensurePointerFile(repoRoot, opts)` — all gated by an explicit allowPointer flag (this module is the documented exception to `safe-io`'s two-directory rule, after SPEC rule #2).

## Tree-sitter parser wrapper

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` is the idempotent global initializer; subsequent calls return the cached `initPromise`. After it resolves, `parseSource` is safe to call.

- `export async function initParser(): Promise<void>` — sets `initPromise = Parser.init()` once and returns the same promise on subsequent calls.
- `function grammarsDir(): string` — resolves `packages/core/grammars/` by trying `./package.json` then `../package.json` via `createRequire(import.meta.url)`, and throws if neither exists.
- `async function loadLanguage(name: string): Promise<Language>` — caches `Language.load(wasmPath)` in a module-local `Map<string, Language>` keyed by grammar name; the WASM path must exist or the call throws with a localized error pointing at the missing grammar.
- `export function grammarForExtension(ext: string): string | undefined` — lowercase-lookup in the `EXT_TO_GRAMMAR` map covering `.ts` → `typescript`, `.tsx` → `tsx`, `.js`/`.mjs`/`.cjs` → `javascript`, `.jsx` → `tsx`, `.py` → `python`; unknown extensions return `undefined`.
- `export async function parseSource(ext: string, source: string): Promise<Tree>` — awaits `initParser`, looks up the grammar, sets it on a fresh `Parser`, calls `parser.parse(source)`, and throws on a `null` tree (the visible branch handles the "input vazio" case explicitly so `null` never propagates).
- `export function listSupportedGrammars(): string[]` — `readdirSync(grammarsDir())`, filtered to `*.wasm` and stripped of the `tree-sitter-` prefix and `.wasm` suffix; returns `[]` when the directory is missing (so a build without grammars is observable rather than throwing).
- `export function _grammarToExtensionForTest(grammar: string): string | undefined` — inverse lookup helper used by the test suite to cross-check that each supported grammar is referenceable.

## Output-token budget

<!-- lw:anchors packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS -->

`export function computeDynamicOutputTokenBudget(signals, opts)` returns an integer budget via the formula `base + perAnchor * anchorCount` (with `anchorCount` clamped to `Math.max(0, …)` so a negative count never subtracts from `base`), plus `Math.ceil(anchorSourceChars / SOURCE_CHARS_PER_OUTPUT_TOKEN)` when `anchorSourceChars` is supplied and positive. The intermediate value is rounded up to the nearest 256 (`TOKEN_ROUNDING_STEP`) and clamped into `[opts.floor, opts.ceiling]` by a `Math.min(opts.ceiling, Math.max(opts.floor, rounded))` envelope — a one-sided cap above the floor and a one-sided cap below the ceiling; both sides are always enforced, but the formula's content-scaling term only ever adds.

`OutputBudgetSignals` is `{ anchorCount: number; anchorSourceChars?: number }`; `anchorSourceChars` is the additive source-size proxy (topics only). `MODULE_OUTPUT_BUDGET_OPTIONS` is the module/flow/topic-prose preset: `base 2048`, `perAnchor 300`, `floor 4096`, `ceiling 32_768`. `TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS` is the compact structured-payload preset used by the topic-plan refine pass: `base 1024`, `perAnchor 40`, `floor 4096`, `ceiling 32_768`. The floor and ceiling are always respected regardless of preset (verified in the test file by sweeping `anchorCount` across `0` and `10_000`).

## Navigation builders and helpers

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#MODULE_DIGEST_CAP packages/core/src/navigation.ts#RESPONSIBILITY_MAX_CHARS packages/core/src/navigation.ts#loadModuleDigests packages/core/src/navigation.ts#parseModuleOpening packages/core/src/navigation.ts#extractModuleOpeningDigest packages/core/src/navigation.ts#extractModuleResponsibility -->

`buildDisplayTitleFallbacks(modules)` computes human-facing fallback titles by grouping modules on the longest common directory suffix (via `commonDirectory`) until a non-colliding suffix is found, appending `source` when the group contains a `src`/`source` segment, and, when several modules share a directory, suffixing `— part N of M`. `Module.id` is the sole identity key everywhere else (graphs, pages, tasks, checkpoints, anchors, filenames); the title map is presentation-only. `compareModules`, `humanizeSegments`, and `normalizeLabel` are the supporting helpers.

`loadModulePresentations`, `loadFlowPresentations`, and `loadTopicPresentations` return maps of presentation metadata (display title, page existence, declared frontmatter owner) for the three page kinds. The module loader reads `livewiki/<moduleId>.md`, parses frontmatter, prefers the frontmatter `title` when it does not normalize-collide with the module id, and trusts a missing or malformed page to produce `owner: null` rather than fabricating metadata.

`MODULE_DIGEST_CAP` (6) is the cap for the quickstart reader digest's top product modules; `RESPONSIBILITY_MAX_CHARS` (240) caps a single responsibility sentence. `loadModuleDigests` produces the digest (top product modules in prioritization order, each with its display title and opening responsibility sentence). `parseModuleOpening`, `extractModuleOpeningDigest`, and `extractModuleResponsibility` parse the H1 + opening paragraph + `How it fits` block of an accepted module page; `extractModuleResponsibility` returns the sentence-clipped opening paragraph (or `null`) and `extractModuleOpeningDigest` returns the longer bounded block shared by the batch flow-context builder and the quickstart.

## Navigation pages and link updates

<!-- lw:anchors packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#buildOrientationBlock packages/core/src/navigation.ts#buildModuleDigestBlock packages/core/src/navigation.ts#synthesizePurposeFromDigests packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#groupTasksModules packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#buildNavigateBlock packages/core/src/navigation.ts#buildModuleCoverageNote packages/core/src/navigation.ts#sumModuleSourceBytes packages/core/src/navigation.ts#moduleSourceExceedsBudget packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#sameStrings packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#humanizeSegments -->

`generateQuickstart(opts)` emits the quickstart page using the orientation block built by `buildOrientationBlock` (README purpose plus entry-point surfaces, with provenance — and a fast-path section name referenced as a plain code span, never a link — and a deterministic digest synthesis fallback via `synthesizePurposeFromDigests` when the README yields no purpose and accepted module pages exist). `buildModuleDigestBlock` materializes the per-module lines from the digest map. The orientation block is emitted only when there is real evidence; absent evidence renders a title-link-only bullet rather than invented prose.

`generateTasksPage(opts)` outputs the tasks page from grouped product modules via `groupTasksModules`. `generateAuxiliaryIndex`, `generateFlowsIndex`, and `generateTopicsIndex` are the three hub-level index generators; their on-disk counterparts are `syncTopicsIndexHub`, `syncFlowsIndexHub`, and `syncAuxiliaryIndexHub`, with `ensureTopicsIndexScaffold` providing the topics scaffold bootstrap. `readHubDeclaredOwner` reports the per-page owner tag (`generated` / `human` / `mixed` / `null`) so the syncers can decide whether to overwrite human content.

`selectRelatedModules`, `updateModuleNavigateBlocks`, and `updateFlowTopicLinks` keep the per-module `navigate` blocks and the per-flow `topics` link sections in sync with the navigation graph; `buildNavigateBlock` composes the per-module block from related modules. `buildModuleCoverageNote` reports file count and byte total for a module digest; `sumModuleSourceBytes` totals the bytes; `moduleSourceExceedsBudget` is the predicate that gates whether a module source can be quoted in full (it is the one-sided "above the cap" branch — the function name describes the visible above-limit signal, and `sumModuleSourceBytes` defines what the byte total covers). The remaining helpers (`compareTopics`, `sameStrings`, `commonDirectory`, `normalizeLabel`, `compareModules`, `humanizeSegments`) underpin deterministic ordering and label equality used across the navigation layer.

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency and dependent

> Coverage note: this module's source (10 files, ~116k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
