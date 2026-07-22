---
title: Livewiki core source — export, flows, frontmatter, gitignore, hashes
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

# Livewiki core source — export, flows, frontmatter, gitignore, hashes

This module is the deterministic transformation and index-helper layer that backs livewiki's wiki output, semantic flow detection, frontmatter parsing, repo `.gitignore` maintenance, and content hashing.

## When to use this page

- Run or extend the deterministic `livewiki/` → `.livewiki/export/<target>/` exporter, its marker scheme, and its preflight/overwrite semantics.
- Tune stage-5 flow candidate detection, frontmatter parsing, `.gitignore` maintenance, or SHA-256 fingerprinting used by the indexer.

## How it fits

`packages/core/src/` holds the synchronous, filesystem- and index-only utilities that the rest of livewiki depends on. `export.ts` reads `livewiki/` through `safe-io`, transforms each page (Markdown header rendering, link rewriting, mermaid placeholder substitution, anchor stripping), and writes a flattened tree under `.livewiki/export/<target>/` while never mutating the source snapshot. `frontmatter.ts` is the YAML-subset parser used by both the exporter and the rest of the indexer. `flows.ts` is a pure function over module lists, edges, per-file symbol keys, and external import specifiers that decides which cross-module product flows qualify for stage 5. `flow-diagram-repair.ts` provides a deterministic, structural truncation of an over-budget flowchart so the LLM does not burn a repair slot on a mechanical fix. `gitignore.ts` keeps `.livewiki/` out of version control per the SPEC's "DB is derived" rule. `hashes.ts` produces the content fingerprints used by the indexer's incremental change detection. Co-located `*.test.ts` files provide the focused unit coverage.

## Export pipeline — targets, errors, and marker format

<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#validateTarget packages/core/src/export.ts#exportWiki packages/core/src/export.ts#errMessage -->

