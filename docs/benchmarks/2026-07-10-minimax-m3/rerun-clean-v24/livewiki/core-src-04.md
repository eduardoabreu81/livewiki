---
title: Core src 04 — export, frontmatter, flows, hashes, gitignore
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

# Core src 04 — export, frontmatter, flows, hashes, gitignore

This page documents the deterministic transformation layer that turns a `livewiki/` snapshot into a flattened destination tree under `.livewiki/export/<target>/`, together with the supporting modules it composes: YAML-subset frontmatter parsing, SHA-256 content hashing, `.gitignore` maintenance, stage-5 flow-candidate detection, and the localized flowchart-repair helper.

## When to use this page

- **Run** `exportWiki` to flatten the on-disk `livewiki/` snapshot into one of `EXPORT_TARGETS` without touching the source tree.
- **Parse** a page's YAML-subset frontmatter via `parseFrontmatter`, or read its `anchors` and `owner` fields with `getAnchors` and `getOwner`.

## How it fits

These files live in `packages/core/src/` and form the safe-IO compliant export pipeline plus the small utilities it composes. `export.ts` enumerates source pages, rewrites internal links, transforms Mermaid blocks, and writes a flat destination tree stamped with a generated-content marker so subsequent runs can detect drift. `frontmatter.ts` is the YAML-subset parser the exporter and downstream consumers rely on for `title`, `owner`, and `anchors`. `hashes.ts` provides the deterministic content fingerprints used to detect symbol-level changes. `gitignore.ts` keeps the `.livewiki/` cache out of source control idempotently. `flows.ts` and `flow-diagram-repair.ts` are stage-5 helpers that decide which cross-module product flows to document and that surgically shrink an over-budget flowchart without invoking the LLM. The test files exercise each of these surfaces under deterministic, cross-platform contracts (Windows symlink probe, fixture diffing, UTF-8 hygiene).

## Export pipeline

<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#validateTarget packages/core/src/export.ts#exportWiki packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#flattenPath packages/core/src/export.ts#buildMarker packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#detectMarker packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#transformPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#errMessage packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.test.ts#bodyOf packages/core/src/export.test.ts#detectSymlinkSupport packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#writeWiki -->

