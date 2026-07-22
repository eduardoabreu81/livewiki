---
title: Manifest, Markdown masking, Mermaid validation, and module partitioning
owner: generated
anchors:
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
  - packages/core/src/markdown-mask.ts#boundedExcerpt
  - packages/core/src/markdown-mask.ts#consumeFenceLine
  - packages/core/src/markdown-mask.ts#createFenceState
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength
  - packages/core/src/markdown-mask.ts#maskInlineCode
  - packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic
  - packages/core/src/mermaid-validator.ts#parseWithTemporaryDom
  - packages/core/src/mermaid-validator.ts#restoreGlobal
  - packages/core/src/mermaid-validator.ts#validateMermaidSyntax
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS
  - packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#SPLIT_AXIS_DISABLED
  - packages/core/src/modules.ts#applyRefinedDisplayTitles
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
  - packages/core/src/modules.ts#normalizePresentationLabel
  - packages/core/src/modules.ts#normalizeRefinedDisplayTitle
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

# Manifest, Markdown masking, Mermaid validation, and module partitioning

This module owns the on-disk manifest writer, the Markdown code-construct maskers and unclosed-markdown diagnostic, the Mermaid syntax validator that runs against a temporary DOM, and the deterministic module partitioning pipeline (heuristic grouping, ID uniqueness, role classification, and oversized-module splitting).

## When to use this page

- Read or write the `livewiki/.manifest.json` file and reason about its `version`, `snapshotHash`, `lastDocumentedCommit`, `updatedAt`, and `pendingBatch` fields.
- Mask or inspect Markdown code constructs (fenced blocks, inline code) for anchor extraction, link verification, or unclosed-markdown diagnostics.
- Validate Mermaid diagrams without leaking a `window`/`document` global into the host process.
- Group repository files into documentation modules, resolve cross-module edges, classify path/module roles, and split oversized modules along the file or symbol axis.

## How it fits

This module is a layer in `packages/core/`. `manifest.ts` is consumed by the batch pipeline (handing off an interrupted run across machines) and writes through the shared `safe-io` allowlist so the manifest is the only file that may appear in `.livewiki/`. `markdown-mask.ts` is shared by `verify.ts`, `artifact.ts`, and `anchors.ts`, so every structural scan operates on the same masked view. `mermaid-validator.ts` is the one place that installs a `JSDOM` `window`/`document` for Mermaid's parser, and it serializes calls because those globals are process-wide. `modules.ts` is stage 2 of the batch pipeline: it groups files deterministically before the LLM refinement call, and the oversized-module splitter keeps the budget stable for stage 4 (write of `livewiki/<id>.md`).

## Manifest schema and writers

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.test.ts#writeLivewikiFile -->

The manifest is a small JSON object pinned to a schema version.

- `export const MANIFEST_VERSION = 1;`
- `export const MANIFEST_REL_PATH = "livewiki/.manifest.json";`

`readManifest(repoRoot)` returns `Promise<LivewikiManifest | null>`. It probes the file via `safeIo.exists`, returns `null` if the file is missing, and on read failure (e.g. corrupted JSON) the `try`/`catch` returns `null` — the read path is intentionally tolerant so CI never crashes on a malformed manifest. The shape check (`version` must be a `number`, `snapshotHash` must be a `string`) is the only structural validation done on read.

`buildManifest(args)` produces a fresh manifest with `version: MANIFEST_VERSION`, the supplied `lastDocumentedCommit`/`snapshotHash`/`pendingBatch`, and `updatedAt` set to `new Date().toISOString()` at the moment of construction. It is a pure builder — it does not touch the filesystem.

`writeManifestIfChanged(repoRoot, manifest)` returns `Promise<boolean>`. It calls `readManifest` first, and if the current manifest is byte-equivalent per `manifestsEqual`, it returns `false` without writing. Otherwise it serializes with `JSON.stringify(manifest, null, 2) + "\n"` and writes through `safeIo.writeText` under the `livewiki/` allowlist. The boolean return is the CI anti-loop signal: `true` means a write happened, `false` means the on-disk copy was already in sync.

`manifestsEqual(a, b)` compares `version`, `snapshotHash`, `lastDocumentedCommit`, and `pendingBatch` via `pendingBatchEqual`. It intentionally does **not** compare `updatedAt` — every call would otherwise produce a fresh `updatedAt` and force a rewrite on every invocation, defeating the anti-loop. `pendingBatchEqual` is `null`-safe: two `null`s are equal, a single `null` against a value is not, and otherwise the four fields (`runId`, `stage`, `done`, `total`) must match.

