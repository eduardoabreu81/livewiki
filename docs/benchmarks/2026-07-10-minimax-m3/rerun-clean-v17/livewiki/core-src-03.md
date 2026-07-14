---
title: core-src-03
owner: generated
anchors:
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/indexer.test.ts#activeSymbolsForKey
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#escapeHtmlId
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#generateQuickstartDeterministic
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#runInit
  - packages/core/src/init.ts#selectImportantSymbols
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/key-leak.test.ts#generate
  - packages/core/src/manifest.test.ts#writeLivewikiFile
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#writeManifestIfChanged
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskInlineCode
  - packages/core/src/mermaid-validator.ts#parseWithTemporaryDom
  - packages/core/src/mermaid-validator.ts#restoreGlobal
  - packages/core/src/mermaid-validator.ts#validateMermaidSyntax
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#SPLIT_AXIS_DISABLED
  - packages/core/src/modules.ts#assertExactPathPartition
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#axisEnabled
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#chunkFlatBucket
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/modules.ts#classifyPathRole
  - packages/core/src/modules.ts#countSymbols
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#fileStem
  - packages/core/src/modules.ts#fitsLimits
  - packages/core/src/modules.ts#groupPathsByNextSegment
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#matchesAnyPathPattern
  - packages/core/src/modules.ts#normalizeRepoPath
  - packages/core/src/modules.ts#normalizeSplitLimits
  - packages/core/src/modules.ts#pathSegmentsFor
  - packages/core/src/modules.ts#pathSlugOf
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#refinePeerDirectoryFragmentationError
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#resolveSymbolCount
  - packages/core/src/modules.ts#slugifyIdSegment
  - packages/core/src/modules.ts#slugifySegment
  - packages/core/src/modules.ts#splitOneModule
  - packages/core/src/modules.ts#splitOversizedModules
  - packages/core/src/modules.ts#stripNodeNextExtension
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#parseSource
---

## Import extraction (imports.ts)
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`extractImportsFromTree` walks a tree-sitter `Tree` and emits `ExtractedImport` rows. The `lang` argument selects between TS/JS (`ts-import`, `ts-export`) and Python (`py-import`, `py-from`). TS import sources are stripped of surrounding quotes; Python `import os` recurses over `dotted_name` children, and `from foo import bar` carries a `names[]` array alongside the `module_name` field.

`collectImports` is the high-level wrapper: it ensures the parser is initialized, picks the extension (`"." + ext`), parses the content, and delegates to `extractImportsFromTree`. Parse failures degrade gracefully — the function returns `[]` instead of throwing, so an unparseable file simply contributes no edges.

## Indexer (indexer.ts) and its tests (indexer.test.ts)
<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKey packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

`run` is the public index entry. It resolves the repo root, ensures `.livewiki/` exists via `ensureLivewikiDir`, validates `.livewiki/index.db` through `safe-io`, walks the repo, opens the SQLite DB, and hands off to `orchestrateIndex`. The returned `IndexResult` carries `filesScanned`/`filesAdded`/`filesUpdated`/`filesDeleted`/`filesUnchanged` plus `symbolsAdded`/`symbolsDeleted` and `durationMs`.

`ensureLivewikiDir` creates `.livewiki/` and, when not in `quiet` mode, prints a one-line note suggesting `livewiki init` if the `livewiki/` wiki directory is still absent. `orchestrateIndex` builds an in-memory plan of `FilePlan` entries (content hash + symbol extraction) before driving the synchronous SQLite transaction. `formatHuman` renders an `IndexResult` as a multi-line human-readable summary.

In the tests, `activeSymbolsForKey` opens the SQLite index read-only and selects active rows by key from the `symbols` table, returning `{ key, kind, signature, start_line }` shaped rows.

## Init pipeline (init.ts)
<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit packages/core/src/init.ts#selectImportantSymbols -->

