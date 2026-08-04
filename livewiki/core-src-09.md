---
title: Safe I/O, section guarding, status reporting, and symbol extraction
owner: generated
anchors:
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
  - packages/core/src/status.ts#anchoredLangs
  - packages/core/src/status.ts#applyFreshness
  - packages/core/src/status.ts#applyRiskRanking
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#collectDegradedPages
  - packages/core/src/status.ts#formatActivityEvent
  - packages/core/src/status.ts#formatDuration
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/status.ts#formatLocalTimestamp
  - packages/core/src/status.ts#formatSnapshotAge
  - packages/core/src/status.ts#run
  - packages/core/src/symbols.ts#attributeRationale
  - packages/core/src/symbols.ts#collectRationaleCandidates
  - packages/core/src/symbols.ts#extractCalleeName
  - packages/core/src/symbols.ts#extractCalls
  - packages/core/src/symbols.ts#extractRationales
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#extractSymbolsWithRanges
  - packages/core/src/symbols.ts#goReceiverTypeName
  - packages/core/src/symbols.ts#groupContiguousBlocks
  - packages/core/src/symbols.ts#isLikelyGenerated
  - packages/core/src/symbols.ts#isRustDocComment
  - packages/core/src/symbols.ts#isTsDocstringComment
  - packages/core/src/symbols.ts#javaCreationTypeName
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#normalizeRationaleText
  - packages/core/src/symbols.ts#rustImplTypeName
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#toSymbolRecord
  - packages/core/src/symbols.ts#walkForCalls
  - packages/core/src/symbols.ts#walkNode
---

# Safe I/O, section guarding, status reporting, and symbol extraction

This page documents the responsibilities of four cooperating modules in `packages/core/src`: `safe-io.ts`, `section-guard.ts`, `status.ts`, and `symbols.ts`.

## When to use this page

- **Audit the disk-write allowlist** when you need to know which paths `safe-io` will accept and which it refuses.
- **Trace a surgical repair call** through `splitH2Sections`, `spliceSections`, and `surgicalRepairTargetSections` to confirm why a section-level edit was accepted or rejected.
- **Inspect a `livewiki status` report** to understand how `collect`, `applyRiskRanking`, `applyFreshness`, and the formatters compose the final `StatusReport` and its human rendering.
- **Understand symbol and call extraction** when adjusting the parser-side rules in `symbols.ts` (kind mapping, key qualification, rationale scraping, generated-file heuristics).

## How it fits