The test helper `writeLivewikiFile(relPath, content)` (declared inside `manifest.test.ts`) joins onto a per-test temp `repoRoot`, creates parent directories, and writes the file — it is the fixture primitive the other manifest tests build on.

## Manifest snapshot hashing

<!-- lw:anchors packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

`computeSnapshotHash(repoRoot)` returns `Promise<string>`. It walks `livewiki/` recursively through `listFiles`, drops the manifest's own filename, sorts the remaining relative paths alphabetically, then for each path concatenates `"<relpath>\n<sha256(content)>\n"` into a single buffer and returns `sha256(buffer)`. The function does not throw when `livewiki/` is empty or missing — the path simply contributes zero entries, and the hash is taken over an empty string. The visible exception in the excerpt is the `try { ... } catch { continue }` inside `listFiles`, which silently swallows `readdir` errors per directory rather than aborting the whole walk.

`listFiles(dir)` does an iterative depth-first walk using an explicit stack. It pushes directories onto the stack and records file paths as forward-slash relative paths from the root. Each `readdir` is wrapped so a single unreadable subdirectory is skipped, not propagated.

## Markdown code masking

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine -->

The high-level entry point is `export function maskCodeSpans(text: string): string`, which composes the two lower-level maskers: fenced blocks first (so inline-code scanning doesn't see fence content), then inline code spans. The output is shorter than the input — fenced bodies and inline spans collapse to empty runs.

`maskInlineCode(text)` walks the string character by character. When it hits a backtick, it consumes the full backtick run, then scans forward for a closing run of **exactly** the same length (CommonMark requires equal-length match, so `` `code with ` inside` `` is valid). If a matching close is found, every character in the span becomes a single space. If no close is found, the unmatched run is **kept literal** — this is how `hasUnclosedMarkdown` later detects a document that was truncated mid code-span.

`maskFencedCodeBlocks(text)` is a line-by-line state machine. It splits on `/\r?\n/` to stay CRLF-safe (a lone `\n` split would leave a trailing `\r` on each line and break the closing-fence regex), and advances the shared state with `consumeFenceLine`. A matched fence line returns `true` and the line becomes `""`; a non-fence line returns `false` and passes through.

`createFenceState()` and `consumeFenceLine(line, state)` form the state machine. `FENCE_OPEN_RE` matches up to three leading spaces followed by three or more backticks or tildes. On opening, it records the fence character and run length. On subsequent lines, it builds a closing regex that requires the same character, the same minimum run length, and only trailing whitespace — the rest of the line is irrelevant. Any line while inside a fence returns `true` (the whole line, opening or closing, is consumed).

## Length-preserving masking and unclosed-markdown detection

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#boundedExcerpt packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic -->

When the caller needs source offsets to survive (e.g. extracting anchor lines that point into real text), use `maskCodeSpansPreservingLength`. It calls `maskFencedCodeBlocksPreservingLength` and then `maskInlineCode`. The preserving variant walks the string by `\n` indices rather than splitting, handles `\r\n` by stripping the `\r` from the line payload and re-appending the terminator, and replaces a masked line with `" ".repeat(line.length)` so every original index still maps to the same column in the masked view. CRLF terminators land at the exact same offsets they had in the source.

`hasUnclosedFence(text)` is the same state machine used inside `maskFencedCodeBlocks`, but the boolean is the post-walk `state.inFence` flag. `hasUnclosedMarkdown(text)` is the combined detector: it returns `true` if a fence is still open **or** if `maskInlineCode(maskFencedCodeBlocks(text))` still contains a literal backtick (the surviving literal-backtick case is the inline-code-with-no-match signal from `maskInlineCode`).

`unclosedMarkdownDiagnostic(text)` returns a structured `UnclosedMarkdownDiagnostic` (`kind: "fence" | "inline-code"`, `lineNumber`, `offending`, `delimiterLength`) when the document is cut mid Markdown construct. The repair prompt needs three things: which construct is open (the closing rules differ — fence closes with at-least the opening length, inline code closes with exactly the opening length), the 1-based line of the opening delimiter, and a bounded excerpt the prompt can quote back. The excerpt comes from `boundedExcerpt` (cap 200) and is centered on the opening delimiter so a long line whose delimiter sits past column 200 is not silently truncated away.

## Mermaid syntax validation

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

Mermaid's parser needs `window` and `document` even when only parsing. The validator installs a long-lived `JSDOM` document once and reuses it for every call.

`validateMermaidSyntax(source)` returns `Promise<string | null>`. The visible exception path: a parse error is caught and its `message` (or `String(error)` for non-Error throws) is returned as the diagnostic; a successful parse returns `null`. Calls are serialized through a module-level `validationQueue: Promise<void>` — each call chains onto the previous one and replaces the queue head with `result.then(() => undefined, () => undefined)`, so a single rejection does not block subsequent validations.

`parseWithTemporaryDom(source)` saves the current `globalThis.window` and `globalThis.document` (recording whether each existed at all), assigns the shared `parserDom.window` and `parserDom.window.document`, lazy-loads `mermaid` on first use, calls `mermaidInstance.initialize({ startOnLoad: false })`, and finally runs `mermaidInstance.parse(source)`. The `finally` block hands off to `restoreGlobal` to either restore the prior value or `delete` the global — depending on whether it existed at entry.

`restoreGlobal(globals, key, existed, previous)` is the symmetry of the install. If the global existed before the call, it gets the previous value back; if it did not exist, the key is `delete`d from the globals object so the host process is left exactly as it was.

## Heuristic module grouping

<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.test.ts#idFor -->

`identifyModulesHeuristic(filePaths, symbolCountByPath?)` groups files by top-level directory into `Module` records. Each file path is normalized via `normalizeRepoPath` (so the rest of the pipeline can rely on forward-slash input), split into directory and filename, and bucketed by directory. The visible exception: a file with no directory component (the repo root) is bucketed under the empty-string key. After bucketing, the result is sorted by `id` so output is deterministic regardless of input order.

`dirToModuleId(dir, paths, totalDirs)` produces the module's slug. For root-level files, the rule is: if there is exactly one file in the repo and no other directory, the slug is the filename's stem (basename without extension); otherwise the slug is the literal string `"root"`. For any non-empty directory, the slug is the **last** segment of the directory path. The final slug is not guaranteed globally unique here — uniqueness is enforced later by `makeUniqueDeterministicIds`.

`countSymbols(paths, map)` is the per-module total: it sums `symbolCountByPath.get(p) ?? 0` across every path in the module. `fileStem(path)` and `stripNodeNextExtension(p)` are the small path utilities used when a root-level single file needs a stem-based id (the stem is taken from the first `.`-separated segment of the basename, so `index.test.ts` becomes `index`).

`groupPathsByNextSegment(paths)` is the splitter's helper: given a flat list of paths, group by their next path segment (the first segment for a sub-path, the file basename for a leaf). It returns a map from segment to the list of paths that share that segment and is used by the flat-bucket path of `splitOversizedModules`.

The test file declares a small helper, `function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string`, used by assertions to render a module's id for matching.

## Module IDs, uniqueness, and edges

<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport -->

`makeUniqueDeterministicIds(modules)` returns `Module[]` with every id guaranteed unique. `pathSlugOf(m)` is the deterministic candidate for a module: the last path segment if the module has any paths, otherwise the current id. `candidateIdSequence(m)` builds a deterministic sequence of fallback slugs by progressively prepending parent segments of the module's paths — e.g. `core-src`, then `packages-core-src`, and so on. `pathSegmentsFor(m)` exposes the path-segments the sequence is built from. `slugifyIdSegment(s)` and `slugifySegment(s)` lowercase, dash-separate, and trim the input so path characters are safe in a Markdown filename.

`assertUniqueModuleIds(modules)` is the defensive check. If two modules share an id, it throws `DuplicateModuleIdError` (a subclass of `Error` whose `constructor(message: string)` is the only declared member). The runtime path is: a `Map<string, number>` counts id occurrences, the first id with count > 1 produces a `"Duplicate module id: <id>"` message, and the constructor is invoked once. The visible exception is the throw itself; nothing in the excerpt catches it.

`resolveModuleEdges(modules, importsByFile, knownFiles)` returns a deduplicated `ModuleGraphEdge[]` (`{ from, to }`) covering only cross-module edges. For each file, it iterates the import list and uses `resolveRelativeImport` to map a relative specifier (`./`, `../`) onto a known file path; imports that are bare specifiers (e.g. `"express"`) and imports that don't resolve to a known file are dropped. Self-loops (where the resolved file is in the same module) are skipped. The remaining `(from, to)` pairs are stored in a `Set` keyed by `"from|to"` to dedupe parallel imports between the same two modules.

## Role classification and path patterns

<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#resolveSymbolCount -->

`DEFAULT_PATH_ROLE_PATTERNS` and `DEFAULT_FLOW_SIGNAL_PATTERNS` are the two default `Required<…>` config objects exported from the module. They hold the gitignore-style patterns used to mark a path as a `fixture`, a `tool`, a `test`, a `doc`, and so on, and the patterns used to detect a `flow` signal inside a module.

`matchesAnyPathPattern(path, patterns)` is the matcher: it takes a `gitignore`-style pattern list (delegated to the `ignore` package) and returns `boolean`.

`classifyPathRole(path, config?)` returns a `PathRole` for a single path. Without an explicit config it uses `DEFAULT_PATH_ROLE_PATTERNS`; with one, the caller's `PathRoleConfig` overrides. `classifyModuleRole(module, config?)` rolls the per-path classification up to a module: it iterates the module's paths, classifies each, and uses the per-role counts to assign a single `PathRole` to the whole module.

`prioritizeModules(modules, edges)` returns a reordering (not a filter) of the input. It ranks by indegree first (modules that more other modules import rank higher), breaks ties by `symbolCount` descending, and as a final tie-breaker falls back to the module id. The `prioritizeModules` tests exercise the role-aware variant: even with no edges and a higher `symbolCount`, a `fixtures` module is ranked below a product module — and the test that swaps input order asserts the output is identical.

`applyRefinedDisplayTitles(modules, candidates)` accepts the LLM-suggested titles from stage 2 without letting them become identity. Each candidate is run through `normalizeRefinedDisplayTitle(value, moduleId)`: non-strings, short strings (< 4), long strings (> 120), strings with control characters, and strings with no letter are rejected; the normalized title must not equal the normalized module id, and a small blocklist (`["module", "source", "code", "repository-module"]`) drops generic filler. `normalizePresentationLabel(value)` is the shared normalizer (NFKD strip diacritics, lowercase, `[^a-z0-9]+` → `-`, trim leading/trailing dashes). After the per-module filter, any title that collides after normalization is dropped from **all** colliding modules so the navigation falls back to the deterministic title.

`refinePeerDirectoryFragmentationError(...)` rewrites the error message emitted when a directory has many peer subdirectories that produce many thin modules. `assertExactPathPartition(...)` walks every file in the repo, checks that it appears in exactly one module, and throws `ExactPartitionError` (a subclass of `Error` whose `constructor(message: string)` is the only declared member) on violation. The visible exception is the throw; the excerpt does not show a catch.

`resolveSymbolCount(...)` looks up the symbol count for a single path with a fallback; it is used by the splitter and the prioritizer.

## Oversized-module splitting

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#splitOversizedModules -->

`MODULE_SPLIT_DEFAULTS` is the `as const` defaults object: `maxFiles: 12`, `maxSymbols: 80`. `SPLIT_AXIS_DISABLED` is the sentinel for a fully-disabled axis: `Number.MAX_SAFE_INTEGER`. With this sentinel, `fitsLimits` can compare against the limit and any realistic file/symbol count will be "under".

`normalizeSplitLimits(maxFiles?, maxSymbols?)` returns `{ maxFiles, maxSymbols }`. The rules: `undefined` falls back to the `MODULE_SPLIT_DEFAULTS` value for that axis; `0` or a negative number becomes `SPLIT_AXIS_DISABLED` (no cap). `axisEnabled(limit)` is the predicate used inside the splitter to know whether to enforce an axis at all.

`fitsLimits(...)` is the per-axis `≤` check. The visible normal path: a module fits if it satisfies every enabled axis.

`splitOversizedModules(modules, options?)` returns a new `Module[]` where oversized modules have been split. `splitOneModule(...)` is the per-module workhorse: it inspects the module, decides which axis (files or symbols) overflows, and dispatches to a structural split. `chunkFlatBucket(...)` is the leaf path: a flat bucket of files that doesn't share a parent sub-directory is split into equal-sized chunks. The `unsplittable` flag is set on a single-file module that exceeds the symbol cap — the batch still schedules the page, and stage 4 (write of `livewiki/<id>.md`) is expected to bound the context window for that unit.
