---
title: README export — deterministic README.md synthesis from the wiki
owner: generated
anchors:
  - packages/core/src/readme-export.ts#README_END
  - packages/core/src/readme-export.ts#README_REL_PATH
  - packages/core/src/readme-export.ts#README_START
  - packages/core/src/readme-export.ts#ReadmeExportError
  - packages/core/src/readme-export.ts#ReadmeExportError.constructor
  - packages/core/src/readme-export.ts#applyReadme
  - packages/core/src/readme-export.ts#buildReadme
  - packages/core/src/readme-export.ts#canonicalBlock
  - packages/core/src/readme-export.ts#exportReadme
  - packages/core/src/readme-export.ts#extractDigests
  - packages/core/src/readme-export.ts#extractHubLinks
  - packages/core/src/readme-export.ts#extractPurpose
  - packages/core/src/readme-export.ts#findReadmeBlock
  - packages/core/src/readme-export.ts#firstPlainParagraph
  - packages/core/src/readme-export.ts#fullFileContent
  - packages/core/src/readme-export.ts#generateReadmeContent
  - packages/core/src/readme-export.ts#readWikiPage
  - packages/core/src/readme-export.ts#refusalMessage
  - packages/core/src/readme-export.ts#sectionLines
  - packages/core/src/readme-export.ts#stripFrontmatter
  - packages/core/src/readme-export.ts#synthesizePurposeFromDigests
---

# README export — deterministic README.md synthesis from the wiki

This module synthesises a `README.md` for the repository from the generated livewiki wiki, without ever rewriting a human-authored file.

## When to use this page

- Run or invoke the `livewiki export readme` command and want to understand what the synthesizer reads from the wiki and how it assembles the block.
- Add a new section to the generated README and need to know which wiki page owns that data.
- Diagnose a refused, unchanged, or dry-run export and want to follow the rule-#6 contract, the marker discipline, and the opt-in flow.

## How it fits

