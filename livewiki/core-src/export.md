---
title: Livewiki exporter
owner: generated
anchors:
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
---

# Livewiki exporter

This module transforms an on-disk `livewiki/` snapshot into a flattened destination tree under `.livewiki/export/<target>/`, producing wiki pages that third-party hosts can consume.

## When to use this page

- **Configure the supported export targets** by consulting `EXPORT_TARGETS` and the home-page rename table when adding or renaming a host flavor.
- **Diagnose a failed `livewiki export` run** by mapping an `ExportIssue` code from the returned `issues` array back to the preflight stage that produced it.
- **Trace an internal-link rewrite** by following the link parsing and path resolution helpers when a rewritten href looks wrong.
- **Audit the preflight gate** before changing anything that touches `safeIo`, since every write goes through the allowlist.

## How it fits

This file lives at `packages/core/src/export.ts` and is the public face of the `exporter` namespace that the core package re-exports. Its only external entry point is `exportWiki(opts)`, which the CLI orchestrator calls after the user picks a target and flags. Internally the module is split into a small set of cooperating groups: an enumeration pair (`enumerateSourcePages`, `enumerateDestination`), a path/header utility cluster (`flattenPath`, `buildMarker`, `splitRawFrontmatter`, `stripAnchorsField`, `renderMarkdownHeader`, `detectMarker`, `stripAnchorMarkers`), a per-page transform dispatcher and its `.md`/`.mmd` branches (`transformPage`, `transformMarkdownPage`, `transformMermaidPage`, `replaceMermaidPlaceholder`), and an inline-link rewriting cluster (`parseLinkHref`, `resolveLinkSource`, `rewriteInternalLinks`, `ensureExtension`, `errMessage`). Every filesystem action flows through the `safe-io` allowlist; the destination root `.livewiki/export/<target>/` is inside the existing `.livewiki/` allowlist, so no `safe-io` exception is needed.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-export.mmd
```

## Preflight and contract

The exporter is a deterministic preflighted transformer: the entire source-to-destination translation is computed in memory, every predictable destination conflict is classified, and only then does it touch the filesystem. A preflight failure leaves the destination unchanged; an unforeseen filesystem failure mid-write may leave the derived export partially updated and is reported as a `write_failed` issue so an idempotent rerun can repair it.

`exportWiki` is the only entry point and returns an `ExportResult` describing what happened:

```ts
export async function exportWiki(opts: ExportOptions): Promise<ExportResult>
```

`exportWiki` takes an `ExportOptions` record (`repoRoot`, `target`, `force?`, `push?`) and returns a promise that resolves to an `ExportResult` describing the outcome.

<!-- lw:anchors packages/core/src/export.ts#exportWiki packages/core/src/export.ts#validateTarget packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#errMessage -->

The function first normalizes the request. `validateTarget` checks that the requested target is one of the three supported values; the supported set is declared by `EXPORT_TARGETS`. Anything else is rejected up-front with an `ExportError` carrying an `invalid_target` issue:

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
```

`EXPORT_TARGETS` is a frozen readonly array of the three supported `ExportTarget` strings (`"generic"`, `"github-wiki"`, `"gitlab-wiki"`).

```ts
export function validateTarget(target: string): ExportTarget
```

`validateTarget` takes a candidate target string and returns it narrowed to the `ExportTarget` union, throwing an `ExportError` listing the invalid value when the input is not recognized.

```ts
export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) {
    super(issues.map((i) => `${i.code}: ${i.detail}`).join("\n"));
    this.name = "ExportError";
    this.issues = issues;
  }
}
```

`ExportError` is an `Error` subclass that carries the structured `ExportIssue[]` that triggered the failure, and `ExportError.constructor` builds it from the issue list, joining each issue's `code` and `detail` into the `Error.message`. `errMessage` is the cross-cutting helper that extracts a printable message from any thrown value (including non-`Error` throws) so issue `detail` strings never crash on `null` or a primitive.

After target validation, `exportWiki` rejects `--push` with an `invalid_push` issue before any I/O (Lot 6A does not implement publication), then validates that both the source root and the destination root are accepted by the `safe-io` allowlist. The destination root `.livewiki/export/<target>/` lives inside the existing `.livewiki/` allowlist, so the second validation should normally succeed. If `safeIo.exists` reports that `livewiki/` is missing, the function bails with a `source_not_initialized` issue.

