/**
 * update — incremental mode (the product's heart, Phase 5).
 *
 * SPEC §"CLI commands":
 *   livewiki update — incremental mode: given the diff since lastDocumentedCommit,
 *   lists the debt and (a) emits the "work package" for the in-session agent to
 *   document, or (b) with --llm calls the configured API to pay the debt.
 *
 * SPEC §"Token accounting (Phase 3)":
 *   Incremental: `update` records the size (tokens estimated by a tokenizer)
 *   of the work package emitted to the agent and of the doc written back.
 *   Metrics in their own table in `.livewiki/`, exposed via `status --json`.
 *
 * That number is the product's thesis ("800 tokens instead of rereading the
 * repo"): the package is focused — only debt + snippets of the affected anchors
 * + valid keys — not the whole repo.
 *
 * Package structure (WorkPackage):
 *   - manifest: manifest data (lastDocumentedCommit, pendingBatch)
 *   - debt: open items (changed/moved/deleted) with assignee
 *   - snippets: for each debt item, a slice of the current source around the
 *     symbol (a window of N lines centered on the symbol's start_line — bounded)
 *   - validAnchors: keys of active symbols the agent may anchor
 *   - tokensEstimated: package size (chars / 4 — a common heuristic;
 *     the GPT tokenizer reports ~4 chars/token for English/code)
 *
 * Agent actions after receiving the package (SPEC §Skill "document-as-you-go"):
 *   1. For each debt item: updates the corresponding markdown (or creates it
 *      if it does not exist) — anchoring on the valid symbols.
 *   2. Runs `livewiki verify` to confirm zero issues.
 *   3. (Optional) `livewiki update --record-write <tokens>` to account for
 *      the size of the doc written back — feeds the savings metric.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { run as runStatus, type DebtItem } from "./status.js";
import { readManifest } from "./manifest.js";
import { recordUpdateMetric, type UpdateMetric } from "./update-metrics.js";
// Backlog #2 (plan docs/plans/2026-07-28-change-impact-and-index-freshness.md,
// Item 2): the work package carries the additive `impact` block. The import
// edge change-impact.js → update.js (for the hoisted `snippetForSymbol`)
// forms a cycle with this one; it is safe because every cross-module use is a
// hoisted function declaration referenced only at call time.
import { computeChangeImpact, type ChangeImpact } from "./change-impact.js";

/** Default token estimate: ~4 chars/token (code/EN). */
export const CHARS_PER_TOKEN = 4;

/** Line window around the symbol in the snippet (default ±20 lines). */
export const SNIPPET_WINDOW = 20;

export interface WorkPackageOptions {
  /** Language of the human messages (default: "en"). Unused today, but reserved. */
  language?: "en" | "pt-BR";
  /** Override of the snippet window size (in lines). Default 20. */
  snippetWindow?: number;
  /** Snippet limit (defense — do not include 1000 if the debt is large). */
  maxSnippets?: number;
}

export interface DebtSnippet {
  /** Symbol key (path/to/file.ts#name) — used by the agent to write the anchor. */
  symbolKey: string;
  /** Current source content (window around the symbol). */
  snippet: string;
  /** Absolute file path on disk (relative to repoRoot). */
  filePath: string;
  /** Symbol's start line (1-indexed) — useful for debug. */
  startLine: number;
  /** Symbol's end line (1-indexed). */
  endLine: number;
}

export interface WorkPackage {
  /** Data from the read manifest. Null if it does not exist (repo never initialized). */
  manifest: {
    lastDocumentedCommit: string | null;
    pendingBatch: unknown;
  } | null;
  /** Open debt items — the agent pays each one. */
  debt: DebtItem[];
  /** Source snippets for each debt item (window around the symbol). */
  snippets: DebtSnippet[];
  /** Keys of active symbols the agent may anchor (subset of the debt). */
  validAnchors: string[];
  /** Token estimate of the package (chars / CHARS_PER_TOKEN). */
  tokensEstimated: number;
  /** Size in bytes of the serialized package. */
  bytes: number;
  /** Language of the human messages. */
  language: "en" | "pt-BR";
  /**
   * Additive bounded change-impact context (backlog #2, Item 2 of
   * docs/plans/2026-07-28-change-impact-and-index-freshness.md): working-tree
   * changed symbols, affected pages, direct importers and snippets — the
   * same payload `livewiki_impact` returns with an empty symbolKey.
   * Read-only; degrades to `notGitRepo: true` outside a git repository.
   */
  impact: ChangeImpact;
}

