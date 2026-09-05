---
title: Wiki document I/O with human-content protection
owner: generated
anchors:
  - packages/core/src/wiki-document.ts#assertHumanContentPreserved
  - packages/core/src/wiki-document.ts#manualBlockContents
  - packages/core/src/wiki-document.ts#readExisting
  - packages/core/src/wiki-document.ts#readWikiDocument
  - packages/core/src/wiki-document.ts#resolveWikiDocumentPath
  - packages/core/src/wiki-document.ts#writeWikiDocument
---

# Wiki document I/O with human-content protection

This page documents the wiki-only file operations that the livewiki core uses when agent tools read, write, and verify wiki documents.

## When to use this page

- **Understand path safety** when an agent asks the tooling to open a wiki page by a user-supplied path.
- **Trace the write pipeline** from a requested path through verification, rollback, and the final result.
- **Check how manual blocks survive regeneration** before changing content-preservation logic.
- **Debug a failed write** by following exactly which branch produced the error and what state the disk was left in.

## How it fits

`wiki-document.ts` is the narrow I/O boundary between the agent-facing document operations and the filesystem. It does not interpret document structure beyond the ownership metadata and manual-block markers it must protect. Resolving a request into a safe repository-relative path is delegated in two stages: the local normalization and allow-list checks here, then deeper validation in `safe-io.js`. Content preservation consults anchor metadata through `anchors.js`, and the post-write check reuses `verify.js` unless the caller supplies its own verifier.

The file is deliberately small: six symbols cover the whole lifecycle of a wiki page on disk. Callers that only need to read get a one-call path; callers that write get atomic replacement, an optional verification gate, and a rollback story that distinguishes "the old page was restored" from "the new page was never kept."

## Diagram

```mermaid
%% livewiki/diagrams/core-src-wiki-document.mmd
```

## Path resolution

<!-- lw:anchors packages/core/src/wiki-document.ts#resolveWikiDocumentPath -->

`resolveWikiDocumentPath` is the single gate through which every user- or agent-supplied wiki path must pass before any read or write touches the filesystem. Its job is to turn a possibly messy input string into one canonical repository-relative path that is always inside the `livewiki/` tree.

```ts
export async function resolveWikiDocumentPath(repoRoot: string, path: string): Promise<string> {
```

The function takes the repository root and the requested path, and returns a promise for a normalized relative path such as `livewiki/core-src/wiki-document.md`.

It first normalizes backslashes to forward slashes and applies POSIX `normalize`, so `a/../b` becomes `b` and Windows-style separators behave predictably. Absolute paths are rejected in both POSIX and Windows forms, and any normalized path that does not start with `livewiki/` is rejected immediately with `safeIo.PathOutsideAllowlistError`. After that, the function resolves the real repository root and asks `safeIo.resolveAndValidate` for the fully validated target. Because the safe-io layer can also permit `.livewiki/`, the result is converted back to a canonical relative path and checked again: if the canonical path no longer starts with `livewiki/`, the function throws the same allow-list error. This second check is a containment defense against a symlink inside the wiki tree that points into the internal `.livewiki/` directory. A non-existent path that still lands inside `livewiki/` is accepted here, because existence is the concern of the later read or write, not of path resolution.

## Reading wiki documents

<!-- lw:anchors packages/core/src/wiki-document.ts#readWikiDocument packages/core/src/wiki-document.ts#readExisting -->

Reading exists in two layers: the exported `readWikiDocument` is the public operation, while `readExisting` is the internal "does anything exist here yet?" probe used by the write path. Both delegate the actual file access to `safeIo.readText`, so permission and boundary handling stays in one shared implementation.

```ts
export async function readWikiDocument(repoRoot: string, path: string): Promise<string> {
```

`readWikiDocument` takes the repository root and a requested path and returns a promise for the file's text contents. It calls `resolveWikiDocumentPath` first, then reads the canonical path.

```ts
async function readExisting(repoRoot: string, path: string): Promise<string | null> {
```

`readExisting` takes the repository root and an already-canonical path and returns a promise for the file's text contents, or `null` when the file does not exist. It catches errors and treats only an `ENOENT` code as "no existing content". Any other error is rethrown, because a permission problem or I/O failure must not masquerade as an empty page that the write path would then try to replace.

The split exists because `writeWikiDocument` needs to distinguish "no previous page" from "unreadable previous page". `null` from `readExisting` is the only signal that permits the write path to later remove a newly created page during rollback instead of restoring an old one.

