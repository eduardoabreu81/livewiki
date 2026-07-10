---
title: "@livewiki/core — indexing, anchors, batch pipeline, LLM adapters"
owner: generated
anchors:
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery
  - packages/core/src/anchor-ledger.test.ts#writeCode
  - packages/core/src/anchor-ledger.test.ts#writeWiki
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/anchor-ledger.ts#collectWikiPages
  - packages/core/src/anchor-ledger.ts#createDebt
  - packages/core/src/anchor-ledger.ts#detectMoves
  - packages/core/src/anchor-ledger.ts#escapeRegex
  - packages/core/src/anchor-ledger.ts#hasOpenDebt
  - packages/core/src/anchor-ledger.ts#hashContent
  - packages/core/src/anchor-ledger.ts#orchestrate
  - packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage
  - packages/core/src/anchor-ledger.ts#run
  - packages/core/src/anchor-ledger.ts#upsertAnchor
  - packages/core/src/anchor-ledger.ts#upsertDocPage
  - packages/core/src/anchor-ledger.ts#upsertUndocumented
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/anchors.ts#isInsideAny
  - packages/core/src/anchors.ts#slugify
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#checkPageOwner
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#generateModuleDoc
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#writeWikiPagePreservingManual
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#openIndex
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#moduleSlug
  - packages/core/src/frontmatter.ts#FrontmatterParseError
  - packages/core/src/frontmatter.ts#FrontmatterParseError.constructor
  - packages/core/src/frontmatter.ts#getAnchors
  - packages/core/src/frontmatter.ts#getOwner
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/frontmatter.ts#parseYamlBlock
  - packages/core/src/frontmatter.ts#stripComment
  - packages/core/src/gitignore.ts#ensureGitignoreEntries
  - packages/core/src/gitignore.ts#extractManagedBlock
  - packages/core/src/gitignore.ts#mergeBlockLines
  - packages/core/src/gitignore.ts#readGitignore
  - packages/core/src/gitignore.ts#renderBlock
  - packages/core/src/gitignore.ts#replaceManagedBlock
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#extractImportsFromTree
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
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
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
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#stripNodeNextExtension
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
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
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
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/walker.test.ts#write
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

# @livewiki/core

`@livewiki/core` is where all of livewiki's logic lives. `@livewiki/cli` and
`@livewiki/mcp` are thin wrappers around this package — see
[cli.md](cli.md) and [mcp.md](mcp.md). The public surface is re-exported
from `packages/core/src/index.ts` as namespaced modules (`hashes`, `walker`,
`parser`, `symbols`, `db`, `indexer`, `status`, `anchorLedger`, `verify`,
`anchors`, `frontmatter`, `pricing`, `llm`, `imports`, `modules`, `diagrams`,
`prompts`, `manifest`, `batch`, `batchStatus`, `init`, `update`,
`updateMetrics`, `pointer`, `presets`, `gitignore`) plus a flat `safe-io` and
`config` surface.

Everything core does operates on one repo (`repoRoot`) and one derived
cache directory, `.livewiki/` (SQLite `index.db` schema v4, plus
`config.json`). The wiki itself — the thing this documentation lives in —
is `livewiki/` at the repo root, and it is the **only** place core is
allowed to write generated docs to.

## Rule #1 — safe-io: the write allowlist

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor -->

Every write in the codebase — CLI commands, the batch pipeline, the MCP
`write_doc` tool — goes through `safe-io.ts`. This is the most
security-relevant file in the project: it is the only module allowed to
touch the filesystem for writes, and it enforces an allowlist of
directories (`ALLOWED_DIRS`: `livewiki/`, `.livewiki/`, and — only when
explicitly enabled — the repo's `AGENTS.md`/`CLAUDE.md` pointer files via
`allowPointer`).

`resolveAndValidate(repoRoot, relPath)` is the gate everything passes
through: it resolves the path relative to `repoRoot`, checks it falls
inside the allowlist (`isInsideAllowlist`), and resolves symlinks via
`findDeepestExisting` + `realpath` (async — there is no sync version) so a
symlink can't be used to escape the allowlist. A path outside the
allowlist throws `PathOutsideAllowlistError`; a malformed relative path
(e.g. containing `..` segments that escape after normalization) throws
`InvalidRelativePathError`. `writeText`/`readText`/`exists`/`mkdir`/`remove`
are the only I/O primitives built on top of this gate — nothing else in
the codebase calls `fs` directly for wiki/cache paths.

