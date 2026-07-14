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

## imports.ts
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`extractImportsFromTree` walks a `web-tree-sitter` tree and pulls out import nodes without any I/O. It handles TypeScript `import_statement` and `export_statement` (re-exports), Python `import_statement` (top-level `dotted_name`), and Python `import_from_statement` (with the `names` list attached to the `py-from` kind). The returned `ExtractedImport[]` preserves the literal source string as it appears in the file; path resolution (`./foo` → `src/auth/foo.ts`) is deferred to `modules.ts`.

`collectImports` is the high-level wrapper that takes a relative path and content, calls `initParser`, picks the language by extension (`.py` → `python`, everything else → `ts`), and delegates to `extractImportsFromTree`. Files that fail to parse degrade gracefully to an empty list rather than throwing.

## indexer.ts
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman -->

`run` is the top-level incremental indexer entry point. It resolves the repo root, ensures `.livewiki/` exists, validates the DB path through `safe-io`, walks the repo, opens the SQLite index, and delegates to `orchestrateIndex`. The result is an `IndexResult` with counters for files added/updated/deleted/unchanged, symbols added/deleted, and total duration.

`ensureLivewikiDir` creates `.livewiki/` (cache, never in git) and, if `livewiki/` does not exist and the call is not `quiet`, prints a one-line note suggesting `livewiki init`. Errors that are not "already exists" are rethrown as `failed to create .livewiki/`.

`orchestrateIndex` performs the read + hash + parse + extract pass outside the SQLite transaction (since better-sqlite3 transactions are synchronous and cannot contain `await`), then upserts inside one transaction. Files whose `content_hash` matches the prior row are skipped from the expensive parse path.

`formatHuman` produces a CLI-friendly summary string from an `IndexResult`.

## init.ts
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#selectImportantSymbols packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#escapeHtmlId -->

`runInit` is the real `livewiki init` implementation. It ensures `.livewiki/` and `livewiki/` exist, registers `.livewiki/` in `.gitignore`, runs the indexer + anchor ledger, loads the plan, and then branches: `--plan` returns the report without writing, the default path writes deterministic layout, and `--batch` triggers the LLM pipeline. `batchExitCode` is delegated to `core/batch.ts#statusToExitCode`.

`buildPlan` runs the heuristic module identification, edge resolution, prioritization, unique-id enforcement, oversized split, exact-partition assertion, and per-module role classification, returning a `InitPlanReport`.

`generateQuickstartDeterministic` produces the low-token entry point (`livewiki/quickstart.md`) without LLM calls; `selectImportantSymbols` picks the symbols featured in it.

`generateArchitectureOverview` and `regenerateArchitectureOverview` write the high-level architecture page; the latter is the entry point re-run after batches.

`escapeHtmlId` sanitizes strings for use as HTML `id` attributes in anchor links emitted by the wiki pages.

## Test fixtures and helpers
<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKey packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/modules.test.ts#idFor -->

`activeSymbolsForKey` opens `.livewiki/index.db` read-only and selects every active `symbols` row matching a key; used in the end-to-end indexer tests.

`assertCanaryNotPresent` is the canary-checker used by the key-leak regression suite. It throws with a diagnostic if a string contains the canary token, identifying the context label passed in.

`generate` (the method) is exercised by the key-leak test to drive the LLM adapter with the canary key in the API key slot, ensuring the request error path does not surface the credential in `message` or `stack`.

`writeLivewikiFile` is a small test helper that creates parent directories and writes a file relative to a temp `repoRoot`, used across the manifest tests.

`idFor` is a test-side helper that returns the canonical string id used to look up a module in the modules test expectations.

## manifest.ts
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest -->

`MANIFEST_VERSION` is the current schema number (`1`); `MANIFEST_REL_PATH` is `livewiki/.manifest.json`.

`readManifest` returns the parsed `LivewikiManifest` or `null` when the file is missing or corrupted — the tolerance is deliberate so CI does not break on bad JSON.

`computeSnapshotHash` walks `livewiki/` recursively (excluding the manifest itself), sorts entries alphabetically for determinism, concatenates `relpath\nsha256(content)\n` for each, and returns the sha256 of the joined buffer. This is the value persisted as `snapshotHash`.

`listFiles` is the internal recursive walker for `computeSnapshotHash`; it uses an explicit stack and tolerates directories that cannot be read.

`writeManifestIfChanged` serializes the manifest and writes it through `safe-io`, but only if `manifestsEqual` against the on-disk copy returns false. Returning `false` on a no-op write is the anti-loop mechanism that keeps CI diffs clean.

`manifestsEqual` compares `version`, `snapshotHash`, `lastDocumentedCommit`, and the nested `pendingBatch`; `updatedAt` is intentionally excluded so re-runs in the same second do not flap.

`pendingBatchEqual` deep-compares two `PendingBatchRef | null` values, used as part of the manifest equality check.

`buildManifest` constructs a `LivewikiManifest` from the documented commit, snapshot hash, and pending batch reference.

## markdown-mask.ts
<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown -->

`maskCodeSpans` is the combined mask: it blanks fenced code blocks first, then inline code spans, leaving the rest of the document untouched.

`maskFencedCodeBlocks` splits on `/\r?\n/` (CRLF-safe), tracks an in-fence state machine, and replaces the opening line, the body, and the closing line with empty strings. The closing regex requires the same fence character and minimum length as the opener.

`maskInlineCode` follows the CommonMark rule that the closing backtick run must match the opening run in length. Matched spans become a run of spaces the same width; unmatched backticks are preserved literally so `hasUnclosedMarkdown` can detect a truncated span.

`hasUnclosedFence` reports whether the document ended with an open fence by replaying the same state machine used by `maskFencedCodeBlocks`.