The supported destinations are enumerated by:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
```

```ts
export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) {
    super(issues.map((i) => `${i.code}: ${i.detail}`).join("\n"));
  }
}
```

`validateTarget(target)` returns a known `ExportTarget` for any string in `EXPORT_TARGETS`, and any other input throws an `ExportError` whose first issue carries the structured `ExportIssue.code === "invalid_target"`. The `ExportError` class captures the full `ExportIssue[]` list passed to its constructor.

The marker used to identify generated destination files is the literal pair:

```ts
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
```

`exportWiki(opts: ExportOptions): Promise<ExportResult>` is the single public entry. It runs a destination preflight (resolving paths through `safe-io`, enumerating current entries, classifying them as regular / unsafe / wrong-marker) before any write. If preflight raises an `ExportError`, the destination tree is left unchanged; an unforeseen filesystem failure during write or removal may leave the derived export partially updated and the command returns exit 1. The contract is honest, not transactionally atomic — an idempotent rerun repairs drift. `enumerateSourcePages` reads the `livewiki/` tree through the safe-io allowlist and constructs a `SourcePage`; `enumerateDestination` reads the current `.livewiki/export/<target>/` tree through `safeIo.resolveAndValidate` and then uses `nodeFs.readdir` to list entries, classifying each as regular-readable / unsafe (symlink, directory, special) / wrong-marker.

Source-path splitting goes through `splitRawFrontmatter` (returns `{ frontmatter, body }`); each entry's frontmatter is re-emitted by `renderMarkdownHeader` after `stripAnchorsField` removes the `lw:anchors` / `anchors` metadata key, so generated docs never leak internal anchor listings to the destination. `stripAnchorMarkers` additionally removes any `lw:anchors` HTML-comment markers from the rendered body. The flattened destination name is produced by `flattenPath(rel, target)` and is collision-checked; any collision surfaces as an `ExportIssue` with code `"flattening_collision"`. `buildMarker(sourceRel)` produces `"<PREFIX><sourceRel><SUFFIX>"`; `detectMarker(text)` scans the first `MARKER_HEADER_BODY_LINES` lines for the matching prefix and returns the source path (or `null` if absent).

`transformPage` dispatches to `transformMarkdownPage` or `transformMermaidPage` based on extension. The Markdown transformer rewrites relative links via `parseLinkHref`, `resolveLinkSource`, and `rewriteInternalLinks` while leaving code spans and fenced code blocks untouched (the exporter masks them via `maskCodeSpansPreservingLength`). The Mermaid transformer delegates to `replaceMermaidPlaceholder` so flowchart or sequence diagrams embedded in the page are produced from the local IR rather than from free-form Mermaid the LLM happened to write. `ensureExtension` re-adds a destination-side `.md` extension when a link lost it during flattening. `errMessage(err)` is the shared formatter that turns an unknown thrown value into a stable error string used in `ExportIssue.detail`.

Unsafe or unreadable PLANNED destination entries (a directory where a file is expected, a symlink escape, a non-regular file) are NEVER forceable — the `force` flag on `ExportOptions` applies only to an ordinary readable regular file that lacks the expected marker or has a marker for another source. An unrelated directory, symlink, special file, or unreadable file whose name is NOT in the planned destination set is left untouched and does not block the export.

The test file `packages/core/src/export.test.ts` provides the helpers used across the suite:

```ts
async function detectSymlinkSupport(): Promise<boolean>
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: ExportTarget, name: string): Promise<string | null>
async function listDest(target: ExportTarget): Promise<string[]>
async function bodyOf(transformed: string): Promise<string>
```

`detectSymlinkSupport` probes via a unique `mkdtemp` directory and removes it in a `finally` block, so a failed Windows symlink attempt cannot leave a stray target file. On any non-Windows host, a probe that returns `false` throws a CI contract violation — the matrix is expected to provide `symlink(2)`. `writeWiki` writes a file into `repoRoot`, while `readDest` and `listDest` round-trip the destination side. `bodyOf` extracts the body for marker checks. The visible excerpt establishes the symlink-probe contract and the target-acceptance assertions; behavior of `exportWiki`'s deeper branches (overwrite refusal, stale-file removal, idempotent rerun, `push` failure) is part of the truncated region and is not exhaustively documented here.

## Flowchart repair

<!-- lw:anchors packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart -->

`flow-diagram-repair.ts` is a deterministic, localized repair for an over-budget stage-5 flowchart. The public surface:

```ts
export function parseFlowchartMermaid(source: string): FlowchartIR | null
export function truncateFlowchartToBudget(
  ir: FlowchartIR,
  maxNodes: number,
  maxEdges: number,
): FlowchartIR
export function renderFlowchartMermaid(ir: FlowchartIR): string
export function repairOversizedFlowchart(
  source: string,
  maxNodes: number,
  maxEdges: number,
): string | null
```

`parseFlowchartMermaid` matches a `flowchart|graph` header, skips `subgraph`/`end`/`classdef`/`class`/`style`/`linkstyle`/`click`/`direction` lines, and tokenizes edges with a longest-operator-first regex so `<-->` never splits into two shorter operators. It returns `null` for any construct it cannot safely round-trip: a different diagram kind, a chained `&` endpoint, a line it cannot cleanly tokenize, or empty source — never a best-effort guess. When a node id first appears bare and later with a label, the later label wins.

`truncateFlowchartToBudget(ir, maxNodes, maxEdges)` keeps the first `maxNodes` nodes in appearance order and only edges whose endpoints are both kept, independently capping edge count. It is idempotent on an already-small IR.

`renderFlowchartMermaid` emits `flowchart <direction>` followed by the kept nodes and edges, with isolated kept nodes written as standalone declarations when no surviving edge remains. The visible test cases confirm that `flowchart TD\n  A[Start] --> B[Middle] --> C[End]` round-trips to three nodes / two edges, and that the label form `-->|go|` survives parse and render.

`repairOversizedFlowchart` parses, truncates to the configured budgets, and renders; it returns `null` when parsing cannot round-trip — the caller falls back to the existing LLM-repair path. A truncation the module cannot prove correct is worse than no truncation at all.

## Flow candidate detection

<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#normalizeFileMap packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap -->

Stage 5 documents a small, capped set of cross-module semantic product flows. The constants:

```ts
export const FLOW_MAX_PATH_LENGTH = 8;
export const FLOW_PER_ROOT_PATH_BUDGET = 64;
```

```ts
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
export function isTestPath(path: string): boolean
```

`detectFlowCandidates` is a pure function over index facts: the module list, the module import graph, active symbol keys per file, and external import specifiers per file. It is deterministic under input reordering — shuffling the modules/edges arrays or map insertion orders must produce byte-identical output. All iteration happens over sorted structures; input maps are only looked up, never iterated (each is copied once via `normalizeFileMap`).

`computeModuleSignals(modules, edges, externalImportsByFile)` derives per-module `entry` (in-degree 0 OR matching entry patterns), `persistence` (file pattern match OR external-import persistence match), `external` (third-party specifiers, excluding `node:` and relative paths via `isExternalSpecifier`), and `sink` (out-degree 0) signals. `matchedPatterns(inputs, patterns)` applies gitignore-style matching (same matcher as `classifyPathRole`); the default patterns come from `DEFAULT_FLOW_SIGNAL_PATTERNS`. Per-occurrence accounting matters: an `(file, specifier)` occurrence with a resolved internal edge in `resolvedEdges` is NOT external — the same specifier may be internal in one file and external in another.

Candidates are simple paths (no repeated module) starting at an entry module, stopped at a sink or at `FLOW_MAX_PATH_LENGTH`, that cross at least one boundary module via `crossesBoundary(path, signalsById)` and have length ≥ 2. Enumeration is a deterministic DFS over sorted module ids and sorted edges, with a per-root budget (`FLOW_PER_ROOT_PATH_BUDGET` enumerated simple paths per entry root) so a single chatty root cannot starve the others. `isProperPrefix(p, q)` plus the longest-path comparison `compareLongestFirst` drop proper prefixes of longer qualified paths and keep only the longest path per entry+sink pair; `comparePathLex` is the deterministic tiebreaker used when paths are otherwise equal.

`buildCandidate` packages the ranked output: ranking is product-role module count desc, then centrality desc (the number of qualified walks sharing at least one module with the candidate), then slug asc. `maxFlows` (default 4; 0 disables) applies only after ranking. `displayName(module)` produces the user-visible module label.

Seed-key classification (R10.1 K) is a two-pass fill that builds five groups per candidate — `entryKeys` (T1), `boundaryKeys` (T2), `sinkKeys` (T3), `otherProductKeys` (T4), `auxiliaryKeys` (T5) — via `buildSeedKeyGroups`. Pass 1 reserves one key per non-empty T1/T2/T3 group; pass 2 fills T1→T5 in round-robin across the walk's modules until `flowMaxAnchors`. `capGroupsToSeedKeys` enforces the invariant: a key truncated from `seedKeys` is dropped from every group, order preserved, and the union of the five groups EQUALS `seedKeys`. Within T1/T2/T3 an auxiliary key enters the group ONLY when no product key holds that role. Two deterministic skip conditions are decided before any LLM call and recorded on the candidate (`skip`): `insufficient_anchor_capacity` (the cap cannot fit the mandatory group reservation) and `insufficient_section_anchor_coverage` (after pass 1 plus a top-up to three distinct keys, fewer than 3 distinct keys remain).

The test helpers in `packages/core/src/flows.test.ts` are:

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
```

