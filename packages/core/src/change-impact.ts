/**
 * change-impact — bounded, documentation-focused impact context
 * (ROADMAP backlog #2; plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
 * Item 2).
 *
 * Composes three existing deterministic signals into ONE bounded package —
 * nothing here calls an LLM or another graph/MCP product:
 *
 *   1. Changed symbols — `previewWorkingTreeDebt` (diff-preview.ts, backlog
 *      #5) in the default `working-tree` mode (ledger-identical hashes, one
 *      `git diff --name-only HEAD` spawn, clean not-a-git-repo degrade), or
 *      the open debt rows (`status.run`) in `debt` mode. Debt `moved` events
 *      pass through untouched.
 *   2. Affected anchors + pages — the anchor rows citing the changed symbol
 *      keys, grouped per wiki page (the preview's own grouping in
 *      working-tree mode; debt items grouped by `wiki_path` in debt mode).
 *   3. Dependencies — direct importers of the changed FILES via the shared
 *      `resolveImportEdges` (import-resolution.ts), recomputed on demand
 *      like the status risk analysis (imports are never persisted; the
 *      workspace map is empty, same strictness as risk.ts).
 *   4. Snippets — the update.ts snippet window (`snippetForSymbol`, hoisted
 *      and reused — never duplicated) for the first `maxSnippets` changed
 *      symbols.
 *
 * Guarantees:
 *   - ZERO writes: no debt rows, no anchor updates, no index mutation. The
 *     index DB is opened only when `.livewiki/index.db` already exists, and
 *     only SELECTs run against it (same discipline as diff-preview.ts).
 *   - Bounded: `IMPACT_BUDGETS` caps every section; `truncated: true` plus
 *     the pre-cap `totals` make a binding cap visible, never silent.
 *   - Deterministic: every list is sorted (files, symbol keys, wiki paths,
 *     importers); identical inputs produce identical output.
 *   - Degrades cleanly: not a git repo (working-tree mode) →
 *     `notGitRepo: true` with an empty impact, never a throw; missing index
 *     DB → changed files only (working-tree mode), empty impact (debt mode).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow } from "./db.js";
import { previewWorkingTreeDebt } from "./diff-preview.js";
import { run as runStatus } from "./status.js";
import { collectImportsForFiles } from "./imports.js";
import { loadGoModulePath, resolveImportEdges } from "./import-resolution.js";
import { derivePathFromSymbolKey } from "./risk.js";
import { EXTENSION_LANG } from "./walker.js";
import { snippetForSymbol, SNIPPET_WINDOW, type DebtSnippet } from "./update.js";

/**
 * Budget caps (single source of truth). Each section is capped
 * independently; when a cap binds, `truncated` is true and `totals` carries
 * the pre-cap counts.
 */
export const IMPACT_BUDGETS = {
  maxSymbols: 50,
  maxPages: 20,
  maxSnippets: 10,
  maxImporters: 25,
} as const;

export interface ChangeImpactOptions {
  /**
   * Seed for the changed-symbol set. `"working-tree"` (default) diffs the
   * working tree vs HEAD; `"debt"` reads the open debt rows via status.
   */
  mode?: "working-tree" | "debt";
  maxSymbols?: number;
  maxPages?: number;
  maxSnippets?: number;
  maxImporters?: number;
  /** Snippet window per symbol in lines (default SNIPPET_WINDOW = 20). */
  snippetWindow?: number;
}

export interface ImpactChangedSymbol {
  symbolKey: string;
  /** `moved` only appears in `debt` mode (the preview does not detect renames). */
  event: "changed" | "deleted" | "moved";
}

export interface ImpactPage {
  wikiPath: string;
  /** Changed symbols this page cites (deduped, sorted by symbolKey). */
  items: ImpactChangedSymbol[];
}

