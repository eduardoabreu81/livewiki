---
title: Navigation hubs and per-page navigate blocks
owner: generated
anchors:
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
  - packages/core/src/navigation.ts#folderPageTitle
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

# Navigation hubs and per-page navigate blocks

This page documents the livewiki navigation layer that turns the verified wiki pages already on disk into the deterministic hubs (Quickstart, Tasks, Flows, Topics, Auxiliary) and the per-page Navigate blocks that readers and agents follow.

## When to use this page

- **Generate the Quickstart page** for a freshly initialised repo by calling `generateQuickstart` with the presentations and orientation inputs you have ready.
- **Keep the topic, flow, and auxiliary hubs consistent** with the current set of accepted pages by running `syncTopicsIndexHub`, `syncFlowsIndexHub`, and `syncAuxiliaryIndexHub` after pages change.
- **Refresh the per-page Navigate blocks** on every module page that the orchestrator owns, via `updateModuleNavigateBlocks`, when the module plan or edges change.
- **Read the layout of an accepted module page's opening** (title + responsibility paragraph + `How it fits`) with `extractModuleOpeningDigest` or `extractModuleResponsibility` when another stage needs the same parsed opening.

## How it fits

`packages/core/src/navigation.ts` sits in the core package alongside the orientation, markdown-mask, and modules helpers, and is imported by the higher-level batch and init pipelines that own the wiki as a whole. It consumes data the rest of the core has already produced — `Module` lists from `modules.ts`, `RepoOrientation` from `orientation.ts`, parsed frontmatter from `frontmatter.ts`, and disk reads through the safe I/O wrapper — and produces Markdown strings plus a handful of filesystem sync results. The orchestrator decides when each generator runs; this module makes sure every hub and Navigate block is deterministic, derived only from the evidence on disk, and refrains from inventing prose for missing inputs.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-navigation.mmd
```

## Display titles and presentation loaders

<!-- livewiki:anchors: packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#folderPageTitle packages/core/src/navigation.ts#normalizeLabel -->

WHY: every navigation surface must show a human-meaningful folder name without changing the `Module.id` that graphs, pages, and anchors all key off. The display title layer is therefore deliberately separate from identity, and it must be deterministic and re-derivable from `Module` alone.

`buildDisplayTitleFallbacks` computes the fallback titles. It sorts modules with `compareModules`, derives each module's `commonDirectory` segments, picks the shortest tail of segments that does not collide with another module's tail outside the same directory, appends `"source"` when the segments drop the `src`/`source` marker, and finally appends `"tests"` when the module's role is `test`. Same-directory siblings skip each other in the collision check so the appended role label is what distinguishes them; siblings in other directories still collide normally so each role's series disambiguates across packages. Multi-member directories receive a `" — part N of M"` suffix so siblings stay distinguishable.

```ts
export function buildDisplayTitleFallbacks(
  modules: Module[],
  pathRoleConfig?: PathRoleConfig,
): Map<string, string>
```

The signature takes an array of modules and an optional path-role configuration, and returns a map from `module.id` to its presentation-only display title.

`loadModulePresentations` enriches those fallbacks with what is actually on disk: for each module it reads `livewiki/<module.id>/index.md`, parses the frontmatter, captures the `owner` field if it is one of the accepted values, and overrides the fallback title with the page's `title` frontmatter when the title is meaningful (non-empty and not just a normalized echo of the module id, except when that echo IS the folder's directory path — in which case the title is the human-meaningful identity of the folder unit). Malformed pages are caught and silently treated as having no presentation metadata; the loader never throws on a bad page.

`loadFlowPresentations` reads `livewiki/flows/<slug>.md` (skipping `index.md`), returning a map keyed by slug with `title` (null on missing/unparseable frontmatter) and a `modules` array sourced from the page's `modules:` frontmatter. Missing pages yield an empty map; malformed pages still contribute an entry with `title: null` so the hub can fall back to the slug rather than dropping the flow silently.

`loadTopicPresentations` reads `livewiki/topics/<slug>.md`, validates that every required field is present and well-typed (string `title`, string `intent`, array `modules`, array `flows`, valid `owner`, `kind: "topic"`, numeric `order`), and returns a deterministic map of fully-formed `TopicPresentation` records. Pages that fail any check are skipped entirely — they are not navigation evidence.

`compareModules` is the deterministic order used everywhere modules need to be sorted.

```ts
function compareModules(a: Module, b: Module): number
```

The signature takes two modules and returns a number suitable for `Array.prototype.sort`: ascending id, with the smallest path as the tiebreaker.

`compareTopics` is the deterministic order used by every topics surface.

```ts
function compareTopics(a: TopicPresentation, b: TopicPresentation): number
```

The signature takes two topic presentations and returns a number suitable for `Array.prototype.sort`: ascending plan order, with slug as the tiebreaker.

`commonDirectory` is the directory-clustering helper used both by `buildDisplayTitleFallbacks` and by `groupTasksModules`.

```ts
function commonDirectory(paths: string[]): string[]
```

The signature takes an array of repository-relative file paths and returns the array of path segments that every path shares as its directory.

`folderPageTitle` returns the title the folder-page renderer gives a module: the directory path of its first declared path, or `"(repository root)"` for the root folder. It returns `null` when the module declares no paths.

```ts
function folderPageTitle(module: Module): string | null
```

The signature takes a module and returns either the folder title string or null when the module has no paths.

`humanizeSegments` turns a path-segments array into a human-readable title: split each segment on `-`, `_`, or `.`, expand `src` to `source` and `docs` to `documentation`, upper-case a fixed acronym set (`api`, `cli`, `db`, `fts`, `llm`, `mcp`, `ui`), and title-case the first segment's first letter. An empty input returns `"Repository root"`.

`normalizeLabel` lower-cases a string and strips every run of non-alphanumeric characters. It is the comparison used to decide whether a frontmatter title is just a normalized echo of the module id (and therefore not a meaningful override) and to decide whether a derived suffix would collide with the module id itself.

## Parsing accepted module openings

<!-- livewiki:anchors: packages/core/src/navigation.ts#parseModuleOpening packages/core/src/navigation.ts#extractModuleOpeningDigest packages/core/src/navigation.ts#extractModuleResponsibility -->

WHY: several downstream surfaces (the quickstart digest, the stage-5 flow context, and any future reader) all need the same "title + responsibility paragraph + How it fits" slice of an accepted module page. Centralising that parsing in one place keeps the surfaces byte-identical and protects against fenced code accidentally faking an H1 or section boundary.

`parseModuleOpening` is the shared parser. It first tries to strip frontmatter (falling back to the raw content when frontmatter is unparseable), then splits both the raw body and a length-preserving masked view of the same body into lines. Heading detection runs against the masked view (so fenced code blocks cannot masquerade as an H1 or section break), while extracted text comes from the raw lines so casing and punctuation are preserved. It walks past the H1 to the first non-empty paragraph (stopping at the next heading or blank-after-content boundary), then locates the `## How it fits` heading the same way and collects its body lines.

