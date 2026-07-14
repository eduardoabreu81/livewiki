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
  - packages/core/src/markdown-mask.ts#consumeFenceLine
  - packages/core/src/markdown-mask.ts#createFenceState
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength
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
---

## Import extraction (tree-sitter)
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`extractImportsFromTree(tree, lang)` walks a parsed tree-sitter `Tree` and returns `ExtractedImport[]`. It distinguishes TypeScript `import_statement` / `export_statement` (re-exports) from Python `import_statement` and `import_from_statement`. TS sources are stripped of surrounding quotes; Python `from foo import bar` carries the imported names list. The function is I/O-free and reused in tests where a parsed tree is already available.

`collectImports(relPath, content)` is the high-level wrapper: it initialises the parser (cached), dispatches by extension (`.py` → python, otherwise → ts), parses `content`, and delegates to `extractImportsFromTree`. Parse failures degrade gracefully to an empty array rather than throwing.

## Indexer
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

`run(repoRoot, opts)` is the public entry point: it resolves the absolute root, ensures `.livewiki/` exists, validates the SQLite path through `safe-io`, walks the repo, opens the DB, and delegates to `orchestrateIndex`. It returns an `IndexResult` with scanned/added/updated/deleted/unchanged counts plus added/deleted symbol counts and elapsed milliseconds.

`ensureLivewikiDir(absRoot, quiet)` creates `.livewiki/` via `safe-io.mkdir`. When `livewiki/` itself does not exist and `quiet` is false, it emits an informational note suggesting `livewiki init`; in quiet mode (CI hooks) the note is suppressed.

`orchestrateIndex(db, repoRoot, walked, startedAt)` performs the two-phase work: Phase A does async I/O (stat + read + hash + parse) outside any transaction and produces a `FilePlan[]`. Phase B runs synchronously inside a `better-sqlite3` transaction (the DB API is sync) and performs the upserts. Files whose `content_hash` matches the prior DB row are skipped from re-parse (incremental fast path). Removed files are tombstoned via `status='deleted'`.

`formatHuman(result)` produces a human-readable summary of an `IndexResult` for the CLI.

In `indexer.test.ts`, `activeSymbolsForKey(key)` is a test helper that opens the per-run SQLite database read-only and returns active symbol rows for a given key.

## Init pipeline
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#selectImportantSymbols -->

`runInit(opts)` is the CLI entry point behind `livewiki init`. It ensures `.livewiki/` and `livewiki/` (with `architecture/` and `diagrams/` subdirectories) exist, ensures `.livewiki/` is gitignored, then runs the indexer and anchor ledger. It builds a plan, branches on `--plan` (read-only report, no writes), and otherwise emits the deterministic layout: `structure.mmd`, `modules.mmd`, per-module class diagrams, and the manifest. `--batch` then dispatches the full LLM pipeline; `--no-refine` skips the LLM refinement of stage 2.

`buildPlan(absRoot)` loads the indexed symbols, builds `pathRoleConfig`, derives heuristic `Module`s, resolves module edges from the import map, and returns `{symbols, pathRoleConfig, filePaths, modules, edges, ordered, totalSymbols, totalFiles}` used by both the writer and `--plan` report.

`generateQuickstartDeterministic(...)` produces the `livewiki/quickstart.md` entry point without LLM involvement.

`generateArchitectureOverview(opts)` produces the architecture overview page from the deterministic plan.

`regenerateArchitectureOverview(repoRoot)` rewrites the architecture overview in place from the current index — used after batch runs to refresh the snapshot.

`escapeHtmlId(s)` sanitises strings for use as HTML anchor `id` attributes.

`selectImportantSymbols(...)` chooses the symbols highlighted in the deterministic quickstart page (typically the most-referenced or highest-priority entries).

## Manifest
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.test.ts#writeLivewikiFile -->

`MANIFEST_VERSION` is the current schema number (`1`). `MANIFEST_REL_PATH` is `"livewiki/.manifest.json"`.

