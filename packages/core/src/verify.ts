/**
 * verify — validates the wiki against the code index.
 *
 * SPEC §"CLI commands" (commit 6183214 — Fix C): "Parses the wiki fresh from
 * disk — an anchor in a never-indexed page MUST be caught (it is the
 * anti-hallucination promise: a doc freshly written by an LLM is validatable
 * without running `index` first)".
 *
 * Checks:
 *   - anchors (page and section) point to existing symbols in the index?
 *   - manual blocks preserved byte-for-byte (rule #6)?
 *   - internal links between wiki pages valid?
 *
 * Exit code != 0 on error (CI-friendly). The DB is opened only to query
 * active symbols and the manual-blocks baseline (for the rule #6 check).
 *
 * The wiki walk is ALWAYS from disk — we do not depend on the database's
 * `doc_pages` to detect "ghost" pages (created after the last index).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { extractAnchors, slugify } from "./anchors.js";
import { sha256 } from "./hashes.js";
import { maskCodeSpans } from "./markdown-mask.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import {
  BASELINE_REL_PATH,
  collectBaselineDocumentationInventory,
  evaluateBaseline,
  readBaseline,
} from "./baseline.js";

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "broken_anchor"        // anchor references a symbol that does not exist
  | "broken_internal_link" // [text](page.md) or [text](page.md#section) for a nonexistent page
  | "invalid_mermaid_diagram"
  | "manual_block_altered"  // block <!-- lw:manual -->...<!-- /lw:manual --> with a diverging hash
  | "missing_wiki_path"     // a doc_page from the database vanished from the wiki
  | "unsupported_baseline_algorithm"
  | "invalid_documentation_baseline"
  | "baseline_entry_without_anchor"
  | "think_block_present"    // reasoning <think> block leaked into the page (outside code spans/fences)
  | "malformed_frontmatter"; // the page frontmatter does not parse, so no page check can run

export interface VerifyIssue {
  severity: IssueSeverity;
  code: IssueCode;
  wikiPath: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  pagesChecked: number;
  issues: VerifyIssue[];
}

export async function run(repoRoot: string): Promise<VerifyResult> {
  const absRoot = nodePath.resolve(repoRoot);
  await safeIo.mkdir(absRoot, ".livewiki");
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);

  const issues: VerifyIssue[] = [];

  try {
    // Map of active symbols (needed for broken_anchor)
    const activeSymbols = new Map<string, SymbolRow>();
    for (const row of db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[]) {
      activeSymbols.set(row.key, row);
    }

    // Map of manual blocks by wiki_path (rule #6, database baseline).
    // wiki_path is the doc_page path (livewiki/foo.md).
    interface ManualBlockRow {
      id: number;
      doc_page_id: number;
      start_offset: number;
      end_offset: number;
      content_hash: string;
      updated_at: number;
    }
    interface DocPageRow {
      id: number;
      wiki_path: string;
    }
    const docPages = new Map<number, string>();
    const manualBlocksByPath = new Map<string, ManualBlockRow[]>();
    for (const row of db
      .prepare("SELECT id, wiki_path FROM doc_pages")
      .all() as DocPageRow[]) {
      docPages.set(row.id, row.wiki_path);
    }
    for (const row of db.prepare("SELECT * FROM manual_blocks").all() as ManualBlockRow[]) {
      const path = docPages.get(row.doc_page_id);
      if (!path) continue;
      const arr = manualBlocksByPath.get(path) ?? [];
      arr.push(row);
      manualBlocksByPath.set(path, arr);
    }

    // Wiki walk from disk (Fix C) — does not depend on the database's doc_pages.
    const wikiPages = await collectWikiPages(absRoot);
    // The existence set used for link resolution
    // includes non-.md wiki artifacts (currently `.mmd` diagrams) — a link
    // to a diagram is checkable even though diagrams aren't full "pages"
    // (no anchors/manual-blocks/section-scan of their own).
    const existingArtifactPaths = await collectWikiArtifactPaths(absRoot);

    // Map of section_slug by wiki_path (for internal links)
    const sectionSlugsByPath = new Map<string, Set<string>>();
    for (const page of wikiPages) {
      sectionSlugsByPath.set(page.relPath, await collectSectionSlugs(absRoot, page.relPath));
    }

    let pagesChecked = 0;

    for (const page of wikiPages) {
      pagesChecked++;
      const source = await safeIo.readText(absRoot, page.relPath).catch(() => null);
      if (source === null) continue;

      let extracted;
      try {
        extracted = extractAnchors(source);
      } catch (error) {
        // Without a parse none of the per-page checks below can run — but the
        // page must still FAIL the gate. A silent `continue` let a malformed
        // page skip broken_anchor, the thinking leak, the manual blocks and
        // the internal links while verify still answered ok: exactly the
        // hole the anti-hallucination promise cannot have.
        issues.push({
          severity: "error",
          code: "malformed_frontmatter",
          wikiPath: page.relPath,
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      // Anchors from disk: each symbol_key must exist as an active symbol
      const allAnchorsFromDisk = [
        ...extracted.pageAnchors.map((sk) => ({ key: sk, sectionSlug: null as string | null })),
        ...extracted.sectionAnchors.flatMap((sa) =>
          sa.symbolKeys.map((sk) => ({ key: sk, sectionSlug: sa.sectionSlug })),
        ),
      ];

      for (const a of allAnchorsFromDisk) {
        if (!activeSymbols.has(a.key)) {
          // SPEC Fix C: ghost anchor in a new page — error, even without a
          // prior index. It is the anti-hallucination promise.
          issues.push({
            severity: "error",
            code: "broken_anchor",
            wikiPath: page.relPath,
            detail: `anchor ${a.key} (${a.sectionSlug ?? "page"}) references nonexistent symbol`,
          });
        }
      }

      // Provider thinking leak: a reasoning <think> block outside code
      // spans/fences is never page content (quoted examples stay legal).
      if (/<think[\s>]/.test(maskCodeSpans(source))) {
        issues.push({
          severity: "error",
          code: "think_block_present",
          wikiPath: page.relPath,
          detail: "reasoning <think> block present outside code spans/fences",
        });
      }

      // Verify stored manual blocks byte-for-byte. Offsets are not identities:
      // regenerated prose and section markers can move a preserved block by
      // any distance. Compare the multiset of hashes so duplicate blocks are
      // counted correctly and a missing/changed stored block is detected.
      const storedBlocks = manualBlocksByPath.get(page.relPath) ?? [];
      const unmatchedCurrentHashes = extracted.manualBlocks.map((block) =>
        sha256(source.slice(block.start, block.end)),
      );
      const unmatchedStored = [...storedBlocks];
      for (let index = unmatchedStored.length - 1; index >= 0; index--) {
        const stored = unmatchedStored[index]!;
        const currentIndex = unmatchedCurrentHashes.indexOf(stored.content_hash);
        if (currentIndex >= 0) {
          unmatchedCurrentHashes.splice(currentIndex, 1);
          unmatchedStored.splice(index, 1);
        }
      }
      for (const stored of unmatchedStored) {
        issues.push({
          severity: "error",
          code: "manual_block_altered",
          wikiPath: page.relPath,
          detail:
            `stored manual block at offset ${stored.start_offset} is missing or changed ` +
            `(expected hash=${stored.content_hash.slice(0, 8)})`,
        });
      }

      // Internal links — between wiki pages (read from disk)
      // Links inside fenced code blocks or inline code are NOT navigable —
      // they are syntax examples, not real references. Mask that content
      // BEFORE running the link regex (does not mutate `source`; used only
      // for this scan).
      const sourceForLinks = maskCodeSpans(source);
      // `.md` and `.mmd` are both checkable wiki artifacts:
      // overview links to class diagrams must be caught the same way as
      // broken page links — extension-driven, not path-driven).
      const linkRe = /\[([^\]]*)\]\(([^)#]+\.(?:md|mmd))(#([^)]+))?\)/g;
      for (const m of sourceForLinks.matchAll(linkRe)) {
        const linkPathRaw = m[2];
        if (!linkPathRaw) continue;
        const linkSection = m[4];
        // Resolve the link against the current wiki page's directory.
        // 3 cases (Q — fix):
        //   1. "livewiki/foo.md" or "livewiki/" prefix  → absolute in the namespace, use as-is
        //   2. "/foo.md"                               → absolute from the repo root
        //   3. "./foo.md", "../foo.md", "foo.md"       → relative to the page's directory
        //
        // Before the fix, case (3) was treated as (1) with a "livewiki/" prepend
        // — which broke ANY link with "..". E.g. architecture/overview.md
        // emits "[page](../auth.md)" which became "livewiki/../auth.md" = outside.
        const resolved = resolveWikiLink(page.relPath, linkPathRaw);
        if (!resolved) {
          // Malformed link (not a valid wiki-path) — skips silently.
          // May be an external link or a fake absolute-path. Does not block.
          continue;
        }
        if (!isInsideWiki(resolved)) {
          // Resolved to outside the livewiki/ namespace (e.g. "../../etc/passwd"
          // → "../etc/passwd"). verify is read-only — does not block writes, only
          // reports (same philosophy as the legacy test).
          issues.push({
            severity: "warning",
            code: "broken_internal_link",
            wikiPath: page.relPath,
            detail: `link to ${resolved}${linkSection ? `#${linkSection}` : ""} points outside of livewiki/`,
          });
          continue;
        }
        // Check whether the target artifact exists on disk.
        const targetExists = existingArtifactPaths.has(resolved);
        if (!targetExists) {
          issues.push({
            severity: "warning",
            code: "broken_internal_link",
            wikiPath: page.relPath,
            detail: `link to ${resolved}${linkSection ? `#${linkSection}` : ""} points to nonexistent page`,
          });
          continue;
        }
        if (linkSection) {
          const slugs = sectionSlugsByPath.get(resolved);
          if (slugs && !slugs.has(linkSection)) {
            issues.push({
              severity: "warning",
              code: "broken_internal_link",
              wikiPath: page.relPath,
              detail: `link to ${resolved}#${linkSection} — section does not exist`,
            });
          }
        }
      }
    }

    for (const diagramPath of [...existingArtifactPaths]
      .filter((path) => path.endsWith(".mmd"))
      .sort()) {
      const source = await safeIo.readText(absRoot, diagramPath).catch(() => null);
      if (source === null) continue;
      const diagnostic = await validateMermaidSyntax(source);
      if (diagnostic !== null) {
        issues.push({
          severity: "error",
          code: "invalid_mermaid_diagram",
          wikiPath: diagramPath,
          detail: `Mermaid parser rejected the diagram: ${diagnostic}`,
        });
      }
    }

    // Doc_pages from the database that vanished from the wiki (deleted page).
    const seenPaths = new Set(wikiPages.map((p) => p.relPath));
    for (const [_, wikiPath] of docPages) {
      if (!seenPaths.has(wikiPath)) {
        issues.push({
          severity: "warning",
          code: "missing_wiki_path",
          wikiPath,
          detail: "page disappeared from the wiki",
        });
      }
    }

    const baselineLoad = await readBaseline(absRoot);
    if (baselineLoad.state === "incompatible") {
      for (const issue of baselineLoad.issues) {
        issues.push({
          severity: "error",
          code:
            issue.code === "unsupported_schema" || issue.code === "unsupported_extraction"
              ? "unsupported_baseline_algorithm"
              : "invalid_documentation_baseline",
          wikiPath: BASELINE_REL_PATH,
          detail: issue.entryIndex === undefined
            ? issue.detail
            : `entry ${issue.entryIndex}: ${issue.detail}`,
        });
      }
    } else if (baselineLoad.state === "available") {
      const inventory = await collectBaselineDocumentationInventory(absRoot);
      const health = evaluateBaseline(
        baselineLoad.baseline,
        [...activeSymbols.values()],
        inventory,
      );
      for (const entry of health.removedAnchors) {
        issues.push({
          severity: "error",
          code: "baseline_entry_without_anchor",
          wikiPath: entry.wikiPath,
          detail: `baseline entry for ${entry.symbolKey} has no current anchor; use the explicit anchor-removal operation`,
        });
      }
    }

    return {
      ok: issues.filter((i) => i.severity === "error").length === 0,
      pagesChecked,
      issues,
    };
  } finally {
    db.close();
  }
}

async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]> {
  const out: { relPath: string }[] = [];
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Never descend hidden dirs. Dot-prefixed PAGES are legit: tier-2
        // modules from hidden source dirs (e.g. .github/) produce pages
        // like livewiki/.github.md (Etapa 3 E2E). .manifest.json stays out
        // via the .md extension check.
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push({
          relPath: nodePath.relative(absRoot, abs).split(nodePath.sep).join("/"),
        });
      }
    }
  }
  return out;
}

/**
 * Every wiki-relative artifact path on disk that a link is allowed to
 * target — `.md` pages and `.mmd` diagrams (`verify` must be
 * able to see a broken link to a deterministic diagram the same way it
 * sees a broken link to a page). Extension-driven, not path-driven — a
 * future third artifact type only needs one more suffix here.
 *
 * Exported for the Phase 7 viewer (`view.ts`), which enumerates the same
 * canonical artifact set instead of re-inventing the walker rules
 * (dot-directories skipped, dot-prefixed pages included).
 */