The exporter supports three destinations and refuses anything else. The valid set is fixed and exported:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
]
```

Validation is performed by `validateTarget(target: string): ExportTarget`, which is the only path the public surface uses to accept a target string; an unknown target throws a structured error rather than returning a default. Failures across the exporter funnel through one error class so callers can discriminate by `issues` instead of by message:

```ts
export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) {
    super(issues.map((i) => `${i.code}: ${i.detail}`).join(/* ... */));
    // (truncated; per-issue code/severity/path/detail are preserved on the ExportIssue list)
  }
}
```

Every exported page carries a generated marker that the overwrite/refresh logic keys off. The marker is two exported string constants concatenated around the source-relative path:

```ts
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
```

The marker is searched only in a small header region (`MARKER_HEADER_BODY_LINES = 32` lines), so deeply buried occurrences are not consulted. `errMessage(err: unknown): string` is the project's normaliser used by the exporter to turn arbitrary thrown values into a stable human-readable string; the supplied excerpt does not establish its full behaviour beyond the visible signature.

## Export pipeline — source enumeration and flattening

<!-- lw:anchors packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#flattenPath packages/core/src/export.ts#transformPage packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#stripAnchorMarkers -->

The exporter walks the source tree and then transforms each page individually. `enumerateSourcePages` produces the list of source pages; each entry carries the repository-relative path, the safe-io relative path, the extension, and the raw text. `transformPage` dispatches by extension — Markdown goes through `transformMarkdownPage`, Mermaid diagrams through `transformMermaidPage`. The supplied excerpt truncates the full signatures of these two transform entry points.

```ts
async function enumerateSourcePages(/* ... */)
function flattenPath(rel: string, target: ExportTarget): string
function transformPage(/* ... */)
function transformMarkdownPage(/* ... */)
function transformMermaidPage(page: SourcePage): string
```

For Markdown, the page is first split into raw frontmatter and body via `splitRawFrontmatter(source: string)`, then `stripAnchorsField` removes the `anchors:` field from the frontmatter block so the export contains no anchor metadata, and `stripAnchorMarkers` removes any `lw:anchors` HTML-comment markers that may appear in the body. The final Markdown header is built by `renderMarkdownHeader(source: string, sourceRel: string)`. `flattenPath` collapses the source-relative path into the flat destination name per target (e.g. `livewiki/foo/bar.md` → `foo.bar.md`, with the home page mapped per `HOME_MAPPING`). Collisions on the flat name surface as a `flattening_collision` issue before any write.

## Export pipeline — destination safety preflight, marker detection, and overwrite

<!-- lw:anchors packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#detectMarker packages/core/src/export.ts#buildMarker packages/core/src/export.ts#ensureExtension -->

Before any write, the destination tree is enumerated and each entry classified:

```ts
async function enumerateDestination(/* ... */)
```

The exporter classifies destination entries by the marker carried in the first header lines. `detectMarker(text: string): string | null` reads the marker and returns the source path embedded in it, or `null` if the marker is absent or malformed; `buildMarker(sourceRel: string): string` constructs the marker from a source-relative path. Each planned write therefore answers three questions before touching the filesystem: is the destination a regular file, does it have a valid marker, and does the marker match the source the planner is about to write. `--force` only relaxes one of those — an ordinary, readable, regular file lacking a matching marker is overwritten; symlinks, directories, special files, and unreadable entries are NEVER forceable. `ensureExtension(path: string): string` normalises a destination filename to its expected extension. A preflight failure leaves the destination tree unchanged; an unforeseen filesystem failure during write or removal may leave the export partially updated and is signalled by returning a result with `ok: false` so an idempotent rerun can repair it.

## Export pipeline — link rewriting and mermaid placeholder

<!-- lw:anchors packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#replaceMermaidPlaceholder -->

Internal links are rewritten to point at the flat destination tree rather than the `livewiki/` source tree. The pipeline first parses a link's `href` with `parseLinkHref(href: string): ParsedLink`, then resolves the linked source path with `resolveLinkSource(pathPart: string, sourceRel: string): string`, then rewrites the link list with `rewriteInternalLinks`. The supplied excerpt truncates the full body of `rewriteInternalLinks`; behaviour visible in the surrounding code is that code spans and fenced code blocks are masked (`maskCodeSpansPreservingLength` from `./markdown-mask.js`) before rewriting so links inside code are never rewritten, and a target that the source enumeration cannot find surfaces as a `broken_internal_link` issue. Broken links fail the export — there is no silent skip. Mermaid pages are converted to a placeholder via `replaceMermaidPlaceholder`; if the corresponding diagram is missing from the source snapshot, the export fails with `missing_diagram` before any destination write.

## Export tests — fixture helpers and symlink guard

<!-- lw:anchors packages/core/src/export.test.ts#writeWiki packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#bodyOf packages/core/src/export.test.ts#detectSymlinkSupport -->

The exporter's test file provides focused fixture helpers and a boot-time CI contract guard:

```ts
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: ExportTarget, name: string): Promise<string | null>
async function listDest(target: ExportTarget): Promise<string[]>
async function bodyOf(transformed: string): Promise<string>
async function detectSymlinkSupport(): Promise<boolean>
```

`writeWiki` writes a file under the per-test `repoRoot`; `readDest` reads from `.livewiki/export/<target>/<name>` and returns `null` on miss; `listDest` lists that directory or returns `[]` if it does not exist. `bodyOf` is a test-side accessor for the post-transform body (signature truncated above). `detectSymlinkSupport` is called once at boot and the result drives `it.runIf(canSymlink)` on the symlink-security tests; on a non-Windows host, a `false` result is treated as a CI contract violation and the boot fails with an explicit error rather than silently skipping the regression coverage.

## Flow-diagram repair — flowchart IR, truncation, and re-render

<!-- lw:anchors packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart -->

When a stage-5 flow page produces a flowchart that exceeds the configured node/edge budget, the page would previously be sent back to the LLM for a full repair attempt. This module performs a deterministic, localized structural fix instead:

```ts
export function parseFlowchartMermaid(source: string): FlowchartIR | null
export function truncateFlowchartToBudget(/* ... */)
export function renderFlowchartMermaid(ir: FlowchartIR): string
export function repairOversizedFlowchart(/* ... */)
```

`parseFlowchartMermaid` returns `null` for any diagram kind it does not handle (`sequenceDiagram`, `stateDiagram`, etc.), for any flowchart line that uses chained `&` endpoints, or for any line the deliberately-narrow tokenizer cannot confidently round-trip. The supported subset parses the header (`flowchart TD` / `graph LR`), skips `subgraph` / `end` / `classdef` / `class` / `style` / `linkstyle` / `click` / `direction` directives, captures node shape+label tokens, splits each edge on a longest-operator-first regex (`<-->`, `-->`, `<--`, `-.->`, `-.-`, `==>`, `===`, …), and records optional `|label|` text. A later reference carrying a label that the first bare reference lacked upgrades the recorded shape. `truncateFlowchartToBudget` keeps the first N nodes in appearance order and only edges whose endpoints both survive, capping edges independently when the edge budget is the tighter constraint. `renderFlowchartMermaid` re-emits valid Mermaid from the truncated IR; isolated kept nodes with no surviving edge are emitted as standalone declarations. `repairOversizedFlowchart` is the entry point that decides whether truncation is needed and applies it; on a `null` parse it does not repair, and the caller falls back to the existing LLM-repair path. The repair only mutates the diagram, never the surrounding page prose.

## Flow detection — budgets, signal classification, and path enumeration

<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#normalizeFileMap packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#displayName packages/core/src/flows.ts#buildCandidate -->

Stage 5's product-flow detector is a pure function over index facts. Two exported constants bound the search:

```ts
export const FLOW_PER_ROOT_PATH_BUDGET = 64;
export const FLOW_MAX_PATH_LENGTH = 8;
```

`FLOW_MAX_PATH_LENGTH` caps the length of any enumerated simple path (no repeated module); `FLOW_PER_ROOT_PATH_BUDGET` caps the number of enumerated simple paths per entry root, so a root with many candidate paths cannot starve the others. Path helpers `compareLongestFirst`, `comparePathLex`, and `isProperPrefix` together produce deterministic DFS ordering and the "drop proper prefixes of a longer qualified path" / "keep only the longest path per entry+sink pair" reductions. `computeModuleSignals` derives per-module signals (entry, persistence, external, sink, product role) from in/out-degree and gitignore-style pattern matches over files and external import specifiers; `matchedPatterns` is the shared gitignore-style matcher reused from the path-role classifier. `crossesBoundary(path, signalsById)` is the predicate that gates whether a walk is worth keeping — it must cross at least one persistence or external-boundary module. `isExternalSpecifier(spec)` excludes `node:` and any relative specifier (`.` / `..` / leading `/`) from the external boundary, since the same specifier may be internal in one file and external in another. `isTestPath(path)` is the path-role predicate that decides whether a key is classified as auxiliary rather than product in the seed-key grouping. `buildCandidate` is the per-walk assembler (signature truncated above); `displayName` formats a module id for human-readable signal output; `normalizeFileMap` copies the input file map once so the detector never iterates a user-provided map in insertion order. Input reordering — shuffled module arrays, shuffled edges, shuffled map insertion orders — must produce byte-identical output. A repo with no qualifying walk produces zero candidates and that is a valid outcome, not a failure.

## Flow detection — entry point and seed-key grouping

<!-- lw:anchors packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys -->

The public detector and the seed-key grouping are the two coordinating functions:

```ts
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
function buildSeedKeyGroups(/* ... */)
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups
```

`detectFlowCandidates` is the only entry point: it runs the deterministic DFS over each entry root, unions the qualified walks, applies the proper-prefix and longest-path reductions, ranks candidates by product-role module count descending, then by walk-sharing-module centrality descending, then by slug ascending, and finally applies the `maxFlows` cap (default 4; `0` disables). Each emitted `FlowCandidate` carries `moduleIds`, `slug`, `titleSeed`, the explicit groups (`entryKeys`, `boundaryKeys`, `sinkKeys`, `otherProductKeys`, `auxiliaryKeys`), the closed `seedKeys` list, and an optional `skip` reason decided before any LLM call. `buildSeedKeyGroups` classifies every key of a walk into the five groups above, with the rule that an auxiliary key enters a T1/T2/T3 group only when no product key holds that role; `capGroupsToSeedKeys` is the invariant-preserving truncation that drops keys from any group when they are dropped from the closed list, keeping the union of the five groups equal to `seedKeys` at all times. The seed list itself is filled in two passes: pass 1 reserves one key per non-empty T1/T2/T3 group, pass 2 fills in tier priority T1→T5 (round-robin across the walk's modules, one key per module per round) until `flowMaxAnchors`. Two deterministic skips are decided before any LLM call and recorded on the candidate: `insufficient_anchor_capacity` (the cap cannot fit the mandatory reservation) and `insufficient_section_anchor_coverage` (after pass 1 plus a top-up to three distinct keys, the list still holds fewer than three). Neither is turned into a task.

## Flow tests — fixture builders and deterministic shuffler

<!-- lw:anchors packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap -->

The flow detector's tests need to feed in deterministic but reordered inputs to assert that the detector's output is order-independent:

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
```