`runInit` orchestrates the deterministic init: it ensures `.livewiki/` and `livewiki/{architecture,diagrams}` exist via `safe-io`, guarantees `.livewiki/` is gitignored, calls the indexer + anchor ledger, then `buildPlan` to load symbols and modules. With `--plan` it stops and returns an `InitPlanReport`; otherwise it writes `structure.mmd`, modules graph, per-module class diagrams, and the manifest.

`buildPlan` resolves heuristic modules via the deterministic pipeline, resolves edges, prioritizes modules, makes ids unique, splits oversized modules, validates the exact path partition, and returns `{ symbols, pathRoleConfig, filePaths, modules, edges, ordered, totalSymbols, totalFiles }`. `generateQuickstartDeterministic` produces a low-token entry point without an LLM; `generateArchitectureOverview` is its layout counterpart for `livewiki/architecture/` and `regenerateArchitectureOverview` re-runs it from the CLI on an existing repo.

`selectImportantSymbols` is the heuristic for choosing which symbols deserve prominent placement (used by quickstart generation), and `escapeHtmlId` makes arbitrary strings safe as HTML ids in anchors emitted inside the generated Markdown.

## Key-leak canary (key-leak.test.ts)
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

`assertCanaryNotPresent` is the regression assertion: any value containing the `KEY-LEAK-CANARY-DONOTUSE-7f3a` token throws a descriptive error tagged with the call site (`MissingApiKeyError.message`, `LlmRequestError.message`, etc.). The `generate` method belongs to a faked LLM adapter used to exercise the same path.

## Manifest persistence (manifest.ts) and its tests (manifest.test.ts)
<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

`MANIFEST_VERSION` is the schema version (currently `1`) and `MANIFEST_REL_PATH` is the relative location `livewiki/.manifest.json` (the manifest excludes itself from its own snapshot hash).

`computeSnapshotHash` walks the `livewiki/` tree via `listFiles`, excludes the manifest file, sorts the result deterministically, concatenates `relpath\nsha256(content)\n` lines and hashes the concatenation. `listFiles` is an iterative directory walk that emits forward-slash relative paths.

`readManifest` returns `null` on absence or corruption rather than throwing — corrupted JSON is treated as "no manifest". `writeManifestIfChanged` is the idempotent writer: it compares against the existing manifest via `manifestsEqual` and only writes through `safe-io` when the content actually differs (CI anti-loop). `manifestsEqual` ignores `updatedAt` (a timestamp), only comparing `version`, `snapshotHash`, `lastDocumentedCommit`, and the `pendingBatch` ref via `pendingBatchEqual`. `buildManifest` constructs a `LivewikiManifest` from the supplied inputs.

In `manifest.test.ts`, `writeLivewikiFile` is a small helper that creates parent directories and writes UTF-8 content to a path inside the test `repoRoot`.

## Markdown masking helpers (markdown-mask.ts)
<!-- lw:anchors packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskInlineCode -->

`maskCodeSpans` first masks fenced blocks (so `inline code` examples containing backticks inside fences are protected) and then masks inline code spans; the resulting text has code replaced with spaces of equal length, preserving offsets.

