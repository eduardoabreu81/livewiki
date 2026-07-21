---
title: Wiki export, flow detection, and parser helpers
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

# Wiki export, flow detection, and parser helpers

This page is responsible for the deterministic export of the `livewiki/` snapshot to per-target destination trees, the deterministic detection of cross-module semantic product flows, and the small parser/IO helpers (frontmatter, gitignore, hashing, flowchart repair) those two stages depend on.

## When to use this page

- **Run or extend the export pipeline.** Reach for `exportWiki`, `validateTarget`, `EXPORT_TARGETS`, `ExportError`, and the marker helpers (`GENERATED_MARKER_PREFIX`, `GENERATED_MARKER_SUFFIX`, `buildMarker`, `detectMarker`) when shipping `livewiki/` to `generic`, `github-wiki`, or `gitlab-wiki`.
- **Tune flow candidate detection.** Use `detectFlowCandidates`, `FLOW_MAX_PATH_LENGTH`, `FLOW_PER_ROOT_PATH_BUDGET`, and the seed-key group helpers (`buildSeedKeyGroups`, `capGroupsToSeedKeys`, `compareLongestFirst`, `comparePathLex`, `normalizeFileMap`) when stage 5 picks which product flows to render.
- **Repair over-budget flowcharts locally.** Use `parseFlowchartMermaid`, `truncateFlowchartToBudget`, `renderFlowchartMermaid`, and `repairOversizedFlowchart` when an LLM-produced flowchart exceeds the configured node/edge budget.
- **Maintain the core parsing utilities.** Reach for `parseFrontmatter`/`getAnchors`/`getOwner`, the gitignore block helpers (`readGitignore`, `ensureGitignoreEntries`, `extractManagedBlock`, `mergeBlockLines`, `renderBlock`, `replaceManagedBlock`), and the hashing helpers (`sha256`, `sha256Slice`) when wiring new pages or modules to the same invariants.

## How it fits

This module is the `packages/core/src/` slice that powers stage 5 (flow detection) and the post-LLM export stage. `export.ts` reads `livewiki/` and emits a flattened tree under `.livewiki/export/<target>/`, never modifying the source snapshot. `flows.ts` is a pure function over module/edge/symbol/external-import facts — no disk I/O — that decides which cross-module flows deserve a page. `flow-diagram-repair.ts` is a localized mechanical repair for one of the most common stage-5 failures (over-budget Mermaid flowcharts) so the LLM repair budget isn't burned on a non-semantic fix. The remaining files (`frontmatter.ts`, `gitignore.ts`, `hashes.ts`, and their tests) are small, dependency-light utilities consumed across the core module — frontmatter parsing for every wiki page, gitignore management for `livewiki init`, and SHA-256 content/slice fingerprints for the indexer's incremental change detection. The `*.test.ts` files here exercise both happy paths and the security regressions named in the export spec (symlink-escape, overwrite refusal, idempotent rerun).

## Wiki export

<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#validateTarget packages/core/src/export.ts#exportWiki packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#transformPage packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#flattenPath packages/core/src/export.ts#buildMarker packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#detectMarker packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#errMessage -->