`readManifest(repoRoot)` returns the parsed manifest or `null` when missing or corrupted (tolerant of bad JSON so CI does not break on a partial write).

`computeSnapshotHash(repoRoot)` produces a stable sha256 of `livewiki/` content while excluding the manifest file itself, so writing the manifest does not mutate its own hash. The walk is alphabetical for determinism.

`listFiles(dir)` is the recursive file-listing helper used by `computeSnapshotHash`; missing directories yield an empty list.

`writeManifestIfChanged(repoRoot, manifest)` writes the manifest only when content has actually changed. Equality intentionally ignores `updatedAt` (a timestamp), otherwise every call would rewrite the file and dirty the working tree in CI.

`manifestsEqual(a, b)` compares two manifests field-by-field, delegating batch-ref comparison to `pendingBatchEqual`.

`pendingBatchEqual(a, b)` is a null-safe equality check for `PendingBatchRef | null`, comparing `runId`, `stage`, `done`, `total`.

`buildManifest(args)` constructs a `LivewikiManifest` value from its inputs.

In `manifest.test.ts`, `writeLivewikiFile(relPath, content)` is a fixture helper that creates parent directories and writes a file under the temporary `repoRoot`.

## Markdown masking
<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine -->

`maskCodeSpans(text)` is the combined helper: it blanks fenced code blocks first, then inline code spans, so callers can run link/marker scans against the result without matching code-as-prose.

`maskFencedCodeBlocks(text)` walks the document line-by-line, tracking a `FenceState`; opening and closing fence lines (and the body between them) are replaced with empty strings. The line split is CRLF-safe so closing fences still match on Windows-style line endings.

`maskInlineCode(text)` blanks runs of backticks using CommonMark rules — the closing delimiter must be the same length as the opening one. A backtick run with no matching close is left as literal text so `hasUnclosedMarkdown` can detect it later.

`maskCodeSpansPreservingLength(text)` and `maskFencedCodeBlocksPreservingLength(text)` are length-stable variants: masked characters become spaces rather than disappearing, so indices in the masked output still map to indices in the original. This is essential when ranges computed against the masked text must be reapplied to the source.

`hasUnclosedFence(text)` returns true when the document ends still inside a fence.

`hasUnclosedMarkdown(text)` returns true when the document has either an unclosed fence or an unclosed inline code span — the deterministic signal that a truncation cut the document mid Markdown construct.

`createFenceState()` initialises a fresh state machine; `consumeFenceLine(line, state)` advances it by one line and reports whether that line belongs to a fenced block.

## Mermaid validator
<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

`validateMermaidSyntax(source)` validates a Mermaid diagram by calling Mermaid's real parser through a temporary `jsdom` DOM. The global `window` / `document` are swapped for the duration of the parse and restored afterwards. Calls are serialised through an internal queue because the globals are process-wide. Returns a concise error message on failure or `null` on success.

`parseWithTemporaryDom(source)` is the internal helper that swaps the globals, lazily initialises the Mermaid instance (with `startOnLoad: false`), runs `mermaidInstance.parse(source)`, and restores the globals via `restoreGlobal`.

`restoreGlobal(globals, key, existed, previous)` writes the previous value back if the key existed, or deletes it otherwise — preserving the original global shape exactly.

## Module identification
<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension -->

`identifyModulesHeuristic(filePaths, symbolCountByPath?)` groups files by top-level directory into `Module[]`. Files with no directory go to the `root` module, except for the single-file repo case where the file stem is used. `symbolCountByPath` is summed per module. Output is sorted by id for determinism.

`dirToModuleId(dir, paths, totalDirs)` decides the slug for a directory: the last path segment, with a special rule for the root directory.

`normalizeRepoPath(p)` canonicalises a path (forward slashes, no trailing slash) so the grouping and matching logic see a consistent shape.

`countSymbols(paths, map)` sums the per-path symbol counts from a `Map<string, number>`, defaulting missing entries to zero.

`resolveModuleEdges(modules, importsByFile, knownFiles)` walks each file's imports, follows relative paths through `resolveRelativeImport` and `stripNodeNextExtension`, finds the destination module, and emits deduplicated `ModuleGraphEdge` rows. Self-loops and external imports are ignored.