`maskFencedCodeBlocks` walks the document line-by-line tracking an open-fence state. It supports ```` ``` ```` and `~~~` fences of any length, matches a closing fence of equal-or-longer run on the same character, and is CRLF-safe (it splits on `\r?\n`). `maskInlineCode` parses backtick runs lazily and follows CommonMark: the closing delimiter must have the same number of backticks as the opening one. A backtick run with no closing match is left literal so that `hasUnclosedMarkdown` can detect truncation.

`hasUnclosedFence` reports whether the document ends inside an open fence (objective truncation signal). `hasUnclosedMarkdown` combines fence detection with the post-mask-inline-code check: any literal backtick surviving both passes means an inline code span was cut off.

## Mermaid syntax validator (mermaid-validator.ts)
<!-- lw:anchors packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal packages/core/src/mermaid-validator.ts#validateMermaidSyntax -->

`validateMermaidSyntax` calls Mermaid's real parser and returns the error message string on failure or `null` when the diagram parses. Mermaid requires browser-like globals, so the implementation swaps `window`/`document` for a shared `JSDOM` instance for the duration of one parse and restores them afterwards.

Calls are serialized through `validationQueue` so two concurrent validations don't trample each other's globals. `parseWithTemporaryDom` snapshots the previous `window` and `document` values (and whether the keys existed at all) before installing the temporary DOM, lazily imports `mermaid`, runs `mermaid.parse(source)`, and produces the diagnostic. `restoreGlobal` either reassigns the prior value when the key existed or `delete`s it from `globalThis` otherwise.

## Module identification (modules.ts) and its tests (modules.test.ts)
<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.test.ts#idFor -->

`identifyModulesHeuristic` groups forward-slash normalized paths by their directory, derives an id per group, sums symbol counts when an optional `symbolCountByPath` map is provided, and sorts by id for stable output. The single-root-file case is a basename-id rather than `root`. `dirToModuleId` is the helper implementing that policy.

`MODULES_SPLIT_DEFAULTS` sets the structural thresholds (`maxFiles: 12`, `maxSymbols: 80`) and `SPLIT_AXIS_DISABLED` is the `Number.MAX_SAFE_INTEGER` sentinel used when an axis (file or symbol) is disabled (`0` or negative input). `normalizeSplitLimits` converts the raw user thresholds to active limits. `splitOversizedModules` drives the per-module splitter using `axisEnabled`, `fitsLimits`, `resolveSymbolCount`, `countSymbols`, `groupPathsByNextSegment`, `chunkFlatBucket`, and `splitOneModule`. When a single file exceeds the cap and cannot be split, the module is marked `unsplittable` so downstream stages bound its context.

`assertExactPathPartition` verifies that the modules cover the input paths exactly with no overlap. The `ExactPartitionError` class and its constructor carry that failure mode. `refinePeerDirectoryFragmentationError` upgrades a "fragmented peers" message into a clearer diagnostic that names the offending directories.

`DEFAULT_PATH_ROLE_PATTERNS` ships the regex set used by `classifyPathRole` and `classifyModuleRole` to tag modules (test/source/config/etc). `matchesAnyPathPattern` tests a path against an arbitrary list. `normalizeRepoPath` canonicalizes separators; `stripNodeNextExtension` removes `.js`/`.mjs` from relative import specifiers; `resolveRelativeImport` resolves a relative import against a source path.

`resolveModuleEdges` turns per-file `ExtractedImport` data into a deduplicated set of `{ from, to }` module edges, ignoring self-loops and unresolved node-module imports. `prioritizeModules` sorts modules by descending indegree (centrality). `makeUniqueDeterministicIds` walks `pathSegmentsFor` + `pathSlugOf` + `candidateIdSequence` + `slugifySegment`/`slugifyIdSegment`/`fileStem`, expanding slug prefixes from right to left until each module id is unique; `assertUniqueModuleIds` + `DuplicateModuleIdError` (and its constructor) defend that invariant.

In `modules.test.ts`, `idFor` is a small projection that returns `module.id` and is used to make assertion code more compact.

## Tree-sitter parser wrapper (parser.ts)
<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#initParser packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#parseSource -->

`initParser` is the idempotent WASM runtime initializer that caches the `Parser.init()` promise so concurrent first-calls share a single load. `grammarsDir` resolves the bundled `grammars/` directory relative to the package's `package.json`, trying `./package.json` (dev) then `../package.json` (build) and throwing a clear error otherwise.

`loadLanguage` is the per-grammar cache: missing `.wasm` files produce a descriptive error (the language isn't supported in this build), and successful loads are memoized. The internal `EXT_TO_GRAMMAR` map drives `grammarForExtension` for callers that hold an extension but not a language name. `parseSource` initializes the parser, looks up the grammar for the extension, runs `parser.parse(source)`, and rejects a null tree defensively.

`listSupportedGrammars` enumerates the available `.wasm` files and strips the `tree-sitter-` prefix and `.wasm` suffix to produce grammar names. `_grammarToExtensionForTest` is the inverse lookup over the internal `GRAMMAR_TO_EXT` map, exposed solely so tests can confirm grammar names round-trip.