---
title: Core Repair, Status, Sectioning, Symbols, and Risk Pipeline
owner: generated
anchors:
  - packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES
  - packages/core/src/repair-contract.ts#PAGE_KINDS
  - packages/core/src/repair-contract.ts#SUPPORTED_FIXES
  - packages/core/src/repair-contract.ts#UNCLASSIFIED
  - packages/core/src/repair-contract.ts#collectUnclassified
  - packages/core/src/repair-contract.ts#formatUnrepairableMessage
  - packages/core/src/repair-contract.ts#isUnrepairableErrorSet
  - packages/core/src/repair-contract.ts#renderActionDirective
  - packages/core/src/repair-contract.ts#renderReportOnlyBlock
  - packages/core/src/risk.test.ts#fakeSpawnError
  - packages/core/src/risk.test.ts#fakeSpawnOk
  - packages/core/src/risk.test.ts#tsImport
  - packages/core/src/risk.ts#bandPoints
  - packages/core/src/risk.ts#collectGitChurn
  - packages/core/src/risk.ts#compareByRisk
  - packages/core/src/risk.ts#computeTestCoverageAndFanIn
  - packages/core/src/risk.ts#derivePathFromSymbolKey
  - packages/core/src/risk.ts#parseGitChurnOutput
  - packages/core/src/risk.ts#runGitLog
  - packages/core/src/risk.ts#scoreDebtItem
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
  - packages/core/src/section-guard.ts#SURGICAL_REPAIR_ELIGIBLE_CODES
  - packages/core/src/section-guard.ts#slugifyHeading
  - packages/core/src/section-guard.ts#spliceSections
  - packages/core/src/section-guard.ts#splitH2Sections
  - packages/core/src/section-guard.ts#surgicalRepairTargetSections
  - packages/core/src/status.test.ts#setupChangedDebtOnBoth
  - packages/core/src/status.test.ts#writeRepoFile
  - packages/core/src/status.test.ts#writeWikiPage
  - packages/core/src/status.ts#anchoredLangs
  - packages/core/src/status.ts#applyFreshness
  - packages/core/src/status.ts#applyRiskRanking
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#collectDegradedPages
  - packages/core/src/status.ts#formatActivityEvent
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/status.ts#formatLocalTimestamp
  - packages/core/src/status.ts#formatSnapshotAge
  - packages/core/src/status.ts#run
  - packages/core/src/symbols.test.ts#parse
  - packages/core/src/symbols.ts#attributeRationale
  - packages/core/src/symbols.ts#collectRationaleCandidates
  - packages/core/src/symbols.ts#extractCalleeName
  - packages/core/src/symbols.ts#extractCalls
  - packages/core/src/symbols.ts#extractRationales
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#extractSymbolsWithRanges
  - packages/core/src/symbols.ts#groupContiguousBlocks
  - packages/core/src/symbols.ts#isLikelyGenerated
  - packages/core/src/symbols.ts#isTsDocstringComment
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#normalizeRationaleText
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#toSymbolRecord
  - packages/core/src/symbols.ts#walkForCalls
  - packages/core/src/symbols.ts#walkNode
---

# Core Repair, Status, Sectioning, Symbols, and Risk Pipeline

This module page describes the livewiki core's mid-stack pipeline: safe filesystem I/O, symbol and rationale extraction from source, deterministic debt risk scoring, surgical H2-section repair, the closed repair contract, and the status reporter.

## When to use this page

- **Review** the repair-contract mapping and surgical-repair eligibility rules before extending the prompt layer with a new `ArtifactValidationCode`.
- **Audit** `safe-io` allowlist checks, error classes, and symlink-revalidation behavior when modifying any code path that writes to disk.
- **Inspect** symbol extraction (`extractSymbols`, `extractSymbolsWithRanges`, `walkNode`, `signatureFor`, `makeRecord`, `toSymbolRecord`) when changing what becomes a `SymbolRecord` in the index.
- **Verify** the risk rubric (`bandPoints`, `computeTestCoverageAndFanIn`, `scoreDebtItem`, `derivePathFromSymbolKey`, `compareByRisk`, `parseGitChurnOutput`, `collectGitChurn`, `runGitLog`) when adjusting how `livewiki status` orders debt.

