---
title: Export, frontmatter, flows, and hashing primitives
owner: generated
anchors:
  - packages/core/src/export.test.ts#bodyOf
  - packages/core/src/export.test.ts#detectSymlinkSupport
  - packages/core/src/export.test.ts#listDest
  - packages/core/src/export.test.ts#readDest
  - packages/core/src/export.test.ts#writeWiki
  - packages/core/src/export.ts#EXPORT_TARGETS
  - packages/core/src/export.ts#ExportError
  - packages/core/src/export.ts#ExportError.constructor
  - packages/core/src/export.ts#GENERATED_MARKER_PREFIX
  - packages/core/src/export.ts#GENERATED_MARKER_SUFFIX
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/export.ts#ensureExtension
  - packages/core/src/export.ts#enumerateDestination
  - packages/core/src/export.ts#enumerateSourcePages
  - packages/core/src/export.ts#errMessage
  - packages/core/src/export.ts#exportWiki
  - packages/core/src/export.ts#flattenPath
  - packages/core/src/export.ts#parseLinkHref
  - packages/core/src/export.ts#renderMarkdownHeader
  - packages/core/src/export.ts#replaceMermaidPlaceholder
  - packages/core/src/export.ts#resolveLinkSource
  - packages/core/src/export.ts#rewriteInternalLinks
  - packages/core/src/export.ts#splitRawFrontmatter
  - packages/core/src/export.ts#stripAnchorMarkers
  - packages/core/src/export.ts#stripAnchorsField
  - packages/core/src/export.ts#transformMarkdownPage
  - packages/core/src/export.ts#transformMermaidPage
  - packages/core/src/export.ts#transformPage
  - packages/core/src/export.ts#validateTarget
  - packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid
  - packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid
  - packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart
  - packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget
  - packages/core/src/flows.test.ts#mod
  - packages/core/src/flows.test.ts#shuffled
  - packages/core/src/flows.test.ts#shuffledMap
  - packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH
  - packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET
  - packages/core/src/flows.ts#buildCandidate
  - packages/core/src/flows.ts#buildSeedKeyGroups
  - packages/core/src/flows.ts#capGroupsToSeedKeys
  - packages/core/src/flows.ts#compareLongestFirst
  - packages/core/src/flows.ts#comparePathLex
  - packages/core/src/flows.ts#computeModuleSignals
  - packages/core/src/flows.ts#crossesBoundary
  - packages/core/src/flows.ts#detectFlowCandidates
  - packages/core/src/flows.ts#displayName
  - packages/core/src/flows.ts#isExternalSpecifier
  - packages/core/src/flows.ts#isProperPrefix
  - packages/core/src/flows.ts#isTestPath
  - packages/core/src/flows.ts#matchedPatterns
  - packages/core/src/flows.ts#normalizeFileMap
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

# Export, frontmatter, flows, and hashing primitives

This page documents the deterministic core utilities that transform `livewiki/` into a flattened destination tree, parse the YAML-subset frontmatter used across pages, detect semantic cross-module flow candidates, repair oversized Mermaid flowcharts, manage the repo `.gitignore`, and compute content hashes.

## When to use this page

- **Audit** the safe-io preflight and destination marker logic that backs `livewiki export`.
- **Verify** that the YAML-subset parser handles the fields the spec requires (title, owner, anchors, modules).
- **Trace** how cross-module flow candidates are detected from index facts without touching disk or the LLM.
- **Inspect** the deterministic SHA-256 hashing used for incremental index changes and per-symbol slices.

## How it fits

