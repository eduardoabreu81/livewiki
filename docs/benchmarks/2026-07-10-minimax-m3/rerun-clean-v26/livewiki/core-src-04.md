---
title: Core export, frontmatter, gitignore, flow detection, and hashing
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

# Core export, frontmatter, gitignore, flow detection, and hashing

This page describes the modules under `packages/core/src/` that transform the on-disk `livewiki/` snapshot into a destination wiki, parse the YAML-subset frontmatter used across pages, manage the repo `.gitignore`, detect stage-5 semantic product flows, repair oversized Mermaid flowcharts, and provide deterministic sha256 content hashing.

## When to use this page

- **Transform** the `livewiki/` snapshot into `generic`, `github-wiki`, or `gitlab-wiki` output via `exportWiki` and inspect `ExportError` / `ExportIssue` shapes.
- **Parse** page frontmatter with `parseFrontmatter` and read `anchors` / `owner` via `getAnchors` and `getOwner`.
- **Repair** oversized flowcharts deterministically with `repairOversizedFlowchart` and tune `FLOW_MAX_PATH_LENGTH` / `FLOW_PER_ROOT_PATH_BUDGET` for flow detection.
- **Hash** content with `sha256` / `sha256Slice` and keep `.livewiki/` out of git via `ensureGitignoreEntries`.

## How it fits

This module group lives inside `packages/core/src/` and bridges raw repository state (files under `livewiki/`) and downstream artifacts (exported wikis, generated stage-5 flow pages, the SQLite cache). `export.ts` is the only writer side: it consumes the YAML-subset frontmatter produced by `frontmatter.ts`, writes inside the `.livewiki/` allowlist that `ensureGitignoreEntries` keeps out of git, and refuses to touch `livewiki/` itself. `flows.ts` and `flow-diagram-repair.ts` are pure functions used by the stage-5 generator: `detectFlowCandidates` decides which flows exist from index facts only, and `repairOversizedFlowchart` trims over-budget Mermaid flowcharts without round-tripping back through the LLM. `hashes.ts` is the lowest-level helper, fingerprinting both full file content and per-symbol source slices.

The test files (`export.test.ts`, `flows.test.ts`, `frontmatter.test.ts`, `gitignore.test.ts`, `hashes.test.ts`) sit alongside the implementation as regression coverage and as documentation of the exact behavior contracts (cross-platform symlink handling, deterministic flow enumeration, inline YAML flow-style lists, idempotent gitignore block rewriting, etc.).

## Export pipeline

<!-- lw:anchors packages/core/src/export.test.ts#bodyOf packages/core/src/export.test.ts#detectSymlinkSupport packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#writeWiki packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#errMessage packages/core/src/export.ts#exportWiki packages/core/src/export.ts#flattenPath packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#transformPage packages/core/src/export.ts#validateTarget -->