The export subsystem transforms the on-disk `livewiki/` snapshot into a flattened destination tree under `.livewiki/export/<target>/` and never writes back to `livewiki/`. The three supported targets are listed by:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
```

`validateTarget(target: string): ExportTarget` accepts any string that is a member of `EXPORT_TARGETS` and rejects anything else. The visible excerpt shows that an unknown target throws `ExportError`; the exported class is declared as:

```ts
export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) { /* joins codes and details */ }
}
```

`exportWiki(opts: ExportOptions): Promise<ExportResult>` is the single public entry point. The contract documented in the source is: the destination preflight runs BEFORE any write, a preflight failure leaves the destination tree unchanged, an unforeseen filesystem failure during write may leave the destination partially updated (the command returns exit 1 and an idempotent rerun repairs it — not a transactional atomic snapshot). Writes, directory creation, removals, and per-file reads go through `safe-io`. `--force` only overrides an ordinary readable regular file that lacks the expected marker or has a marker for another source — unsafe destination entries (symlink escape, directory where a file is expected, non-regular file) are NEVER forceable. An unrelated entry whose name is not in the planned destination set is left untouched and does not block the export.

`exportWiki` is implemented in terms of:

- `enumerateSourcePages(...)` and `enumerateDestination(...)`, which respectively read the `livewiki/` snapshot and the existing destination tree through `safe-io`.
- `transformPage(...)`, which dispatches to `transformMarkdownPage(...)` or `transformMermaidPage(...)` based on the source extension.
- `replaceMermaidPlaceholder(...)`, which substitutes the model-produced Mermaid block for the per-host wiki's expected diagram placeholder.
- `rewriteInternalLinks(...)`, with helpers `parseLinkHref(href: string): ParsedLink`, `resolveLinkSource(pathPart: string, sourceRel: string): string`, and `ensureExtension(path: string): string`. Links are rewritten outside code spans and fenced code blocks (the markdown is masked via `maskCodeSpansPreservingLength` from `./markdown-mask.js`).
- `flattenPath(rel: string, target: ExportTarget): string`, which computes the destination-side flat filename. A collision raises `ExportIssueCode "flattening_collision"`; the excerpt does not establish whether that branch is recoverable with `--force`.
- `renderMarkdownHeader(source: string, sourceRel: string): string`, which inserts the generated marker and strips anchor metadata from the source's own frontmatter via `splitRawFrontmatter(source: string)`, `stripAnchorsField(frontmatterBlock: string): string`, and `stripAnchorMarkers(body: string): string`.

The generated marker is built from two exported string constants:

```ts
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
```

`buildMarker(sourceRel: string): string` concatenates the prefix, the source-relative path, and the suffix. `detectMarker(text: string): string | null` scans the first `MARKER_HEADER_BODY_LINES` (32) lines of the destination text and returns the source path embedded in the marker, or `null` if the marker is absent or malformed.

`errMessage(err: unknown): string` is the small helper used to stringify caught filesystem errors before they are wrapped in `ExportIssue`.

The visible excerpt truncates the bodies of `enumerateSourcePages`, `enumerateDestination`, `transformPage`, `transformMarkdownPage`, `transformMermaidPage`, `flattenPath`, `rewriteInternalLinks`, `parseLinkHref`, `resolveLinkSource`, `ensureExtension`, `splitRawFrontmatter`, `stripAnchorsField`, `stripAnchorMarkers`, `renderMarkdownHeader`, `replaceMermaidPlaceholder`, and `errMessage`; the signatures shown here are the authoritative copy from the symbol table.

## Export security and symlink support

<!-- lw:anchors packages/core/src/export.test.ts#detectSymlinkSupport packages/core/src/export.test.ts#writeWiki packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#bodyOf -->

The export test module ships its own platform-aware helpers and gates symlink-sensitive tests behind them:

```ts
async function detectSymlinkSupport(): Promise<boolean>
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: ExportTarget, name: string): Promise<string | null>
async function listDest(target: ExportTarget): Promise<string[]>
async function bodyOf(transformed: string): Promise<string>
```

`detectSymlinkSupport` probes symlink creation inside a `mkdtemp` directory under `os.tmpdir()` and removes the probe directory in a `finally` block — the source comment is explicit that a failed Windows probe must not leak files into `os.tmpdir()` or produce a false-positive on retry. The same module then enforces a cross-platform CI contract: on `process.platform !== "win32"`, if `canSymlink === false` the test file throws, because a Unix host that cannot create symlinks is treated as a CI contract violation, not a harmless skip.

`writeWiki` writes a source-page fixture under the per-test `repoRoot`. `readDest` and `listDest` mirror the production destination layout at `.livewiki/export/<target>/` and swallow read errors (a missing file or directory returns `null` or `[]`). `bodyOf` is a small wrapper used to read a transformed page's body after the marker has been stripped.

The visible excerpt of `export.test.ts` is truncated before any `describe` block finishes listing the cases it covers (all targets, deterministic flattening and collision failure, anchor metadata removal, link/fragment rewriting, code-span/fence exclusion, Mermaid conversion, broken-link failure, exact generated marker, overwrite refusal and `--force`, stale generated-file removal, idempotent second export, preflight failure leaving the destination unchanged, `--push` failing before any write, and JSON failure exiting 1); the helpers above are what those tests build on.

## Flow detection: signals and paths

<!-- lw:anchors packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#normalizeFileMap -->

```ts
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
function computeModuleSignals(/* opts + module list */)
function matchedPatterns(inputs: string[], patterns: string[]): string[]
function isExternalSpecifier(spec: string): boolean
function crossesBoundary(path: string[], signalsById: Map<string, ModuleSignals>): boolean
function isProperPrefix(p: string[], q: string[]): boolean
function compareLongestFirst(a: string[], b: string[]): number
function comparePathLex(a: string[], b: string[]): number
function buildCandidate(/* modules, signals, opts */)
function displayName(module: Module): string
export function isTestPath(path: string): boolean
export const FLOW_MAX_PATH_LENGTH = 8
export const FLOW_PER_ROOT_PATH_BUDGET = 64
function normalizeFileMap(map: Map<string, string[]>): Map<string, string[]>
```

`detectFlowCandidates` is a pure, deterministic function over four facts: the module list, the module import graph, the active symbol keys per file, and the external import specifiers per file. It does no disk I/O, no DB access, and no LLM calls; shuffling the inputs must produce byte-identical output. Per-module signals are computed by `computeModuleSignals`:

- `entry`: in-degree 0 in the module graph, OR any file matches the entry patterns (gitignore-style, via `matchedPatterns` over `DEFAULT_FLOW_SIGNAL_PATTERNS`).
- `persistence`: any file matches the persistence patterns, OR any file has an external import specifier matching `persistenceImportPatterns` (default empty — no built-in package-name guessing).
- `external`: any file has third-party import specifiers (non-relative, non-`node:`) per `externalImportsByFile`; `isExternalSpecifier(spec)` is the predicate. An absent map means no external signal. Per-occurrence accounting: an occurrence with a resolved internal edge in `resolvedEdges` is NOT external.
- `sink`: out-degree 0 in the module graph.
- `product`: `classifyModuleRole === "product"` (ranking only).

A candidate is a simple path (no repeated module) starting at an entry module, stopped at a sink or at length `FLOW_MAX_PATH_LENGTH = 8`, crossing at least one boundary module (`crossesBoundary`), with length >= 2. Enumeration is a deterministic DFS over sorted module ids and sorted edges, with a PER-ROOT budget (`FLOW_PER_ROOT_PATH_BUDGET = 64` enumerated simple paths per entry root): a root with more paths than the budget is truncated WITHOUT starving the other roots. `isProperPrefix(p, q)` drops proper prefixes of a longer qualified path; `compareLongestFirst` and `comparePathLex` keep only the longest path per entry+sink pair.

Ranking (in order): product-role module count desc, then centrality desc — the number of qualified walks sharing at least one MODULE with the candidate — then slug asc. `maxFlows` (default 4; 0 disables) applies only after ranking. A repo with no qualifying walk produces zero candidates — a valid outcome, not a failure.

`buildCandidate` constructs the candidate record; `displayName(module)` renders a friendly module label; `isTestPath(path)` is the deterministic predicate used to split product vs auxiliary keys; `normalizeFileMap` is the per-input lookup copy so the module never iterates an input map directly.

## Flow detection: seed keys and group capping

<!-- lw:anchors packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys -->

```ts
function buildSeedKeyGroups(/* walk + signals + opts */)
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups
```

Every key of the walk is classified by path role (product vs auxiliary — `classifyPathRole` combined with `isTestPath`) and by semantic role (T1 entry, T2 crossing, T3 boundary-sink; a key may hold several). The candidate carries explicit groups: `entryKeys` (T1), `boundaryKeys` (T2), `sinkKeys` (T3), `otherProductKeys` (T4: product keys with no semantic role), and `auxiliaryKeys` (T5: auxiliary keys not admitted to a semantic group). `buildSeedKeyGroups` produces those groups.

`capGroupsToSeedKeys(groups, seedKeys)` enforces that the union of the five groups EQUALS `seedKeys`, always: a key truncated from `seedKeys` is dropped from every group, with order preserved. Within T1/T2/T3 an auxiliary key enters the group ONLY when no product key holds that role — a legitimately test-shaped entry keeps its keys, but a product flow never presents test helpers as primary evidence.

The closed list (`seedKeys`) is filled in two passes by `buildSeedKeyGroups`: pass 1 reserves one key per non-empty T1/T2/T3 group (a reserved key covers every group it belongs to; the group's first key in round-robin order — modules in walk order, keys sorted within a module); pass 2 fills in tier priority T1→T5 (round-robin across the walk's modules, one key per module per round) until `flowMaxAnchors`. Two skips are decided deterministically BEFORE any LLM call and recorded on the candidate (`skip`):

- (K-a) the cap cannot fit the mandatory group reservation — `insufficient_anchor_capacity`.
- (K-b) after pass 1 plus a top-up to three distinct keys from the remaining pool in the same T1→T5 priority order, the list still holds fewer than 3 distinct keys — `insufficient_section_anchor_coverage`.

These skips never become tasks. The visible excerpt of `flows.ts` is truncated before the bodies of `buildSeedKeyGroups` and `capGroupsToSeedKeys` are visible.

## Flow detection: test helpers

<!-- lw:anchors packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap -->

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
```