export interface ChangeImpact {
  mode: "working-tree" | "debt";
  /**
   * working-tree mode only: the git diff could not be computed (not a git
   * repo / git unavailable). The rest of the impact is empty — a degrade,
   * never an error.
   */
  notGitRepo: boolean;
  /** Changed files that seeded the dependency view (sorted). */
  changedFiles: string[];
  /** Deduped changed symbols across all affected pages, sorted by key, capped. */
  changedSymbols: ImpactChangedSymbol[];
  /** Affected wiki pages, sorted by wikiPath, capped. */
  pages: ImpactPage[];
  /**
   * Distinct files importing at least one changed file (resolved import
   * edges, recomputed on demand). Sorted, capped. A changed file that
   * imports another changed file appears here too — the list answers
   * "which files depend on the change", not "which files are unchanged".
   */
  importers: string[];
  /** Source windows for the first `maxSnippets` changed symbols. */
  snippets: DebtSnippet[];
  /** True when ANY budget capped a section — never silent. */
  truncated: boolean;
  /** Pre-cap counts, so a binding cap is quantified. */
  totals: {
    symbols: number;
    pages: number;
    importers: number;
    /** Snippet candidates after the symbol cap (pre-`maxSnippets`). */
    snippetCandidates: number;
  };
}

type ImpactEvent = ImpactChangedSymbol["event"];

/**
 * Computes the bounded change-impact package. Read-only and total: any
 * infrastructure gap (no git, no index DB, unreadable file) degrades a
 * section instead of throwing.
 */
export async function computeChangeImpact(
  repoRoot: string,
  opts: ChangeImpactOptions = {},
): Promise<ChangeImpact> {
  const absRoot = nodePath.resolve(repoRoot);
  const mode = opts.mode ?? "working-tree";
  const maxSymbols = opts.maxSymbols ?? IMPACT_BUDGETS.maxSymbols;
  const maxPages = opts.maxPages ?? IMPACT_BUDGETS.maxPages;
  const maxSnippets = opts.maxSnippets ?? IMPACT_BUDGETS.maxSnippets;
  const maxImporters = opts.maxImporters ?? IMPACT_BUDGETS.maxImporters;
  const snippetWindow = opts.snippetWindow ?? SNIPPET_WINDOW;

  // 1) Changed-symbol seed.
  let notGitRepo = false;
  let changedFiles: string[];
  let allPages: ImpactPage[];
  if (mode === "working-tree") {
    const preview = await previewWorkingTreeDebt(absRoot);
    if (preview.notGitRepo) {
      return emptyImpact(mode, true);
    }
    notGitRepo = false;
    changedFiles = preview.changedFiles;
    allPages = preview.pages;
  } else {
    const seeded = await seedFromDebt(absRoot);
    changedFiles = seeded.changedFiles;
    allPages = seeded.pages;
  }

  // 2) Flattened, deduped symbol view (first event wins in page order — the
  //    same (symbol, page) comparison is page-independent, so duplicates
  //    across pages always agree). Sorted by key.
  const symbolMap = new Map<string, ImpactEvent>();
  for (const page of allPages) {
    for (const item of page.items) {
      if (!symbolMap.has(item.symbolKey)) symbolMap.set(item.symbolKey, item.event);
    }
  }
  const allSymbols: ImpactChangedSymbol[] = [...symbolMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([symbolKey, event]) => ({ symbolKey, event }));

  // 3) Section caps.
  const changedSymbols = allSymbols.slice(0, maxSymbols);
  const pages = allPages.slice(0, maxPages);

  // 4) Dependencies: direct importers of the changed files. Requires the
  //    index inventory — skipped (not an error) without an existing DB.
  let allImporters: string[] = [];
  if (changedFiles.length > 0 && (await indexDbExists(absRoot))) {
    allImporters = await computeDirectImporters(absRoot, new Set(changedFiles));
  }
  const importers = allImporters.slice(0, maxImporters);

  // 5) Snippets for the highest-priority changed symbols (deterministic
  //    sorted order). Deleted symbols in a still-existing file resolve
  //    through the index fallback inside snippetForSymbol (the stale
  //    indexed positions); a deleted file yields no snippet.
  const snippetCandidates = changedSymbols.slice(0, maxSnippets);
  const snippets: DebtSnippet[] = [];
  for (const symbol of snippetCandidates) {
    const snippet = await snippetForSymbol(absRoot, symbol.symbolKey, snippetWindow);
    if (snippet) snippets.push(snippet);
  }

  const truncated =
    allSymbols.length > changedSymbols.length ||
    allPages.length > pages.length ||
    allImporters.length > importers.length ||
    changedSymbols.length > snippetCandidates.length;

  return {
    mode,
    notGitRepo,
    changedFiles,
    changedSymbols,
    pages,
    importers,
    snippets,
    truncated,
    totals: {
      symbols: allSymbols.length,
      pages: allPages.length,
      importers: allImporters.length,
      snippetCandidates: changedSymbols.length,
    },
  };
}

