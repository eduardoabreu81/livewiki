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

## Import extraction
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

The `imports.ts` module walks a tree-sitter tree and pulls import literals out without performing any path resolution. `extractImportsFromTree(tree, lang)` takes a parsed `Tree` plus a language tag (`"ts"` or `"python"`) and returns `ExtractedImport[]` describing the source string, the kind (`ts-import`, `ts-export`, `py-import`, `py-from`), and for `py-from` the list of imported names. The walker inspects `import_statement`, `export_statement` (re-exports), and `import_from_statement` nodes, stripping surrounding quotes from string sources and collecting dotted names for Python `import foo` forms.

`collectImports(relPath, content)` is the high-level entry: it lazily initialises the parser, derives the file extension from the relative path, calls `parseSource`, and forwards the tree to `extractImportsFromTree`. If the parser throws (unparseable file), the function returns an empty array for graceful degradation.

## Indexer pipeline
<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKey packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

`indexer.ts` orchestrates the walk → read → hash → parse → extract → upsert pipeline. `run(repoRoot, opts)` is the entry point: it resolves the repo path, calls `ensureLivewikiDir`, validates the `.livewiki/index.db` path through `safeIo`, walks the repo, opens the SQLite index, and delegates to `orchestrateIndex`. It returns an `IndexResult` tally with scanned/added/updated/deleted/unchanged counts plus symbol deltas and total duration.

`ensureLivewikiDir(absRoot, quiet)` creates `.livewiki/` via `safeIo.mkdir` and emits an informational log (suppressed in `quiet` mode, used by hooks) when `livewiki/` is also missing, suggesting `livewiki init`. `orchestrateIndex(db, repoRoot, walked, startedAt)` performs the per-file I/O outside the SQLite transaction (read + hash + parse), compares each file against the existing row map by `content_hash`, and accumulates deltas for the atomic commit. `formatHuman(result)` renders the index result for CLI output. The companion test helper `activeSymbolsForKey(key)` opens `index.db` in readonly mode and returns the active `symbols` rows matching the given key.

## init orchestration
<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit packages/core/src/init.ts#selectImportantSymbols -->

`init.ts` implements the `livewiki init` command (Phase 3). `runInit(opts)` ensures `.livewiki/` and `livewiki/architecture` plus `livewiki/diagrams` directories exist via safe I/O, appends `.livewiki/` to the repo `.gitignore`, then runs the indexer and the anchor ledger. It calls `buildPlan(absRoot)` to compute the deterministic module plan, branches on `opts.plan` for dry-run reporting, and otherwise proceeds to deterministic layout generation and optional batch dispatch.

`buildPlan(absRoot)` loads symbols from the index, applies `PathRoleConfig`, runs `identifyModulesHeuristic`, `resolveModuleEdges`, `prioritizeModules`, `makeUniqueDeterministicIds`, `splitOversizedModules`, `assertExactPathPartition`, and `assertUniqueModuleIds`, and returns the ordered modules plus edges and counts. `generateArchitectureOverview(opts)` and `generateQuickstartDeterministic` produce the architecture overview and the low-token quickstart entry point without LLM involvement. `regenerateArchitectureOverview(repoRoot)` is the public hook used by downstream phases to refresh only the architecture output. `selectImportantSymbols` ranks symbols for inclusion in the overview, and `escapeHtmlId(s)` slugifies identifier strings so they are safe to embed in HTML id attributes.

## Key-leak regression suite
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

`key-leak.test.ts` is a critical regression suite that injects a canary API key into every credential-bearing call site and asserts it never appears in error messages, serialised JSON, captured console output, or stack traces. `assertCanaryNotPresent(value, context)` throws a descriptive error if the canary string is found anywhere in `value`, citing the context label and the first 500 characters of the offending string.

The suite covers `MissingApiKeyError`, `MissingProviderConfigError`, `LlmRequestError` from the Anthropic adapter (which receives a mock `fetch` returning a 500 body that mentions the canary), and persisted config JSON. The referenced `generate` method (shown in the symbol table as `async generate()`) belongs to the Anthropic adapter and is exercised via the `LlmRequestError` test path; the suite ensures the adapter never echoes the inbound request body that contains the credential.