`hasUnclosedMarkdown` is the truncation detector: it returns `true` if there is an unclosed fence or if any backtick survives `maskInlineCode(maskFencedCodeBlocks(text))`. It is the deterministic signal that a page was cut mid Markdown construct, used by the artifact validator to reject truncated output.

## mermaid-validator.ts
<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

`validateMermaidSyntax` enqueues a parse through a single shared `validationQueue` Promise so that the temporary DOM swap is serialized — Mermaid's parser expects `window` and `document`, and those globals are process-wide. On success it returns `null`; on parse failure it returns the error's message string.

`parseWithTemporaryDom` snapshots the previous `window` and `document` (and whether each key existed on the global), installs the long-lived `parserDom` instance, lazily loads and initializes `mermaid` on first use, calls `mermaid.parse`, and always restores the originals in the `finally` block.

`restoreGlobal` re-assigns the previous value when the key existed before, and `delete`s it otherwise — the precise inverse of the swap performed by `parseWithTemporaryDom`.

## modules.ts
<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor -->

`identifyModulesHeuristic` groups files by their top-level directory and emits one `Module` per group, sorted by id for determinism. The optional `symbolCountByPath` map aggregates per-module symbol totals; files at the repo root get the id `"root"`, or their file stem when the repo is a single file.

`dirToModuleId` is the id-derivation rule for a directory group: the last path segment for a non-empty directory, `"root"` for the multi-file root case, or the single file's basename (without extension) for a one-file repo.

`MODULE_SPLIT_DEFAULTS` holds the structural completion targets (`maxFiles: 12`, `maxSymbols: 80`); `SPLIT_AXIS_DISABLED` is the `Number.MAX_SAFE_INTEGER` sentinel used when an axis is turned off.

`normalizeSplitLimits` maps `undefined` to `MODULE_SPLIT_DEFAULTS` and `0` or negative values to `SPLIT_AXIS_DISABLED`, returning a normalized `{ maxFiles, maxSymbols }` pair. `splitOversizedModules` applies that limit pair across the input modules, marking any single-file module that still exceeds the cap as `unsplittable: true` so the batch can still schedule it without losing structural information.

`countSymbols` sums a `symbolCountByPath` map across a module's paths; `resolveSymbolCount` is the symbol-count resolver used by the split pipeline (sourcing counts from the indexer's symbol map).

`axisEnabled` is the predicate `limit < SPLIT_AXIS_DISABLED`; `fitsLimits` returns `true` when a module is within both the file and symbol axes.

`splitOneModule` is the per-module splitter; `chunkFlatBucket` slices a flat array of paths into evenly sized chunks; `groupPathsByNextSegment` clusters sibling paths by the next path segment to produce sub-directory fragments when a single bucket is still over-cap.

`fileStem` returns the basename without extension; `slugifyIdSegment` and `slugifySegment` normalize a string into a kebab-style slug for use in module ids and URL anchors.

`normalizeRepoPath` standardizes a path to forward slashes for consistent grouping; `stripNodeNextExtension` removes the `.js`/`.mjs`/`.cjs` extension that NodeNext implicit-allow adds to relative specifiers.

`DEFAULT_PATH_ROLE_PATTERNS` is the default glob set for `entry` / `test` / `fixture` / `example` / `infra` / `config` / `docs` path roles; `matchesAnyPathPattern` is the matcher used by `classifyPathRole`, which in turn feeds `classifyModuleRole` (role is taken from the dominant role across a module's paths).

`resolveModuleEdges` walks the per-file import map, calls `resolveRelativeImport` to map a relative source string to a known file in the repo, and emits one `ModuleGraphEdge` per cross-module pair (self-loops and node_modules imports are dropped, duplicates are deduped).

`prioritizeModules` orders modules by indegree (incoming edges) descending — modules depended on by more neighbors get documented first.

`makeUniqueDeterministicIds` runs the right-to-left slug expansion described in the module header, so two `src` directories under different parents become `core-src` and `cli-src`; `pathSlugOf`, `candidateIdSequence`, and `pathSegmentsFor` are the helpers it calls. `assertUniqueModuleIds` throws `DuplicateModuleIdError` if two modules end up with the same id; the constructor sets the message and the class extends `Error`.

`assertExactPathPartition` verifies that the post-split module set still covers every input path exactly once and throws `ExactPartitionError` (constructor attaches the message) if a path is missing or duplicated. `refinePeerDirectoryFragmentationError` rewrites a raw `ExactPartitionError` message into one that points at the fragmented peer directories and suggests merging them before re-running.

## parser.ts
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` calls `Parser.init()` once, caching the resulting promise in module scope; subsequent calls return the cached promise so the WASM runtime is initialized exactly once.

`grammarsDir` resolves the directory containing the `.wasm` grammars by trying `./package.json` (dev) then `../package.json` (build) and returning its sibling `grammars/` folder, throwing if neither exists. `loadLanguage` caches a `Language` instance per grammar name, throwing a clear error if the matching `tree-sitter-<name>.wasm` is not present in the resolved directory.

`grammarForExtension` maps a lowercased file extension (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`) to the matching tree-sitter grammar name; `_grammarToExtensionForTest` is the inverse, exposed only for tests to assert the mapping.

`parseSource` runs `initParser`, looks up the grammar by extension, loads (or reuses) the `Language`, constructs a fresh `Parser` per call, and returns the `Tree`. It throws if no grammar is registered for the extension or if tree-sitter returns a null tree.

`listSupportedGrammars` returns the names of all `.wasm` files in the grammars directory, derived by stripping the `tree-sitter-` prefix and `.wasm` suffix; an empty array is returned when the directory is absent.