## How it fits

These eleven files live under `packages/core/src/` and sit between the indexer/DB layer and the CLI/orchestrator layer. `safe-io.ts` is the single authority for any disk write that touches `livewiki/` or `.livewiki/` inside the repo root, and every higher module ultimately funnels through it. `symbols.ts` is what turns a parsed tree-sitter tree into the `SymbolRecord` rows the indexer persists, while `status.ts` is what reads those rows back into the human/JSON status report (with the Etapa 2c risk overlay applied on the fly). `repair-contract.ts` and `section-guard.ts` together gate the surgical repair path: `repair-contract.ts` decides which `ArtifactValidationCode` values have a supported directive per page kind, and `section-guard.ts` decides whether a given error set is eligible for surgical splice and how to splice it safely. Test files (`risk.test.ts`, `safe-io.test.ts`, `section-guard.test.ts`, `status.test.ts`, `symbols.test.ts`) cover the contract surfaces of those modules.

## Repair contract and surgical-repair eligibility

<!-- lw:anchors packages/core/src/repair-contract.ts#ALL_ARTIFACT_VALIDATION_CODES packages/core/src/repair-contract.ts#PAGE_KINDS packages/core/src/repair-contract.ts#SUPPORTED_FIXES packages/core/src/repair-contract.ts#UNCLASSIFIED packages/core/src/repair-contract.ts#collectUnclassified packages/core/src/repair-contract.ts#formatUnrepairableMessage packages/core/src/repair-contract.ts#isUnrepairableErrorSet packages/core/src/repair-contract.ts#renderActionDirective packages/core/src/repair-contract.ts#renderReportOnlyBlock packages/core/src/section-guard.ts#SURGICAL_REPAIR_ELIGIBLE_CODES packages/core/src/section-guard.ts#slugifyHeading packages/core/src/section-guard.ts#spliceSections packages/core/src/section-guard.ts#splitH2Sections packages/core/src/section-guard.ts#surgicalRepairTargetSections -->