`mod` is the test-side factory for `Module`. `shuffled` is a deterministic Fisher–Yates shuffle driven by an LCG (`s = (s * 1664525 + 1013904223) >>> 0`); `shuffledMap` builds a fresh `Map` from a shuffled `entries` array. Together they let the test suite assert that `detectFlowCandidates` produces byte-identical output when the inputs (module list, edge list, per-file symbol/import maps) are reordered.

The visible excerpt of `flows.test.ts` is truncated before the assertions on the linear `cli→core→db` candidate (slug `cli-to-db`, ordered `seedKeys`, capped output under `flowMaxAnchors: 3`) and the external-boundary case (asserting that `node:` and relative specifiers are not external, while package specifiers are) finish being described.

## Flowchart repair

<!-- lw:anchors packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart -->

```ts
export function parseFlowchartMermaid(source: string): FlowchartIR | null
export function truncateFlowchartToBudget(/* ir + budgets */)
export function renderFlowchartMermaid(ir: FlowchartIR): string
export function repairOversizedFlowchart(/* source + budgets */)
```

This module is a deterministic, localized repair for an over-budget stage-5 flowchart diagram. Its purpose (per the source comment) is to avoid burning an LLM repair slot on a purely mechanical problem — too many nodes/edges for the configured budget. The strategy: parse the model's Mermaid into a small structural IR, truncate to the budget deterministically (first N nodes in appearance order, only edges between kept nodes), re-render valid Mermaid, and leave the surrounding page prose untouched.

