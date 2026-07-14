---
title: core-src-02
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MAX_TIMEOUT_MS
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#assertValidTimeoutMs
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
  - packages/core/src/diagrams.ts#classIdentity
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#mermaidMemberName
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
---

## Batch orchestration entry points
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#buildFairTruncatedSource -->

`runBatch` is the principal entry point; it delegates to the internal
`orchestrate` helper with `mode: "run"`. `resumeBatch` continues an
interrupted run (`mode: "resume"`). `runOnly` re-runs a single task
(`mode: "only"`) and requires `opts.onlyTarget`; it preserves manual
content byte-for-byte and refuses `owner: human`. `statusToExitCode`
translates a run status into a process exit code. `buildFairTruncatedSource`
produces a code excerpt for stage-4 prompts under a configurable character
budget.

## Batch errors, usage accumulation, and tasks
<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules -->

`EmptyPipelineError` is thrown when there are no modules to document; its
constructor accepts a message. `TaskError` carries a code and message pair
for per-task failures. `emptyUsage`, `aggregateTotals`, and
`accumulateUsage` handle stage-level token accounting (zero usage,
combine two usage totals, fold a single attempt into a running total).
`getOrCreateTask` and `createOrGetTask` manage checkpoint rows for a run.
`safeJsonParse` parses JSON without throwing. `validateRefinedModules`
verifies a stage-2 LLM refinement against the heuristic baseline.

## Collection, frontmatter, and manual-block handling
<!-- lw:anchors packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#getFileIdsForModule -->

`collectAllImports` walks the import graph for the repo. `readOwnerFromFrontmatter`
returns a `PreOwnerCheck` describing the current owner tag, and
`forceOwnerInFrontmatter` rewrites an existing page to use either
`"generated"` or `"mixed"` (never `"human"`). `extractManualBlocksBySection`
and `injectManualBlocksBySection` move `lw:manual` regions between the old
file and the new generated content; `slugifyHeadingText` and
`sectionRangeOf` compute the heading anchors and byte ranges they rely on.
`getFileIdsForModule` resolves the file rows that belong to a module.

## Verification, diagnostics, and stage-4 generation
<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

`tryWriteAndVerify` performs the transactional write pipeline (snapshot,
write, verify, restore on failure). `verifyIssuesToValidationErrors`
normalizes verifier issues into the artifact's validation error shape.
`summarizeLlmDiagnosticError` and `summarizeVerifyDiagnosticErrors` produce
short error summaries for the run report. `diagnosticAttempt` drives a
single bounded repair cycle; `attemptStage4Generation` is the full
stage-4 loop with repair attempts and non-consuming incomplete retries.
`computeCostFromUsage` converts usage into USD, `buildModuleDocContext`
assembles the per-module prompt context, and `finalizeRun` plus
`buildResult` produce the final `BatchRunResult`.

## Config constants and validation
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#validateConfigForBatch -->

`CONFIG_DEFAULTS` is the in-memory defaults object applied at runtime
(language, supported file extensions, base URLs per provider, repair
limits, token budgets, split thresholds, timeout). `CONFIG_PATH` and
`CONFIG_FILENAME` identify `.livewiki/config.json`. `MAX_TIMEOUT_MS` is the
safe upper bound for `setTimeout` (2,147,483,647). `assertValidTimeoutMs`
narrows an unknown into a non-negative integer within that bound.
`MissingProviderConfigError` is thrown when `provider` and/or `model`
are absent; its constructor records the repo root and which fields are
missing. `validateConfigShape` enforces shape rules (including integer
ranges for repair/split/timeout knobs), and `validateConfigForBatch`
performs the final pre-flight check before LLM work begins.

## Config load, save, and provider resolution
<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl -->

`loadConfig` reads `.livewiki/config.json`, returning an empty config
when the file is absent. `saveConfig` writes it back. `applyDefaults`
fills runtime defaults without persisting them. `resolveProviderFromConfig`
derives the provider/adapter/base URL/env var/pricing tuple, honoring
preset overrides. `resolveBaseUrl` returns the base URL for HTTP calls,
preferring `config.baseUrl` over the per-provider default.

## SQLite schema, migrations, and index opening
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

`CURRENT_SCHEMA_VERSION` is the version the writer expects (4);
`SCHEMA_VERSION_KEY` is the row key under `meta`. `SCHEMA_SQL` is the
full idempotent schema (files, symbols with a partial unique key on
`status='active'`, meta, anchors, debt, undocumented, batch_runs,
batch_tasks, doc_pages, manual_blocks, plus the supporting indexes).
`MIGRATION_SQL_V3` is the v2→v3 migration script (adds `debt.symbol_key`,
rebuilds `symbols` to drop the inline UNIQUE, and creates the partial
indexes). `migrateV3ToV4` adds `finished_at`, `started_by`, and
`summary_json` to `batch_runs` (guarded by `PRAGMA table_info`) plus the
`batch_runs`/`batch_tasks` indexes. `migrationsFor` returns the per-version
migration steps between two versions, `postV3Migrations` runs the
post-v3 chain, and `openIndex` opens (and migrates) the on-disk SQLite
file.

## Mermaid diagram generation
<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`moduleSlug` produces a lowercase, filesystem-safe slug from a module
identifier. `generateStructure` emits `architecture/structure.mmd` from
the file tree. `generateModulesGraph` emits `architecture/modules.mmd`
from `ModuleGraphEdge`s. `generateClassDiagram` emits
`diagrams/<module>.classes.mmd`, grouping methods by `classIdentity`
(whitespace-stable, file-scoped). Internal helpers `mermaidId`,
`mermaidMemberName`, and `escapeLabel` normalize identifiers, member
names, and quoted labels so the output stays parseable.

## Frontmatter parsing
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`FrontmatterParseError` is thrown for malformed blocks; its constructor
takes a message and 1-based line number. `parseFrontmatter` returns
`{ frontmatter, body, bodyOffset }` and returns `frontmatter: null` when
the source does not start with `---\n`. `parseYamlBlock` implements the
limited YAML subset (top-level keys, string values, `- item` lists) and
delegates comment stripping to `stripComment`. `getAnchors` returns the
`anchors` list (or `[]`), and `getOwner` returns the owner tag narrowed
to `"generated" | "human" | "mixed"`, defaulting to `"generated"`.

## `.gitignore` managed block
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`readGitignore` returns the file contents (or `""` when it does not
exist). `ensureGitignoreEntries` is the idempotent writer: it ensures
the requested entries are present inside the `# livewiki:start` /
`# livewiki:end` managed block, creating the block when none exists and
reporting which entries were added. `extractManagedBlock` parses the
block (or returns `null` if truncated). `mergeBlockLines` unions
existing and new entries while preserving order and dedupping case-
sensitively after `trim`. `renderBlock` formats the block, and
`replaceManagedBlock` swaps it in place or appends it.

## Content hashing
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`sha256` returns a lowercase hex digest of either a string or `Uint8Array`.
`sha256Slice` hashes the byte range `[startByte, endByte)` of a string —
used by the indexer to detect symbol-local changes without re-hashing
the entire file.