`PAGE_KINDS` enumerates the three page kinds (`"module"`, `"flow"`, `"topic"`) that the closed repair contract keys on. `ALL_ARTIFACT_VALIDATION_CODES` is the runtime mirror of the `ArtifactValidationCode` union, used as the iteration set for the exhaustiveness test. `SUPPORTED_FIXES` maps every code to the exact ACTION text the prompt renders (port of the historical if-chains in `prompts.ts`); `UNCLASSIFIED` maps every code that has no supported repair to a one-line reason and is rendered report-only — the model is never asked to repair by guessing (for example, `manual_block_altered` is human content under rule #6).

`renderActionDirective(err, kind)` returns the directive text for one error under the page kind's contract, or `""` when the code is unclassified or the directive does not apply to this exact instance (the caller must already have neutralized `messageSafe` / `offendingSafe`). `collectUnclassified(errors, kind)` returns the distinct unclassified codes present in an error set in first-seen order; codes absent from both maps are tolerated here so a legacy checkpoint code can never crash the loop. `isUnrepairableErrorSet(errors, kind)` is the Etapa 2a early-abort gate: when every error in a non-empty set is unclassified for the page kind, the orchestrator must not burn a paid repair call on it. `renderReportOnlyBlock(errors, kind)` is the report-only prompt block listing the unclassified codes the model must NOT try to fix by guessing; it is empty when every error has a directive. `formatUnrepairableMessage(errors, kind)` formats the human-readable abort message for the early-abort path.

On the section-guard side, `splitH2Sections(page)` splits a Markdown page into its prefix (frontmatter + opening) and H2 sections using the same heading-scan idiom as `artifact.ts` (`maskCodeSpansPreservingLength` keeps fenced `##` lines invisible and gives exact byte offsets on both LF and CRLF). `spliceSections(original, repaired, targetSections)` is the anti-cascade guard: it returns `original` with only the target sections replaced, or `null` when the prefix, non-target sections, or section sequence drifted. `slugifyHeading(text)` must stay byte-identical to the private rule in `artifact.ts` because validation errors carry its output as `sectionSlug`. `surgicalRepairTargetSections(errors, kind)` is the eligibility rule — every error must carry a prose-level code AND a resolvable section (its `sectionSlug`, or for the section-level `missing_page_opening` shape, the section named in the message via `FLOW_FIXES` in `repair-contract.ts`). `SURGICAL_REPAIR_ELIGIBLE_CODES` is the read-only set of codes that satisfy the prose-level part of that rule.

## Safe filesystem I/O

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`ALLOWED_DIRS = ["livewiki", ".livewiki"] as const` is the canonical allowlist (rule #1). The two error classes surface every allowlist violation as a structured exception: `PathOutsideAllowlistError` carries the `repoRoot`, the `attempted` path, and the `allowlist` it was checked against; `InvalidRelativePathError` carries the rejected relPath and a `reason`. `isInsideAllowlist(repoRoot, absPath, opts)` is the pure (no disk) prefix check — it uses prefix-plus-separator matching, not substring, so `livewiki-evil` cannot match `livewiki/`; the optional `allowPointer` flag also matches root-level `AGENTS.md` / `CLAUDE.md` (rule #2, opt-in, pointer phase only), and `allowReadme` matches root-level `README.md` (rule #6: readme-export enforces the marker-block contract before any write reaches `safe-io`). `allowlistFor(opts)` builds the effective allowlist including the pointer/readme filenames; `allowedAbs(repoRoot, dir)` resolves an `AllowedDir` to an absolute path and throws if the literal ever escapes `repoRoot`.

`resolveAndValidate(repoRoot, relPath, opts)` is the only entry point for safe I/O: it realpath-canonicalizes the repo root itself before any allowlist comparison (macOS `/var` → `/private/var`, Windows 8.3 aliases — the allowlist must apply to the real location; falls back to the lexical resolve when the root does not exist yet), then calls `validateDeclared` (rejects absolute paths and `..` escapes), then walks from the target up to the deepest existing ancestor via `findDeepestExisting`, realpaths that ancestor, reconstitutes the final path, and **revalidates** it against `isInsideAllowlist` to close symlink-escape attacks (`livewiki` → `/tmp`, `livewiki/sub` → `../src`, `livewiki/leaf` → `/etc/x`). `writeText`, `readText`, `exists`, `mkdir`, and `remove` are the thin wrappers that delegate to `resolveAndValidate` first and then call `node:fs/promises`. `detectSymlinkSupport()` is the test-only Windows capability probe that runs once per test session — when symlink creation fails (no admin / no Developer Mode), symlink-sensitive tests are skipped via `it.runIf(canSymlink)`.

## Risk-weighted debt prioritization

<!-- lw:anchors packages/core/src/risk.ts#bandPoints packages/core/src/risk.ts#collectGitChurn packages/core/src/risk.ts#compareByRisk packages/core/src/risk.ts#computeTestCoverageAndFanIn packages/core/src/risk.ts#derivePathFromSymbolKey packages/core/src/risk.ts#parseGitChurnOutput packages/core/src/risk.ts#runGitLog packages/core/src/risk.ts#scoreDebtItem packages/core/src/risk.test.ts#fakeSpawnError packages/core/src/risk.test.ts#fakeSpawnOk packages/core/src/risk.test.ts#tsImport -->

```ts
function bandPoints(bands: ReadonlyArray<readonly [number, number, number]>, value: number): number
```

`bandPoints` is the top-down band lookup shared by the fan-in and churn rubric: each band is a `[min, max, points]` triple, and the first band whose range contains `value` wins (out-of-range values yield `0`).

```ts
export function computeTestCoverageAndFanIn(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
}): { coveredByTest: Set<string>; fanIn: Map<string, number> }
```

`computeTestCoverageAndFanIn` resolves file-level import edges via `resolveImportEdges` (relative specifiers only; workspace packages empty) and projects them into two signals: `coveredByTest` (files imported by at least one test file per `isTestPath`) and `fanIn` (count of distinct importer files per imported file). Self-edges are dropped by `resolveImportEdges`, and specifiers that resolve outside `knownFiles` are ignored.

```ts
export function derivePathFromSymbolKey(key: string | null): string | null
export function scoreDebtItem(opts: {
  event: "changed" | "moved" | "deleted";
  tier: "anchored" | "prose" | null;
  coveredByTest: boolean;
  fanIn: number;
  churnCount: number | null;
}): RiskScore
```

`derivePathFromSymbolKey` splits a `${relPath}#${name}` key back into its `relPath` and returns `null` when the key is absent or carries no `#` segment (such items still get event points, with all file-derived factors at `0`). `scoreDebtItem` applies the rubric: event points (`changed=10`, `deleted=10`, `moved=5`); test-gap (`40` for an anchored file with no test importer, `10` flat for prose-tier files since import coverage is not extractable); fan-in via `bandPoints` (`11+→20`, `6–10→15`, `3–5→10`, `1–2→5`); churn via `bandPoints` (`10+→15`, `4–9→10`, `1–3→5`). `null` `tier` zeroes every file-derived factor. `compareByRisk` is the comparator that puts higher `score` first and uses stable fallbacks to keep ordering deterministic.

```ts
export function parseGitChurnOutput(text: string): Map<string, number>
export function collectGitChurn(repoRoot: string, spawnImpl?: SpawnImpl): Promise<Map<string, number>>
function runGitLog(repoRoot: string, spawnImpl: SpawnImpl): Promise<string>
```

`parseGitChurnOutput` parses `git log --name-only --pretty=format:` output into a per-file commit count (`Map<relPath, count>`). `collectGitChurn` calls `runGitLog` with an injectable `SpawnImpl` and degrades gracefully (returns an empty map) when the directory is not a git repo, the churn window is disabled, or the spawn errors — the test helpers `fakeSpawnOk(output, code)` and `fakeSpawnError()` exercise the success and spawn-error paths without touching real git. `tsImport(source)` is the test helper that wraps a relative specifier into the `ExtractedImport` shape (`kind: "ts-import"`) the resolver expects.

## Status reporter

<!-- lw:anchors packages/core/src/status.ts#anchoredLangs packages/core/src/status.ts#applyFreshness packages/core/src/status.ts#applyRiskRanking packages/core/src/status.ts#collect packages/core/src/status.ts#collectDegradedPages packages/core/src/status.ts#formatActivityEvent packages/core/src/status.ts#formatHuman packages/core/src/status.ts#formatLocalTimestamp packages/core/src/status.ts#formatSnapshotAge packages/core/src/status.ts#run packages/core/src/status.test.ts#setupChangedDebtOnBoth packages/core/src/status.test.ts#writeRepoFile packages/core/src/status.test.ts#writeWikiPage -->

`run(repoRoot, opts)` is the top-level entry: resolves the index DB via `safeIo.resolveAndValidate`, opens it, builds the initial report via `collect(db, topN)`, then layers on freshness (`applyFreshness`) and risk ranking (`applyRiskRanking`) only when there is open debt to score. `collect` reads the file/symbol/debt/undocumented/metrics rows and applies `anchoredLangs()` (a `Set` built from `EXTENSION_LANG`, kept import-light so status never pulls web-tree-sitter) to compute the per-language coverage tier (`"anchored"` when a tree-sitter grammar exists, `"prose"` otherwise). The open-debt query COALESCEs `symbol_key` and `wiki_path` from the durable debt columns (`debt.symbol_key`, `debt.doc_page_id` via a second `doc_pages` join) over the anchor-path LEFT JOINs, so deleted-event rows keep their identity after anchor removal (schema v8). `applyFreshness` stats the indexed files only (never a repo walk) and fills `meta.snapshotAgeMs`, `meta.stale`, and `meta.staleChangedFiles`. `applyRiskRanking` recomputes imports on demand and rewrites `debt.items` in `compareByRisk` order, attaching the additive `risk` field — status on a clean repo never parses files because the ranking step is gated on `debt.items.length > 0`. `collectDegradedPages` recounts pages flagged `quality: degraded` in frontmatter directly from disk (recovery tier, Component 2; verify-style walk, never stale).

The formatters produce the human-readable output: `formatHuman(report)` is the multi-line CLI text, `formatActivityEvent(e)` formats a single `UpdateMetric` (used inside the Activity block) — `batch_run` lines end with a wall-clock duration via the private `formatDuration` helper (`45s` / `30m` / `1h12m`), `formatLocalTimestamp(ts)` formats an epoch millisecond as local `YYYY-MM-DD HH:MM:SS`, and `formatSnapshotAge(ms)` formats the age bucket for the freshness line. Test helpers `writeRepoFile(rel, content)`, `writeWikiPage(rel, frontmatter)`, and `setupChangedDebtOnBoth()` build the fixture repo and DB so the populated-report expectations have something to assert against.

## Symbol and rationale extraction

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#extractSymbolsWithRanges packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#extractCalls packages/core/src/symbols.ts#walkForCalls packages/core/src/symbols.ts#extractCalleeName packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#isLikelyGenerated packages/core/src/symbols.ts#extractRationales packages/core/src/symbols.ts#collectRationaleCandidates packages/core/src/symbols.ts#isTsDocstringComment packages/core/src/symbols.ts#normalizeRationaleText packages/core/src/symbols.ts#groupContiguousBlocks packages/core/src/symbols.ts#attributeRationale packages/core/src/symbols.test.ts#parse -->

```ts
export function extractSymbols(tree: Tree, relPath: string, source: string): SymbolRecord[]
export function extractSymbolsWithRanges(tree: Tree, relPath: string, source: string): Array<SymbolRecord & SymbolRange>
```

`extractSymbols` returns the public `SymbolRecord[]`; `extractSymbolsWithRanges` is the same extraction with the AST byte range preserved (`source_start_byte`, `source_end_byte`) so the indexer can re-slice the EOL-normalized file text per-symbol (roadmap item 12). Both share `walkNode`, which descends the tree and emits one record per declaration — top-level `function_declaration` / `generator_function_declaration` (kind `"function"`), `class_declaration` (kind `"class"`), `method_definition` with parent class (kind `"method"`, name `Class.method`), `export_statement` (kind `"export"`), Python `function_definition` and `class_definition`, and `decorated_definition` for Python decorators. Anonymous arrows and IIFEs are skipped (a `SymbolRecord.key` must be referenceable). Classes declared inside a function/method body are also skipped — they are local implementation detail, and emitting them would collide on the same `path#Name` key across sibling methods (a confirmed root cause of recurring `duplicate_anchor` errors, 2026-07-23). `signatureFor(node, source)` returns the first line of the node as the signature slice; `makeRecord` and `toSymbolRecord` are the small constructors that build the `SymbolRecord` / `SymbolRange` from the walker output.

```ts
export function extractCalls(tree: Tree, relPath: string, source: string): CallRecord[]
```

`extractCalls` walks the tree with `walkForCalls` and records call sites; `extractCalleeName(node)` resolves the callee to a `{ name, confidence }` pair (or `null` when the call shape is not recoverable). The rationale side: `extractRationales` walks comments, `collectRationaleCandidates` collects them, `isTsDocstringComment(rawText)` decides whether a JSDoc/TSDoc block counts, `normalizeRationaleText(rawText, pythonDocstring)` strips the comment markers (handles both `/** … */` and Python `""" … """` shapes), `groupContiguousBlocks` merges adjacent lines into one rationale, and `attributeRationale` binds each rationale to the next declaration in source order. `isLikelyGenerated(content)` is the heuristic that flags vendored or generated files so their extracted symbols never leak into the index. The test helper `parse(ext, src)` initializes the parser once per session (via `beforeAll(initParser)`) and returns the `Tree` the extraction tests assert against.

<!-- livewiki:navigate:start -->
## Navigate

- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency and dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency and dependent
- [core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)](core-src-06.md) — dependency

> Coverage note: this module's source (11 files, ~185k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