export async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>> {
  const out = new Set<string>();
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Never descend hidden dirs (.git and friends). Dot-prefixed FILES
        // are fine: tier-2 modules from hidden source dirs (e.g. .github/)
        // produce legit pages like livewiki/.github.md (Etapa 3 E2E).
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mmd"))) {
        out.add(nodePath.relative(absRoot, abs).split(nodePath.sep).join("/"));
      }
    }
  }
  return out;
}

async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  const source = await safeIo.readText(absRoot, relPath).catch(() => null);
  if (source === null) return out;
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  for (const m of source.matchAll(headingRe)) {
    if (m[2]) out.add(slugify(m[2]));
  }
  return out;
}

/**
 * Resolves a markdown link to a wiki-path (relative to repoRoot) or returns
 * null if the link is not wiki-valid (e.g. external).
 *
 * Three accepted forms:
 *   1. "livewiki/foo.md" → "livewiki/foo.md" (absolute in the namespace — used as-is)
 *   2. "/foo.md"        → "foo.md" (absolute from the repo root)
 *   3. "foo.md" | "./foo.md" | "../foo.md" → relative to fromRelPath's directory
 *
 * Does not validate whether the target exists — only resolves the path. Use
 * `isInsideWiki()` to check whether it stayed inside the `livewiki/` namespace
 * (safety against a malicious `..` that escapes the wiki).
 *
 * Exported for the Phase 7 viewer (`view.ts`), which rewrites internal
 * links with exactly the same resolution rules.
 */