Scope is flowchart/graph diagrams only — the only kind stage-5 flow pages actually produce. `sequenceDiagram`/`stateDiagram` sources, node-chaining with `&`, or any flowchart line this parser cannot confidently round-trip all return `null`; the visible source documents that a truncation the module cannot prove correct is worse than no truncation at all. The parser uses:

- `HEADER_RE = /^(flowchart|graph)\s+(\S+)\s*$/i` for the diagram header,
- `SKIP_RE = /^(?:subgraph\b|end\b|classdef\b|class\b|style\b|linkstyle\b|click\b|direction\b)/i` for directive lines,
- `EDGE_OP_RE = /(<-->|-->|<--|-\.->|-\.-|==>|===|o--o|x--x|--o|o--|--x|x--|---)(\|[^|]*\|)?/g`, ordered longest-operator-first so `<-->` is never split as two shorter operators,
- `NODE_TOKEN_RE = /^([A-Za-z0-9_]+)(\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{[^}]*\}|>[^\]]*\])?$/` for node shape capture.

The parser records node ids in first-seen order; if a later occurrence of the same id carries a shape the first (bare) reference lacked, the shape is upgraded. Edges are tokenised by `line.split(EDGE_OP_RE)` — the comment in source notes that with N capture groups, every 3rd entry (index `% 3 === 0`) is plain text and the pairs in between are the captured operator and optional `|label|`.

`truncateFlowchartToBudget(ir, nodeBudget, edgeBudget)` keeps only the first N nodes in appearance order and edges between kept nodes, capping edges independently of node truncation (a larger node budget with a tight edge budget yields at most `edgeBudget` edges). On an already-small IR it is idempotent: `truncateFlowchartToBudget(truncateFlowchartToBudget(ir, ...), ...) === truncateFlowchartToBudget(ir, ...)`.

`renderFlowchartMermaid(ir)` re-emits valid Mermaid; isolated kept nodes with no surviving edge become standalone declarations. `repairOversizedFlowchart` is the convenience entry point that combines parse → truncate → render and is used when the diagnostic flow-page builder hits `flow_diagram_too_large`. The visible excerpt of `flow-diagram-repair.ts` and `flow-diagram-repair.test.ts` is truncated before the full bodies of `truncateFlowchartToBudget` and `repairOversizedFlowchart` and the remaining test cases are visible; the signatures above are the authoritative copy.

## Frontmatter parser

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

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

The parser is a deliberately small YAML subset: top-level keys, string values, list-of-strings values (both block and inline `[a, b, c]` flow-style), and `#` line comments. It does NOT support nested lists, nested maps, multi-line scalars (`|`/`>`), typed booleans/null, anchors/aliases, or `\"` escapes — `frontmatter.ts` notes these are intentional and that swapping to a full YAML library is straightforward if a future SPEC requires richer features.