The export module produces a deterministic, flattened destination tree under `.livewiki/export/<target>/` from the on-disk `livewiki/` snapshot. Three targets are supported:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
```

The home page filename per target is `quickstart.md`, `Home.md`, and `home.md` respectively (the `HOME_MAPPING` in `export.ts`). Every exported page is tagged with a generated marker so subsequent runs can identify and replace their own output:

```ts
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
```

`buildMarker(sourceRel)` constructs the full marker from a source path, `detectMarker(text)` searches the first 32 lines (`MARKER_HEADER_BODY_LINES`) for one, and `stripAnchorMarkers(body)` removes any `lw:anchors` HTML comments left over from generation. `validateTarget(target)` enforces membership in `EXPORT_TARGETS`; an unknown target throws `ExportError`:

```ts
constructor(issues: ExportIssue[]) {
```

which aggregates `ExportIssue` records (codes such as `invalid_target`, `invalid_push`, `flattening_collision`, `destination_conflict`, `broken_internal_link`, `missing_diagram`, etc.). The orchestrator rejects `--push` with a structured error before any I/O — there is no Git subprocess, network call, or transactional atomic-snapshot guarantee in this module; an unforeseen filesystem failure during write may leave the destination partially updated, and the command returns exit 1 so an idempotent rerun can repair it.

`exportWiki(opts: ExportOptions)` is the public entry point:

```ts
export async function exportWiki(opts: ExportOptions): Promise<ExportResult>
```

It runs the full pipeline against `opts.repoRoot` and `opts.target`. The flow is:

1. `validateTarget` rejects invalid target strings.
2. `enumerateSourcePages` walks `livewiki/` (via the safe-io allowlist) and collects `SourcePage` records `{ rel, safeRel, ext, raw }`.
3. For each source page, `transformPage` dispatches to either `transformMarkdownPage` or `transformMermaidPage` based on the `flow-diagram` extension / header.
4. `flattenPath(rel, target)` maps a source path to a flat destination filename, applying the `HOME_MAPPING` for the home page. A collision (two distinct source paths mapping to the same destination name) raises an `ExportError` with code `flattening_collision`.
5. `splitRawFrontmatter(source)` peels the frontmatter block off the source string; `renderMarkdownHeader(source, sourceRel)` re-renders a minimal header that includes the generated marker. `stripAnchorsField(frontmatterBlock)` removes any `anchors:` field so it is not propagated into the destination.
6. `rewriteInternalLinks` re-targets `livewiki/...` links to the flattened destination paths, skipping any href that lives inside a code span or fenced code block (the mask is applied via `maskCodeSpansPreservingLength` from `markdown-mask`). `parseLinkHref` parses a single href into a `{ kind, ... }` shape and `resolveLinkSource` maps the original path part back to a `livewiki/...` path.
7. `replaceMermaidPlaceholder` swaps `flow-diagram` placeholders for the rendered Mermaid; `transformMermaidPage` runs the flowchart through the repair pass before rendering.
8. `enumerateDestination` reads the current `.livewiki/export/<target>/` directory via safe-io (after `resolveAndValidate` acceptance) and classifies each entry as a `DestinationEntry` carrying `{ name, text, markerSource, unsafe }`. Unsafe entries (symlinks, directories where files are expected, special files, unreadable entries) are NEVER forceable — `--force` only overwrites a plain readable file whose marker does not match the planned source. An unrelated unsafe entry that is NOT in the planned destination set is left untouched.
9. The preflight accumulates every `ExportIssue`. If any error-severity issue is present, no writes happen and the destination tree is unchanged.
10. Writes go through `safeIo.writeText` (the destination is inside the existing `.livewiki/` allowlist, so no exception is required). Stale generated files (matching marker but no longer in the planned set) are removed. `errMessage(err)` extracts a human-readable message from an `unknown` thrown value for the result/issues payload.
11. `ensureExtension(path)` adds a default extension when the destination name lacks one.

The test helpers exist solely to exercise this pipeline against a temp `repoRoot`:

```ts
async function detectSymlinkSupport(): Promise<boolean>
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: ExportTarget, name: string): Promise<string | null>
async function listDest(target: ExportTarget): Promise<string[]>
async function bodyOf(transformed: string): Promise<string>
```

`detectSymlinkSupport` creates a temp probe directory, attempts `symlink(2)`, and always removes the probe in a `finally` block. On a non-Windows host, a `false` result throws a CI-contract violation (the symlink security regression tests must run on every Unix host). `writeWiki` writes a file under the per-test `repoRoot`, `readDest` reads from `.livewiki/export/<target>/<name>`, and `listDest` lists that directory, returning `[]` on miss.

The visible contract is honest: the preflight leaves the destination unchanged on failure, the marker is exact, and `--force` is narrowly scoped to readable regular files with a non-matching marker. The excerpt does not establish exhaustive behavior for every `ExportIssueCode`; codes listed above are the ones visible in the supplied source.

## Frontmatter parsing

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

The frontmatter module implements a small YAML subset (no nested maps, no multi-line strings, no booleans/nulls, no anchors/aliases, no `\"` escapes). It supports top-level string keys with optional single-level string lists in either block style (`- item`) or inline flow style (`key: [a, b, c]` — the form LLMs most often emit, per the regression test), trailing comments after `#`, Windows line endings (normalized to `\n`), and keys with `-` or `_` characters.

```ts
export function parseFrontmatter(source: string): ParseResult
```

returns `{ frontmatter, body, bodyOffset }`. When the source does not start with `---\n`, `frontmatter` is `null` and `body === source` with `bodyOffset === 0`. `parseYamlBlock(yaml)` walks the block lines, tracking a `currentListKey`/`currentList` pair for block-style lists, and recognizes inline flow-style lists when a value starts with `[` and ends with `]`. `stripComment(s)` removes a trailing `# ...` comment while preserving quoted brackets (a value that merely contains brackets is not a list). The module throws `FrontmatterParseError` for malformed input:

```ts
constructor(message: string, line: number) {
```

which prefixes the message with `Frontmatter parse error (line N):` and stores `line` on the instance. Visible failure modes include: an open `---` with no closing `---`, a list item with no preceding key, and any line that does not match `key: value` (or a list item).

Two convenience readers expose the most common fields:

```ts
export function getAnchors(fm: Frontmatter | null): string[]
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
```

`getAnchors` returns the `anchors` array when it is one, otherwise `[]`. `getOwner` reads the `owner` field, falling back to a discriminated union that the caller can use to decide whether to re-inject manual blocks.

## Gitignore management

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

The gitignore module enforces the SPEC rule that `.livewiki/` must never be committed. It writes a managed block delimited by stable comment markers:

```ts
const BLOCK_START = "# livewiki:start";
const BLOCK_END = "# livewiki:end";
```

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult>
```

`readGitignore` is a thin wrapper that returns `""` when the file is absent (the catch swallows the error so the caller can treat "no gitignore" as "empty gitignore"). `ensureGitignoreEntries` is idempotent and returns `{ file, changed, added }`:

1. Read the current file content (possibly empty).
2. `extractManagedBlock(content)` locates the managed block via regex `/^#\s*livewiki:start\s*$/m` and `/^#\s*livewiki:end\s*$/m`. A truncated block (no end marker) is treated as absent and the caller falls back to append.
3. The target set for membership checks is the existing block lines if a block is present, otherwise the non-empty, non-comment lines of the whole file.
4. `entries` missing from that target set are merged in via `mergeBlockLines(existing, toAdd)`, which preserves caller order and dedupes on trimmed equality:

```ts
function mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[]
```

5. `renderBlock(lines)` rebuilds the managed block:

```ts
function renderBlock(lines: string[]): string
```

6. `replaceManagedBlock(content, newBlock)` splices the new block back into the file content, preserving user entries outside it:

```ts
function replaceManagedBlock(content: string, newBlock: string): string
```

If the new content is identical to the current set, the function short-circuits with `{ changed: false, added: [] }` and never touches the file. The policy is strictly additive: existing entries are never removed, even if added manually.

## Flow diagram repair

<!-- lw:anchors packages/core/src/flow-diagram-repair.ts#parseFlowchartMermaid packages/core/src/flow-diagram-repair.ts#renderFlowchartMermaid packages/core/src/flow-diagram-repair.ts#repairOversizedFlowchart packages/core/src/flow-diagram-repair.ts#truncateFlowchartToBudget -->

The flow-diagram-repair module provides deterministic, localized repair for stage-5 flowcharts that exceed the node/edge budget. It parses a flowchart/graph Mermaid source into a small structural IR (`FlowchartIR` with `nodes: FlowchartNode[]` and `edges: FlowchartEdge[]`), truncates it to the budget, and re-renders valid Mermaid — the surrounding page prose is left untouched.

```ts
export function parseFlowchartMermaid(source: string): FlowchartIR | null
```

Tokenizes line-by-line after stripping comments (`%%`) and trailing semicolons. The first line must match `/^(flowchart|graph)\s+(\S+)\s*$/i`; otherwise the source is rejected. Edge operators are matched longest-first so `<-->` is never split as two `-->` halves. The regex is:

```
(<-->|-->|<--|-\.->|-\.-|==>|===|o--o|x--x|--o|o--|--x|x--|---)(\|[^|]*\|)?
```

Each `node` carries `{ id, shape }` where `shape` is the raw shape+label token (e.g. `[Start]`, `{Decision}`) or `""` for a bare id. When an id appears multiple times, the first occurrence's shape wins unless it was bare — a later labeled reference fills the shape in (the test `captures a label from a later reference when the first was bare` covers this). The parser deliberately returns `null` (and never a best-effort guess) for:

- a non-flowchart diagram kind (e.g. `sequenceDiagram`),
- a line containing `&` (chained endpoints),
- empty source,
- any line it cannot cleanly tokenize (`recordNode` returns `null`),
- `parts.length - 1` not divisible by 3 after splitting on the operator regex (malformed interleaving),
- a missing operator capture for an edge slot.

```ts
export function renderFlowchartMermaid(ir: FlowchartIR): string
```