## Indexing pipeline: walker → parser → symbols → db → indexer

<!-- lw:anchors packages/core/src/walker.ts#walkRepo packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/parser.ts#initParser packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#listSupportedGrammars packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice packages/core/src/db.ts#openIndex packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/indexer.ts#run packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman -->

`livewiki index` runs the indexing pipeline that everything else depends
on:

1. **`walkRepo`** (`walker.ts`) walks the repo respecting `.gitignore`
   (via `buildIgnore`), classifying files by extension using
   `EXTENSION_LANG` (TS/TSX/JS/JSX/PY today).
2. **`parseSource`** (`parser.ts`) initializes web-tree-sitter
   (`initParser`) and parses each file with the grammar for its extension
   (`grammarForExtension` → `loadLanguage`, grammars loaded from
   `grammarsDir()`). `listSupportedGrammars()` is the source of truth for
   "can livewiki parse this file type".
3. **`extractSymbols`** (`symbols.ts`) walks the parsed AST
   (`walkNode`) and builds symbol records (`makeRecord`) — functions,
   classes, methods, exports — each with a `signature` (via
   `signatureFor`) and a `content_hash` (`sha256`/`sha256Slice` from
   `hashes.ts`) used later to detect unchanged vs. moved vs. changed code.
4. **`openIndex`** (`db.ts`) opens `.livewiki/index.db`, creating it from
   `SCHEMA_SQL` on first run or migrating an older schema forward
   (`CURRENT_SCHEMA_VERSION`, `SCHEMA_VERSION_KEY`; `migrateV3ToV4` +
   `postV3Migrations` are the concrete v3→v4 step — post-v3 migrations are
   plain JS functions that check `PRAGMA table_info` before `ADD COLUMN`,
   because SQLite has no `ADD COLUMN IF NOT EXISTS`).
5. **`orchestrateIndex`** (`indexer.ts`, invoked by `run`) ties the above
   together: walk → read → hash → parse → upsert into `files`/`symbols`,
   marking removed files' symbols as `status='deleted'` (never physically
   deleted — this is what lets `anchor-ledger` detect "moved" symbols
   later). `ensureLivewikiDir` guarantees `.livewiki/` exists before any
   of this runs.

`livewiki index` also runs the anchor ledger (below) as its second step,
so a single `livewiki index` call keeps both the code index and the
wiki's anchor/debt state in sync.

## Anchors, debt, and verify

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

This is the anti-hallucination core of the project. A wiki page anchors
itself to code symbols in two ways (parsed by `extractAnchors` in
`anchors.ts`):

- **Page anchors** — a `anchors:` list in frontmatter (parsed by the
  hand-rolled YAML subset in `frontmatter.ts`; see `parseFrontmatter` /
  `parseYamlBlock` — deliberately not a full YAML parser, just enough for
  `title`/`owner`/`anchors` lists and top-level string keys).