```ts
function parseModuleOpening(pageContent: string): ModuleOpeningParts
```

The signature takes the full page content and returns a structured object with the H1 title, the responsibility paragraph, and the `How it fits` block (each possibly null when the page lacks that element).

`extractModuleOpeningDigest` stitches those three parts together (H1, then paragraph, then `How it fits:` prefixed block) into a single digest and caps it at the internal `FLOW_MODULE_OPENING_CAP` (1200 chars) by slicing and appending an ellipsis. It returns `"(opening unavailable)"` when nothing was found so callers can render a title-link-only entry instead of fabricated prose.

```ts
export function extractModuleOpeningDigest(pageContent: string): string
```

The signature accepts the page content and returns the bounded digest string.

`extractModuleResponsibility` is the single-sentence version of the same parse: it collapses the paragraph to one line, applies `clipSentence` from `orientation.ts`, and caps the result at `RESPONSIBILITY_MAX_CHARS` (240 chars). It returns `null` when the page has no usable opening.

```ts
export function extractModuleResponsibility(pageContent: string): string | null
```

The signature takes the page content and returns either the clipped responsibility sentence or null.

## Module digest caps and quickstart content

<!-- livewiki:anchors: packages/core/src/navigation.ts#MODULE_DIGEST_CAP packages/core/src/navigation.ts#RESPONSIBILITY_MAX_CHARS packages/core/src/navigation.ts#loadModuleDigests packages/core/src/navigation.ts#buildModuleDigestBlock packages/core/src/navigation.ts#synthesizePurposeFromDigests -->

WHY: the quickstart is the first thing an agent or human reads, and it must show the top product modules without ballooning into the whole repository. Two deterministic caps — one on how many modules, one on how long each responsibility sentence — bound the digest without hand-tuning per repo.

`MODULE_DIGEST_CAP` (6) is the upper bound on the number of product modules surfaced in the reader digest.

```ts
export const MODULE_DIGEST_CAP = 6
```