`parseFrontmatter` normalizes `\r\n` to `\n`, requires the source to start with `---\n`, and locates the closing `\n---`. On success it returns `{ frontmatter, body, bodyOffset }`. On a missing closing fence it throws `FrontmatterParseError("frontmatter aberto com --- mas sem fechamento --- antes do fim do arquivo", 1)`. On a source that does not start with `---\n` it returns `{ frontmatter: null, body: source, bodyOffset: 0 }` — pages without frontmatter are allowed, not an error.

`parseYamlBlock` walks the YAML block line-by-line:

- Lines that are blank or start with `#` are skipped.
- A line matching `^(\s*)-\s+(.*)$` extends the most recently opened list (a list item with no open list throws `FrontmatterParseError`).
- A line matching `^([A-Za-z_][\w-]*)\s*:\s*(.*)$` opens either a list (`restRaw === ""`) or a scalar. Inline flow-style lists (`[a, b, c]`) are parsed by trimming the brackets, splitting on `,`, trimming each item, and filtering empties; a value that merely contains brackets is NOT a list.
- Anything else throws `FrontmatterParseError("linha inválida: ...")` with the line number.

`stripComment` removes a trailing `# comment` from a value; key-vs-list state (`currentListKey`, `currentList`) is maintained across lines.

`getAnchors(fm)` returns the `anchors` list from a parsed `Frontmatter`, or `[]` for `null`/missing/non-list. `getOwner(fm)` classifies the page as `"generated"`, `"human"`, or `"mixed"`; the visible excerpt does not establish the exact heuristic, only that it returns one of the three string literals.

## Gitignore managed block

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

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

The gitignore module enforces SPEC §"Inviolable rules" #3 — `.livewiki/` (the SQLite cache) must NOT be committed, and `livewiki init` must idempotently ensure `.livewiki/` is in the target repo's `.gitignore`. The module wraps all entries in a stable managed block delimited by `# livewiki:start` and `# livewiki:end` (the source comment notes external parsers may depend on these literal markers). Policy: add entries that are MISSING, do NOT duplicate entries that are already present (case-sensitive match after `trim`), do NOT remove entries that might have been added manually.

`readGitignore(repoRoot)` resolves `repoRoot` with `path.resolve` and reads `<repoRoot>/.gitignore` as UTF-8; a missing file returns `""`. `ensureGitignoreEntries` orchestrates the rest:

1. Resolve the absolute `.gitignore` path and read its current contents.
2. Extract any existing managed block via `extractManagedBlock`.
3. Compute the target line set — the block's lines if a block is present, otherwise all non-blank, non-`#`-comment lines of the file. Membership is decided by `targetSet.has(entry.trim())`.
4. If no entries are missing, return `{ file, changed: false, added: [] }` without writing.
5. Otherwise, rebuild the block via `mergeBlockLines(existing, entries)` (order: existing first, then new in caller order; duplicates dropped), render via `renderBlock`, splice into the file via `replaceManagedBlock`, and write.

`extractManagedBlock` uses `^#\s*livewiki:start\s*$` and `^#\s*livewiki:end\s*$` (tolerant of whitespace inside the markers). It returns `null` when no start marker is found, OR when a start marker is found without an end marker (a truncated block — the visible behavior is to fall back to the append path rather than throw). The block's inner lines are trimmed and blank lines filtered. `mergeBlockLines` keeps the existing entries first, appends new entries whose trimmed form is not already in the set, and preserves caller order for the additions. `renderBlock` emits the start marker, the lines, and the end marker separated by newlines. `replaceManagedBlock` rewrites the file content: if a block was found, the old block (markers included) is replaced by `newBlock`; if not, the block is appended at the end with a `\n\n` separator when the file doesn't already end in a blank line.

The visible excerpt of `gitignore.ts` truncates the bodies of `renderBlock` and `replaceManagedBlock`; the signatures above are the authoritative copy.

## Hashing helpers

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

```ts
export function sha256(content: string | Uint8Array): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

`sha256` is a thin wrapper around `node:crypto.createHash("sha256").update(content).digest("hex")`; it accepts either a UTF-8 `string` or a `Uint8Array`. Output is always lowercase hex, 64 chars. There is no salt — the function is a content fingerprint, not an authenticator. `sha256Slice(source, startByte, endByte)` calls `sha256(source.slice(startByte, endByte))`; the source comment notes this is what the indexer uses to detect local change inside a file without re-parsing everything.

The excerpt of `hashes.test.ts` documents the known-vector check (`sha256("hello") === "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"`), the `Uint8Array` overload via `TextEncoder`, and the slice semantics (a slice over `"prefix-foo-suffix"` from byte 7 to byte 10 hashes the substring `"foo"`, which equals `sha256("foo")` and differs from the whole-source hash).

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency and dependent
- [Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