export function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null {
  // Strip the "./" prefix (equivalent to a bare name in the same dir)
  const cleaned = linkRaw.replace(/^\.\//, "");
  if (cleaned.length === 0) return null;

  // (1) Already absolute in the livewiki/ namespace
  if (cleaned === "livewiki" || cleaned.startsWith("livewiki/")) {
    return cleaned;
  }

  // (2) Absolute from the repo root
  if (cleaned.startsWith("/")) {
    return cleaned.replace(/^\/+/, "");
  }

  // (3) Relative to the current wiki page's directory
  const fromDir = nodePath.posix.dirname(fromRelPath);
  return nodePath.posix.normalize(nodePath.posix.join(fromDir, cleaned));
}

/**
 * True if the wiki-path is inside the `livewiki/` namespace (the wiki) or is
 * exactly `livewiki` (without trailing). Used as a safety barrier after
 * resolving relative links — prevents `../../etc/passwd` (or similar) from being
 * interpreted as a valid outward link.
 *
 * Exported together with `resolveWikiLink` for the Phase 7 viewer.
 */
export function isInsideWiki(wikiPath: string): boolean {
  return wikiPath === "livewiki" || wikiPath.startsWith("livewiki/");
}

export function formatHuman(result: VerifyResult): string {
  const lines: string[] = [];
  lines.push(`livewiki verify: ${result.ok ? "OK" : "FAILED"} (${result.pagesChecked} pages)`);
  if (result.issues.length === 0) {
    lines.push("  no issues.");
    return lines.join("\n");
  }
  const errs = result.issues.filter((i) => i.severity === "error");
  const warns = result.issues.filter((i) => i.severity === "warning");
  lines.push(`  ${errs.length} errors, ${warns.length} warnings`);
  for (const i of errs) {
    lines.push(`  ERROR ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  for (const i of warns) {
    lines.push(`  WARN  ${i.wikiPath}: [${i.code}] ${i.detail}`);
  }
  return lines.join("\n");
}