The constant is an exported number; it is read by the digest builder and by `loadModuleDigests` as a default argument.

`RESPONSIBILITY_MAX_CHARS` (240) caps a single responsibility sentence in that digest.

```ts
export const RESPONSIBILITY_MAX_CHARS = 240
```

The constant is an exported number; it is passed to `clipSentence` by `extractModuleResponsibility`.

`loadModuleDigests` walks the prioritized module list, stops at the cap, skips non-product modules, skips modules whose page file is absent (they are not "in the wiki" and linking to them would break `verify`), and tries to extract the responsibility sentence from each present page. Pages that fail to parse contribute a title-link-only entry — the loader never throws upward and never fabricates prose.

`buildModuleDigestBlock` renders the digests as the `## What you'll find in this wiki` section: one bullet per entry with title link and responsibility sentence, or a title-link-only bullet when responsibility is null. It is defensive: it re-caps the list at `MODULE_DIGEST_CAP` even though the caller already does so.

`synthesizePurposeFromDigests` is the deterministic fallback for "What this repository is" when no README purpose is available. It picks up to three digests that have a non-null responsibility, joins them with an Oxford-comma list (`"X, Y, and Z"`, with one- and two-item variants handled explicitly), and wraps them in a fixed sentence. It returns `null` when no usable digest exists so the orientation block can choose to emit nothing rather than a half-built sentence.

## Orientation block and quickstart assembly

<!-- livewiki:anchors: packages/core/src/navigation.ts#buildOrientationBlock packages/core/src/navigation.ts#generateQuickstart -->

WHY: the quickstart's first content section is the repository's orientation, and the tool must prefer the strongest source of evidence available. The hierarchy is: stage-5c synthesis (when present) is primary, the README purpose excerpt is provenance-marked evidence, and only when both are absent does the digest-based synthesis step in. This keeps the block honest about where each line came from.

`buildOrientationBlock` orchestrates that hierarchy. When the `UnderstandingSynthesis` is present, it emits the synthesis paragraph as the primary content, appends its provenance line (the page path string is intentionally duplicated here to avoid a value import that would create a module cycle with `understanding.ts`), then quotes the README purpose as evidence if one exists, then renders the entry-point surfaces (falling back to the README-derived surfaces when the synthesis carries none), then points at the README's fast-path section by name in a plain code span (deliberately not a link, so a repo-root README never trips the verify link check). When no synthesis exists, it falls back to the README purpose or the digest synthesis (one of them wins, never both), then the same surfaces and fast-path tail.

`generateQuickstart` is the public entry point. It stitches the orientation block, the module digest block, a "Work by intent" list (Tasks link, per-flow links when flows exist plus a hub link, Architecture link, and the Auxiliary inventory link when auxiliary work is present), the topic list when topics exist, the agent query / doc-up-to-date / repo facts sections, and a closing line about what the wiki is for. It is pure string assembly over the inputs it is handed — it never reads disk or mutates state.

## Tasks page and concern grouping

<!-- livewiki:anchors: packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#groupTasksModules -->

WHY: the Tasks page is where readers pick an end-to-end behavior or a product area. As a corpus grows the flat list of implementation references starts to lose shape; deterministic directory-cluster grouping recovers the shape without introducing hand-curated taxonomy.

`generateTasksPage` produces the full `livewiki/tasks.md`. It writes the frontmatter, the H1, the concept-topics block (one H3 per topic when topics exist), the end-to-end behavior block (one H3 per flow when flows exist), then the implementation-reference section over the product modules in prioritization order. For each module it renders either a linked H3 (when the page exists) or a stub H3 with a "run `livewiki batch` to generate it" hint.

`groupTasksModules` is the deterministic concern grouper. It builds one cluster per module from the module's `commonDirectory` (case-insensitively), preserves prioritization order inside each cluster, then folds singletons: a one-member cluster never gets its own heading; it folds into the multi-member cluster sharing the longest common directory prefix (at least one segment), or — when no prefixed sibling exists — into one trailing `"Other folders"` bucket. The folding happens in a second pass so it is independent of input order.

The renderer switches on group count: one effective cluster renders the flat list without any group heading (no artificial umbrella), two or more render one H3 per directory cluster with title-link-only bullets inside (no copied responsibility sentences, per the dedup rule).

## Auxiliary, flows, and topics index hubs

<!-- livewiki:anchors: packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex -->