`mod` is the minimal `Module` factory used by the tests (only the fields the detector reads). `shuffled` is a deterministic Fisher–Yates driven by an LCG seeded from the caller's `seed`, so the same input array and seed always produce the same permutation. `shuffledMap` is the same shuffle applied to the entries of a map, used to assert that insertion order into `symbolsByFile` / `externalImportsByFile` does not affect the detector's output.

## Frontmatter — YAML-subset parser, error class, and accessors

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

The frontmatter parser is intentionally narrow: top-level keys, string values, lists of strings (block and inline flow-style), and `#` comments. The supported shape includes both the block form and the inline form that LLMs most often emit (`modules: [hooks, services, lib]`). The entry point is:

```ts
export function parseFrontmatter(source: string): ParseResult
```

It normalises line endings to `\n`, detects the opening `---`, locates the closing `---\n`, slices the YAML block, and calls `parseYamlBlock(yaml: string): Frontmatter` to produce the key→string|string[] map. `parseYamlBlock` walks the block line by line, building either a top-level scalar value or a list that collects indented `- value` items until the next key appears. Inline flow-style lists are detected by a leading `[` and trailing `]` on the value, then split on `,` and trimmed; an empty inline list `[]` is preserved as `[]`. A bare value that merely contains brackets (`"[draft] title" trailing`) is not treated as a list. `stripComment(s: string): string` removes an unquoted trailing `# …` so that comments are tolerated mid-block. The supported subset deliberately excludes nested lists, nested maps, multi-line strings, typed booleans/nulls, anchors/aliases, and escape sequences.

