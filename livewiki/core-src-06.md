---
title: core-src-06 — module identification, splitting, and navigation metadata
owner: generated
anchors:
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
---

# core-src-06 — module identification, splitting, and navigation metadata

This module is the pipeline that turns a file inventory into stable, sized module buckets and the navigation surfaces that reference them.

## When to use this page

- **Identify** the deterministic module list from a directory of repo-relative paths and tune per-path role patterns.
- **Split** oversized modules into subdirectory chunks or ordinal flat chunks while preserving the exact-path partition invariant.
- **Generate** the wiki's navigation pages (quickstart, tasks, auxiliary, flows, topics) from accepted module pages and topic/flow frontmatter.

## How it fits

`packages/core/src/modules.ts` implements batch stage 2: it groups files by top-level directory, splits co-located test files into sibling `<id>-tests` modules, splits modules that exceed `maxFiles` / `maxSymbols` thresholds, and asserts the result is an exact-path partition with globally unique module ids. It also resolves module-to-module import edges on top of the single file-level resolver and classifies paths by role for downstream ranking.

`packages/core/src/navigation.ts` reads accepted module pages from `livewiki/<id>.md` and the topic/flow/auxiliary hub frontmatter, then renders the reader-facing pages (`quickstart`, `tasks`, `flows/index`, `topics/index`, `auxiliary/index`) and the navigation blocks (`updateModuleNavigateBlocks`, `updateFlowTopicLinks`) injected into each unit page. It parses the H1 + opening responsibility sentence of each module page through a shared `parseModuleOpening` so the quickstart digest and flow-context share one definition of "the opening".

## Diagram

```mermaid
%% livewiki/diagrams/core-src-06.mmd
```

## Module identification and role classification

<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel -->

The heuristic builder groups files by directory and emits a `Module` per group. `PathRole` is derived purely from the file path and influences grouping and ranking only — it never prunes the index.

`export const DEFAULT_PATH_ROLE_PATTERNS: Required<PathRoleConfig> = {` defines the default glob set for role classification; `export const DEFAULT_FLOW_SIGNAL_PATTERNS: Required<FlowSignalConfig> = {` defines the default signal patterns for flow detection. `export function matchesAnyPathPattern(path: string, patterns: string[]): boolean` tests a path against a list of glob patterns. `export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole` returns the role for a single path; `export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole` returns the role for a module (majority vote across its paths). `export function identifyModulesHeuristic(` builds the module list: it groups by top-level directory, separates files classified as `"test"` into sibling `<id>-tests` modules so co-located tests do not inflate product modules, and sorts the output by id for deterministic emission. `function dirToModuleId(dir: string, paths: string[], totalDirs: number): string` derives the slug from the last directory segment (or `"root"` for a top-level file when the repo is more than one module). `export function normalizeRepoPath(p: string): string` canonicalises a path to forward slashes with no leading `./`. `export function applyRefinedDisplayTitles(` accepts advisory stage-2 titles without making them part of partition validation; `function normalizeRefinedDisplayTitle(value: unknown, moduleId: string): string | null` rejects strings that are too short, too long, contain control characters, lack any letter, normalize to the module id, or normalize to a generic word (`module`, `source`, `code`, `repository-module`); `function normalizePresentationLabel(value: string): string` strips diacritics, lowercases, and collapses non-alphanumerics into dashes. Duplicate normalized titles across modules are dropped so the display layer falls back to its deterministic title.

## Partition invariants and uniqueness

<!-- lw:anchors packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension -->

The module list must be an exact partition of the expected path set and every id must be unique before stage 4 writes any page.