## Source enumeration

Before any transformation, the exporter walks the source tree to collect every `.md` and `.mmd` page under `livewiki/`. This walk is where path safety is enforced for the source side.

<!-- lw:anchors packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#flattenPath -->

```ts
async function enumerateSourcePages(
  absRoot: string,
  safeLivewikiDir: string,
  issues: ExportIssue[],
): Promise<SourcePage[]>
```

`enumerateSourcePages` takes the lexical repo root, the `safeIo`-validated realpath of `livewiki/`, and the shared issues array, and returns a sorted list of `SourcePage` records (each with `rel`, `safeRel`, `ext`, and `raw` text) that drives every downstream step.

The walker uses `nodeFs.readdir` against the realpath that `safeIo.resolveAndValidate` already accepted, then resolves each entry's `rel` path **relative to that realpath**, not to the lexical `repoRoot`. This matters on platforms where the lexical and real paths diverge (macOS `/var` → `/private/var`, Windows 8.3 short names): a relative-from-lexical walk would otherwise produce paths containing `..` segments that poison every later `safeIo` call. The walker skips the manifest file, recurses through directories, and reads each `.md`/`.mmd` candidate via `safeIo.readText` so a symlink escape surfaces as a `source_path_unsafe` issue here, not at write time.

```ts
function flattenPath(rel: string, target: ExportTarget): string
```

`flattenPath` takes a source-relative path like `architecture/overview.md` together with the chosen target, and returns the destination's flat filename (for example `architecture-overview.md`), honoring the `HOME_MAPPING` rename for `livewiki/quickstart.md` and remapping `.mmd` sources to `.md` destinations.

The home-page rename is performed *before* directory flattening so `livewiki/quickstart.md` always lands at the host-specific home file (`Home.md` for GitHub, `home.md` for GitLab, `quickstart.md` for `generic`) without colliding with another source that already flattens to the same name. The same function also detects flattening collisions in the orchestrator: two source paths that flatten to the same destination name produce a fatal `flattening_collision` issue and abort the run before any write.

## Per-page transformation

Once the source is enumerated and indexed, the exporter transforms each page in memory. The dispatcher chooses between Markdown and Mermaid branches based on the source extension.

<!-- lw:anchors packages/core/src/export.ts#transformPage packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#buildMarker packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#replaceMermaidPlaceholder -->

```ts
function transformPage(
  page: SourcePage,
  target: ExportTarget,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string
```

`transformPage` takes a single `SourcePage`, the chosen `ExportTarget`, the source-to-destination index, and the shared issues array, and returns the fully rendered destination text for that page (dispatching to the Mermaid branch for `.mmd` sources and to the Markdown branch otherwise). Any `ExportError` thrown from a branch is caught by the orchestrator so its structured issues survive the round trip.

```ts
function transformMarkdownPage(
  page: SourcePage,
  target: ExportTarget,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string
```

`transformMarkdownPage` takes the same arguments as `transformPage` and returns the Markdown destination text: a regenerated header (frontmatter with `anchors:` stripped, then a generated marker line) followed by the body after placeholder replacement, marker stripping, and internal-link rewriting.

```ts
function transformMermaidPage(page: SourcePage): string
```