/**
 * Loads the work package: manifest + debt + snippets + valid anchors +
 * accounting. Does NOT call an LLM — emits the package for the in-session
 * agent to consume (or for the `--llm` that lives elsewhere).
 *
 * Side effect: records a "package emitted" metric in update-metrics.json
 * (idempotent write — only rewrites if something changed).
 */
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage> {
  const absRoot = nodePath.resolve(repoRoot);
  const language = opts.language ?? "en";

  // 1) Manifest
  const manifest = await readManifest(absRoot);
  const manifestView = manifest
    ? {
        lastDocumentedCommit: manifest.lastDocumentedCommit,
        pendingBatch: manifest.pendingBatch,
      }
    : null;

  // 2) Open debt (via status — Phase 2's single source of truth)
  const status = await runStatus(absRoot);
  const debt = status.debt.items;

  // 3) Current source snippets for each debt item that has a symbol_key
  const window = opts.snippetWindow ?? SNIPPET_WINDOW;
  const maxSnippets = opts.maxSnippets ?? 50;
  const snippets: DebtSnippet[] = [];
  for (const item of debt.slice(0, maxSnippets)) {
    if (!item.symbol_key || !item.wiki_path) continue;
    const snippet = await snippetForSymbol(absRoot, item.symbol_key, window);
    if (snippet) snippets.push(snippet);
  }

  // 4) Valid keys: subset of the symbol_keys the agent may anchor.
  //    They are exactly the active symbols — limited to the debt items to
  //    reduce noise (the agent only needs to anchor on those).
  const validAnchors = Array.from(
    new Set(debt.map((d) => d.symbol_key).filter((k): k is string => k !== null)),
  ).sort();

  // 5) Change-impact context (backlog #2): bounded working-tree impact,
  //    read-only. Degrades to `notGitRepo: true` outside git — never throws.
  const impact = await computeChangeImpact(absRoot);

  // 6) Assembles the package + estimates tokens
  const pkg: WorkPackage = {
    manifest: manifestView,
    debt,
    snippets,
    validAnchors,
    tokensEstimated: 0, // filled in below
    bytes: 0,
    language,
    impact,
  };
  const json = JSON.stringify(pkg, null, 2);
  pkg.tokensEstimated = Math.ceil(json.length / CHARS_PER_TOKEN);
  pkg.bytes = json.length;

  // 7) Accounting (SPEC §Accounting): records an incremental metric.
  //    Side effect in .livewiki/update_metrics.json (does not block the return).
  await recordUpdateMetric(absRoot, {
    kind: "package_emitted",
    timestamp: Date.now(),
    tokensEstimated: pkg.tokensEstimated,
    bytes: pkg.bytes,
    debtCount: debt.length,
  });

  return pkg;
}

/**
 * Reads the anchor's source file and returns the window around the symbol.
 * Returns null if the file does not exist or the symbol has no start/end.
 *
 * Exported (hoisted) for the change-impact package (backlog #2) — reused,
 * never duplicated. Behavior unchanged.
 */
export async function snippetForSymbol(
  absRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null> {
  const [filePath, symName] = symbolKey.split("#");
  if (!filePath || !symName) return null;

  let source: string;
  try {
    source = await nodeFs.readFile(nodePath.join(absRoot, filePath), "utf8");
  } catch {
    return null; // file vanished
  }
  const lines = source.split("\n");

  // Gets the symbol's lines — a simple search by name. Fine for Phase 5;
  // Phase 6+ can use the index (symbol.start_line/end_line) directly.
  let symStart = -1;
  let symEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // simple match: a line that defines a function/class with the name
    if (
      symStart === -1 &&
      (line.includes(`function ${symName}`) ||
        line.includes(`class ${symName}`) ||
        line.includes(`def ${symName}`) ||
        line.includes(`const ${symName}`) ||
        line.includes(`export function ${symName}`) ||
        line.includes(`export class ${symName}`) ||
        line.includes(`export const ${symName}`) ||
        line.includes(`export async function ${symName}`))
    ) {
      symStart = i;
      // Estimate: symbols last ~20 lines. Good enough for the snippet.
      symEnd = Math.min(lines.length, i + window);
    }
  }

  // If not found by name, uses the symbol index (more reliable)
  if (symStart === -1) {
    const indexed = await lookupSymbol(absRoot, symbolKey);
    if (indexed) {
      symStart = indexed.startLine - 1; // 0-indexed
      symEnd = indexed.endLine;
    } else {
      // No way to locate it — uses the file's first line as a minimal
      // snippet. Better than nothing for the agent to have context.
      symStart = 0;
      symEnd = Math.min(lines.length, window);
    }
  }

  const fromLine = Math.max(0, symStart - 3); // 3 lines of context before
  const toLine = Math.min(lines.length, symEnd + 3); // 3 after
  const snippetLines: string[] = [];
  for (let i = fromLine; i < toLine; i++) {
    snippetLines.push(`${i + 1}: ${lines[i] ?? ""}`);
  }

  return {
    symbolKey,
    filePath,
    snippet: snippetLines.join("\n"),
    startLine: symStart + 1,
    endLine: symEnd,
  };
}

/** DB lookup to get exact start/end_line (more reliable). */
async function lookupSymbol(
  absRoot: string,
  symbolKey: string,
): Promise<{ startLine: number; endLine: number } | null> {
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const row = db
      .prepare("SELECT start_line, end_line FROM symbols WHERE key = ? AND status = 'active'")
      .get(symbolKey) as { start_line: number; end_line: number } | undefined;
    if (!row) return null;
    return { startLine: row.start_line, endLine: row.end_line };
  } finally {
    db.close();
  }
}

/**
 * Helper: records the size of the doc written back by the agent.
 * Called by the skill/CLI after the agent (or human) updates the wiki.
 *
 * Different from `recordUpdateMetric(kind='package_emitted')` — this one is
 * `kind='write_received'` and tracks the OUTPUT (savings: big package → small
 * doc = good savings; big package → big doc = bad savings).
 */
export async function recordDocWrittenBack(
  repoRoot: string,
  payload: {
    wikiPath: string;
    bytes: number;
    tokensEstimated: number;
  },
): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  await recordUpdateMetric(absRoot, {
    kind: "write_received",
    timestamp: Date.now(),
    ...payload,
  });
}

// Re-exports the metric type for the CLI's convenience
export type { UpdateMetric };