Parse failures funnel through one error class:

```ts
export class FrontmatterParseError extends Error {
  public readonly line: number;
  constructor(message: string, line: number) {
    super(`Frontmatter parse error (line ${line}): ${message}`);
    this.name = "FrontmatterParseError";
    this.line = line;
  }
}
```

`getAnchors(fm: Frontmatter | null): string[]` returns the `anchors` list or `[]` if absent or not a list. `getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"` classifies the `owner` field — the supplied excerpt truncates the body of `getOwner`, so its precise classification rules are not exhaustively established here beyond the literal return type. `bodyOffset` on the `ParseResult` is the byte offset into the original source where the body begins (past the closing `---\n`).

## Gitignore — idempotent managed block writer

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

The `.gitignore` writer enforces the SPEC rule that `.livewiki/` must not be committed. It is idempotent and never duplicates an entry it has already added:

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(repoRoot: string, entries: readonly string[]): Promise<EnsureGitignoreResult>
```

`readGitignore` is a thin wrapper that returns `""` when the file is absent. `ensureGitignoreEntries` classifies the existing file into one of three cases — missing (create with the managed block), exists without block (append the managed block, preserving user entries), exists with block (rewrite only the block in place). The managed block is delimited by `# livewiki:start` / `# livewiki:end` markers, which are stable for external parsers. The classification is performed by `extractManagedBlock(content: string): { lines: string[] } | null`, which is tolerant of whitespace around the markers and returns `null` for a truncated block (no end marker) so that the caller falls back to the append path rather than corrupting the file. `mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[]` joins existing lines with new entries, preserves caller order, and skips duplicates by exact trimmed match. `renderBlock(lines: string[]): string` produces the new managed-block string. `replaceManagedBlock(content: string, newBlock: string): string` performs the splice: if a block exists it is replaced in place; otherwise the new block is appended with a `\n\n` separator so a file that does not end with a newline still produces a clean separator. The function reports `{ changed, added }` so the caller can decide whether anything was actually written.

## Hashes — content fingerprinting

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

The hash helpers are the indexer's content fingerprints. They produce lowercase hex (64 chars) without salt; different purposes (files vs symbols) are distinguished by the field name in the index, not by the algorithm:

```ts
export function sha256(content: string | Uint8Array): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

`sha256` accepts either a string or a `Uint8Array` (handy when the caller already has bytes from the filesystem). `sha256Slice` is the symbol-level helper: it hashes the `source.slice(startByte, endByte)` substring only, which lets the indexer detect a local change inside a file without re-hashing the whole file. An empty slice (`endByte === startByte`) hashes the empty string.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency and dependent
- [core library — manifest, markdown masking, mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