`packages/core/src/readme-export.ts` sits in the core package (alongside `safe-io`, `config`, `frontmatter`, and `understanding`) and implements roadmap item 11 (`export readme`). It is positioned as an **output** of the wiki rather than a peer to it: every sentence in the generated README traces to a wiki page (the quickstart's purpose and digests, the flows/topics hubs) or is a fixed template line — no LLM is ever involved. The module enforces a strict human-content contract (rule #6): it will only create `README.md` from scratch, only replace bytes between its own marker block, and only refuse in the clear absence of opt-in markers. All filesystem access flows through `safe-io` with the `allowReadme: true` exception that mirrors the pointer module's `allowPointer` opt-in, and writes additionally require an explicit `yes` flag, otherwise the call is a dry-run preview.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-readme-export.mmd
```

## Marker block and file addressing

<!-- lw:anchors packages/core/src/readme-export.ts#README_START packages/core/src/readme-export.ts#README_END packages/core/src/readme-export.ts#README_REL_PATH -->

The exported file is identified by the `README.md` constant below, and the managed block is bracketed by the two marker comments declared as strings. These markers form the public contract that lets external parsers find the livewiki-owned region without inspecting prose.

```ts
export const README_START = "<!-- livewiki:readme:start -->";
export const README_END = "<!-- livewiki:readme:end -->";
export const README_REL_PATH = "README.md";
```

`README_START` and `README_END` are the literal HTML comment tokens that delimit the generated section. `README_REL_PATH` is the single relative path (relative to the repository root) that the exporter targets. Together they let every other function in the file refer to the block and the target file without re-stringifying the markers or re-quoting the filename.

## Reading the existing README

<!-- lw:anchors packages/core/src/readme-export.ts#findReadmeBlock packages/core/src/readme-export.ts#applyReadme packages/core/src/readme-export.ts#canonicalBlock packages/core/src/readme-export.ts#fullFileContent packages/core/src/readme-export.ts#refusalMessage -->

The export never writes blindly. Before any change it locates the existing block and decides which of three modes applies: create from scratch, replace the block, or refuse. `applyReadme` is the pure decision function that implements the rule-#6 contract:

```ts
export function applyReadme(
  existing: string | null,
  generated: string,
): ReadmeApplyResult
```

`applyReadme` takes the existing file contents (or `null` when absent) plus the freshly generated block **body** (no markers) and returns either a concrete action with the file content to write or a refusal payload — it never throws.

It depends on three helpers. `findReadmeBlock` scans a file string for the marker pair, tolerating whitespace inside the comment tokens; it returns the indices of both markers and the inner slice, or `null` when either marker is missing:

```ts
export function findReadmeBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null
```

```ts
function canonicalBlock(inner: string): string
```

```ts
function fullFileContent(inner: string): string
```

```ts
function refusalMessage(): string
```

`canonicalBlock` assembles the marker-delimited body that gets written inside an existing file. `fullFileContent` wraps that block with a one-line provenance comment for the create-from-scratch case. `refusalMessage` returns the fixed opt-in instructions emitted when a human-authored `README.md` is encountered without markers.

The flow inside `applyReadme` is therefore: when `existing` is `null`, return `create` using `fullFileContent(generated)`; otherwise call `findReadmeBlock` — if it returns `null`, refuse with `refusalMessage()`; otherwise splice `canonicalBlock(generated)` between the marker indices and compare to the original to choose between `replace-block` and `unchanged`. The whole function is a value-in / value-out decision; side effects belong to `exportReadme`.

## Wiki evidence extraction

<!-- lw:anchors packages/core/src/readme-export.ts#stripFrontmatter packages/core/src/readme-export.ts#sectionLines packages/core/src/readme-export.ts#firstPlainParagraph packages/core/src/readme-export.ts#extractPurpose packages/core/src/readme-export.ts#extractDigests packages/core/src/readme-export.ts#extractHubLinks packages/core/src/readme-export.ts#synthesizePurposeFromDigests packages/core/src/readme-export.ts#readWikiPage -->

The block body is built deterministically from the wiki. Every step is a small pure parser that consumes wiki page text and yields structured data, so the README never depends on an LLM and never re-derives content already living in the wiki.

`stripFrontmatter` calls the shared `parseFrontmatter` and returns its `.body`; if parsing throws it falls back to the original content, so a malformed frontmatter block never blocks the export:

```ts
function stripFrontmatter(content: string): string
```

```ts
function sectionLines(lines: string[], headingRe: RegExp): string[] | null
```

```ts
function firstPlainParagraph(lines: string[]): string | null
```

`sectionLines` finds the first line matching `headingRe` and returns all lines up to the next ATX heading (or end-of-file). `firstPlainParagraph` collects consecutive non-blank lines that are not headings, list items, provenance italics, bold labels, or blockquotes; lines that aren't paragraph material are skipped while the buffer is empty and terminate the paragraph once the buffer is non-empty.

`extractPurpose` walks the quickstart body for an `## What this repository is` section and returns its first plain paragraph; if that section is absent it falls back to the first plain paragraph of the whole page, returning `null` only when neither yields text:

```ts
function extractPurpose(quickstartBody: string): string | null
```

`extractDigests` finds the `## What you'll find in this wiki` section and parses its `** [title](link) ** — responsibility?` bullets into `ReadmeDigest` records, capping the result at `README_DIGEST_CAP = 6` to mirror the navigation module:

```ts
function extractDigests(quickstartBody: string): ReadmeDigest[]
```

`extractHubLinks` scans a hub page for `###` or `-` lines of the form `[title](target)` and rewrites the target as `livewiki/<hubDir>/<target>`, yielding `HubLink` records used to emit the "How it works" and "Concept topics" sections of the README.

`synthesizePurposeFromDigests` is the deterministic no-purpose fallback: it joins up to three digest titles with their responsibilities into a sentence like `This repository is organized around X, Y, and Z.`, returning `null` when no digest has a responsibility:

```ts
function synthesizePurposeFromDigests(digests: ReadmeDigest[]): string | null
```

`readWikiPage` is the only side-effecting reader in this group; it delegates to `safe-io.readText` and returns `null` when the file does not exist (or any error is thrown), letting the orchestrator treat absence as "no data" without try/catch noise:

```ts
async function readWikiPage(
  repoRoot: string,
  relPath: string,
): Promise<string | null>
```

## Building the README block

<!-- lw:anchors packages/core/src/readme-export.ts#buildReadme packages/core/src/readme-export.ts#generateReadmeContent packages/core/src/readme-export.ts#ReadmeExportError packages/core/src/readme-export.ts#ReadmeExportError.constructor -->

The block body is composed by `buildReadme`, with `generateReadmeContent` exposed as the public entry point that returns just the body string.

```ts
async function buildReadme(
  repoRoot: string,
): Promise<{ content: string; notes: string[] }>
```

```ts
export async function generateReadmeContent(repoRoot: string): Promise<string>
```

```ts
export class ReadmeExportError extends Error {
  public readonly code: "missing_wiki";

  constructor(code: "missing_wiki", message: string) {
    super(message);
    this.name = "ReadmeExportError";
    this.code = code;
  }
}
```

`ReadmeExportError` carries a single `code` discriminator (`"missing_wiki"`) and is thrown when the wiki itself is missing — at minimum, when `livewiki/quickstart.md` is unreadable, the exporter cannot proceed and the orchestrator surfaces this structured error.

`buildReadme` resolves the repository root, reads the quickstart via `readWikiPage`, strips frontmatter, loads `LivewikiConfig` (falling back to an empty config when loading fails), and emits a non-fatal note when the configured wiki language is not English so callers know template headings stay English even when prose does not. It then assembles the purpose paragraph using a fixed-priority chain — the understanding synthesis (`loadUnderstandingSynthesis`) is preferred when present, then `extractPurpose`, then `synthesizePurposeFromDigests`, then a fixed `This is the \`<repoName>\` repository.` sentence — followed by the digests, flows, and topics sections, each rendered only when its source page yielded data. The function returns the trimmed body and any notes collected along the way; `generateReadmeContent` simply discards the notes and returns the content.

## Orchestrating the export

<!-- lw:anchors packages/core/src/readme-export.ts#exportReadme -->

The exported orchestrator wires generation, decision, and `safe-io` writes together, and is the only entry point that performs filesystem writes.

```ts
export async function exportReadme(
  repoRoot: string,
  opts?: ReadmeExportOptions,
): Promise<ReadmeExportResult>
```

`exportReadme` resolves the repository root, treats `opts.yes !== true` as a dry-run, calls `buildReadme` to get the new body and notes, then probes for `README.md` via `safeIo.exists` (with `{ allowReadme: true }`) and reads it with the same option when present. It feeds the existing content (or `null`) into `applyReadme` along with the new body and branches on the result:

- **Refusal** — the result carries `action: "refused"`, the refusal message, zero `bytesChanged`, and no write is attempted.
- **Dry-run** (no `yes`) — when the applied action is not `unchanged`, the result includes a `preview` of the first `PREVIEW_LINES = 12` lines of the would-be file; no write is performed and `bytesChanged` is `0`.
- **`unchanged` write** — returned as-is with `bytesChanged: 0`; `safe-io.writeText` is not called.
- **`create` or `replace-block` write** — `safeIo.writeText` is invoked with the same `allowReadme: true` option, and `bytesChanged` reflects `applied.content.length - (existing?.length ?? 0)`.

The result type `ReadmeExportResult` carries `ok`, `action`, `dryRun`, an absolute `path`, `bytesChanged`, an optional `refusal` message, the `notes` array, and an optional `preview`. Together these let callers tell success from refusal, distinguish real edits from dry-runs, and surface the same non-fatal observations (`buildReadme`'s language note, for example) regardless of whether bytes hit disk.

## Tests

Covered by `packages/core/src/readme-export.test.ts` (same-name test file on disk).