emits the header line followed by one line per kept element. Standalone kept nodes with no surviving edge are emitted as bare declarations (`id[shape]`). Edge labels round-trip as `from -->|label| to`.

```ts
export function truncateFlowchartToBudget(
  ir: FlowchartIR,
  maxNodes: number,
  maxEdges: number,
): FlowchartIR
```

keeps the first `maxNodes` nodes in appearance order and only edges whose `from` and `to` are both in the kept set, capped independently at `maxEdges`. Truncation is idempotent: running it twice with the same budget produces the same IR as running it once.

```ts
export function repairOversizedFlowchart(
  source: string,
  maxNodes: number,
  maxEdges: number,
): string
```

is the public entry point — it parses, truncates, and re-renders. If parsing returns `null`, the function does not throw in the visible excerpt; the surrounding source establishes that callers fall back to the LLM-repair path in that case. The excerpt does not establish exhaustive behavior for the fallback.

## Flow candidate detection

<!-- lw:anchors packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#normalizeFileMap -->

The flows module decides which cross-module semantic product flows exist for stage 5, purely from index facts (module list, module import graph, active symbol keys per file, external import specifiers per file). It is a pure function: no disk I/O, no DB, no LLM; deterministic under input reordering.

```ts
export const FLOW_MAX_PATH_LENGTH = 8;
export const FLOW_PER_ROOT_PATH_BUDGET = 64;
```

`FLOW_MAX_PATH_LENGTH` caps the length of any single simple path. `FLOW_PER_ROOT_PATH_BUDGET` caps how many simple paths the DFS enumerates per entry root (the comment in the source calls this "R10.1 H1") — a root with more paths than the budget is truncated WITHOUT starving the other roots.

```ts
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
```

`opts` carries `{ modules, edges, symbolsByFile, externalImportsByFile?, flowMaxAnchors? }`. The algorithm (as visible in the supplied source) is:

1. **Normalize inputs.** `normalizeFileMap(map)` copies the input map into a sorted lookup. The comment is explicit: maps are only looked up, never iterated, to keep iteration order deterministic. Input maps are copied once into normalized lookups.

```ts
function normalizeFileMap(map: Map<string, string[]>): Map<string, string[]>
```

2. **Compute per-module signals** via `computeModuleSignals`:

```ts
function computeModuleSignals(
  modules: Module[],
  edges: ModuleGraphEdge[],
  symbolsByFile: Map<string, string[]>,
  externalImportsByFile: Map<string, string[]> | undefined,
): Map<string, ModuleSignals>
```

   - `entry`: in-degree 0 in the module graph, OR any of its files matches the entry patterns (gitignore-style, same matcher as `classifyPathRole`; defaults in `DEFAULT_FLOW_SIGNAL_PATTERNS`).
   - `persistence`: any file matches the persistence patterns, OR any file has an external import specifier matching `persistenceImportPatterns` (default empty — no built-in package-name guessing).
   - `external`: any file has third-party import specifiers (non-relative, non-`node:`) per `externalImportsByFile`; an absent map means no external signal. An occurrence `(file, specifier)` with a resolved internal edge is NOT external — the same specifier may be internal in one file and external in another.
   - `sink`: out-degree 0.
   - `product`: `classifyModuleRole === "product"` (used for ranking only).

3. **Enumerate simple paths** with a deterministic DFS over sorted module ids and sorted edges. A path is qualified when it crosses at least one boundary module (persistence or external) and has length ≥ 2. `crossesBoundary` checks membership of any module along the path in the boundary set:

```ts
function crossesBoundary(path: string[], signalsById: Map<string, ModuleSignals>): boolean
```

   Proper prefixes of a longer qualified path are dropped; each entry+sink pair keeps only its longest path. `compareLongestFirst` and `comparePathLex` are the sort comparators used to keep enumeration deterministic:

```ts
function compareLongestFirst(a: string[], b: string[]): number
function comparePathLex(a: string[], b: string[]): number
```

   `isProperPrefix(p, q)` is the helper that distinguishes "p is a strict prefix of q" from "they're equal" (so equal-length paths are not treated as prefix relations):

```ts
function isProperPrefix(p: string[], q: string[]): boolean
```

4. **Rank** by product-role module count desc, then centrality desc (the number of qualified walks of the union sharing at least one module with the candidate), then slug asc. `maxFlows` (default 4; `0` disables) applies only after ranking.