`transformMermaidPage` takes a `SourcePage` and returns the destination Markdown text, wrapping the diagram body in a fenced ` ```mermaid ` block preceded by the generated marker line.

The Markdown branch assembles the destination in three pieces. First, `renderMarkdownHeader` produces the frontmatter + marker header. The header builder needs to preserve the source's exact line endings (a CRLF source must not receive a mixed LF-marker / CRLF-body output), so it uses `splitRawFrontmatter` — a raw, EOL-aware split — rather than `parseFrontmatter(...).bodyOffset`, which would belong to a parser-normalized LF string.

```ts
function splitRawFrontmatter(source: string): {
  frontmatter: string | null;
  body: string;
  fmStart: number;
  fmEnd: number;
}
```

`splitRawFrontmatter` takes the raw source string and returns the frontmatter block, the post-frontmatter body, and the byte offsets of the opening and closing `---` delimiters (or sentinel `-1` values when there is no frontmatter); CRLF is preserved by matching the two delimiter lines verbatim.

```ts
function renderMarkdownHeader(source: string, sourceRel: string): string
```

`renderMarkdownHeader` takes the raw source string and the source-relative path, and returns the destination header: the retained frontmatter (with `anchors:` stripped) followed by the generated marker line, using the source's own line endings throughout. A malformed frontmatter (opening `---` with no closing `---`) is reported by re-throwing a descriptive `Error`; the orchestrator wraps that into a `frontmatter_parse_error`.

```ts
function stripAnchorsField(frontmatterBlock: string): string
```

`stripAnchorsField` takes the raw frontmatter block (between the `---` delimiters) and returns the same block with the top-level `anchors:` field removed, preserving every other field's order, spelling, and the source's line ending (CRLF inputs come out CRLF). The narrow raw-text removal handles the list form, the inline form (`anchors: []` or a single-line scalar with a non-whitespace value), and the inline-with-trailing-comment form.

The marker is composed by `buildMarker` from the path relative to `livewiki/`, using two exported string constants that define the prefix and suffix of the marker comment:

```ts
function buildMarker(sourceRel: string): string
```

`buildMarker` takes a source-relative path and returns the marker comment string for that page, composed from `GENERATED_MARKER_PREFIX`, the path with the `livewiki/` prefix stripped, and `GENERATED_MARKER_SUFFIX`.

```ts
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
```

`GENERATED_MARKER_PREFIX` and `GENERATED_MARKER_SUFFIX` are the literal opening and closing halves of the marker comment that the exporter inserts into every destination page and that the destination enumerator scans for.

After the header, the body passes through three body-level transformations. `stripAnchorMarkers` removes any `lw:anchors` comments left behind in the source body so the destination page is anchor-marker-free (the `anchors:` frontmatter field is removed earlier by `stripAnchorsField`; this stripper targets only the in-body marker comments):

```ts
function stripAnchorMarkers(body: string): string
```

`stripAnchorMarkers` takes the body string and returns the same body with every `                       ` comment removed.

```ts
function replaceMermaidPlaceholder(
  body: string,
  pageRel: string,
  pageIndex: Map<string, string>,
): string
```

`replaceMermaidPlaceholder` takes the body string, the source-relative path of the page being transformed, and the source-to-destination index; it returns the body with every `%% livewiki/<path>.mmd` placeholder inside a fenced ` ```mermaid ` block replaced by a Markdown link to the generated diagram page. If the referenced `.mmd` does not exist in the page index, the function throws an `ExportError` carrying a `missing_diagram` issue.

