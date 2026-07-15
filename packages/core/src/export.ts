/**
 * export — Phase 6 Lot 6A. Local deterministic transformation of the
 * on-disk `livewiki/` snapshot into a flattened destination tree under
 * `.livewiki/export/<target>/`.
 *
 * The export NEVER touches `livewiki/` (the source). The transform
 * and the destination safety preflight run entirely against the
 * current source and destination state BEFORE any write. A preflight
 * failure leaves the destination tree unchanged. An unforeseen
 * filesystem failure during write or removal may leave the derived
 * export partially updated; the command returns exit 1 in that
 * case and an idempotent rerun repairs it. This is the honest
 * contract — not a transactional atomic snapshot.
 *
 * Three targets: `generic` (no rename), `github-wiki` (Home.md), and
 * `gitlab-wiki` (home.md). No host-specific anchor prefix is added.
 * No `--out`, no `--push`, no Git subprocess, no network.
 *
 * All production writes, directory creation, removals, and individual
 * file reads go through `safe-io` (rule #1 of SPEC.md: writes only via
 * allowlist). The destination root is `.livewiki/export/<target>/`,
 * which is inside the existing `.livewiki/` allowlist — no safe-io
 * exception is needed. Direct `nodeFs.readdir` is permitted only
 * AFTER `safeIo.resolveAndValidate` has accepted the directory path,
 * for the purpose of enumerating entries.
 *
 * Unsafe or unreadable PLANNED destination entries (a directory where
 * a file is expected, a symlink escape, a non-regular file) are
 * NEVER forceable. `--force` applies only to an ordinary readable
 * regular file that lacks the expected marker or has a marker for
 * another source. An unrelated directory, symlink, special file, or
 * unreadable file whose name is NOT in the planned destination set
 * is left untouched and does not block the export.
 *
 * Public surface: `exportWiki(opts: ExportOptions): Promise<ExportResult>`.
 * Exported as the `exporter` namespace from the core index.
 */

import * as nodePath from "node:path";
import type { Dirent } from "node:fs";
import * as nodeFs from "node:fs/promises";
import * as safeIo from "./safe-io.js";
import { parseFrontmatter } from "./frontmatter.js";
import { maskCodeSpansPreservingLength } from "./markdown-mask.js";

/** Targets the export knows about. */
export type ExportTarget = "generic" | "github-wiki" | "gitlab-wiki";

/** All valid targets. */
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;

/** Mapping from `livewiki/quickstart.md` to the destination filename per target. */
const HOME_MAPPING: Record<ExportTarget, string> = {
  generic: "quickstart.md",
  "github-wiki": "Home.md",
  "gitlab-wiki": "home.md",
};

/** Marker inserted into every exported page. */
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";

/** Header region size in which the marker is searched. */
const MARKER_HEADER_BODY_LINES = 32;

export type ExportIssueCode =
  | "invalid_target"
  | "invalid_push"
  | "source_not_initialized"
  | "source_path_unsafe"
  | "destination_path_unsafe"
  | "empty_source"
  | "frontmatter_parse_error"
  | "missing_diagram"
  | "broken_internal_link"
  | "flattening_collision"
  | "destination_conflict"
  | "destination_unsafe"
  | "write_failed";

export type ExportIssueSeverity = "error" | "warning";

export interface ExportIssue {
  code: ExportIssueCode;
  severity: ExportIssueSeverity;
  path: string;
  detail: string;
}

export interface ExportOptions {
  repoRoot: string;
  target: ExportTarget;
  /** Overwrite destination files that lack a matching livewiki marker. */
  force?: boolean;
  /**
   * Optional push remote. NOT supported in Lot 6A; the orchestrator rejects
   * this option with a structured error before any I/O.
   */
  push?: string;
}

export interface ExportResult {
  ok: boolean;
  target: ExportTarget;
  outDir: string;
  pagesWritten: number;
  pagesRemoved: number;
  issues: ExportIssue[];
}

interface SourcePage {
  /** Repository-relative path with forward slashes, e.g. `livewiki/foo.md`. */
  rel: string;
  /** Path passed to safeIo for read. */
  safeRel: string;
  ext: string;
  raw: string;
}

interface DestinationEntry {
  /** Destination-side name (flat), e.g. `foo.md`. */
  name: string;
  /** Decoded text content, or null if unreadable. */
  text: string | null;
  /** Marker source path, or null if the file has no valid marker. */
  markerSource: string | null;
  /** True when the entry is unsafe to read or write (symlink, directory, etc.). */
  unsafe: boolean;
}

export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) {
    super(issues.map((i) => `${i.code}: ${i.detail}`).join("\n"));
    this.name = "ExportError";
    this.issues = issues;
  }
}

/** Validate the target. Throws ExportError on failure. */
export function validateTarget(target: string): ExportTarget {
  if (EXPORT_TARGETS.includes(target as ExportTarget)) {
    return target as ExportTarget;
  }
  throw new ExportError([
    {
      code: "invalid_target",
      severity: "error",
      path: target,
      detail: `unknown export target "${target}"; supported: ${EXPORT_TARGETS.join(", ")}`,
    },
  ]);
}