WHY: each non-product concern (tests, fixtures, tooling, documentation) needs a single deterministic inventory hub so the primary hubs link to one place instead of competing destinations. The flows and topics hubs play the same role for the semantic product-flow layer and the concept-topic layer.

`generateAuxiliaryIndex` writes the `livewiki/auxiliary/index.md`. It emits one `## <Heading>` section per role in the fixed `AUXILIARY_ROLE_SECTIONS` table — `Automated tests`, `Test fixtures`, `Tooling and benchmarks`, `Repository documentation` — and lists the members of that role in prioritization order. Members with no page file are listed with a "page not written yet" hint; the rest are linked.

`generateFlowsIndex` writes the flows hub: a single H1, one `### [title-or-slug](slug.md)` per existing flow page in slug order, no copied purpose sentences. The slug fallback applies when a flow page has no parseable frontmatter title.

`generateTopicsIndex` writes the topics hub: a single H1 plus one `[title](slug.md)` link per topic, sorted by `compareTopics` (plan order, then slug).

## Hub synchronization with the ownership gate

<!-- livewiki:anchors: packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncAuxiliaryIndexHub -->

WHY: the orchestrator owns only content it previously wrote. A human-edited hub or a mixed-ownership hub must be preserved byte-for-byte; only an `owner: generated` hub may be replaced or removed. This keeps manual edits sacred and lets the tool converge on every run.

`readHubDeclaredOwner` is the gate. It strips a leading BOM if present, requires an `---\n` (or `---\r\n`) frontmatter opener, normalises CRLF to LF, then asks `parseFrontmatter` for the `owner` field and returns `"generated"`, `"human"`, `"mixed"`, or null (anything else, or any parse failure). The shape mirrors the flow-page owner check used in `init.ts`.

```ts
function readHubDeclaredOwner(content: string): "generated" | "human" | "mixed" | null
```

The signature takes the hub's file content and returns the declared owner, or null when the page has no parseable owner.

`syncFlowsIndexHub` keeps `livewiki/flows/index.md` consistent. When at least one flow page exists: if a non-empty hub is present and its owner is not `generated`, the call returns `skipped-owner` with the preserved path and owner; otherwise the hub is rewritten from `generateFlowsIndex`. When no flow pages exist: a missing hub is a `none`; a present `owner: generated` hub is removed (`removed`); a human, mixed, or unparseable hub is left untouched (`none`).

`syncTopicsIndexHub` applies the same rule to `livewiki/topics/index.md`: when at least one topic presentation exists and the present hub (if any) is `owner: generated`, the hub is rewritten; otherwise the call returns `skipped-owner` with the preserved path and owner. When no topics exist, a missing hub is `none`; a present `owner: generated` hub is removed; a human/mixed/unparseable hub is left untouched (also `none`).

`ensureTopicsIndexScaffold` is the bootstrap variant used before transactional verification: it writes a link-safe empty topics hub (no candidate links, so an interrupted run cannot leave broken navigation behind) when none exists, and otherwise reports `skipped-owner` when a non-generated hub is present or `none` when one already exists.

`syncAuxiliaryIndexHub` applies the same conservative ownership rule to the auxiliary inventory: it rewrites the hub when at least one non-product module exists and the present hub (if any) is `owner: generated`; it removes an `owner: generated` hub when no auxiliary modules remain; and it reports `skipped-owner` (with path + owner) when a human/mixed hub is present.

## Navigate block assembly and per-page rewriting

<!-- livewiki:anchors: packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#buildModuleCoverageNote packages/core/src/navigation.ts#sumModuleSourceBytes packages/core/src/navigation.ts#moduleSourceExceedsBudget packages/core/src/navigation.ts#buildNavigateBlock packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#sameStrings -->

WHY: each generated module page needs a Navigate block that points at the most relevant flow, topics, and related modules without duplicating the universal Quickstart/Tasks/Architecture routes. The block is also the right place to attach an honest coverage note when a folder's source is too large to read in full.

`selectRelatedModules` is the deterministic chooser. It scans the edge list for edges incident to the current module, marks each neighbour as a dependency, a dependent, or both, drops neighbours that have no `Module` record, sorts the survivors by (product role first, then prioritization order, then id), takes the first `limit` (3 by default), and returns `RelatedModule` records with the direction normalised to `"dependency" | "dependent" | "both"`.

`buildModuleCoverageNote` formats the honest coverage note: one deterministic line per folder, parameterised by `module.paths.length` and the rounded kilo-char sum so no two pages share the note verbatim. The wording is plain language — no pipeline-internals jargon — and explicitly says the page documents the folder's main entry points rather than the whole source.