- **Section anchors** — an HTML-comment marker (`lw:anchors` followed by
  a space-separated list of symbol keys) right after a markdown heading,
  associating that heading's prose with specific `symbol_key`s
  (`slugify` turns the heading text into the section's slug). This very
  page uses that mechanism throughout.

**`anchor-ledger.ts`** (`run` → `orchestrate`) is what `livewiki index`
calls after re-indexing code: it walks every `.md` page under `livewiki/`
(`collectWikiPages`), upserts `doc_pages` and `anchors` rows
(`upsertDocPage`, `upsertAnchor`), and diffs the new anchor set against
the previous one to create **debt** (`createDebt`) — `changed` (symbol's
`content_hash` differs), `moved` (same symbol detected at a new location
via hash or name+signature fallback — `detectMoves`), or `deleted`
(symbol no longer exists). Debt is assigned to `agent` or `human`
(`assigneeFor`) based on the page's declared `owner`. When a symbol moves,
the ledger **rewrites the anchor key directly in the markdown**
(`rewriteSymbolKeyInPage`, using `escapeRegex` to build a safe
find/replace) via safe-io — except inside `owner: human` pages or manual
blocks, which are never touched (rule #6). Symbols with zero anchors
pointing at them become rows in `upsertUndocumented`, which is what
`livewiki status --json`'s `undocumented` count reports.

**`verify.ts`** (`run`) is the read-only counterpart, and the one that
matters for CI and for the MCP `write_doc` gate: it re-reads the wiki
**fresh from disk** (never trusts `doc_pages` in the DB for which pages
exist — `collectWikiPages` walks the actual `livewiki/` directory) and
checks every anchor against `symbols WHERE status = 'active'`. Any anchor
key that isn't an active symbol is a `broken_anchor` **error** — this is
deliberate and is the anti-hallucination promise: an LLM-written page that
was never run through `livewiki index` still gets caught. `verify` also
checks that manual blocks are byte-identical to their last-known hash
(`manual_block_altered`), and that internal wiki links resolve
(`resolveWikiLink` handles the three link forms — `livewiki/...`
absolute-in-namespace, `/...` absolute-from-repo-root, and
`./...`/`../...` relative — `isInsideWiki` is the safety barrier against
`..` escaping the wiki namespace; `collectSectionSlugs` supplies valid
`#section` targets). `formatHuman` renders the human-readable report;
exit code is always non-zero on any `error`-severity issue.

## Modules and deterministic diagrams

<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#collectImports packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#prioritizeModules packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#escapeLabel -->

Before the batch pipeline can document a repo, it needs to know what its
"modules" are. `imports.ts` extracts import statements from the
tree-sitter AST (`extractImportsFromTree`, aggregated per-file by
`collectImports`). `modules.ts` turns that into a module graph:
`identifyModulesHeuristic` groups files by directory (`dirToModuleId`),
`resolveModuleEdges` builds import edges between modules —
`resolveRelativeImport` resolves relative import specifiers to actual
indexed files, and `stripNodeNextExtension` strips `.js`/`.jsx`/`.mjs`/
`.cjs` from NodeNext-style specifiers first (so
`import x from "../utils/crypto.js"` correctly resolves to `crypto.ts`).
`prioritizeModules` orders modules by centrality + size for the batch
queue and for `architecture/overview.md`'s module index.

`diagrams.ts` generates the **deterministic** (non-LLM) Mermaid diagrams
that ship in `livewiki/architecture/*.mmd` and
`livewiki/diagrams/*.classes.mmd`: `generateStructure` (file/directory
organogram), `generateModulesGraph` (import graph between modules),
`generateClassDiagram` (per-module class diagram). `moduleSlug`/
`mermaidId`/`escapeLabel` are Mermaid-safe identifier/label helpers. These
diagrams are pure `owner: generated` and regenerate byte-for-byte from the
index — they never go stale in a way `verify` would catch, because they
carry no anchors.

## The batch pipeline: init → batch (4 stages) → generated pages

<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#escapeHtmlId packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#generateModuleDoc packages/core/src/batch.ts#checkPageOwner packages/core/src/batch.ts#writeWikiPagePreservingManual packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#safeJsonParse packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH -->

`livewiki init` (`runInit`) creates the deterministic layout: it computes
a heuristic module plan (`buildPlan`, built on `identifyModulesHeuristic`
+ `prioritizeModules`), writes the deterministic diagrams, generates
`livewiki/quickstart.md` (`generateQuickstartDeterministic`) and
`livewiki/architecture/overview.md` (`generateArchitectureOverview` —
using HTML inline anchors `<a id="...">` via `escapeHtmlId` so the
quickstart's `#<module-id>` links match exactly regardless of markdown
renderer), and — when `--batch` is passed — hands off to `runBatch`.
`init --batch` propagates the batch's exit status through
`InitResult.batchExitCode`.

`runBatch` (in `batch.ts`) is the **4-stage orchestrator**: scan → modules
→ prioritize → document. Each module becomes a task; documentation
generation per task is `generateModuleDoc`, which calls the LLM (see
below) with a prompt built by `buildStage4Prompt`, and writes the result
via `writeWikiPagePreservingManual` — which, true to its name, preserves
any manual block byte-for-byte on regeneration and refuses to overwrite a
page declared `owner: human` (`checkPageOwner`). An opt-in "stage 2" LLM
refinement pass (`buildStage2RefinePrompt`) can propose better module
groupings; `validateRefinedModules` rejects malformed/empty/duplicate
output or refinements covering less than 80% of the heuristic file set,
falling back to the heuristic on any rejection (never a hard failure —
`--no-refine` skips this stage outright).

Failure handling is deliberately lenient at the task level and strict at
the run level: a failing task is marked with a reason and the run
**continues** (`TaskError`), but a **circuit breaker** aborts the whole
run after 3 consecutive failures or when failures exceed 50% with at
least 3 tasks attempted (the `>= 3` floor exists so "1 fail / 0 done"
doesn't look like 100% failure). `statusToExitCode` is the single source
of truth mapping run status to process exit code: `completed` → 0,
`completed_with_failures` → 1, `aborted` → 2. `EmptyPipelineError` guards
against the case where the heuristic found modules but zero tasks ended
up queued — that's forced to `completed_with_failures`, never silently
`completed`. `resumeBatch`/`runOnly` let an interrupted or partially-run
batch continue from a checkpoint (same task-queue interface used by
in-session agents paying doc debt one task at a time).

`batch-status.ts` (`buildStatusReport`, `listRuns`) turns the raw
`batch_runs`/`batch_tasks` checkpoint rows into the `livewiki batch
status`/`batch list` report — usage/cost aggregation
(`aggregateUsageFromCheckpoint`, `mergeStageUsage`) is **token-first**:
tokens are the primary metric, USD is a secondary, clearly-labeled
estimate that's omitted entirely when no pricing entry exists for the
provider/model.

`manifest.ts` (`buildManifest`, `writeManifestIfChanged`) writes
`livewiki/.manifest.json` with a `snapshotHash` — a hash of everything
under `livewiki/` except the manifest itself (`computeSnapshotHash`,
`listFiles`). `writeManifestIfChanged` only rewrites the file if content
actually changed (`manifestsEqual` deliberately ignores the `updatedAt`
timestamp field, otherwise every run would produce a diff and defeat any
CI "no uncommitted changes" check).

## LLM adapters

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`llm/index.ts#createLlmClient` is the factory: given a resolved provider
config it returns either an `AnthropicAdapter` or an `OpenAiCompatAdapter`
(both implement the same `LlmClient` interface — see `llm/types.ts`).
`requestWithRetry` (`llm/base.ts`) is the shared HTTP retry helper
(`isRetryableStatus` decides which HTTP statuses are worth a retry,
`sleep` backs off between attempts). Adding a new provider means writing
one adapter file implementing `LlmClient` and registering it in the
factory — no changes needed elsewhere. `MissingApiKeyError` and
`LlmRequestError` are the two error types callers need to handle
(missing env var vs. request failure).

## Config, presets, and pricing

<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`config.ts` reads/writes `.livewiki/config.json` (`loadConfig`/
`saveConfig`, defaults applied by `applyDefaults` from
`CONFIG_DEFAULTS`). `resolveProviderFromConfig` figures out which
provider+model+baseUrl to use, `validateConfigForBatch` /
`validateConfigShape` fail fast with clear errors — critically,
**there is no hardcoded default model**: `batch` without a valid config
throws `MissingProviderConfigError`, which names `.livewiki/config.json`
and shows an example (`claude-sonnet-5` is only ever an example value in
that error, never a silent fallback).

`presets.ts#PRESET_TABLE` is pure data — 10 provider presets (anthropic,
openai, openrouter, deepseek, kimi, minimax (routed through the Anthropic
adapter for prompt-caching compatibility), gemini, nvidia, ollama,
lmstudio). `resolvePreset`/`resolveProviderConfig` look up a preset by
name and let config override individual fields (`baseUrl`, `pricing`);
`isKnownPreset` guards the lookup, throwing `UnknownPresetError`
otherwise. **API keys are never part of a preset or of `config.json`** —
only read from environment variables — this invariant is what
`key-leak.test.ts` (`assertCanaryNotPresent`) regression-tests: if that
test fails, nothing should be committed.

`pricing.ts#PRICING_TABLE` is an embedded cost-per-token table
(`PRICING_REFERENCE_DATE` documents when it was last updated);
`lookupPricing`/`calculateCostUsd`/`formatCost` turn token usage into an
estimated USD figure — always presented as "estimated, table as of
`<date>`", never as ground truth, and omitted entirely for providers with
no pricing entry.

## Incremental update (Phase 5)

<!-- lw:anchors packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#clearMetricsForTests -->

Where `batch.ts` documents a repo from scratch, `update.ts` supports the
incremental "pay debt for one symbol" flow that the
`document-as-you-go` skill and the MCP `write_doc` path use day to day:
`loadWorkPackage` builds the context an LLM (or an agent) needs to
re-document one changed symbol, `lookupSymbol` finds it in the index,
`snippetForSymbol` extracts just the relevant source slice (bounded by
`CHARS_PER_TOKEN`-based budgeting, matching `prompts.ts`'s token
budgets), and `recordDocWrittenBack` marks the debt resolved once the
page is written. `update-metrics.ts` tracks token spend for this
incremental path separately from batch runs (`recordUpdateMetric`,
`readMetrics`/`writeMetrics`, `snapshotMetrics`; `clearMetricsForTests` is
test-only cleanup).

## Repo-hygiene helpers: gitignore and pointer

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#_internal -->

`gitignore.ts#ensureGitignoreEntries` is what `livewiki init` calls to add
`.livewiki/` to the repo's `.gitignore` — the derived cache must never be
committed (rule #3: the disk under `livewiki/` is the source of truth,
`.livewiki/` is disposable). It's idempotent: entries live inside a
managed block (with start/end marker comments, built by
`renderBlock`/`mergeBlockLines`, located by `extractManagedBlock`,
swapped in place by `replaceManagedBlock`) so re-running `init` is a
no-op if the block is already present, and anything the user added
outside the block is left alone.

`pointer.ts` manages an **opt-in** block in the repo's `AGENTS.md` or
`CLAUDE.md` (`pickPointerFile` chooses which file exists;
`POINTER_START`/`POINTER_END` delimit the start/end marker comments) that
tells an agent livewiki exists and how to use it. Unlike `.gitignore`,
this is never touched automatically — only via the explicit `livewiki
pointer` command / `--write-pointer` flag (rule #2: don't rewrite a
human-owned entry point without asking). `insertPointer`/`removePointer`/
`applyPointerReplace`/`applyPointerRemove` do the actual block surgery;
`readPointerStatus` reports whether a pointer is currently present.

## status.ts: the `livewiki status --json` report

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`status.ts#run` → `collect` assembles the report served by both
`livewiki status --json` and the MCP `livewiki_debt` tool: file/symbol
counts, open debt (from the `debt` table, grouped by event and assignee),
undocumented symbols (from anchor-ledger's `upsertUndocumented`), and
batch/update token metrics. `formatHuman` renders the CLI's non-JSON
view.

## Testing

<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/safe-io.test.ts#detectSymlinkSupport packages/core/src/symbols.test.ts#parse packages/core/src/walker.test.ts#write packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate packages/core/src/llm/adapters.test.ts#fakeFetch packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash packages/core/test/fixtures/fase2-repo/src/auth.ts#extra packages/core/test/fixtures/fase2-repo/src/auth.ts#validate packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

Coverage is 80%+ statements/branches, 90%+ functions. A few critical
regressions have dedicated tests rather than being folded into general
suites: `key-leak.test.ts` (`assertCanaryNotPresent`) asserts an API key
can **never** appear anywhere in output — treat a failure here as a
stop-the-line signal, not something to patch around. `safe-io.test.ts`
(`detectSymlinkSupport`) skips symlink-escape tests gracefully on
platforms/filesystems that don't support them (Windows without dev mode).
`symbols.test.ts`, `walker.test.ts`, `manifest.test.ts`, `update.test.ts`,
`verify.test.ts`, and `anchor-ledger.test.ts` each carry small test-only
helpers (`parse`, `write`, `writeLivewikiFile`, `setupWithAnchor`,
`writeCode`/`writeWiki`, `nodeSqliteQuery`) that build disposable
fixture repos/wiki pages per test. `batch.test.ts#MockLlm` is a fake
`LlmClient` used to drive the 4-stage pipeline deterministically in unit
tests without hitting a real provider; `llm/adapters.test.ts#fakeFetch`
does the same for the HTTP-level adapter tests. The two `test/fixtures/*/
src/auth.ts` files are static sample repos used as indexing fixtures —
not part of livewiki itself, just data the indexer is pointed at in
tests.

## See also

- [cli.md](cli.md) — the `@livewiki/cli` commands built on top of this package.
- [mcp.md](mcp.md) — the `@livewiki/mcp` server exposing this package's
  `status`/`verify`/safe-io/search over MCP.
- [architecture/overview.md](architecture/overview.md) — generated module
  diagrams for this repo.