`resolveRelativeImport(fromPath, importSource)` resolves `./foo` / `../bar` against the importer's path. `stripNodeNextExtension(p)` removes the `.js` / `.mjs` / `.cjs` suffix used in NodeNext source-only imports so the resolver can find the matching `.ts` file.

## Oversized-module splitting
<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem -->

`MODULE_SPLIT_DEFAULTS` provides the default thresholds (`maxFiles: 12`, `maxSymbols: 80`). `SPLIT_AXIS_DISABLED` is the sentinel (`Number.MAX_SAFE_INTEGER`) used when an axis is turned off (`0` or negative).

`normalizeSplitLimits(maxFiles?, maxSymbols?)` returns the effective thresholds, mapping missing / zero / negative inputs to either `MODULE_SPLIT_DEFAULTS` or `SPLIT_AXIS_DISABLED`.

`splitOversizedModules(modules, options)` walks the module list and splits any module that exceeds the resolved limits, preserving overall path coverage. `resolveSymbolCount` reads the per-path symbol count from `options.symbolCountByPath`; `axisEnabled(limit)` and `fitsLimits(...)` answer whether a given axis is active and whether a module fits.

`splitOneModule(mod, limits, ...)` produces a list of smaller modules for one oversized module. It uses `groupPathsByNextSegment(paths)` to organise by next directory segment, falls back to `chunkFlatBucket(...)` for flat directories, and may split files via `fileStem(path)` when a single file is too large (marking the result `unsplittable`).

## Path-role classification
<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole -->

`DEFAULT_PATH_ROLE_PATTERNS` ships a `Required<PathRoleConfig>` with the conventional patterns for `tests`, `docs`, `scripts`, `config`, and `app` (source) directories. `matchesAnyPathPattern(path, patterns)` is a tiny matcher used by the classifiers.

`classifyPathRole(path, config?)` returns the `PathRole` for a single path (e.g. `tests`, `app`). `classifyModuleRole(module, config?)` aggregates over the module's paths to decide a role for the module as a whole.

## Module ids and partitions
<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.test.ts#idFor -->

`makeUniqueDeterministicIds(modules)` resolves slug collisions deterministically. For each module it asks `candidateIdSequence(m)` for the ordered candidate slugs (`pathSlugOf(m)`, then expanded forms produced by walking `pathSegmentsFor(m)` through `slugifySegment`). The first candidate not yet claimed by another module wins; otherwise `slugifyIdSegment(s)` is used as a final tie-breaker. The result is a new `Module[]` with globally unique ids.

`prioritizeModules(modules, edges)` returns the modules ordered for batch processing — by graph centrality first (in-degree from the edges), then by symbol count as the tie-breaker.

`assertUniqueModuleIds(modules)` throws a `DuplicateModuleIdError` (constructor accepts the message) when two modules share an id — a defensive check before stage 4 writes one file per id.

`assertExactPathPartition(modules, allPaths)` throws an `ExactPartitionError` (constructor accepts the message) when the union of module paths does not exactly equal the set of `allPaths` — the modules-to-paths mapping must be bijective.

`refinePeerDirectoryFragmentationError(...)` takes a candidate `ExactPartitionError` and refines its message when the failure is specifically the case of peer-directory fragmentation, so the diagnostic points to the actual cause.

In `modules.test.ts`, `idFor(mod)` is a fixture helper that returns a stable identifier for a module, used by table-driven tests to compare snapshots across module-list variants.

## Key-leak test helpers
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

`assertCanaryNotPresent(value, context)` is the guard used throughout the key-leak suite: if the canary API-key string appears anywhere in `value`, it throws with the offending context. This enforces the SPEC invariant that API keys are sourced only from environment variables and never appear in logs, error messages, or persisted JSON.

`generate()` is an async generator method (on a fixture helper in the test file) used to produce canary-laden payloads that exercise every error path of the LLM adapter and config layer, so each path is checked for leakage.