```ts
export function buildModuleCoverageNote(fileCount: number, totalBytes: number): string
```

The signature takes the folder's file count and summed source-byte total, and returns a single-line Markdown blockquote.

`sumModuleSourceBytes` is the byte-total helper. It iterates over `module.paths`, stat's each on disk, and silently skips any path that throws; unreadable paths contribute nothing, mirroring `buildFairTruncatedSource`'s skip-on-error policy.

```ts
async function sumModuleSourceBytes(absRoot: string, module: Module): Promise<number>
```

The signature takes the absolute repo root and a module, and returns the sum of the on-disk sizes of `module.paths` (or 0 when none could be read).

`moduleSourceExceedsBudget` is the public coverage check: a module's summed source exceeds the supplied `charBudget` (the stage-4 fair-share source budget, defaulting to 60_000). Unreadable paths contribute nothing, so a folder with missing files never reads as "too large" because of the misses.

```ts
export async function moduleSourceExceedsBudget(
  absRoot: string,
  module: Module,
  charBudget: number,
): Promise<boolean>
```

The signature takes the absolute repo root, a module, and a character budget, and returns true when the summed source exceeds that budget.

`buildNavigateBlock` assembles the block itself. It opens with the `NAV_START` sentinel and a `## Navigate` heading, then emits a Flow line (when the module participates in exactly one flow — the lowest slug wins) and up to two Topic lines (when the module is listed by up to two topics). It then emits one line per related module with a plain-language relationship label (`"used both ways"`, `"used here"`, or `"depends on this folder"` — never graph jargon). When the source exceeded the budget, a coverage note paragraph is appended. The block closes with the `NAV_END` sentinel.

`updateModuleNavigateBlocks` rewrites each module's Navigate block on disk. For every module whose page exists and whose owner is `generated` or `mixed`, it:

1. loads flow and topic presentations once for the whole pass;
2. builds a `flowByModule` map (lowest slug wins, so a module appears under at most one flow) and a `topicsByModule` map (up to two topics per module);
3. computes the set of linkable module ids — every module in the plan plus only those whose page exists;
4. calls `selectRelatedModules` with edges filtered to the linkable set;
5. computes `sourceBytes` via `sumModuleSourceBytes` and attaches the coverage note when the bytes exceed the char budget (60_000 by default);
6. finds the existing `NAV_START` … `NAV_END` region; if either sentinel is missing or out of order, the module is skipped; if a `lw:manual` block sits inside the existing region, the module is skipped (manual content is sacred);
7. builds the next source by replacing the old region (or appending the new block when no region exists yet);
8. asserts that the `lw:manual` blocks before and after the rewrite match — if they would change, the function throws `Refusing to rewrite <relPath>: lw:manual blocks would change`;
9. writes the new content and records the relative path when it actually changed.

`updateFlowTopicLinks` does the equivalent rewrite on flow pages. It builds a `byFlow` map (up to two topics per flow), loads the current flow presentations, and for each flow page that is `owner: generated` or `owner: mixed`:

1. constructs a bounded topic block wrapped in `TOPIC_RELATED_START` … `TOPIC_RELATED_END` sentinels (or an empty block when the flow has no topics);
2. replaces an existing region when both sentinels are present and in order, otherwise appends the block to the trimmed end;
3. asserts `lw:manual` blocks are unchanged before writing, otherwise throws.

`sameStrings` is the tiny equality helper the rewrites use to compare `lw:manual` matches before and after.

```ts
function sameStrings(a: string[], b: string[]): boolean
```

The signature takes two arrays of strings and returns true exactly when they have equal length and identical entries in the same positions.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/navigation.ts#MODULE_DIGEST_CAP packages/core/src/navigation.ts#RESPONSIBILITY_MAX_CHARS packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildModuleCoverageNote packages/core/src/navigation.ts#buildModuleDigestBlock packages/core/src/navigation.ts#buildNavigateBlock packages/core/src/navigation.ts#buildOrientationBlock packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#extractModuleOpeningDigest packages/core/src/navigation.ts#extractModuleResponsibility packages/core/src/navigation.ts#folderPageTitle packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#groupTasksModules packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadModuleDigests packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#moduleSourceExceedsBudget packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#parseModuleOpening packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#sameStrings packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#sumModuleSourceBytes packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#synthesizePurposeFromDigests packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#updateModuleNavigateBlocks -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Covered by `packages/core/src/navigation.test.ts` (same-name test file on disk).
