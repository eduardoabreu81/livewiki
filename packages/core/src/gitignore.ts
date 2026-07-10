/**
 * gitignore — idempotent .gitignore entry writer.
 *
 * SPEC §"Inviolable rules" #3: "The DB is derived" — `.livewiki/` (SQLite
 * cache) must NOT be committed. `livewiki init` must ensure that the
 * target repo's `.gitignore` contains `.livewiki/` (idempotent).
 *
 * Policy:
 *   - Add entries if MISSING
 *   - Do NOT duplicate if already present (case-sensitive match after trim)
 *   - Do NOT remove existing entries (might have been added manually)
 *   - `# livewiki:start` / `# livewiki:end` comments delimit a managed
 *     block (parser-stable; future updates can target only this block)
 *
 * Position in the file:
 *   - Append at the end (preserves user entries)
 *   - Separator `\n` if the file doesn't end in newline
 *   - Managed block delimited by `# livewiki:start` / `# livewiki:end`
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";

/** Stable markers of the managed block (external parsers may depend on them). */
const BLOCK_START = "# livewiki:start";
const BLOCK_END = "# livewiki:end";

export interface EnsureGitignoreResult {
  /** Absolute path of the .gitignore. */
  file: string;
  /** true if something was written (false if already up to date). */
  changed: boolean;
  /** Entries that were missing and got added. */
  added: string[];
}

/**
 * Reads the repo's .gitignore. Returns empty string if it doesn't exist.
 * Pure wrapper for testability.
 */
export async function readGitignore(repoRoot: string): Promise<string> {
  const file = nodePath.join(nodePath.resolve(repoRoot), ".gitignore");
  try {
    return await nodeFs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * Ensures that all `entries` are in the repo's .gitignore, inside a managed
 * block. Idempotent — multiple calls don't duplicate.
 *
 * Behavior:
 *   - File doesn't exist: creates it with a managed block
 *   - File exists without block: appends the managed block
 *   - File exists with block: rewrites only the block (preserves user
 *     entries added around it)
 *   - Entries already present in the block: no-op (no duplicate)
 *
 * Does not allow opt-out (R is a SPEC rule). Consent would be via a
 * `--no-gitignore` flag on `init` (not implemented — can be added later).
 */
export async function ensureGitignoreEntries(
  repoRoot: string,
  entries: readonly string[],
): Promise<EnsureGitignoreResult> {
  const absRoot = nodePath.resolve(repoRoot);
  const file = nodePath.join(absRoot, ".gitignore");
  const current = await readGitignore(absRoot);

  // Extract the current managed block (if any)
  const existingBlock = extractManagedBlock(current);

  // Decide which entries are missing — check exact membership in the
  // managed block (or the whole file if there's no block)
  const targetLines: readonly string[] = existingBlock
    ? existingBlock.lines
    : current.split(/\r?\n/).filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
  const targetSet = new Set<string>(targetLines.map((l) => l.trim()));

  const missing = entries.filter((e) => !targetSet.has(e.trim()));
  if (missing.length === 0) {
    return { file, changed: false, added: [] };
  }

  // Rebuild the file
  const newBlockLines = mergeBlockLines(existingBlock?.lines ?? [], entries);
  const newBlock = renderBlock(newBlockLines);
  const newContent = replaceManagedBlock(current, newBlock);

  await nodeFs.writeFile(file, newContent, "utf8");
  return { file, changed: true, added: missing };
}

/**
 * Extracts the managed block (`# livewiki:start` ... `# livewiki:end`).
 * Returns null if not present. Tolerant of whitespace in markers.
 */
function extractManagedBlock(content: string): { lines: string[] } | null {
  const startRegex = /^#\s*livewiki:start\s*$/m;
  const endRegex = /^#\s*livewiki:end\s*$/m;
  const startMatch = startRegex.exec(content);
  if (!startMatch) return null;
  const endMatch = endRegex.exec(content);
  if (!endMatch) return null; // truncated block — ignore
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = endMatch.index;
  const inner = content.slice(startIdx, endIdx);
  const lines = inner
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return { lines };
}

/**
 * Merge existing entries in the block + new entries.
 * Keeps order: existing first, then new (preserves caller order).
 */
function mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[] {
  const set = new Set<string>(existing.map((l) => l.trim()));
  const merged: string[] = [...existing];
  for (const e of toAdd) {
    const t = e.trim();
    if (!set.has(t)) {
      merged.push(t);
      set.add(t);
    }
  }
  return merged;
}

/** Render the managed block. */
function renderBlock(lines: string[]): string {
  return [BLOCK_START, ...lines, BLOCK_END].join("\n");
}

/**
 * Replaces the managed block in the content. If it doesn't exist, appends.
 */
function replaceManagedBlock(content: string, newBlock: string): string {
  const startRegex = /^#\s*livewiki:start\s*$/m;
  const endRegex = /^#\s*livewiki:end\s*$/m;
  const startMatch = startRegex.exec(content);
  const endMatch = endRegex.exec(content);

  if (startMatch && endMatch) {
    // Replaces the exact range
    const before = content.slice(0, startMatch.index);
    const after = content.slice(endMatch.index + endMatch[0].length);
    const sep = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
    return before + newBlock + sep + after;
  }

  // No block: append at the end
  const sep = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return content + sep + newBlock + "\n";
}