5. **Build seed keys** in two passes (R10.1 K):

```ts
function buildSeedKeyGroups(
  walk: string[],
  symbolsByFile: Map<string, string[]>,
  signalsById: Map<string, ModuleSignals>,
  isTestPathFn: (path: string) => boolean,
): KeyGroups
```

   Every key of the walk is classified by path role (product vs auxiliary — `classifyPathRole` combined with the deterministic `isTestPath`) and by semantic role (T1 entry / T2 crossing / T3 boundary-sink; a key may hold several). The candidate carries explicit groups — `entryKeys` (T1), `boundaryKeys` (T2), `sinkKeys` (T3), `otherProductKeys` (T4: product keys with no semantic role), `auxiliaryKeys` (T5: auxiliary keys not admitted to a semantic group). Within T1/T2/T3 an auxiliary key enters the group ONLY when no product key holds that role — a legitimately test-shaped entry keeps its keys; a product flow never presents test helpers as primary evidence.

6. **Cap to the closed list** via `capGroupsToSeedKeys`:

```ts
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups
```

   Each group is capped to the closed list (`seedKeys`). A key truncated from `seedKeys` is dropped from every group, order preserved, so the union of the five groups always EQUALS `seedKeys`. The closed list itself is filled in two passes: pass 1 reserves one key per non-empty T1/T2/T3 group (a reserved key covers every group it belongs to; the group's first key in round-robin order — modules in walk order, keys sorted within a module); pass 2 fills in tier priority T1→T5 (round-robin across the walk's modules, one key per module per round) until `flowMaxAnchors`.

7. **Decide skips deterministically** before any LLM call (recorded on `candidate.skip` and never turned into tasks): `insufficient_anchor_capacity` (cap cannot fit mandatory group reservations) and `insufficient_section_anchor_coverage` (after pass 1 plus a top-up to three distinct keys from the remaining pool in the same T1→T5 priority order, fewer than 3 distinct keys survive — the three required flow sections each need their own anchor).

Supporting helpers in the module:

```ts
function matchedPatterns(inputs: string[], patterns: string[]): string[]
function isExternalSpecifier(spec: string): boolean
export function isTestPath(path: string): boolean
function displayName(module: Module): string
function buildCandidate(...): FlowCandidate
```

`isExternalSpecifier` treats `node:`-prefixed specifiers and any specifier starting with `.`, `/`, or matching a relative form as non-external. `isTestPath` is exported because callers elsewhere need the same rule. `displayName` derives a human label from the module's `displayTitle` (when present) or from its id. `buildCandidate` constructs the final `FlowCandidate` record from the path, slug, titleSeed, seed keys, and grouped key sets.

Test helpers in `flows.test.ts` exist purely to drive `detectFlowCandidates` with deterministic inputs:

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
```

`mod` is a fixture builder (the production `Module` type carries more fields). `shuffled` is a Fisher–Yates shuffle driven by a 32-bit LCG (`s * 1664525 + 1013904223`) so the same `seed` always produces the same permutation; `shuffledMap` applies it to map entry lists to assert that input reordering never changes output.

The visible source establishes that `detectFlowCandidates` is a pure function of its inputs and is deterministic under reordering; the excerpt does not establish exhaustive behavior for every ranking tie-breaker edge case.

## Content hashing

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

```ts
export function sha256(content: string | Uint8Array): string {
  return nodeCrypto.createHash("sha256").update(content).digest("hex");
}
```

Returns lowercase hex, 64 characters, with no salt — it is a content fingerprint, not authentication. The same string and its `Uint8Array` encoding (via `new TextEncoder().encode(s)`) produce the same digest, which the test suite verifies against the known vector for `"hello"`.

```ts
export function sha256Slice(source: string, startByte: number, endByte: number): string {
  return sha256(source.slice(startByte, endByte));
}
```

Hashes only the `startByte..endByte` slice of `source`. This is how the indexer detects a change inside a symbol without re-parsing the whole file: the full-file hash may be unchanged while the per-symbol slice hash flips, surfacing symbol-level drift. An empty slice (`start === end`) hashes the empty string, which the test suite pins to `sha256("")`. Different purposes (file content vs symbol slice) are distinguished by the field name in the index, never by the algorithm.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency and dependent
- [Manifest persistence, Markdown masking, module partitioning, and mermaid validation](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