The `packages/core/src/` directory hosts the deterministic transformation and parsing layer of the pipeline. `export.ts` is the Phase 6 Lot 6A writer that flattens the `livewiki/` snapshot into `.livewiki/export/<target>/`, guarded by a safe-io preflight and decorated with a generated marker. `frontmatter.ts` is the YAML-subset parser used by every page reader (including the export's transformation step). `flows.ts` is the pure detector that decides which semantic product-flow pages stage 5 should produce, consuming module graph facts and symbol maps. `flow-diagram-repair.ts` is a localized repair for flow pages whose Mermaid flowchart exceeds the configured budget. `gitignore.ts` keeps `.livewiki/` out of version control. `hashes.ts` provides the content fingerprinting primitives consumed by the indexer.

## Export targets and marker format
<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/export.ts#validateTarget packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#errMessage -->

The export knows three targets, declared in the symbols table as:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
```

Each exported page is decorated with a generated marker built from `GENERATED_MARKER_PREFIX` and `GENERATED_MARKER_SUFFIX` around the source path. `buildMarker(sourceRel)` constructs the marker; `detectMarker(text)` reverses it (header region only). `validateTarget(target)` rejects unknown targets by throwing `ExportError` (constructor takes `issues: ExportIssue[]`); `errMessage(err)` normalizes an unknown thrown value into a string for structured errors.

The excerpt does not establish exhaustive behavior of every failure path; only the visible source-level signatures and intent are documented here.

## Export entry point and preflight
<!-- lw:anchors packages/core/src/export.ts#exportWiki packages/core/src/export.ts#flattenPath packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#transformPage packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage -->

The exported entry point is:

```ts
export async function exportWiki(opts: ExportOptions): Promise<ExportResult>
```

The transform pipeline flattens paths, splits raw frontmatter, strips the `anchors` field and inline anchor markers, rewrites internal links, converts Mermaid placeholders to fenced diagrams, and renders the markdown header. Per-target helpers include `flattenPath`, `enumerateSourcePages`, `enumerateDestination`, `transformPage`, `transformMarkdownPage`, `transformMermaidPage`, `ensureExtension`, `replaceMermaidPlaceholder`, `splitRawFrontmatter`, `stripAnchorsField`, `renderMarkdownHeader`, `stripAnchorMarkers`, `parseLinkHref`, `resolveLinkSource`, and `rewriteInternalLinks`. The source comments warn that a preflight failure leaves the destination unchanged, but unforeseen mid-write filesystem failures can leave the export partially updated (the command returns exit 1 and an idempotent rerun repairs it).

## Export test fixtures
<!-- lw:anchors packages/core/src/export.test.ts#detectSymlinkSupport packages/core/src/export.test.ts#writeWiki packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#bodyOf -->

The export test module bootstraps a per-test temporary repo via `mkdtemp` and tears it down with recursive `rm`. Test fixtures use these helpers:

```ts
async function detectSymlinkSupport(): Promise<boolean>
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: ExportTarget, name: string): Promise<string | null>
async function listDest(target: ExportTarget): Promise<string[]>
async function bodyOf(transformed: string): Promise<string>
```

`detectSymlinkSupport` probes the host's symlink capability once at boot; on any non-Windows host where the probe returns `false`, the module throws a contract-violation error rather than skipping the symlink security regression tests. Visible behavior is the documented CI contract; the excerpt does not establish exhaustive behavior beyond what's shown.

## Flowchart repair
<!-- lw:anchors packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart -->

```ts
export function parseFlowchartMermaid(source: string): FlowchartIR | null
export function renderFlowchartMermaid(ir: FlowchartIR): string
export function truncateFlowchartToBudget(
export function repairOversizedFlowchart(
```

`parseFlowchartMermaid` is a deliberately narrow parser for `flowchart`/`graph` diagrams: it accepts header + simple edges and node declarations, skips `subgraph`/`classdef`/`style`/etc. directives, returns `null` for `&`-chained endpoints, non-flowchart kinds, empty sources, or lines it cannot tokenize. `truncateFlowchartToBudget` keeps only the first N nodes and only edges whose endpoints are both kept. `renderFlowchartMermaid` re-emits valid Mermaid from the IR; `repairOversizedFlowchart` is the deterministic fallback that runs before the LLM repair path on over-budget flowcharts.

The visible source confirms a `null`-on-failure contract; the excerpt does not show every code path inside `truncateFlowchartToBudget` or `repairOversizedFlowchart`.

## Flow candidate detection
<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#normalizeFileMap -->

```ts
export const FLOW_MAX_PATH_LENGTH = 8;
export const FLOW_PER_ROOT_PATH_BUDGET = 64;
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
export function isTestPath(path: string): boolean
```

`detectFlowCandidates` is a pure function over the module list, import graph, symbol map, and external imports map. It computes per-module signals (entry, persistence, external boundary, sink, product role) via `computeModuleSignals` and `matchedPatterns`, enumerates simple-path walks up to `FLOW_MAX_PATH_LENGTH` with a per-root budget of `FLOW_PER_ROOT_PATH_BUDGET`, drops proper prefixes (`isProperPrefix`), keeps only the longest path per entry+sink pair, and ranks candidates deterministically. `isExternalSpecifier` decides which specifiers count as third-party; `crossesBoundary` decides whether a walk crosses at least one persistence or external boundary; `compareLongestFirst`/`comparePathLex`/`buildCandidate`/`displayName`/`normalizeFileMap`/`buildSeedKeyGroups`/`capGroupsToSeedKeys` shape the ranked output and the closed seed-key list that the renderer fills with a deterministic two-pass process.

The module is deterministic under input reordering; the excerpt does not exhaustively describe every branch of the ranking or skip-decision logic.

## Flow test helpers
<!-- lw:anchors packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap -->

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
```

`mod` is a tiny `Module` factory used by `detectFlowCandidates` tests; `shuffled` is a deterministic Fisher–Yates shuffle driven by an LCG so input-ordering tests can produce byte-identical output; `shuffledMap` adapts the shuffle to `Map` construction.

## Frontmatter parsing
<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor -->

```ts
export function parseFrontmatter(source: string): ParseResult
export function getAnchors(fm: Frontmatter | null): string[]
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
export class FrontmatterParseError extends Error {
  constructor(message: string, line: number) { ... }
}
```

`parseFrontmatter` returns `{ frontmatter, body, bodyOffset }`. If the source does not begin with `---\n`, it returns `frontmatter: null` and the original source as body — pages without frontmatter are allowed, not an error. If a closing `---` is missing, the function throws `FrontmatterParseError` (`line` field attached). The internal `parseYamlBlock` supports top-level `key: string`, indented `- item` lists, and inline flow-style lists (`key: [a, b]`). `stripComment` strips a `# ...` trailing comment; `getAnchors` returns the `anchors` list or `[]`; `getOwner` returns the `owner` value, normalized to `"generated" | "human" | "mixed"`.

Documented YAML-subset limitations: no nested lists/maps, no multiline strings, no typed booleans/null, no anchors/aliases, no `\"` escaping.

## `.gitignore` management
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult>
```

`readGitignore` returns the file content or empty string if missing. `ensureGitignoreEntries` is idempotent: when the file is missing it creates a managed block; when the file exists without a block it appends one; when the file exists with a `# livewiki:start` / `# livewiki:end` block it rewrites only that block, preserving user entries outside it. Missing entries are added without duplicating entries already inside the block. `extractManagedBlock` parses the block (returns `null` for a truncated block), `mergeBlockLines` unions existing and new entries while preserving order, `renderBlock` produces the rendered block text, and `replaceManagedBlock` splices the new block back into the file content.

The excerpt does not establish exhaustive behavior when the file exists with malformed markers beyond the `extractManagedBlock` returning `null` fallback documented in the visible source.

## Content hashing
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

```ts
export function sha256(content: string | Uint8Array): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

`sha256` returns a lowercase 64-char hex digest of either a string or a `Uint8Array`; `sha256Slice` hashes `source.slice(startByte, endByte)`, used for per-symbol change detection without re-hashing the whole file. The module uses Node's `crypto`; no salt — fingerprints are content-only.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency and dependent
- [Core module identification, manifest IO, and Markdown masking](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