## Human-content protection

<!-- lw:anchors packages/core/src/wiki-document.ts#assertHumanContentPreserved packages/core/src/wiki-document.ts#manualBlockContents -->

Before a write replaces anything on disk, `assertHumanContentPreserved` compares the existing page with the candidate content and refuses destructive changes to human-owned parts. It protects two kinds of content: whole pages that declare human ownership, and the manual blocks embedded inside otherwise generated pages. `manualBlockContents` is the extraction helper that finds those blocks.

```ts
function assertHumanContentPreserved(existing: string, candidate: string): void {
```

The function takes the existing page text and the candidate replacement text, and returns nothing when the protected content survives; otherwise it throws.

It first strips a leading byte-order mark from the existing text and reads its anchor metadata through `extractAnchors`. If the existing page declares `owner: human`, the function throws immediately: this file never overwrites a human-owned page, regardless of what the candidate contains.

Next, it collects the protected manual blocks from the existing page. A manual block is any region delimited by the HTML comment opener whose body names `lw:manual` and its matching closing comment. For this file, those regions are located by `manualBlockContents`:

```ts
function manualBlockContents(content: string): string[] {
```

`manualBlockContents` takes the full page text and returns an array of strings, each one the complete matched block including both comment delimiters and everything between them.

The regular expression in `manualBlockContents` matches opening delimiters with flexible internal whitespace, then lazily spans to the first matching closing delimiter. The result preserves the original bytes of each block, which matters because frontmatter parsing elsewhere may normalize line endings before computing offsets; matching against raw content keeps the comparison aligned with what will be written.

When the existing page declares `owner: mixed`, the function additionally requires the candidate to remain `mixed`; otherwise it throws. Finally, it extracts the candidate's own manual blocks and checks that every protected block from the existing page appears verbatim among them. For each protect block, it finds the first exact match and removes that occurrence from the remaining candidate list. If any protected block has no exact match, the function throws `manual_block_altered: existing manual blocks must be preserved byte-for-byte`. The check is order-independent and duplicate-safe because each existing block consumes one matching candidate occurrence.

## Atomic write, verification, and rollback

<!-- lw:anchors packages/core/src/wiki-document.ts#writeWikiDocument -->

`writeWikiDocument` is the lifecycle coordinator for changing a wiki page. It resolves the path, preserves human content, writes atomically, optionally verifies the repository, and then either returns success or restores the previous state. The result type gives callers a machine-readable account of what happened rather than forcing them to inspect exceptions.

```ts
export async function writeWikiDocument(opts: WriteWikiDocumentOptions): Promise<WriteWikiDocumentResult> {
```

The function takes a `WriteWikiDocumentOptions` object containing the repository root, the requested path, the new content, and optional overrides for verification. It returns a promise for a discriminated result: `{ ok: true, path, verified }` on success, or `{ ok: false, path, error }` on failure.

The flow begins by resolving the requested path and reading the existing content through `readExisting`. When a previous page exists, `assertHumanContentPreserved` runs before any filesystem mutation, so a protected manual block or human-owned page causes the function to throw instead of writing. The new content is then written with `safeIo.writeTextAtomic`, passing the expected previous content so the safe-io layer can detect concurrent changes, and placing temporary files under `.livewiki`. If the caller set `skipVerify`, the function returns success immediately with `verified: false`.

Without the skip flag, the function runs verification. It uses the caller-supplied `verify` function when provided, otherwise the default `runVerify` from `verify.js`. The report's issues are filtered down to errors that either have no specific `wikiPath` or normalize to the page's canonical path. If no such issues remain, the write is considered verified and the function returns success with `verified: true`. If issues exist, the function records a failure message that includes the issue count and the first issue's code and detail. If verification itself throws, the function records a crash message instead; both paths continue to rollback rather than returning from inside the success path.

Rollback distinguishes two disk states. When an existing page was present, the function writes that previous content back using the candidate content as the expected current state, restoring the prior page byte-for-byte. When no page existed before, the function checks that the candidate content is still what is on disk and then removes the file, so a failed first write does not leave a new page behind. If rollback itself fails, the result reports the original verification failure plus a warning that the disk may hold an unverified page at the quoted path; if rollback succeeds, the result reports either that the previous page was restored or that the page was not kept. Every failure branch returns through the same `WriteWikiDocumentResult` shape, and no branch silently leaves the write in place after a verification error without saying so in the result.