function emptyImpact(mode: "working-tree" | "debt", notGitRepo: boolean): ChangeImpact {
  return {
    mode,
    notGitRepo,
    changedFiles: [],
    changedSymbols: [],
    pages: [],
    importers: [],
    snippets: [],
    truncated: false,
    totals: { symbols: 0, pages: 0, importers: 0, snippetCandidates: 0 },
  };
}

/** The read-only guarantee: the index is opened only when it already exists. */
async function indexDbExists(absRoot: string): Promise<boolean> {
  const stat = await nodeFs
    .stat(nodePath.join(absRoot, ".livewiki", "index.db"))
    .catch(() => null);
  return stat !== null;
}

/**
 * Debt-mode seed: open debt rows (via status.run — the single source of
 * truth) grouped per wiki page, mirroring the preview's page shape. Items
 * without a `symbol_key` or a `wiki_path` cannot seed the impact view and
 * are skipped. Without an existing index DB there is no debt to read.
 */
async function seedFromDebt(
  absRoot: string,
): Promise<{ changedFiles: string[]; pages: ImpactPage[] }> {
  if (!(await indexDbExists(absRoot))) return { changedFiles: [], pages: [] };

  const status = await runStatus(absRoot);
  const files = new Set<string>();
  const byPage = new Map<string, Map<string, ImpactEvent>>();
  for (const item of status.debt.items) {
    if (!item.symbol_key || !item.wiki_path) continue;
    const path = derivePathFromSymbolKey(item.symbol_key);
    if (path !== null) files.add(path);
    let page = byPage.get(item.wiki_path);
    if (!page) {
      page = new Map();
      byPage.set(item.wiki_path, page);
    }
    if (!page.has(item.symbol_key)) page.set(item.symbol_key, item.event);
  }

  const pages: ImpactPage[] = [...byPage.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([wikiPath, items]) => ({
      wikiPath,
      items: [...items.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([symbolKey, event]) => ({ symbolKey, event })),
    }));
  return { changedFiles: [...files].sort(), pages };
}

/**
 * Direct importers of the changed files: import edges recomputed on demand
 * (never persisted — the risk.ts/status.ts pattern), with an empty
 * workspace map (relative edges, which carry the signal, resolve
 * identically). Only anchored-tier files are parsed; prose-tier files can
 * hold no imports. Distinct importer files, sorted.
 */
async function computeDirectImporters(
  absRoot: string,
  changedFiles: ReadonlySet<string>,
): Promise<string[]> {
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const files = db
      .prepare("SELECT * FROM files WHERE status = 'active'")
      .all() as FileRow[];
    // Same tier projection as status.ts (walker's extension→lang map): only
    // anchored-tier files are parsed for imports.
    const anchoredLangs = new Set(Object.values(EXTENSION_LANG));
    const allPaths: string[] = [];
    const anchoredPaths: string[] = [];
    for (const f of files) {
      allPaths.push(f.path);
      if (anchoredLangs.has(f.lang)) anchoredPaths.push(f.path);
    }
    const importsByFile = await collectImportsForFiles(absRoot, anchoredPaths);
    const edges = resolveImportEdges({
      importsByFile,
      knownFiles: new Set(allPaths),
      workspacePackages: [],
      goModulePath: await loadGoModulePath(absRoot),
    });
    const importers = new Set<string>();
    for (const edge of edges) {
      if (changedFiles.has(edge.toFile)) importers.add(edge.fromFile);
    }
    return [...importers].sort();
  } finally {
    db.close();
  }
}