The four files form the on-disk enforcement and reporting surface of the `livewiki` core. `safe-io.ts` is the sole authorized writer; every other module that touches the filesystem routes through `resolveAndValidate`, which combines a fast declared-path check with a realpath-based symlink defense. `section-guard.ts` provides the deterministic split/splice helpers the orchestrator needs around the surgical repair prompt, mirroring the heading-scan idiom of the artifact validator. `status.ts` opens the SQLite index, gathers file/symbol/debt counts, layers on risk ranking and freshness, and formats the result for both machine and human consumers. `symbols.ts` walks tree-sitter ASTs to produce the `SymbolRecord` keys that downstream indexer, debt, and risk code consume, and additionally scrapes rationale evidence and call edges for the livewiki documentation pipeline.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-09.mmd
```

## Safe I/O allowlist and validation

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate -->

`safe-io` is the only module in `packages/core/src` authorized to write to disk. The allowlist is the literal tuple of two directories relative to `repoRoot`:

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

`allowlistFor` extends that tuple with opt-in extras: when `SafeIoOptions.allowPointer` is true it appends `AGENTS.md` and `CLAUDE.md`; when `SafeIoOptions.allowReadme` is true it appends `README.md`. Both flags default to `false`, and the module itself contains no special case for the pointer or readme writes — that decision lives in the Phase 5 `pointer.ts` module and the `readme-export` target respectively.

Two named errors describe every refusal. `PathOutsideAllowlistError` carries `repoRoot`, `attempted`, and `allowlist` (the list produced by `allowlistFor`). `InvalidRelativePathError` carries the rejected `relPath` and a `reason` string. Both extend `Error` and set a `name` for `instanceof` matching.

`allowedAbs(repoRoot, dir)` resolves an `AllowedDir` to an absolute path and throws an internal `Error` if the resolved directory escapes `repoRoot` — a defense-in-depth check that fires only if `ALLOWED_DIRS` is corrupted. `isInsideAllowlist` is a pure function: it uses `nodePath.relative` plus a prefix-and-separator check so that `livewiki-evil` cannot match `livewiki/`. For `allowPointer` it matches exact filenames at `repoRoot` (`AGENTS.md`, `CLAUDE.md`); for `allowReadme` it matches `README.md` at `repoRoot`. The source only checks the equality of the resolved path against the resolved candidate, so prefix-without-equal matches (sibling files) are not accepted.

`validateDeclared` performs the first pass: it rejects absolute `relPath`s, normalizes the path, throws on any `..` segment, and then runs `isInsideAllowlist` on the resolved absolute target. `findDeepestExisting` walks from the declared target back toward `repoRoot` using `existsSync` (synchronous, used only inside this loop) and returns the deepest existing ancestor plus the suffix to reattach. `resolveAndValidate` then canonicalizes `repoRoot` via `realpath` (falling back to lexical resolution when the root does not yet exist), runs `validateDeclared`, asks for the deepest existing ancestor, `realpath`s that ancestor, reconstructs `realAncestor + suffix`, and re-runs `isInsideAllowlist` on the final absolute path. If any of those steps fail, `PathOutsideAllowlistError` or `InvalidRelativePathError` is thrown. The source notes an inherent race window between `existsSync` and `realpath`; on Phase 0 the caller absorbs I/O errors so this is not considered a problem.

## Safe I/O operations

<!-- lw:anchors packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

The five exported operations all call `resolveAndValidate` before touching the disk. The signatures copied verbatim from the source:

```ts
export async function writeText(
  repoRoot: string,
  relPath: string,
  content: string,
  opts: SafeIoOptions = {},
): Promise<void>
export async function readText(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string>
export async function exists(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<boolean>
export async function mkdir(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void>
export async function remove(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void>
```

`writeText` resolves the target, creates the parent directory recursively, then writes UTF-8. `readText` resolves and reads UTF-8. `exists` resolves and tries `nodeFs.access`; if `resolveAndValidate` threw `PathOutsideAllowlistError` it is re-thrown (the source surfaces the security violation rather than swallowing it), while any other error returns `false`. The source comment notes this is intentional: knowing whether a file exists outside `livewiki/` already leaks information. `mkdir` resolves and creates recursively. `remove` resolves and calls `rm` with `recursive: true, force: true`.

## Section guarding

<!-- lw:anchors packages/core/src/section-guard.ts#SURGICAL_REPAIR_ELIGIBLE_CODES packages/core/src/section-guard.ts#slugifyHeading packages/core/src/section-guard.ts#splitH2Sections packages/core/src/section-guard.ts#spliceSections packages/core/src/section-guard.ts#surgicalRepairTargetSections -->

`section-guard` is the deterministic H2 machinery that sits around the surgical repair prompt. `slugifyHeading` is the same lowercase, NFD-stripped, alphanumerics+hyphens slugifier used by the artifact validator; the source comment stresses that this copy MUST stay byte-identical to the private copy in `artifact.ts` so that the `sectionSlug` carried by validation errors lines up. `splitH2Sections` runs the heading scan on `maskCodeSpansPreservingLength(page)` so that `##` lines inside fenced code blocks cannot fake a boundary, then groups H2 sections by walking the masked scan and using each subsequent H2's start as the previous section's end. The result is a `{ prefix, sections }` pair where `sections[i]` carries `slug`, `heading`, `start`, and `end` offsets that map byte-for-byte to the original page.

`spliceSections` is the anti-cascade guard. With `targetSections` non-empty it splits both `original` and `repaired` and returns `null` if the prefixes differ, the section counts differ, or any pair of slugs at the same index differs. It also returns `null` if a target slug is absent or duplicated in either side, or if any non-target section differs byte-for-byte between the two pages. Otherwise it splices in only the target sections using an offset-descending walk so earlier offsets stay valid.

```ts
export function spliceSections(
  original: string,
  repaired: string,
  targetSections: readonly string[],
): string | null
```

`SURGICAL_REPAIR_ELIGIBLE_CODES` is the fixed `ReadonlySet<string>` of codes the surgical prompt may attempt: `missing_page_opening`, `todo_marker_present`, `empty_section`, `broken_internal_link`, `anchor_missing_in_required_section`. `surgicalRepairTargetSections` walks a `ReadonlyArray<ArtifactValidationError>` and returns the deduplicated target slug list when every error carries one of those codes and a resolvable section — either an explicit `sectionSlug`, or for a section-level `missing_page_opening` (location `"body"`) the slug extracted from the message via the internal `SECTION_LEVEL_OPENING_RE`. An empty error set, a disallowed code, an unresolved slug, or any other mismatch returns `null` so the caller falls back to the existing full-context repair path.

## Status reporting

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#applyRiskRanking packages/core/src/status.ts#applyFreshness packages/core/src/status.ts#collectDegradedPages packages/core/src/status.ts#anchoredLangs packages/core/src/status.ts#formatSnapshotAge packages/core/src/status.ts#formatLocalTimestamp packages/core/src/status.ts#formatActivityEvent packages/core/src/status.ts#formatDuration packages/core/src/status.ts#formatHuman -->

`run` is the entry point: it resolves `.livewiki/index.db` via `safe-io.resolveAndValidate`, opens the SQLite handle, calls `collect` to build the base `StatusReport`, layers on `applyFreshness`, then runs `applyRiskRanking` only when `report.debt.items.length > 0`. Incremental token metrics come from `snapshotMetrics` (best-effort; on failure `metrics` stays `null`), and `collectDegradedPages` recounts degraded pages from disk.

```ts
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>
```

`collect` reads active `files` and `symbols` rows, builds `byLang`/`byKind` histograms, computes the top-N by symbol count, derives `tiers` via `anchoredLangs()` (the walker-side `EXTENSION_LANG` projection, intentionally import-light), and reads debt rows using `COALESCE` against both the durable debt columns and the live anchor joins so that identity survives anchor removal. Undocumented rows are read up to a 20-row sample. `meta` carries `schemaVersion`, `lastIndexedAt`, and `lastLedgerAt`; the `metrics` and `degraded` slots are placeholders filled in by `run` after `collect` returns. `applyRiskRanking` loads config defensively (config-read failure → defaults), recomputes imports on demand for anchored-tier files only, computes test coverage and fan-in, optionally pulls git churn, attaches `risk` to each item, and reorders items via `compareByRisk`. `applyFreshness` stats the indexed files only — never a repo walk — and sets `meta.snapshotAgeMs`, `meta.stale`, and `meta.staleChangedFiles`; an unindexed repo keeps `snapshotAgeMs` `null` and `stale` `false`.

The formatters turn the report into a single human-readable string. `formatSnapshotAge`, `formatLocalTimestamp`, `formatActivityEvent`, and `formatDuration` are small presentation helpers; `formatHuman(report)` is the public aggregator that strings the sections together for the CLI's human mode.

## Symbol extraction

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#extractSymbolsWithRanges packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord -->

`extractSymbols` is the public entry point; `extractSymbolsWithRanges` is the range-preserving variant consumed by the indexer for per-symbol EOL realignment. Both share the same walker and dedup rule: candidates are sorted by `(start_line, source_start_byte, discoveryOrder)` and the first record with each `key` wins. Anonymous functions and classes declared inside a function body are skipped at the walker level (`walkNode` sets `insideFunctionBody` whenever it descends into a function-like node and short-circuits on `class_declaration`/`class_definition`). This skip matters: sibling test methods commonly repeat local class names, and the dedup would otherwise silently drop all but the first.

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
export function extractSymbolsWithRanges(
  tree: Tree,
  relPath: string,
  source: string,
): Array<SymbolRecord & SymbolRange>
```

`walkNode` recognizes TS function/class/method/export shapes (where `export class`/`export function` emit a single class or function entry — not a separate `export` — and `export const` emits an `export` entry per declarator), Python `function_definition` and `class_definition` (qualified by enclosing class), and recurses into class bodies to attach parent qualifiers. `makeRecord` produces an `ExtractedSymbol` carrying the AST byte range plus the `signature` slice; `toSymbolRecord` strips the `SymbolRange` to produce the persisted shape.

## Per-language symbol kind mapping

<!-- lw:anchors packages/core/src/symbols.ts#goReceiverTypeName packages/core/src/symbols.ts#rustImplTypeName packages/core/src/symbols.ts#javaCreationTypeName -->

`goReceiverTypeName` strips a leading `*` from a Go method receiver so `*T` resolves to `T` for key qualification. `rustImplTypeName` resolves the type name of a `function_item` inside an `impl_item` — both `impl T` and `impl Trait for T` qualify the method under `T` so the produced key is callable on `T`. `javaCreationTypeName` resolves the right-most `type_identifier` from an `object_creation_expression`'s type field, used so `new X()` produces a symbol key named `X` and matches the same policy as TS `new_expression`.

## Call extraction

<!-- lw:anchors packages/core/src/symbols.ts#extractCalls packages/core/src/symbols.ts#walkForCalls packages/core/src/symbols.ts#extractCalleeName packages/core/src/symbols.ts#signatureFor -->

`extractCalls(tree, relPath, source)` returns a `CallRecord[]` derived from the same AST; `walkForCalls` is the dedicated walker. `extractCalleeName` returns a `{ name, confidence }` where `confidence` is one of `"extracted"` or `"inferred"`. A bare callee identifier (Go, Rust call_expression, Java method_invocation with no receiver, TS call_expression with no field) is `extracted`; anything with a receiver form (`x.m()`, `Type.m()`, `a.b.m()`, scoped identifiers, field expressions, generic functions) is `inferred` from the right-most name. `signatureFor` slices a representative header from the source via the node's byte range; returns `null` when the slice would be empty or out of range.

## Rationale evidence

<!-- lw:anchors packages/core/src/symbols.ts#extractRationales packages/core/src/symbols.ts#collectRationaleCandidates packages/core/src/symbols.ts#isTsDocstringComment packages/core/src/symbols.ts#isRustDocComment packages/core/src/symbols.ts#normalizeRationaleText packages/core/src/symbols.ts#groupContiguousBlocks packages/core/src/symbols.ts#attributeRationale packages/core/src/symbols.ts#isLikelyGenerated -->

`extractRationales` returns rationale candidates for a file: `collectRationaleCandidates` walks the AST and accumulates raw blocks; `isTsDocstringComment` accepts JSDoc-style comments and rejects plain `//` comments, `isRustDocComment` accepts `///` and `//!` doc comments and rejects ordinary `//`. `normalizeRationaleText` strips leading `*` markers (Rust/TS doc style) and, for Python docstrings, the surrounding triple quotes; non-Python input keeps the comment markers as-is. `groupContiguousBlocks` merges consecutive candidate lines into a single rationale block. `attributeRationale` binds each block to the immediately following declaration and the file-level lead; rationale text is untrusted intent context and never a source of anchor keys. `isLikelyGenerated` is a content heuristic (looking for `// Code generated` / equivalent markers) used to skip scraped rationale from generated files.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependent
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependency and dependent

> Coverage note: this module's source (4 files, ~91k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
