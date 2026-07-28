/**
 * diff-preview — read-only pre-commit anchor preview (ROADMAP backlog #5;
 * plan docs/plans/2026-07-28-status-diff-preview.md).
 *
 * The anchor ledger (`anchor-ledger.ts:495-516`) detects debt AFTER a
 * commit/index by comparing each anchor's `symbol_hash_at_doc` against the
 * indexed symbols' `content_hash`: missing → `deleted`, mismatch →
 * `changed`. This module applies the SAME comparison to the UNCOMMITTED
 * working tree: one `git diff --name-only HEAD` spawn finds the changed
 * files, symbols are re-extracted from disk through the indexer's own path
 * (`parseSource` + `extractSymbols`, identical key/hash computation), and
 * every anchor row whose `symbol_key` belongs to a changed file is checked
 * against the working-tree symbol set.
 *
 * Guarantees:
 *   - ZERO writes — no debt rows, no anchor updates, no index mutation.
 *     The index DB is only opened when `.livewiki/index.db` already exists
 *     (it is never created here), and only SELECTs run against it.
 *   - `moved` is out of scope for v1: the post-commit ledger catches renames
 *     with full-repo evidence; guessing from a partial diff would
 *     false-positive. The human output carries this note.
 *   - Deterministic output: `changedFiles` sorted, pages sorted by
 *     `wiki_path`, items sorted by `symbolKey`.
 *   - Non-git directory (or git unavailable) → clean degrade
 *     (`notGitRepo: true`), never a throw.
 */

import { spawn } from "node:child_process";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { grammarForExtension, parseSource } from "./parser.js";
import { extractSymbols } from "./symbols.js";
import { BINARY_SNIFF_BYTES, MAX_FILE_BYTES } from "./indexer.js";
import { derivePathFromSymbolKey } from "./risk.js";
import { normalizeRepoPath } from "./modules.js";

export interface DiffPreviewItem {
  symbolKey: string;
  event: "changed" | "deleted";
}

export interface DiffPreviewPage {
  wikiPath: string;
  items: DiffPreviewItem[];
}

export interface DiffPreviewResult {
  /** True when the working-tree diff could not be computed (not a git repo / git missing). */
  notGitRepo: boolean;
  /** Repo-relative paths changed vs HEAD (staged + unstaged; untracked excluded). Sorted. */
  changedFiles: string[];
  /** Wiki pages whose anchors the working tree would invalidate. Sorted by wikiPath. */
  pages: DiffPreviewPage[];
}

/** Scope note carried by the human output (`moved` is a post-commit signal). */
export const MOVED_SCOPE_NOTE =
  "renames (`moved`) are detected by the post-commit ledger (`livewiki index`), not by this preview";

/**
 * Parses `git diff --name-only` output into a sorted, deduped list of
 * repo-relative posix paths. Pure: blank-line tolerant (same idiom as
 * `parseGitChurnOutput` in risk.ts).
 */
export function parseGitDiffOutput(text: string): string[] {
  const files = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    files.add(normalizeRepoPath(line));
  }
  return [...files].sort();
}

/**
 * Runs ONE `git diff --name-only --relative HEAD` with `shell: false` (same
 * spawn pattern as `collectGitChurn` in risk.ts). `--relative` keeps paths
 * relative to `absRoot` even when it is a subdirectory of the git work tree.
 * ANY failure — git missing, not a repo, no HEAD yet, non-zero exit — returns
 * null, never throws.
 */
function runGitDiff(absRoot: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        "git",
        // core.quotepath=false: without it, git C-quotes paths containing
        // non-ASCII bytes, which would never match the indexed file paths.
        ["-c", "core.quotepath=false", "diff", "--name-only", "--relative", "HEAD"],
        { cwd: absRoot, shell: false },
      );
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let out = "";
    child.stdout?.on("data", (chunk: unknown) => {
      out += String(chunk);
    });
    child.on("error", () => done(null));
    child.on("close", (code: number | null) => done(code === 0 ? out : null));
  });
}

/**
 * Recomputes the working-tree symbol sets of the changed files via the
 * indexer's own read/parse/extract path, then compares every anchor row
 * whose `symbol_key` belongs to a changed file against them (the ledger's
 * exact rule: missing → `deleted`, hash mismatch → `changed`).
 *
 * Files deleted in the working tree yield an empty symbol set (all their
 * anchored symbols read as `deleted`). Prose-tier files (no grammar) yield
 * zero symbols, matching the indexer — they can hold no anchors, so they
 * never produce hits. Files the indexer itself would skip entirely (over
 * 1 MiB, NUL byte, unreadable) are excluded from the comparison so their
 * anchors are not false-flagged.
 */
