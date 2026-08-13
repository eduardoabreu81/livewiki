---
title: Verifying the wiki against the code index
owner: generated
anchors:
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
---

# Verifying the wiki against the code index

This page is responsible for the `verify` command, which checks that the generated documentation on disk is still consistent with the code index and with itself.

## When to use this page

- **Run the full verifier** before merging a docs change or in CI to confirm anchors, manual blocks, and internal links are all still valid.
- **Resolve an internal link target** from a wiki page path, following the wiki's three accepted link shapes, by calling `resolveWikiLink`.
- **Confirm a resolved link stays inside the wiki namespace** as a safety check against `..` paths by calling `isInsideWiki`.
- **Enumerate every checkable wiki artifact** (`.md` pages and `.mmd` diagrams) on disk by calling `collectWikiArtifactPaths`.

## How it fits

`packages/core/src/verify.ts` is a CLI verification module in the livewiki core package. It opens the SQLite index built by the indexing pipeline, walks the `livewiki/` directory fresh from disk (so pages written after the last `index` are still caught), and emits a structured `VerifyResult` that the CLI can render via `formatHuman` and that downstream tools like the Phase 7 viewer can reuse. It depends on `db` for the index, on `anchors` to pull symbol keys out of pages, on `hashes` and `markdown-mask` to verify preserved manual blocks and ignore code-span links, and on `mermaid-validator` to sanity-check standalone diagrams.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-verify.mmd
```

## Discovery: walking the wiki from disk

The verifier never trusts the index for which pages exist — a doc freshly written by an LLM must be caught without first running `index`. Two walkers enumerate the `livewiki/` directory from disk; both skip hidden directories but keep dot-prefixed files (for example, a tier-2 page from a `.github/` source dir like `livewiki/.github.md`).

<!-- lw:anchors packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths -->

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
```

`collectWikiPages` takes the absolute repository root and returns every `.md` page under `livewiki/`, relative to `repoRoot`. It returns a list of `{ relPath }` objects representing full pages that will be scanned for anchors, manual blocks, and links.

```ts
export async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
```

`collectWikiArtifactPaths` takes the absolute repository root and returns the set of every artifact a link is allowed to target — `.md` pages plus `.mmd` diagrams. It returns a `Set<string>` of wiki-relative paths used to detect broken links to non-page artifacts (the verifier must catch a broken link to a deterministic diagram exactly as it catches a broken link to a page). The set is extension-driven, so a future artifact type would only require adding one more suffix here. It is also re-used by the Phase 7 viewer to avoid re-implementing the walker rules.

## Index lookups: what counts as a valid anchor or a preserved block

The DB is opened read-only here, used only to answer two questions: which symbol keys are currently active, and which manual blocks were last seen on each page. The verifier then re-reads the page from disk and compares what it sees against those baselines.