/**
 * Main entry point. The contract:
 *   - The full source transformation and all predictable destination
 *     conflicts are preflighted before any write.
 *   - A preflight failure leaves the destination unchanged.
 *   - An unforeseen filesystem failure during write or removal may
 *     leave the derived export partially updated; the command
 *     returns exit 1 and an idempotent rerun repairs it.
 */
export async function exportWiki(opts: ExportOptions): Promise<ExportResult> {
  const target = validateTarget(opts.target);
  const absRoot = nodePath.resolve(opts.repoRoot);
  const outDir = nodePath.join(absRoot, ".livewiki", "export", target);

  const issues: ExportIssue[] = [];

  // Reject --push before any I/O.
  if (opts.push !== undefined) {
    issues.push({
      code: "invalid_push",
      severity: "error",
      path: "--push",
      detail: "Git publication is not available in Phase 6 Lot 6A.",
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Validate that BOTH the source and the destination root are within the
  // safe-io allowlist. We never call safeIo.read/write on a path that
  // has not been resolved through safeIo.resolveAndValidate. The
  // source and destination roots are both under `.livewiki/` (livewiki/
  // is itself in the allowlist), so this check should succeed.
  let safeLivewikiDir: string;
  let safeOutDir: string;
  try {
    safeLivewikiDir = await safeIo.resolveAndValidate(absRoot, "livewiki");
  } catch (err) {
    issues.push({
      code: "source_path_unsafe",
      severity: "error",
      path: "livewiki/",
      detail: `safe-io rejected the source path: ${errMessage(err)}`,
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }
  try {
    safeOutDir = await safeIo.resolveAndValidate(absRoot, `.livewiki/export/${target}`);
  } catch (err) {
    issues.push({
      code: "destination_path_unsafe",
      severity: "error",
      path: `.livewiki/export/${target}/`,
      detail: `safe-io rejected the destination path: ${errMessage(err)}`,
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Confirm `livewiki/` exists. Use safeIo.exists to stay inside the
  // allowlist (it also re-validates symlinks).
  const livewikiExists = await safeIo.exists(absRoot, "livewiki").catch(() => false);
  if (!livewikiExists) {
    issues.push({
      code: "source_not_initialized",
      severity: "error",
      path: "livewiki/",
      detail: "livewiki/ not found — run `livewiki init` first",
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Enumerate source pages via safeIo (reads through the allowlist).
  const source = await enumerateSourcePages(absRoot, safeLivewikiDir, issues);
  if (source.length === 0) {
    issues.push({
      code: "empty_source",
      severity: "error",
      path: "livewiki/",
      detail: "no exportable .md or .mmd files under livewiki/",
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Build the pageIndex (source rel -> flattened dest name) and detect
  // collisions. Collisions are a fatal preflight error.
  const pageIndex = new Map<string, string>();
  for (const p of source) {
    pageIndex.set(p.rel, flattenPath(p.rel, target));
  }
  const destNames = new Set<string>();
  for (const p of source) {
    const destName = pageIndex.get(p.rel)!;
    if (destNames.has(destName)) {
      issues.push({
        code: "flattening_collision",
        severity: "error",
        path: p.rel,
        detail: `flattens to "${destName}" which is also produced by another source file`,
      });
    }
    destNames.add(destName);
  }

  // Transform every page in memory.
  const transformed: Array<{
    sourceRel: string;
    destName: string;
    text: string;
  }> = [];
  for (const page of source) {
    const destName = pageIndex.get(page.rel)!;
    try {
      const text = transformPage(page, target, pageIndex, issues);
      transformed.push({ sourceRel: page.rel, destName, text });
    } catch (err) {
      if (err instanceof ExportError) {
        for (const issue of err.issues) issues.push(issue);
      } else {
        issues.push({
          code: "frontmatter_parse_error",
          severity: "error",
          path: page.rel,
          detail: errMessage(err),
        });
      }
    }
  }

  // Preflight gate: any per-page error aborts the entire export.
  if (issues.some((i) => i.severity === "error")) {
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Enumerate the destination. The directory may not exist yet (clean
  // first export). Pass the planned destination-name set so we can
  // distinguish a PLANNED entry that is unsafe (directory where a file
  // is expected, etc.) from an UNRELATED entry that is unsafe
  // (which we leave untouched and do not block on).
  const newDestNames = new Set(transformed.map((r) => r.destName));
  const existing = await enumerateDestination(
    absRoot,
    target,
    safeOutDir,
    newDestNames,
    issues,
  );

  // Preflight: if destination enumeration added any error issue, the
  // destination is in an unrecoverable state for this run (e.g. the
  // destination root is a regular file, not a directory). Abort
  // before any mkdir or write so the destination is not touched
  // further and so we do not stack a `write_failed` on top of the
  // original `destination_unsafe`.
  if (issues.some((i) => i.severity === "error")) {
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Preflight: PLANNED destination entries that are unsafe to write
  // to (a directory, symlink escape, non-regular file, or an
  // unreadable file) are FATAL — `--force` does NOT bypass them.
  // An ordinary readable, unmarked file is still forceable.
  const fatalPlanned: Array<{ sourceRel: string; destName: string; reason: string }> = [];
  const forceablePlanned: Array<{ sourceRel: string; destName: string; reason: string }> = [];
  const safeExisting = new Map<string, DestinationEntry>();
  for (const [name, entry] of existing) {
    const isPlanned = newDestNames.has(name);
    if (entry.unsafe) {
      // Unsafe entries (directory / symlink / special / unreadable)
      // are fatal ONLY if they are planned. Unrelated unsafe entries
      // are left in `existing` so the removal phase can decide what
      // to do (never remove a non-marker file; the existence of an
      // unrelated unreadable file is itself a `destination_unsafe`
      // warning, not a fatal conflict).
      if (isPlanned) {
        fatalPlanned.push({
          sourceRel: transformed.find((r) => r.destName === name)?.sourceRel ?? "(destination)",
          destName: name,
          reason: "destination entry is unsafe (directory, symlink, special file, or unreadable)",
        });
      }
      safeExisting.set(name, entry);
      continue;
    }
    if (!isPlanned) {
      // Unrelated, regular, readable — keep for the removal phase.
      safeExisting.set(name, entry);
      continue;
    }
    // Planned + safe + readable. Compare marker.
    const expectedSource = transformed.find((r) => r.destName === name)?.sourceRel;
    if (entry.markerSource === expectedSource) {
      safeExisting.set(name, entry);
      continue;
    }
    // Marker mismatch: hand-edited or different source.
    forceablePlanned.push({
      sourceRel: expectedSource ?? "(destination)",
      destName: name,
      reason: entry.markerSource
        ? `destination has a livewiki marker for a different source ("${entry.markerSource}")`
        : "destination file lacks a livewiki marker",
    });
    safeExisting.set(name, entry);
  }

  // Fatal planned destination conflicts abort the export BEFORE any
  // write. `--force` cannot bypass these.
  if (fatalPlanned.length > 0) {
    for (const c of fatalPlanned) {
      issues.push({
        code: "destination_unsafe",
        severity: "error",
        path: c.sourceRel,
        detail: `${c.reason} for planned destination "${c.destName}"; refusing to write (force does not bypass)`,
      });
    }
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Forceable planned conflicts: abort without --force, downgrade to
  // warning with --force (the export will rewrite the file).
  if (forceablePlanned.length > 0 && !opts.force) {
    for (const c of forceablePlanned) {
      issues.push({
        code: "destination_conflict",
        severity: "error",
        path: c.sourceRel,
        detail: `${c.reason}; pass --force to overwrite`,
      });
    }
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }
  if (forceablePlanned.length > 0 && opts.force) {
    for (const c of forceablePlanned) {
      issues.push({
        code: "destination_conflict",
        severity: "warning",
        path: c.sourceRel,
        detail: `${c.reason}; overwritten because --force was set`,
      });
    }
  }

  // Build the set of stale destinations (have a marker, are no longer
  // in the new snapshot). These are eligible for removal. Files without
  // a marker are NEVER removed.
  const stale: DestinationEntry[] = [];
  for (const [name, entry] of safeExisting) {
    if (newDestNames.has(name)) continue;
    if (entry.markerSource === null) continue;
    stale.push(entry);
  }

  // Ensure the destination directory exists via safeIo.mkdir.
  try {
    await safeIo.mkdir(absRoot, `.livewiki/export/${target}`);
  } catch (err) {
    issues.push({
      code: "write_failed",
      severity: "error",
      path: `.livewiki/export/${target}/`,
      detail: `failed to create destination: ${errMessage(err)}`,
    });
    return { ok: false, target, outDir, pagesWritten: 0, pagesRemoved: 0, issues };
  }

  // Phase 1: write every file. Skip files whose content is byte-identical
  // to the existing destination (same source, same content).
  let written = 0;
  for (const r of transformed) {
    const ex = safeExisting.get(r.destName);
    if (ex && ex.text === r.text) continue;
    const safeRel = `.livewiki/export/${target}/${r.destName}`;
    try {
      await safeIo.writeText(absRoot, safeRel, r.text);
      written++;
    } catch (err) {
      issues.push({
        code: "write_failed",
        severity: "error",
        path: r.sourceRel,
        detail: `failed to write ${r.destName}: ${errMessage(err)}`,
      });
      return { ok: false, target, outDir, pagesWritten: written, pagesRemoved: 0, issues };
    }
  }

  // Phase 2: remove stale destination files. UNREADABLE stale files
  // (which would have produced a destination_unreadable issue in
  // enumerateDestination) are NOT removed — we cannot tell whether they
  // belong to us.
  let removed = 0;
  for (const entry of stale) {
    const safeRel = `.livewiki/export/${target}/${entry.name}`;
    try {
      await safeIo.remove(absRoot, safeRel);
      removed++;
    } catch (err) {
      issues.push({
        code: "write_failed",
        severity: "error",
        path: entry.name,
        detail: `failed to remove stale destination: ${errMessage(err)}`,
      });
    }
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, target, outDir, pagesWritten: written, pagesRemoved: removed, issues };
}

// ── Source enumeration ────────────────────────────────────────────────────

/**
 * Enumerate every `.md` and `.mmd` file under `livewiki/`. Reads each
 * file via `safeIo.readText` so the read path itself passes through
 * the allowlist (and any symlink escape is caught here, not later).
 */
async function enumerateSourcePages(
  absRoot: string,
  safeLivewikiDir: string,
  issues: ExportIssue[],
): Promise<SourcePage[]> {
  const out: SourcePage[] = [];
  // `safeIo.readText` only reads a single file; for enumeration we
  // walk the directory ourselves. The directory has been validated via
  // `safeIo.resolveAndValidate` above, so its real path stays inside
  // the allowlist. We do NOT use the realpath result for further
  // writes; safeIo enforces its own allowlist per file.
  const stack: string[] = [safeLivewikiDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = await nodeFs.readdir(cur, { withFileTypes: true });
    } catch (err) {
      issues.push({
        code: "source_path_unsafe",
        severity: "error",
        path: nodePath.relative(absRoot, cur).split(nodePath.sep).join("/"),
        detail: errMessage(err),
      });
      continue;
    }
    for (const e of entries) {
      const name = String(e.name);
      const abs = nodePath.join(cur, name);
      if (e.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = nodePath.extname(name).toLowerCase();
      if (ext !== ".md" && ext !== ".mmd") continue;
      const rel = nodePath.relative(absRoot, abs).split(nodePath.sep).join("/");
      if (rel === "livewiki/.manifest.json") continue;
      const safeRel = rel;
      let raw: string;
      try {
        raw = await safeIo.readText(absRoot, safeRel);
      } catch (err) {
        issues.push({
          code: "source_path_unsafe",
          severity: "error",
          path: rel,
          detail: `cannot read: ${errMessage(err)}`,
        });
        continue;
      }
      out.push({ rel, safeRel, ext, raw });
    }
  }
  out.sort((a, b) => a.rel.localeCompare(b.rel));
  return out;
}

// ── Path utilities ───────────────────────────────────────────────────────

/**
 * Flatten a source rel like `architecture/overview.md` to
 * `architecture-overview.md`. Applies the home-page rename for
 * `quickstart.md` BEFORE flattening. `.mmd` source files become `.md`
 * pages (the destination is a Markdown page with an embedded fenced
 * `mermaid` block).
 */
function flattenPath(rel: string, target: ExportTarget): string {
  if (rel === "livewiki/quickstart.md") return HOME_MAPPING[target];
  const withoutPrefix = rel.startsWith("livewiki/") ? rel.slice("livewiki/".length) : rel;
  const ext = nodePath.extname(withoutPrefix);
  const destExt = ext === ".mmd" ? ".md" : ext;
  const base = ext ? withoutPrefix.slice(0, -ext.length) : withoutPrefix;
  const parts = base.split("/").filter((p) => p.length > 0);
  const flat = parts.join("-");
  return flat + destExt;
}

/**
 * Build the marker for a given source rel path. The marker convention
 * uses the path relative to `livewiki/`. The prefix constant already
 * ends with `livewiki/`, so we strip the prefix from the input before
 * composing.
 */
function buildMarker(sourceRel: string): string {
  const withoutPrefix = sourceRel.startsWith("livewiki/")
    ? sourceRel.slice("livewiki/".length)
    : sourceRel;
  return `${GENERATED_MARKER_PREFIX}${withoutPrefix}${GENERATED_MARKER_SUFFIX}`;
}

// ── Frontmatter handling ────────────────────────────────────────────────

/**
 * Split a raw source string into the frontmatter block (between the
 * two `---` delimiters) and the body. Operates on the original
 * string — including CRLF — by matching the first two `---` lines
 * verbatim. Returns `{ frontmatter, body, fmStart, fmEnd }` where
 * `fmStart` / `fmEnd` are the byte offsets of the opening and closing
 * `---` delimiter lines (inclusive of the line terminator). If the
 * source has no frontmatter, returns `{ frontmatter: null }`.
 *
 * The parser `parseFrontmatter` is still called to validate the
 * block; this raw split is used for the slice that is then handed to
 * `stripAnchorsField`. Using `parseFrontmatter(...).bodyOffset` would
 * be wrong for CRLF input because that offset belongs to the
 * parser's LF-normalized string.
 */
function splitRawFrontmatter(source: string): {
  frontmatter: string | null;
  body: string;
  fmStart: number;
  fmEnd: number;
} {
  if (!source.startsWith("---")) {
    return { frontmatter: null, body: source, fmStart: -1, fmEnd: -1 };
  }
  // Match the first line: it must be exactly `---` followed by an EOL.
  // Allow CRLF or LF.
  const openRe = /^---(\r?\n)/;
  const openMatch = openRe.exec(source);
  if (!openMatch) {
    return { frontmatter: null, body: source, fmStart: -1, fmEnd: -1 };
  }
  const fmStart = openMatch[0].length;
  // The closing `---` is on its own line AFTER the body of the block.
  // Search from fmStart onward.
  const closeRe = /\r?\n---\r?\n?/g;
  closeRe.lastIndex = fmStart;
  const closeMatch = closeRe.exec(source);
  if (!closeMatch) {
    return { frontmatter: null, body: source, fmStart: -1, fmEnd: -1 };
  }
  const fmEnd = closeMatch.index + closeMatch[0].length;
  const frontmatter = source.slice(fmStart, closeMatch.index);
  const body = source.slice(fmEnd);
  return { frontmatter, body, fmStart, fmEnd };
}

/**
 * Strip ONLY the top-level `anchors:` field and its list items from
 * the raw source. Preserves every other field (including unknown /
 * custom keys, comments, quoted values, and lists) in its original
 * order and spelling. Performs a narrow deterministic removal on
 * the raw text, not a round-trip through a reduced object.
 *
 * Handles every parser-valid top-level anchors form:
 *   - normal list (multi-line)
 *   - inline / scalar form such as `anchors: []` or `anchors: # comment`
 *   - blank lines or comment lines between anchor list items
 *   - any line ending (LF or CRLF)
 *
 * The retained lines are rejoined with the SAME EOL the block used
 * (CRLF stays CRLF). Detected by whether the block contains a `\r`
 * — sources that use CRLF have one on every retained line.
 */
function stripAnchorsField(frontmatterBlock: string): string {
  // Detect EOL from the block itself. CRLF sources have a `\r` in
  // the block; LF-only sources do not. We join the retained lines
  // with the matching EOL so the output preserves the source's line
  // ending. A bare `anchors:` line on its own (no value) is the
  // list-start form, not the inline form.
  const eol = frontmatterBlock.includes("\r") ? "\r\n" : "\n";
  const lines = frontmatterBlock.split(/\r?\n/);
  const out: string[] = [];
  let inAnchors = false;
  // Recognize the start of the anchors field. Three forms:
  //   1. `anchors:`  (start of a list — the next non-list, non-blank,
  //      non-comment line ends the field)
  //   2. `anchors: []` or `anchors:[...]` (inline empty / scalar)
  //   3. `anchors: <value>` followed by an inline `# comment` (the
  //      value is on the same line; do NOT consume subsequent lines)
  //
  // The "inline" check requires at least one non-whitespace character
  // after the colon. A bare `anchors:` (with no value) is the list
  // form, not inline. Using `^anchors\s*:[^]*$` (zero-or-more chars
  // after the colon) would mistakenly classify the bare list-start
  // form as inline and leave the list items behind.
  const isAnchorsStart = (line: string): boolean => /^anchors\s*:/.test(line);
  const isAnchorsInline = (line: string): boolean => /^anchors\s*:\s*\S/.test(line);
  for (const line of lines) {
    if (inAnchors) {
      // Continue consuming list items belonging to the `anchors:`
      // field until we hit a non-list, non-blank, non-comment line.
      if (/^\s*-\s+/.test(line)) continue;
      if (/^\s*$/.test(line)) {
        // Blank line — still inside the list (the list may have
        // visually separated items). Keep consuming.
        continue;
      }
      if (/^\s*#/.test(line)) {
        // Comment line — still inside the list. Keep consuming.
        continue;
      }
      // Non-list line — the anchors list ended.
      inAnchors = false;
    }
    if (isAnchorsStart(line)) {
      // Inline form: the field is fully on this line. Drop the line.
      if (isAnchorsInline(line)) {
        continue;
      }
      // List form: the field starts here. Drop the line and consume
      // the list items.
      inAnchors = true;
      continue;
    }
    out.push(line);
  }
  return out.join(eol);
}

/**
 * Render the destination page header for a Markdown source: retained
 * frontmatter (with `anchors:` stripped) followed by the marker on
 * its own line. For source files with no frontmatter, emit just the
 * marker line.
 *
 * Operates on the raw source via `splitRawFrontmatter` so CRLF
 * frontmatter is preserved byte-for-byte (no stray `\r` bytes). The
 * parser is still consulted only to validate the block; its
 * `bodyOffset` is not used for slicing because that offset belongs
 * to the parser's LF-normalized string and would corrupt CRLF input.
 */
function renderMarkdownHeader(source: string, sourceRel: string): string {
  const marker = buildMarker(sourceRel);
  // Detect the source's line ending from the source string. A
  // CRLF source gets CRLF delimiters AND CRLF retained frontmatter
  // (and CRLF body). An LF source gets LF throughout. This way a
  // CRLF page does not receive a mixed LF-marker / CRLF-body output.
  // We detect by the presence of any CRLF in the source — sources
  // are assumed to be consistent in their line endings.
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  // No opening delimiter: no frontmatter. The raw split is not
  // consulted for "does frontmatter exist" — the source string is.
  if (!source.startsWith("---")) {
    return `${marker}${eol}${eol}`;
  }
  const split = splitRawFrontmatter(source);
  // Source opens with `---` but the raw split found no closing
  // delimiter. The source is malformed; surface a parse error so
  // the orchestrator emits `frontmatter_parse_error` and aborts.
  if (split.fmEnd === -1) {
    try {
      parseFrontmatter(source);
    } catch (err) {
      throw new Error(`malformed frontmatter in ${sourceRel}: ${errMessage(err)}`);
    }
    // Defensive fall-through: the parser's own check missed the
    // missing close (its frontmatter is optional), but we know
    // the source is malformed.
    throw new Error(
      `malformed frontmatter in ${sourceRel}: frontmatter opens with --- but has no closing ---`,
    );
  }
  // Source has a complete frontmatter block. Validate the block.
  try {
    parseFrontmatter(source);
  } catch (err) {
    throw new Error(`malformed frontmatter in ${sourceRel}: ${errMessage(err)}`);
  }
  // split.frontmatter is non-null here (split.fmEnd !== -1 means we
  // found the closing delimiter).
  const frontmatterBlock = split.frontmatter as string;
  const cleaned = stripAnchorsField(frontmatterBlock);
  if (cleaned.trim() === "") {
    return `${marker}${eol}${eol}`;
  }
  // The retained `cleaned` block already uses the source's EOL
  // (stripAnchorsField detects the block's EOL). Wrap with the
  // matching delimiter EOL.
  return `---${eol}${cleaned}${eol}---${eol}${marker}${eol}${eol}`;
}

// ── Marker detection ─────────────────────────────────────────────────────

/**
 * Find a marker in a destination file's header region (frontmatter +
 * first N body lines). Returns the source path it points to, or null.
 */
function detectMarker(text: string): string | null {
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const lines = s.split(/\r?\n/);
  let bodyLinesRemaining = MARKER_HEADER_BODY_LINES;
  let inFrontmatter = false;
  let frontmatterClosed = false;
  for (const line of lines) {
    if (!inFrontmatter && !frontmatterClosed && line === "---") {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line === "---") {
      inFrontmatter = false;
      frontmatterClosed = true;
      continue;
    }
    if (inFrontmatter) continue;
    const m = line.match(/<!--\s*livewiki:generated\s+source="([^"]+)"\s*-->/);
    if (m) return m[1] ?? null;
    if (frontmatterClosed) {
      bodyLinesRemaining--;
      if (bodyLinesRemaining <= 0) return null;
    }
  }
  return null;
}

// ── Destination enumeration ─────────────────────────────────────────────

/**
 * Enumerate the existing destination directory. Returns a map from
 * the destination-side flat name to the entry metadata. The directory
 * may not exist (first export), in which case the map is empty.
 *
 * Each individual file is read via `safeIo.readText` so a symlink
 * escape or other allowlist violation is reported as a structured
 * `destination_unsafe` issue rather than a thrown error.
 *
 * `plannedDestNames` is the set of destination filenames this export
 * will write. Entries in that set are checked for safety (a directory
 * where a file is expected, a symlink, or an unreadable file are
 * marked `unsafe: true` so the orchestrator can abort on a PLANNED
 * conflict). Entries NOT in the set are kept on the side: an
 * unrelated unsafe entry is left untouched and does not block the
 * export.
 */
async function enumerateDestination(
  absRoot: string,
  target: ExportTarget,
  safeOutDir: string,
  plannedDestNames: Set<string>,
  issues: ExportIssue[],
): Promise<Map<string, DestinationEntry>> {
  const out = new Map<string, DestinationEntry>();
  let entries: Dirent[];
  try {
    entries = await nodeFs.readdir(safeOutDir, { withFileTypes: true });
  } catch (err) {
    // ENOENT (or similar) means the destination does not exist yet.
    // We only treat that as "no entries" — other errors are real.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return out;
    issues.push({
      code: "destination_unsafe",
      severity: "error",
      path: `.livewiki/export/${target}/`,
      detail: `cannot read destination: ${errMessage(err)}`,
    });
    return out;
  }
  for (const e of entries) {
    const name = String(e.name);
    const safeRel = `.livewiki/export/${target}/${name}`;
    const isPlanned = plannedDestNames.has(name);
    // A symlink where a regular file is expected is unsafe to overwrite.
    if (e.isSymbolicLink()) {
      const unsafeEntry: DestinationEntry = {
        name,
        text: null,
        markerSource: null,
        unsafe: true,
      };
      out.set(name, unsafeEntry);
      if (isPlanned) {
        issues.push({
          code: "destination_unsafe",
          severity: "error",
          path: name,
          detail: "destination entry is a symlink; refusing to overwrite (force does not bypass)",
        });
      }
      continue;
    }
    if (!e.isFile()) {
      // A directory where a file is expected is unsafe to overwrite.
      const unsafeEntry: DestinationEntry = {
        name,
        text: null,
        markerSource: null,
        unsafe: true,
      };
      out.set(name, unsafeEntry);
      if (isPlanned) {
        issues.push({
          code: "destination_unsafe",
          severity: "error",
          path: name,
          detail: "destination entry is a directory or special file; refusing to overwrite (force does not bypass)",
        });
      }
      continue;
    }
    let text: string;
    try {
      text = await safeIo.readText(absRoot, safeRel);
    } catch (err) {
      const unsafeEntry: DestinationEntry = {
        name,
        text: null,
        markerSource: null,
        unsafe: true,
      };
      out.set(name, unsafeEntry);
      if (isPlanned) {
        issues.push({
          code: "destination_unsafe",
          severity: "error",
          path: name,
          detail: `cannot read planned destination: ${errMessage(err)}`,
        });
      }
      continue;
    }
    const marker = detectMarker(text);
    out.set(name, { name, text, markerSource: marker, unsafe: false });
  }
  return out;
}

// ── Per-page transform ──────────────────────────────────────────────────

/**
 * Transform a single source page. For Markdown: strip anchor frontmatter,
 * strip anchor markers, replace Mermaid placeholders, rewrite internal
 * links. For Mermaid: wrap the diagram body in a fenced ` ```mermaid `
 * block. Throws `ExportError` for fatal, structured issues (e.g. missing
 * diagram, broken link). The orchestrator catches ExportError and
 * preserves the structured issue codes.
 */
function transformPage(
  page: SourcePage,
  target: ExportTarget,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string {
  if (page.ext === ".mmd") return transformMermaidPage(page);
  return transformMarkdownPage(page, target, pageIndex, issues);
}

/** Wrap a Mermaid diagram in a destination markdown page. */
function transformMermaidPage(page: SourcePage): string {
  const body = page.raw.replace(/\r\n/g, "\n");
  const marker = buildMarker(page.rel);
  const lines: string[] = [];
  lines.push(marker);
  lines.push("");
  lines.push("```mermaid");
  lines.push(body);
  if (!body.endsWith("\n")) lines.push("");
  lines.push("```");
  lines.push("");
  return lines.join("\n");
}

/** Transform a Markdown source page. */
function transformMarkdownPage(
  page: SourcePage,
  target: ExportTarget,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string {
  const header = renderMarkdownHeader(page.raw, page.rel);
  // Body: take the body portion of the raw source so CRLF is preserved
  // (use splitRawFrontmatter, NOT parseFrontmatter(...).bodyOffset).
  const split = splitRawFrontmatter(page.raw);
  let body = split.body;
  body = replaceMermaidPlaceholder(body, page.rel, pageIndex);
  body = stripAnchorMarkers(body);
  body = rewriteInternalLinks(body, page.rel, pageIndex, issues);
  return `${header}${body}`;
}

// ── Body transformations ────────────────────────────────────────────────

/** Strip `<!-- lw:anchors ... -->` markers from the body. */
function stripAnchorMarkers(body: string): string {
  return body.replace(/<!--\s*lw:anchors\s+[^>]*?-->/g, "");
}

/**
 * Replace the exact `%% livewiki/<path>.mmd` placeholder (inside a
 * fenced ```mermaid block) with a link to the generated diagram page.
 * The link uses the full source path; the link rewriter resolves it
 * to the destination's flat name.
 */
function replaceMermaidPlaceholder(
  body: string,
  pageRel: string,
  pageIndex: Map<string, string>,
): string {
  const re = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/g;
  return body.replace(re, (match, inner: string) => {
    const trimmed = inner.trim();
    const placeholder = trimmed.match(/^%%\s*livewiki\/(.+?\.mmd)\s*$/);
    if (!placeholder) return match;
    const mmdRel = `livewiki/${placeholder[1]}`;
    if (!pageIndex.has(mmdRel)) {
      throw new ExportError([
        {
          code: "missing_diagram",
          severity: "error",
          path: pageRel,
          detail: `placeholder references "${mmdRel}" but no such .mmd exists in source`,
        },
      ]);
    }
    const label = `View diagram (${placeholder[1]})`;
    return `[${label}](${mmdRel})`;
  });
}

// ── Inline link rewriting ──────────────────────────────────────────────

interface ParsedLink {
  pathPart: string;
  query: string;
  fragment: string;
  title: string;
}

/**
 * Parse a Markdown link's URL into pathPart / query / fragment / title.
 * The link rewriter only mutates pathPart; query, fragment, and the
 * title are preserved verbatim.
 */
function parseLinkHref(href: string): ParsedLink {
  let title = "";
  let url = href;
  // Optional title in `"..."` at the end of the link target.
  const titleMatch = url.match(/^(.*?)\s+"([^"]*)"\s*$/);
  if (titleMatch) {
    url = titleMatch[1] ?? url;
    title = titleMatch[2] ?? "";
  }
  // Fragment.
  const fragIdx = url.indexOf("#");
  let fragment = "";
  let pathAndQuery = url;
  if (fragIdx >= 0) {
    fragment = url.slice(fragIdx); // includes leading '#'
    pathAndQuery = url.slice(0, fragIdx);
  }
  // Query.
  const qIdx = pathAndQuery.indexOf("?");
  let query = "";
  let pathPart = pathAndQuery;
  if (qIdx >= 0) {
    query = pathAndQuery.slice(qIdx); // includes leading '?'
    pathPart = pathAndQuery.slice(0, qIdx);
  }
  return { pathPart, query, fragment, title };
}

/**
 * Rewrite internal links in a Markdown body. External URLs, schemes,
 * fragment-only links, query-only links, fenced code blocks, and
 * inline code spans are left untouched. The link's optional title,
 * query string, and fragment are preserved verbatim.
 *
 * For an internal link, the path is resolved to a source path under
 * `livewiki/`; if that source path is in the pageIndex, the link is
 * rewritten to the destination's flat name. A path that does not
 * resolve to a known source file is reported as a broken internal
 * link.
 */
function rewriteInternalLinks(
  body: string,
  sourceRel: string,
  pageIndex: Map<string, string>,
  issues: ExportIssue[],
): string {
  const masked = maskCodeSpansPreservingLength(body);
  // Match Markdown links: [text](href) with an optional title.
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  for (const m of masked.matchAll(linkRe)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    result += body.slice(lastIndex, start);
    const text = m[1] ?? "";
    const href = m[2] ?? "";
    const parsed = parseLinkHref(href);
    // Fragment-only or query-only links: empty pathPart. Leave
    // the original link text unchanged (no path to resolve, no
    // destination to map to).
    if (parsed.pathPart === "") {
      result += m[0];
      lastIndex = end;
      continue;
    }
    // External / mailto / absolute URLs / scheme-bearing URLs: leave
    // verbatim.
    if (
      parsed.pathPart.startsWith("http://") ||
      parsed.pathPart.startsWith("https://") ||
      parsed.pathPart.startsWith("mailto:") ||
      /^[a-z][a-z0-9+.-]*:/i.test(parsed.pathPart)
    ) {
      result += m[0];
      lastIndex = end;
      continue;
    }
    const resolvedSource = resolveLinkSource(parsed.pathPart, sourceRel);
    if (!pageIndex.has(resolvedSource)) {
      issues.push({
        code: "broken_internal_link",
        severity: "error",
        path: sourceRel,
        detail: `link to "${href}" resolves to "${resolvedSource}" which is not in source`,
      });
      result += m[0];
      lastIndex = end;
      continue;
    }
    const dest = pageIndex.get(resolvedSource)!;
    // Re-attach query, fragment, and title (preserved verbatim).
    const newHref = `${dest}${parsed.query}${parsed.fragment}`;
    const titleSep = parsed.title ? ` "${parsed.title}"` : "";
    result += `[${text}](${newHref}${titleSep})`;
    lastIndex = end;
  }
  result += body.slice(lastIndex);
  return result;
}

/**
 * Resolve a link's path part to a source-relative path under
 * `livewiki/`. Handles absolute paths (leading `/`), relative paths
 * (`./` / `../`), bare filenames, and paths that already start with
 * `livewiki/`. Adds `.md` when the path has no recognized extension.
 */
function resolveLinkSource(pathPart: string, sourceRel: string): string {
  // Repo-root absolute (leading `/`): strip the leading slash, then
  // join with `livewiki/`. We do NOT support double `livewiki/`; the
  // path part "/livewiki/foo.md" resolves to "livewiki/foo.md".
  if (pathPart.startsWith("/")) {
    const rest = pathPart.replace(/^\/+/, "");
    // If `rest` already starts with `livewiki/`, do not double it.
    if (rest.startsWith("livewiki/")) return ensureExtension(rest);
    return ensureExtension(`livewiki/${rest}`);
  }
  const sourceDir = sourceRel.includes("/")
    ? sourceRel.slice(0, sourceRel.lastIndexOf("/"))
    : "livewiki";
  let resolved: string;
  if (pathPart.startsWith("./") || pathPart.startsWith("../")) {
    resolved = nodePath.posix.normalize(`${sourceDir}/${pathPart}`);
  } else if (!pathPart.includes("/")) {
    resolved = `${sourceDir}/${pathPart}`;
  } else {
    resolved = nodePath.posix.normalize(pathPart);
  }
  if (!/\.[a-z]+$/i.test(resolved)) {
    resolved = `${resolved}.md`;
  }
  if (!resolved.startsWith("livewiki/")) {
    resolved = `livewiki/${resolved}`;
  }
  return resolved;
}

/** Add `.md` when the path has no extension. */
function ensureExtension(path: string): string {
  if (!/\.[a-z]+$/i.test(path)) return `${path}.md`;
  return path;
}

/**
 * Extract a human-readable error message from an unknown thrown value
 * without re-throwing. Throwing `null` or a primitive would otherwise
 * crash the catch handler when it accesses `.message`.
 */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err === null || err === undefined) return String(err);
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}