`shuffled` is a deterministic Fisher–Yates shuffle driven by an LCG (constants `1664525` and `1013904223`) so input-reordering tests get reproducible orderings. `shuffledMap` is the map-typed wrapper used to exercise the deterministic-map contract. The test suite additionally enforces a `flows.ts` source-hygiene assertion that no literal NUL bytes appear in the source file.

## Frontmatter parser

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

The parser is a deliberately small YAML subset (top-level keys, string lists, comments) so the export pipeline and downstream consumers do not pull in an external YAML dependency:

```ts
export class FrontmatterParseError extends Error {
  public readonly line: number;
  constructor(message: string, line: number) {
    super(`Frontmatter parse error (line ${line}): ${message}`);
    this.name = "FrontmatterParseError";
    this.line = line;
  }
}
export function parseFrontmatter(source: string): ParseResult
function parseYamlBlock(yaml: string): Frontmatter
function stripComment(s: string): string
export function getAnchors(fm: Frontmatter | null): string[]
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
```

`parseFrontmatter` normalizes `\r\n` to `\n`, returns `{ frontmatter: null, body: source, bodyOffset: 0 }` if the page does not start with `---\n` (not an error), and otherwise looks for `\n---` to find the closing fence. The body offset points one past the trailing newline after the closing fence, so `source.slice(result.bodyOffset)` is the markdown body.