## Manifest persistence
<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

The manifest module records the cross-machine handoff state for `livewiki/`. `MANIFEST_VERSION = 1` and `MANIFEST_REL_PATH = "livewiki/.manifest.json"` define the schema version and on-disk location. `LivewikiManifest` holds `version`, `lastDocumentedCommit`, `snapshotHash`, `updatedAt`, and `pendingBatch: PendingBatchRef | null`.

`readManifest(repoRoot)` returns the parsed manifest or `null` when missing or corrupted (CI-friendly tolerance). `computeSnapshotHash(repoRoot)` walks `livewiki/` recursively, filters out the manifest itself, sorts paths alphabetically for determinism, concatenates `<relpath>\n<sha256(content)>\n` per file, and returns the sha256 of the joined buffer. `listFiles(dir)` is the internal iterative walker using a stack to avoid recursion limits. `writeManifestIfChanged(repoRoot, manifest)` only writes when the content differs from the on-disk version, comparing via `manifestsEqual(a, b)` (which intentionally ignores `updatedAt` to keep `git diff` quiet in CI) and the deep-equality helper `pendingBatchEqual(a, b)` for the optional batch reference. `buildManifest(args)` constructs a fresh `LivewikiManifest`. The test helper `writeLivewikiFile(relPath, content)` writes fixture files under a tmp `repoRoot` and creates parent directories.

## Markdown masking and truncation detection
<!-- lw:anchors packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskInlineCode -->

`markdown-mask.ts` provides deterministic helpers that blank out Markdown code constructs before downstream validators scan prose. `maskFencedCodeBlocks(text)` walks line-by-line in CRLF-safe mode, tracking the open fence character, its length, and the indent tolerance; once inside a fence, every line (including the closer) is replaced with an empty string. `maskInlineCode(text)` scans for backtick runs and blanks the run plus its matching closer when a same-length close exists, otherwise leaves the literal text intact so unclosed spans remain detectable.

`maskCodeSpans(text)` is the combined entry that runs `maskFencedCodeBlocks` then `maskInlineCode`. `hasUnclosedFence(text)` returns true when the document ends inside an open fence. `hasUnclosedMarkdown(text)` returns true when either an unclosed fence exists or any backtick survives `maskInlineCode` after the fence pass — the deterministic signal that a document was cut mid Markdown construct.

## Mermaid validation
<!-- lw:anchors packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal packages/core/src/mermaid-validator.ts#validateMermaidSyntax -->

`mermaid-validator.ts` validates Mermaid diagrams with the real Mermaid parser. `validateMermaidSyntax(source)` enqueues each call onto a serial `validationQueue` (the process-wide `window`/`document` globals make concurrent parsing unsafe) and resolves to a diagnostic message string or `null` when the diagram parses cleanly.

`parseWithTemporaryDom(source)` captures the prior `window` and `document` values (and whether each key existed), installs a JSDOM-backed DOM for the duration of the parse, lazily imports and initialises Mermaid with `startOnLoad: false`, then restores the previous globals in the `finally` block via `restoreGlobal(globals, key, existed, previous)` — re-assigning when the key previously existed, deleting it otherwise. The module keeps a module-scoped JSDOM instance to avoid the cost of constructing one per call.

## Module identification
<!-- lw:anchors packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#stripNodeNextExtension -->

`modules.ts` implements the deterministic module-identification heuristic plus the splitting, naming, and validation pipeline used by the batch stage 2. `identifyModulesHeuristic(filePaths, symbolCountByPath?)` normalises each path via `normalizeRepoPath`, groups files by their directory, computes an id with `dirToModuleId(dir, paths, totalDirs)`, sums per-path symbol counts (defaulting to zero), and returns modules sorted by id. `dirToModuleId` uses the last segment of the directory for normal cases, the file basename when there is exactly one file in the entire repo at the root, and the literal `"root"` otherwise.

