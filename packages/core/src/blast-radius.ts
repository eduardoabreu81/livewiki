/**
 * blast-radius — "what would break if I change symbol X?"
 *
 * Walks the `calls` table BACKWARD from a symbol (its resolved callers,
 * then THEIR callers, transitively) and cross-references the result with
 * `anchors`/`doc_pages` to answer the actual question anyone asking this
 * cares about: which wiki pages document code that (directly or
 * transitively) depends on X.
 *
 * Only RESOLVED edges (`calls.resolved_callee_key`) are walked — an
 * unresolved raw call is a signal the parser saw but couldn't confidently
 * attribute to one symbol (see call-resolution.ts), so it would either be
 * silent noise or a wrong edge in a "what breaks" answer. Bounded by
 * `maxDepth`/`maxNodes` so a central, widely-called utility doesn't walk
 * the entire call graph — `truncated` tells the caller when the bound,
 * not "no more callers", ended the search.
 */

import type Database from "better-sqlite3";

export interface AffectedPage {
  wikiPath: string;
  /** Which symbol(s) in the blast radius this page actually cites. */
  citedSymbolKeys: string[];
}

export interface BlastRadiusResult {
  symbolKey: string;
  /** Callers at depth 1 (call X directly). */
  directCallers: string[];
  /** Callers found at depth >= 2, in BFS discovery order. */
  transitiveCallers: string[];
  affectedPages: AffectedPage[];
  /** True when maxDepth or maxNodes stopped the walk before it exhausted callers. */
  truncated: boolean;
}

export interface BlastRadiusOptions {
  /** Maximum caller-of-caller hops to follow. Default 5. */
  maxDepth?: number;
  /** Maximum total distinct caller symbols to collect. Default 200. */
  maxNodes?: number;
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_MAX_NODES = 200;

export function computeBlastRadius(
  db: Database.Database,
  symbolKey: string,
  opts: BlastRadiusOptions = {},
): BlastRadiusResult {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;

  const callersOf = db.prepare(
    "SELECT DISTINCT caller_key FROM calls WHERE resolved_callee_key = ?",
  );

  const directCallers: string[] = [];
  const transitiveCallers: string[] = [];
  const visited = new Set<string>([symbolKey]);
  let truncated = false;

  let frontier = [symbolKey];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const target of frontier) {
      if (visited.size - 1 >= maxNodes) {
        truncated = true;
        break;
      }
      const rows = callersOf.all(target) as Array<{ caller_key: string }>;
      for (const row of rows) {
        if (visited.has(row.caller_key)) continue;
        visited.add(row.caller_key);
        (depth === 0 ? directCallers : transitiveCallers).push(row.caller_key);
        next.push(row.caller_key);
        if (visited.size - 1 >= maxNodes) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
    frontier = next;
    if (truncated) break;
  }
  if (!truncated && frontier.length > 0) {
    // Loop exited on maxDepth with callers still pending discovery.
    truncated = true;
  }

  const allKeys = [symbolKey, ...directCallers, ...transitiveCallers];
  const affectedPages = findAffectedPages(db, allKeys);

  return { symbolKey, directCallers, transitiveCallers, affectedPages, truncated };
}

function findAffectedPages(db: Database.Database, symbolKeys: string[]): AffectedPage[] {
  if (symbolKeys.length === 0) return [];
  const placeholders = symbolKeys.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT dp.wiki_path AS wikiPath, a.symbol_key AS symbolKey
       FROM anchors a
       JOIN doc_pages dp ON dp.id = a.doc_page_id
       WHERE a.symbol_key IN (${placeholders})
       ORDER BY dp.wiki_path, a.symbol_key`,
    )
    .all(...symbolKeys) as Array<{ wikiPath: string; symbolKey: string }>;

  const byPage = new Map<string, string[]>();
  for (const row of rows) {
    const keys = byPage.get(row.wikiPath) ?? [];
    if (!keys.includes(row.symbolKey)) keys.push(row.symbolKey);
    byPage.set(row.wikiPath, keys);
  }
  return [...byPage.entries()].map(([wikiPath, citedSymbolKeys]) => ({ wikiPath, citedSymbolKeys }));
}
