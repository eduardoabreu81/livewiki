---
title: Wiki integrity verification against the code index
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

# Wiki integrity verification against the code index

This page documents the `verify` module, which validates the wiki against the code index and reports issues.

## When to use this page

- Understand how `verify` detects broken anchors, internal links, and altered manual blocks.
- Learn the resolution rules for internal wiki links and how they are checked.
- Inspect how the module walks the wiki from disk and cross-references it with the database.
- See how verification results are formatted for human consumption.

## How it fits

The `verify` module is the implementation of the `verify` CLI command. It parses the wiki fresh from disk, cross-references it against the symbols and manual blocks stored in the index database, and produces a list of issues. The module is exported for the Phase 7 viewer (`view.ts`), which reuses its artifact-path enumeration and link-resolution logic. It reads the database only to consult active symbols and manual-block baselines; the wiki walk always comes from disk, so pages created after the last `index` run are still validated.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-verify.mmd
```

## Wiki walk and artifact enumeration

<!-- lw:anchors packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths -->

The module must discover what wiki content exists on disk without trusting the database's `doc_pages` table, so it walks the `livewiki/` directory recursively. `collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>` returns the relative paths of all `.md` files; `collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>` returns a set of both `.md` pages and `.mmd` diagrams. Both functions skip hidden directories (whose names start with `.`) but include dot-prefixed files — for example, a tier-2 module from a hidden source directory produces a legitimate page like `livewiki/.github.md`. The artifact set is extension-driven, so adding a future artifact type requires only adding one more suffix. The artifact path set is exported for the viewer so it can enumerate the same canonical set instead of re-inventing walker rules. Both functions return relative paths with forward-slash separators regardless of the host platform.

## Link resolution and containment

<!-- lw:anchors packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki -->

Internal links between wiki pages must be resolved consistently before they can be checked against the artifact set. `resolveWikiLink(fromRelPath: string, linkRaw: string): string | null` takes the path of the page containing the link and the raw link text, and returns the resolved wiki path or `null` if the link is not wiki-valid. It strips a leading `./` (equivalent to a bare filename in the same directory), then accepts three forms: an absolute path within the `livewiki/` namespace (used as-is), an absolute path from the repo root (leading slashes stripped), and a path relative to the directory of `fromRelPath`. The function does not validate whether the target exists — it only resolves the path.

`isInsideWiki(wikiPath: string): boolean` returns `true` if the given path is exactly `livewiki` or starts with `livewiki/`. It is the security barrier used after relative-resolution, preventing a `../` sequence that escapes the wiki namespace from being treated as a valid link. For example, `../../etc/passwd` would resolve to a path outside `livewiki/`, and `isInsideWiki` reports it as such. Both functions are exported for the viewer, which rewrites internal links with exactly the same rules.

## Verification flow

<!-- lw:anchors packages/core/src/verify.ts#run -->

The main orchestration happens in `run(repoRoot: string): Promise<VerifyResult>`. It takes the repository root, resolves it to an absolute path, ensures the `.livewiki` directory exists, and opens the index database. It reads active symbols (to detect broken anchors) and manual blocks (to detect rule #6 violations), then walks the wiki from disk. For each page it extracts anchors, scans for reasoning `<think>` blocks outside code spans, compares stored manual-block hashes byte-for-byte, and resolves every internal link. It also validates every `.mmd` diagram with the Mermaid syntax parser, flags database `doc_pages` that vanished from the wiki, and evaluates the documentation baseline. The function returns a `VerifyResult` with a `ok` flag (no errors), `pagesChecked`, and the full issue list. The database is opened only for reads and is always closed in a `finally` block.

The anchor check is the anti-hallucination promise: a page that was never indexed, created directly by a freshly-generated LLM doc, still reports broken anchors for symbols that do not exist. Manual-block comparison treats offsets as non-identities — regenerated prose can move a preserved block — so it compares the multiset of hashes, detecting missing, changed, or duplicated stored blocks. Link scanning masks code spans and fenced blocks before running the link regex, because links inside them are syntax examples, not navigable references. Link targets that are not inside the wiki namespace are flagged as warnings; targets that do not exist on disk are flagged as broken internal links; and targets that exist but lack a referenced section slug are flagged as well.

## Section slug collection

<!-- lw:anchors packages/core/src/verify.ts#collectSectionSlugs -->

To verify that a link to a section actually points to a real heading, the module needs to know every section slug per page. `collectSectionSlugs(absRoot: string, relPath: string): Promise<Set<string>>` reads the page content, matches Markdown headings of any level, and inserts the slugified heading text into a set. A missing or unreadable page yields an empty set, and the caller treats a target without a matching slug as a broken link. This lets a link like `[text](page.md#section)` be checked for section existence, not just page existence.

## Human-readable reporting

<!-- lw:anchors packages/core/src/verify.ts#formatHuman -->

The final results are presented to the CLI user in a compact, greppable format. `formatHuman(result: VerifyResult): string` takes the verification result and returns a multi-line string starting with a pass/fail line and the page count, then a line summarising error and warning counts. Each issue is printed with its severity, wiki path, issue code, and detail, grouped as errors first and warnings second. When there are no issues, it prints `no issues.` instead of the summary line. This formatter is what makes the exit code meaningful for CI: a non-zero exit code corresponds to at least one error.

## Tests

Covered by `packages/core/src/verify.test.ts` (same-name test file on disk).