`MODULE_SPLIT_DEFAULTS = { maxFiles: 12, maxSymbols: 80 }` and the sentinel `SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER` (also representable as `0` or negative input) define the splitting thresholds. `normalizeSplitLimits(maxFiles?, maxSymbols?)` returns `{ maxFiles, maxSymbols }` with disabled axes converted to `SPLIT_AXIS_DISABLED`. `splitOversizedModules(modules, opts)` iterates the modules and splits those exceeding either axis via `splitOneModule(module, limits, symbolCountByPath, depth)`; `axisEnabled(limit)` checks against `SPLIT_AXIS_DISABLED`, and `fitsLimits(module, limits, symbolCountByPath)` decides whether a module already satisfies both axes. `splitOneModule` combines `resolveSymbolCount`, `groupPathsByNextSegment(paths)` (groups by the next path segment after the prefix), `chunkFlatBucket(paths, count)` (chunks a flat bucket without splitting across siblings), and `fileStem(path)` to derive per-chunk ids. When a module cannot be split further, it is returned with `unsplittable: true` so downstream stages bound the context rather than aborting.

`resolveModuleEdges(modules, importsByFile, knownFiles)` produces deduplicated `{ from, to }` edges by resolving each import via `resolveRelativeImport(source, fromPath, knownFiles)`, stripping the NodeNext extension with `stripNodeNextExtension(p)`, and skipping self-loops and absolute/node_modules sources. `prioritizeModules(modules, edges)` ranks modules by indegree. `makeUniqueDeterministicIds(modules)` walks each module's `candidateIdSequence(m)` (built from `pathSegmentsFor(m)`, `pathSlugOf(m)`, `slugifySegment`, and `slugifyIdSegment`) and expands the slug right-to-left until every id is unique; the result is asserted by `assertUniqueModuleIds`, which throws `DuplicateModuleIdError` (with a `constructor(message: string)`) when collisions remain. `assertExactPathPartition(modules, allFiles)` throws `ExactPartitionError` (constructor takes `message: string`) when the modules' paths do not form an exact partition of the known file set, and `refinePeerDirectoryFragmentationError(message, modules)` rewords that error to point out the peer-directory fragmentation pattern.

`DEFAULT_PATH_ROLE_PATTERNS` is the default `PathRoleConfig` covering routes, components, tests, utilities, and shared UI. `matchesAnyPathPattern(path, patterns)` checks a path against a list of glob patterns. `classifyPathRole(path, config?)` returns the `PathRole` for one path, and `classifyModuleRole(module, config?)` rolls up a module's paths into a dominant role. The test helper `idFor(mod)` produces a debug identifier string from `id`, `paths.length`, and `symbolCount`.

## Parser and grammar loading
<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#initParser packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#parseSource -->

`parser.ts` wraps web-tree-sitter with a cached `Language` loader keyed by grammar name. `initParser()` stores the `Parser.init()` promise in `initPromise` so subsequent calls return immediately (idempotent global setup). `grammarsDir()` resolves the `grammars/` directory by trying `./package.json` (dev layout) and then `../package.json` (build layout) relative to `import.meta.url`, throwing when neither exists.

`loadLanguage(name)` caches the loaded `Language` per name, locating `tree-sitter-<name>.wasm` inside `grammarsDir()` and throwing when the file is absent. The `EXT_TO_GRAMMAR` map covers `.ts` → `typescript`, `.tsx`/`.jsx` → `tsx`, `.js`/`.mjs`/`.cjs` → `javascript`, and `.py` → `python`; `grammarForExtension(ext)` looks up the grammar name case-insensitively. `parseSource(ext, source)` initialises the parser, resolves the grammar, constructs a fresh `Parser` with the language, and returns the resulting `Tree`, throwing if the extension is unsupported or the parser returns null. `listSupportedGrammars()` enumerates `tree-sitter-*.wasm` files in the grammar directory, stripping prefix and suffix, and ` _grammarToExtensionForTest(grammar)` exposes the reverse map for tests.