The Mermaid branch (`transformMermaidPage`) is simpler: it normalizes the source body to LF, emits the marker on its own line, then wraps the body in a fenced ` ```mermaid ` block.

## Internal-link rewriting

Links in the body are rewritten in place so they point at the destination's flat filenames. The rewriter deliberately leaves external URLs, scheme-bearing links, fragment-only links, query-only links, fenced code blocks, and inline code spans alone; it also preserves each link's optional title, query string, and fragment.

<!-- lw:anchors packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#ensureExtension -->

```ts
function rewriteInternalLinks(
  body: string,
  sourceRel: string,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string
```

`rewriteInternalLinks` takes the body string, the source-relative path of the page being transformed, the source-to-destination index, and the shared issues array; it returns the body with every internal Markdown link rewritten to point at the destination's flat filename. Links that cannot be resolved are reported as `broken_internal_link` issues but left visible in the output (the function does not silently delete them).

The rewriter works in three steps. First, it masks code spans and code blocks with a length-preserving mask so that link-shaped text inside backticks cannot be matched. Second, it splits every Markdown link target into its component parts via `parseLinkHref`:

```ts
function parseLinkHref(href: string): ParsedLink
```

`parseLinkHref` takes a Markdown link's URL string and returns a `ParsedLink` (`pathPart`, `query`, `fragment`, `title`); the rewriter only mutates `pathPart` and rejoins the rest verbatim.

External-looking paths (anything with a scheme, including `http://`, `https://`, `mailto:`) and empty `pathPart` values (fragment-only or query-only links) are emitted unchanged. Internal paths are resolved to a source-relative path under `livewiki/` by `resolveLinkSource`:

```ts
function resolveLinkSource(pathPart: string, sourceRel: string): string
```

`resolveLinkSource` takes a link's path portion and the source-relative path of the page containing the link, and returns the resolved source path under `livewiki/`, handling repo-root absolute paths (`/foo.md`), relative paths (`./foo.md`, `../foo.md`), bare filenames, and paths that already start with `livewiki/`.

A path that resolves to a known source in the `pageIndex` is rewritten to the destination's flat name (with the original query, fragment, and title reattached). A path that does not resolve is reported as a `broken_internal_link` issue and the original link is preserved unchanged so the user can see and fix it. `ensureExtension` is the small helper that appends `.md` when the resolved path has no recognized extension:

```ts
function ensureExtension(path: string): string
```

`ensureExtension` takes a path string and returns it with `.md` appended when it has no recognized extension; otherwise the path is returned unchanged.

## Destination enumeration and preflight

With every source page transformed, the exporter enumerates the existing destination tree to classify each entry before any write. This is the second safety gate: planned entries that are directories, symlinks, special files, or unreadable files are *never* force-overwritten; only ordinary readable files without a matching marker are forceable.

<!-- lw:anchors packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#detectMarker -->

```ts
async function enumerateDestination(
  absRoot: string,
  target: ExportTarget,
  safeOutDir: string,
  plannedDestNames: Set<string>,
  issues: ExportIssue[],
): Promise<Map<string, DestinationEntry>>
```

`enumerateDestination` takes the lexical repo root, the chosen `ExportTarget`, the `safeIo`-validated realpath of the destination root, the set of destination names this run plans to write, and the shared issues array; it returns a map from each destination-side flat name to a `DestinationEntry` (with `name`, `text`, `markerSource`, and an `unsafe` flag). Entries not in `plannedDestNames` are reported on the side and do not block the export; entries in the planned set that turn out to be directories, symlinks, special files, or unreadable files are reported as fatal `destination_unsafe` issues.

Each candidate file is read through `safeIo.readText` (so an allowlist violation surfaces here, not at write time). A scanner then searches the file's header region for the livewiki marker:

```ts
function detectMarker(text: string): string | null
```

`detectMarker` takes a destination file's text and returns the source path it was generated from (the value inside the marker's `source="..."` attribute), or `null` when no marker is found within the first 32 body lines after any frontmatter block. The header-only window is intentional: the marker is always emitted in the page header, so a deep scan is unnecessary and slow.

After enumeration, the orchestrator classifies every entry into one of three buckets. Unsafe entries that are also planned (a directory where a file is expected, a symlink escape, a non-regular file, or an unreadable file) are *always fatal* — `--force` does not bypass them. Planned entries that are ordinary readable files but whose marker points at a different source (or that have no marker) are *forceable*: they abort without `--force` and downgrade to a warning when `--force` is set. Entries outside the planned set are kept on the side for the removal phase: a stale file with a marker is eligible for removal; a stale file without a marker is left in place, since the exporter cannot prove it belongs to a previous run.

If the preflight produced any error-severity issue — flattening collisions, fatal planned destination conflicts, forceable conflicts without `--force`, missing diagrams, broken internal links, malformed frontmatter, or unsafe source/destination paths — `exportWiki` returns `ok: false` with zero writes recorded. Only when the preflight is clean does the function proceed to the write and removal phases.

## Write and removal phases

The actual filesystem mutation is the smallest part of the file: it is gated by every preflight above and routes every operation through `safe-io`.

`exportWiki` ensures the destination directory exists via `safeIo.mkdir` (any failure is reported as `write_failed` and aborts). Phase 1 walks the in-memory `transformed` array, byte-comparing each entry against the existing destination text; identical files are skipped. Non-identical files are written via `safeIo.writeText`, and the first write failure aborts the run with a `write_failed` issue carrying the partial write count. Phase 2 walks the stale set (existing destination files that *had* a marker and are no longer in this run's planned set) and removes each via `safeIo.remove`; removal failures are recorded but do not abort the run, since the next idempotent rerun can finish the cleanup.

Throughout the file, `errMessage` is the cross-cutting helper that converts any thrown value into a printable string for `ExportIssue.detail`:

```ts
function errMessage(err: unknown): string
```

`errMessage` takes any thrown value (`Error`, primitive, object) and returns a printable string for inclusion in an `ExportIssue.detail`; non-`Error` values are coerced safely so the catch site cannot itself throw on `null` or a primitive.

The final `ExportResult` reports `ok` based on whether any error-severity issue was produced, plus `pagesWritten`, `pagesRemoved`, the destination `outDir`, and the full `issues` array so the caller can surface structured diagnostics to the user.

## Tests

Covered by `packages/core/src/export.test.ts` (same-name test file on disk).