`export class ExactPartitionError extends Error {` is thrown when the partition is violated; its `constructor(message: string)` sets `name = "ExactPartitionError"`. `export function assertExactPathPartition(` enforces: every module is non-empty, every module path is in the expected set, no path appears in two modules, and no expected path is missing. `export function assertUniqueModuleIds(modules: Module[]): void` guards the W-gate by throwing `DuplicateModuleIdError` on an id collision. `export class DuplicateModuleIdError extends Error {` and its `constructor(message: string)` mirror the partition error. `export function refinePeerDirectoryFragmentationError(` returns a non-null error when stage-2 refinement splits peer files under a single directory across multiple modules — T0 forbids directory-level fragmentation in refine because the deterministic chunker owns size splits. `export function makeUniqueDeterministicIds(modules: Module[]): Module[]` expands the slug right-to-left (e.g. two `src` trees become `core-src` and `cli-src`) until every id is unique. `function pathSlugOf(m: Module): string` returns the base slug; `function candidateIdSequence(m: Module): string[]` enumerates the right-to-left expansions; `function pathSegmentsFor(m: Module): string[]` returns the path segments used for the expansion; `function slugifySegment(s: string): string` and `function slugifyIdSegment(s: string): string` sanitise segments, with the latter capped at 48 characters and falling back to `"part"` when the result is empty. `export function prioritizeModules(` ranks modules for downstream consumption. `export function resolveModuleEdges(` builds a deduplicated, sorted `ModuleGraphEdge[]` from the file-level resolver; self-loops are dropped and edges resolve only between modules that own both endpoints. `export function resolveRelativeImport(` resolves a `./foo` or `../bar` specifier against `knownFiles`, stripping NodeNext-style `.js`/`.jsx`/`.mjs`/`.cjs` extensions before trying `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, and barrel `index.*` / `__init__.py` candidates; `function stripNodeNextExtension(p: string): string` performs the extension strip.

## Oversized module splitting

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount -->

Splitting breaks modules that exceed the LLM page budget into smaller units that still complete with valid frontmatter and verify.

`export const MODULE_SPLIT_DEFAULTS = {` carries `maxFiles: 12` and `maxSymbols: 80`. `export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;` is the sentinel for a disabled axis. `export function normalizeSplitLimits(` maps `undefined` to the defaults and `0`/negative to `SPLIT_AXIS_DISABLED` — note the disable is one-sided: only the upper bound is invalidated; lower bounds are not enforced. `export function splitOversizedModules(` returns a deterministic exact partition of its input: it sorts modules by `(id, first path)`, then walks each module through `splitOneModule`. `function splitOneModule(` short-circuits empty input, marks a single file over the symbol cap as `unsplittable`, leaves intact modules under both limits, and otherwise descends: structural subdirectories become `<id>-<seg>` children, peer leaves flow into a flat bucket, and a single nested directory with no peer leaves is recursed without renaming. `function chunkFlatBucket(` packs sorted peer paths into chunks that respect both enabled limits with ordinal ids (`parent-01`, `parent-02`, …); an individual file over the symbol cap is given its own chunk and marked `unsplittable`. `function groupPathsByNextSegment(paths: string[]): {` returns the longest common prefix length and the map of the next segment to its paths. `function fileStem(path: string): string` returns the dot-less basename. `function fitsLimits(` returns false when an enabled axis is exceeded; `function axisEnabled(limit: number): boolean` reports whether a limit is the `SPLIT_AXIS_DISABLED` sentinel. `function countSymbols(paths: string[], map: Map<string, number>): number` sums per-path entries. `function resolveSymbolCount(` prefers per-path map entries when any path is known and otherwise keeps the module-level fallback so an omitted map does not wipe a known `symbolCount` for an intact module — chunked modules without map data for their paths receive `symbolCount: 0`.

## Page opening parsing and reader digest

<!-- lw:anchors packages/core/src/navigation.ts#MODULE_DIGEST_CAP packages/core/src/navigation.ts#RESPONSIBILITY_MAX_CHARS packages/core/src/navigation.ts#parseModuleOpening packages/core/src/navigation.ts#extractModuleOpeningDigest packages/core/src/navigation.ts#extractModuleResponsibility packages/core/src/navigation.ts#loadModuleDigests packages/core/src/navigation.ts#buildModuleDigestBlock packages/core/src/navigation.ts#synthesizePurposeFromDigests packages/core/src/navigation.ts#buildOrientationBlock packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#sameStrings -->

The quickstart digests accepted module pages into a top-N list of responsibilities.

`export const MODULE_DIGEST_CAP = 6;` caps the quickstart reader digest. `export const RESPONSIBILITY_MAX_CHARS = 240;` caps the length of a single responsibility sentence. `function parseModuleOpening(pageContent: string): ModuleOpeningParts` parses the H1, the paragraph immediately after it, and the `How it fits` block; heading detection runs on a length-preserving masked view so fenced code cannot fake a heading, while text comes from the raw page. `export function extractModuleOpeningDigest(pageContent: string): string` returns the bounded H1 + paragraph + `How it fits` block (cap 1200 chars, appended with `…` when truncated). `export function extractModuleResponsibility(pageContent: string): string | null` returns the single-line paragraph right after the H1, sentence-clipped to `RESPONSIBILITY_MAX_CHARS`; pages without a usable opening contribute `null`. `export async function loadModuleDigests(` walks the prioritised module list in order, filters to `"product"` roles, skips modules whose page is missing, and otherwise reads the responsibility — unreadable pages yield a title-link-only entry, never invented prose. `function buildModuleDigestBlock(moduleDigests: ModuleDigest[]): string[]` emits the `## What you'll find in this wiki` block, re-capping at `MODULE_DIGEST_CAP`. `function synthesizePurposeFromDigests(moduleDigests: ModuleDigest[]): string | null` deterministically composes a no-README purpose from up to three digests with a responsibility (Oxford comma). `function buildOrientationBlock(` composes the `## What this repository is` block: when a stage-5c understanding synthesis is present it is the primary content; otherwise the README purpose wins, falling back to the digest synthesis. `export function generateQuickstart(` stitches orientation, digest, work-by-intent, topic, and workflow sections into the final reader page. `function humanizeSegments(segments: string[]): string` joins segments into a human-readable title; `function normalizeLabel(value: string): string` lowercases and trims for comparison; `function commonDirectory(paths: string[]): string[]` returns the longest common path segments; `function sameStrings(a: string[], b: string[]): boolean` compares two string arrays for set equality.

## Module, flow, and topic presentation loaders

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#groupTasksModules packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#buildModuleCoverageNote packages/core/src/navigation.ts#sumModuleSourceBytes packages/core/src/navigation.ts#moduleSourceExceedsBudget packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#buildNavigateBlock -->

The loaders and generators emit the wiki's navigation pages and the navigation blocks injected into each module page.

`export function buildDisplayTitleFallbacks(` produces a deterministic, role-respecting title per module without changing the module id. `export async function loadModulePresentations(` reads the `livewiki/<id>.md` page when present, parses its frontmatter, and resolves its `owner` and `title`; malformed pages are not trusted as navigation evidence. `export async function loadFlowPresentations(` reads every `livewiki/flows/<slug>.md` (excluding `index.md`) into a `FlowPresentation` map. `export async function loadTopicPresentations(` reads every `livewiki/topics/<slug>.md` (excluding `index.md`) and validates `title`, `intent`, `modules`, `flows`, `owner`, `kind="topic"`, and `order` against a numeric pattern. `export function generateTasksPage(` emits the `tasks.md` skeleton: a concept-topic section, an end-to-end behavior section, an implementation reference section grouped by directory cluster when more than one exists, and an auxiliary-work pointer. `function groupTasksModules(productModules: Module[]): TasksModuleGroup[]` clusters modules by their common directory for the grouped contract. `export function generateAuxiliaryIndex(`, `export function generateFlowsIndex(`, and `export function generateTopicsIndex(` render the corresponding hub pages. `export async function ensureTopicsIndexScaffold(` creates the topics index skeleton when missing. `export async function syncTopicsIndexHub(`, `export async function syncFlowsIndexHub(`, and `export async function syncAuxiliaryIndexHub(` reconcile the hub pages with the on-disk inventory. `function readHubDeclaredOwner(content: string): "generated" | "human" | "mixed" | null` reads the declared ownership from a hub frontmatter. `function compareModules(a: Module, b: Module): number` and `function compareTopics(a: TopicPresentation, b: TopicPresentation): number` provide deterministic ordering for the loaders and generators. `export function buildModuleCoverageNote(fileCount: number, totalBytes: number): string` formats the source-size footer. `async function sumModuleSourceBytes(absRoot: string, module: Module): Promise<number>` totals the bytes of a module's source files. `export async function moduleSourceExceedsBudget(` reports whether a module's source crosses the byte budget. `export function selectRelatedModules(opts: {` picks the related modules surfaced in each module's navigate block. `export async function updateModuleNavigateBlocks(` rewrites the `

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependent

> Coverage note: this module's source (2 files, ~96k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->` block in each module page; `export async function updateFlowTopicLinks(` keeps the related-topic links in flow pages in sync; `function buildNavigateBlock(` composes the rendered block.