`parseYamlBlock` recognizes the supported subset: `key: value` strings, block-form string lists (`  - item`), and inline flow-style lists (`key: [a, b, c]`). Trailing `# comment` text is stripped by `stripComment` before the value is interpreted. Intentionally NOT supported: nested lists, nested maps, multi-line strings (`|`/`>`), quoted inline strings, booleans/null, anchors/aliases, and escape sequences. A list item without a preceding key, a malformed line, or a missing closing fence all throw `FrontmatterParseError` with a 1-based line number.

`getAnchors(fm)` returns the string list stored under the `anchors` key (or `[]` when `fm` is null or the key is missing), and `getOwner(fm)` normalizes the `owner` field to one of `"generated"`, `"human"`, or `"mixed"` — the value the rest of the pipeline uses to decide whether a manual block may be re-injected.

## Gitignore maintenance

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

The `.gitignore` writer enforces SPEC §"Inviolable rules" #3 ("The DB is derived") by ensuring `.livewiki/` (the SQLite cache) is never committed:

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult>
function extractManagedBlock(content: string): { lines: string[] } | null
function mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[]
function renderBlock(lines: string[]): string
function replaceManagedBlock(content: string, newBlock: string): string
```

`readGitignore` is a pure wrapper: returns `""` if the file is missing, otherwise its UTF-8 contents. `ensureGitignoreEntries` is idempotent — it classifies the current file as `file missing`, `file exists without block`, or `file exists with block`, then:

- missing → creates the file with the managed block;
- no block → appends the managed block at the end (preserving user entries and inserting a `\n\n` separator when the file lacked a trailing newline);
- with block → rewrites only the block, preserving surrounding user entries.

The managed block is delimited by the stable markers `# livewiki:start` and `# livewiki:end` (tolerating whitespace). `extractManagedBlock` returns `null` for a truncated block (no end marker), which causes the writer to fall back to append. `mergeBlockLines` keeps the existing entries first, then appends new ones that are not already present (case-sensitive after trim), preserving caller order. `renderBlock` emits the markers and inner lines; `replaceManagedBlock` splices the rebuilt block back into the surrounding content. The function never removes an existing entry (a user may have added it manually) and never duplicates — multiple calls produce a single, stable block.

## Hashing utilities

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

```ts
export function sha256(content: string | Uint8Array): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

`sha256` always returns the lowercase hex digest (64 chars) of the content, accepting either a string or a `Uint8Array` (the `Uint8Array` form is what lets the indexer hash file bytes without first decoding to UTF-8). There is no salt — it is a content fingerprint, not authentication.

`sha256Slice` is the symbol-level helper: it slices `source` by `[startByte, endByte)` and forwards the slice to `sha256`. This lets the indexer detect a change inside a file (a modified function body) without re-hashing the whole file, which would otherwise miss the change. An empty slice (`start === end`) hashes the empty string.