<!-- lw:anchors packages/core/src/verify.ts#run -->

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
```

`run` takes a repository root (the path passed by the CLI) and returns a `VerifyResult` whose `ok` flag is true only when zero error-severity issues were collected, and whose `issues` array carries every diagnostic with severity, code, and wiki path. The function is the public entry point and is responsible for orchestrating the entire verification flow described in this page.

Inside `run`, the verifier pulls all `active` rows from the `symbols` table into a `Map<key, SymbolRow>` so that every anchor extracted from disk can be tested with a single `Map.has` lookup; any key that is missing becomes a `broken_anchor` error — this is the anti-hallucination promise that a freshly written doc is checkable without re-running `index`. Then it pulls every `doc_pages` row into `docPages` (id → wiki_path) and groups the `manual_blocks` rows by `wiki_path`, so for each page on disk it knows which stored blocks to compare against.

After the index is read, `run` walks `livewiki/` via `collectWikiPages`, builds the `existingArtifactPaths` set via `collectWikiArtifactPaths`, and precomputes a `sectionSlugsByPath` map by calling `collectSectionSlugs` for each page. With that scaffolding in place it loops over `wikiPages`, reading each file through the safe-IO layer (a `readText` rejection is treated as "skip this page" via `.catch(() => null)`, not as a fatal error) and parses anchors via `extractAnchors`. If anchor extraction throws, the page is skipped with `continue` rather than aborting the whole run.

For each page, `run` then walks three independent checks; the way their issues are reported is governed by `IssueCode`:

- **Broken anchors.** Page anchors and per-section symbol keys are flattened into a single list and looked up against `activeSymbols`. Any miss becomes a `broken_anchor` error and carries the section slug (or the literal string `"página"` for page-level anchors) in the detail.
- **Manual block preservation.** Stored manual blocks are matched against the blocks currently seen on disk by multiset-of-hash comparison: a stored hash is removed from the unmatched-stored list when its value is found among the unmatched-current hashes, and the comparison uses `sha256` over `source.slice(block.start, block.end)`. Any stored blocks that remain unmatched after the loop become `manual_block_altered` errors and report the expected hash's first 8 hex characters so an operator can locate the divergence. Using a multiset rather than positional offsets is deliberate — preserved blocks can move by any distance when surrounding prose is regenerated, so byte offsets are not stable identities, but a multiset of hashes still detects a missing or changed block while counting duplicate blocks correctly.
- **Internal links.** Links inside fenced code blocks or inline code spans are syntax examples, not navigable references; `run` masks that content with `maskCodeSpans` before scanning, leaving the original `source` untouched. A single regex — `\[([^\]]*)\]\(([^)#]+\.(?:md|mmd))(#([^)]+))?\)/g` — matches only `.md` and `.mmd` targets because both are checkable wiki artifacts. Each match is fed through `resolveWikiLink`, then `isInsideWiki`, then existence-in-`existingArtifactPaths`, then (if a `#section` was supplied) membership in `sectionSlugsByPath`. The link block does not throw on bad input: a `null` from `resolveWikiLink` is treated as a non-wiki link and skipped silently (the comment in the source says it "pode ser link externo ou absolute-path falso"), an `isInsideWiki` failure produces a `broken_internal_link` warning rather than a hard error because `verify` is read-only and only reports the escape, a missing artifact produces a warning, and a missing section slug produces a warning.

After the per-page loop, `run` scans every `.mmd` artifact in `existingArtifactPaths` (sorted for stable output) and feeds its contents to `validateMermaidSyntax`; any non-null diagnostic becomes an `invalid_mermaid_diagram` error pointing at the diagram path. Finally, it diffs `docPages` against the on-disk `seenPaths` and emits a `missing_wiki_path` warning for every indexed page that vanished from the wiki — these are pages deleted between two index runs. The DB is closed in a `finally` block so the connection is released even when a check throws mid-loop.

The returned `VerifyResult` has `ok = true` only when no error-severity issues were collected; warning-only runs still report `ok = true` because the comment header describes `verify` as returning a non-zero exit code only on errors (CI-friendly).

## Section slugs: precomputing link targets

Before the per-page link scan can answer "does `#some-section` exist on the target page?", it needs to know the set of heading slugs on every reachable artifact. That work is done once, up front.

<!-- lw:anchors packages/core/src/verify.ts#collectSectionSlugs -->

```ts
async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>>
```

`collectSectionSlugs` takes the absolute repository root and a wiki-relative page path, then reads the page through the safe-IO layer (a read failure yields an empty set rather than throwing) and runs a global regex `/^(#{1,6})\s+(.+?)\s*$/gm` over its contents. Every captured heading text is run through `slugify` (the same slugifier used by the anchor extractor) and the result is added to the returned set. The function returns a `Set<string>` of heading slugs; `run` keys one of these per page into `sectionSlugsByPath` so the per-page loop only does a `Set.has` lookup per link.

## Link resolution: turning markdown link syntax into wiki paths

A `[text](target.md)` in a page can be written in three shapes, and treating them all the same was the bug the comment block at line 274 calls out ("Q — fix"). `resolveWikiLink` encodes the corrected rules; `isInsideWiki` is the safety net that catches anything that resolved outside the `livewiki/` namespace.

<!-- lw:anchors packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki -->

```ts
export function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
```

`resolveWikiLink` takes the wiki-relative path of the page that contains the link and the raw link target string, and returns the resolved wiki path relative to `repoRoot`, or `null` if the target is not a wiki-valid link (for example, an external link that does not match any of the three accepted shapes). It first strips a leading `./`, then checks for the `"livewiki"` prefix (case 1, return as-is), then for a leading `/` (case 2, strip leading slashes to become repo-relative), and otherwise joins the link against `nodePath.posix.dirname(fromRelPath)` and `normalize`s the result for case 3 (relative links, including `../foo.md`). It returns a `string` on success and `null` for non-wiki-shaped input — it does not validate that the target exists, only that the path resolves syntactically.

```ts
export function isInsideWiki(wikiPath: string): boolean
```

`isInsideWiki` takes a wiki-relative path and returns true if it equals `"livewiki"` or starts with `"livewiki/"`. It returns `true` for the bare namespace (no trailing slash) and for any path nested under it, and `false` otherwise. The function exists as the safety barrier that lets `run` reject relative links whose resolution escaped the namespace — for example, `"../../etc/passwd"` normalizing into `"../etc/passwd"` — and it is exported alongside `resolveWikiLink` so the Phase 7 viewer can apply the exact same gate when rewriting internal links for rendered output.

## Human-readable output

The structured `VerifyResult` is what callers should consume programmatically; the CLI also needs a printable summary.

<!-- lw:anchors packages/core/src/verify.ts#formatHuman -->

```ts
export function formatHuman(result: VerifyResult): string
```

`formatHuman` takes a `VerifyResult` and returns a multi-line string summary: the first line is `livewiki verify: OK|FAILED (<n> pages)`, followed by `no issues.` when `result.issues` is empty, or by a `N errors, M warnings` count line and then every error and warning rendered as `ERROR <wikiPath>: [<code>] <detail>` and `WARN  <wikiPath>: [<code>] <detail>` respectively. The function does no I/O and never throws on the visible evidence; it only reads the fields of the supplied `VerifyResult` and writes them out in a fixed order (errors first, then warnings).

## Tests

Covered by `packages/core/src/verify.test.ts` (same-name test file on disk).