export async function previewWorkingTreeDebt(repoRoot: string): Promise<DiffPreviewResult> {
  const absRoot = nodePath.resolve(repoRoot);

  const diffText = await runGitDiff(absRoot);
  if (diffText === null) {
    return { notGitRepo: true, changedFiles: [], pages: [] };
  }
  const changedFiles = parseGitDiffOutput(diffText);
  if (changedFiles.length === 0) {
    return { notGitRepo: false, changedFiles: [], pages: [] };
  }

  // Read-only guarantee: the preview NEVER creates the index. Without an
  // existing `.livewiki/index.db` there are no anchors to check.
  const dbPathStat = await nodeFs
    .stat(nodePath.join(absRoot, ".livewiki", "index.db"))
    .catch(() => null);
  if (!dbPathStat) {
    return { notGitRepo: false, changedFiles, pages: [] };
  }

  const changedSet = new Set(changedFiles);
  /** path → (symbol key → content_hash), recomputed from the working tree. */
  const workingTreeSymbols = new Map<string, Map<string, string>>();
  /** Files the indexer would skip entirely — excluded from the comparison. */
  const skippedFiles = new Set<string>();

  for (const rel of changedFiles) {
    const abs = nodePath.join(absRoot, rel);
    const stat = await nodeFs.stat(abs).catch(() => null);
    if (!stat) {
      // Deleted in the working tree: every symbol of the file is gone.
      workingTreeSymbols.set(rel, new Map());
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) {
      skippedFiles.add(rel);
      continue;
    }
    const content = await nodeFs.readFile(abs, "utf8").catch(() => null);
    if (content === null || content.slice(0, BINARY_SNIFF_BYTES).includes("\0")) {
      skippedFiles.add(rel);
      continue;
    }
    const symbolsByKey = new Map<string, string>();
    // Tier 2 (SPEC §"Coverage ladder"): without a grammar there is no parse
    // attempt at all — zero symbols, matching the indexer.
    const ext = nodePath.extname(rel);
    if (grammarForExtension(ext) !== undefined) {
      try {
        const tree = await parseSource(ext, content);
        for (const sym of extractSymbols(tree, rel, content)) {
          symbolsByKey.set(sym.key, sym.content_hash);
        }
      } catch {
        // Parse failure: the indexer records zero symbols for the file —
        // mirror that (anchors to its symbols read as deleted).
      }
    }
    workingTreeSymbols.set(rel, symbolsByKey);
  }

  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT a.symbol_key AS symbol_key, a.symbol_hash_at_doc AS hash_at_doc, dp.wiki_path AS wiki_path " +
          "FROM anchors a JOIN doc_pages dp ON dp.id = a.doc_page_id",
      )
      .all() as Array<{ symbol_key: string; hash_at_doc: string; wiki_path: string }>;

    // wiki_path → (symbolKey → event); the Map per page dedupes multiple
    // anchor rows on the same (page, symbolKey) pair.
    const hits = new Map<string, Map<string, "changed" | "deleted">>();
    for (const row of rows) {
      const path = derivePathFromSymbolKey(row.symbol_key);
      if (path === null || !changedSet.has(path) || skippedFiles.has(path)) continue;
      const workingHash = workingTreeSymbols.get(path)?.get(row.symbol_key);
      let event: "changed" | "deleted" | null = null;
      if (workingHash === undefined) {
        event = "deleted";
      } else if (workingHash !== row.hash_at_doc) {
        event = "changed";
      }
      if (event === null) continue;
      let page = hits.get(row.wiki_path);
      if (!page) {
        page = new Map();
        hits.set(row.wiki_path, page);
      }
      page.set(row.symbol_key, event);
    }

    const pages: DiffPreviewPage[] = [...hits.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([wikiPath, items]) => ({
        wikiPath,
        items: [...items.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([symbolKey, event]) => ({ symbolKey, event })),
      }));
    return { notGitRepo: false, changedFiles, pages };
  } finally {
    db.close();
  }
}

/** Human formatter for `livewiki status --diff`. */
export function formatDiffPreviewHuman(result: DiffPreviewResult): string {
  if (result.notGitRepo) {
    return (
      "livewiki status --diff: not a git repository (or git unavailable) — " +
      "cannot compute the working-tree diff"
    );
  }
  const filesWord = `${result.changedFiles.length} changed file${result.changedFiles.length === 1 ? "" : "s"}`;
  const lines: string[] = [];
  if (result.pages.length === 0) {
    lines.push(`livewiki status --diff: working tree clean vs anchors (${filesWord})`);
  } else {
    lines.push(
      `livewiki status --diff: ${result.pages.length} page${result.pages.length === 1 ? "" : "s"} ` +
        `would be invalidated by the working tree (${filesWord})`,
    );
    for (const page of result.pages) {
      lines.push(`  ${page.wikiPath}`);
      for (const item of page.items) {
        lines.push(`    [${item.event}] ${item.symbolKey}`);
      }
    }
  }
  lines.push(`note: ${MOVED_SCOPE_NOTE}`);
  return lines.join("\n");
}
