/**
 * pointer — opt-in append de bloco "livewiki:start/end" em AGENTS.md / CLAUDE.md.
 *
 * SPEC §"Inviolable rules" #2:
 *   "Pointer in AGENTS.md/CLAUDE.md: only with an explicit flag
 *    (`--write-pointer`) or interactive confirmation. Never automatic.
 *    The modification is an append of a delimited block
 *    (`<!-- livewiki:start -->` ... `<!-- livewiki:end -->`), idempotent."
 *
 * This exception does NOT live in `safe-io.ts` — it stays in a separate module
 * (this one). safe-io only knows the two "safe" directories (livewiki/ +
 * .livewiki/). The pointer is the only exception and is here, deliberately, with
 * allowPointer opt-in.
 *
 * Behavior:
 *   - `insertPointer(repoRoot, opts)`: inserts/replaces the block in AGENTS.md
 *     (default) or CLAUDE.md (`opts.file`). Idempotent.
 *   - `removePointer(repoRoot, opts)`: removes the block if it exists.
 *   - `findPointerBlock(content)`: pure parser of the block (testable without disk).
 *   - `buildPointerBlock()`: generates the block content (1 paragraph + 1 link).
 *
 * The block content is deliberately SHORT — 1 paragraph pointing to
 * quickstart.md. Agents/HUMANS who read AGENTS.md see the pointer and know
 * that a wiki exists. No wiki content is duplicated here.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";

/** Block markers — must be stable (external parsers may depend on them). */
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";

/** Files allowed for the pointer (rule #2 says "in AGENTS.md/CLAUDE.md"). */
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
export type PointerFile = (typeof POINTER_FILES)[number];

/** Automatic decision of the target file. */
export function pickPointerFile(
  hasAgentsMd: boolean,
  hasClaudeMd: boolean,
  requested?: PointerFile,
): PointerFile {
  if (requested) return requested;
  // Preference: AGENTS.md if it exists (most common), else CLAUDE.md, else creates AGENTS.md
  if (hasAgentsMd) return "AGENTS.md";
  if (hasClaudeMd) return "CLAUDE.md";
  return "AGENTS.md";
}

export interface PointerInsertOptions {
  /** Which target file. Default: pickPointerFile() */
  file?: PointerFile;
  /** Custom block content. Default: buildPointerBlock(). */
  block?: string;
}

export type PointerAction = "inserted" | "replaced" | "unchanged";

export interface PointerInsertResult {
  file: PointerFile;
  action: PointerAction;
  /** Bytes written (0 if 'unchanged'). */
  bytesWritten: number;
}

/** Default block content. Short and direct. */
export function buildPointerBlock(): string {
  // Idiomatic: 1 paragraph + 1 link.
  // Keeps it concise — whoever wants more context clicks the link.
  return [
    POINTER_START,
    "",
    "> This repository has a [livewiki](./livewiki/quickstart.md) — ",
    "> live documentation, anchored to code symbols and verifiable. ",
    "> Start with the quickstart (low token) and use `livewiki status --json` ",
    "> to see open documentation debt.",
    "",
    POINTER_END,
  ].join("\n");
}

/**
 * Finds the livewiki block in the markdown content. Returns the indices (start,
 * end) including the markers, or null if it does not exist. Pure — does not touch
 * disk.
 *
 * The search is tolerant:
 *   - Ignores leading whitespace before the start marker (defense against CRLF/BOM)
 *   - Accepts the end marker even if it has spaces around it
 *   - Returns the first match (not multiple — insertPointer is idempotent and
 *     always replaces the first/only existing block)
 */
export function findPointerBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null {
  const startRegex = /<!--\s*livewiki:start\s*-->/;
  const endRegex = /<!--\s*livewiki:end\s*-->/;
  const startMatch = startRegex.exec(content);
  if (!startMatch) return null;
  const endMatch = endRegex.exec(content);
  if (!endMatch) {
    // Truncated block (no end marker) — treat as absent. Avoids corrupting the doc.
    return null;
  }
  const startIdx = startMatch.index;
  const endIdx = endMatch.index + endMatch[0].length;
  const inner = content.slice(startIdx + startMatch[0].length, endMatch.index);
  return { startIdx, endIdx, inner };
}

/**
 * Replaces the existing block with the new one, OR appends it if it does not
 * exist. Pure — operates only on a string.
 */
export function applyPointerReplace(
  content: string,
  newBlock: string,
): { content: string; action: PointerAction } {
  const found = findPointerBlock(content);
  if (!found) {
    // Append at the end, with 1 separating blank line (if the content is non-empty)
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n\n" : "\n";
    const appended = content.length > 0
      ? content + sep + newBlock + "\n"
      : newBlock + "\n";
    return { content: appended, action: "inserted" };
  }
  const replaced =
    content.slice(0, found.startIdx) +
    newBlock +
    content.slice(found.endIdx);
  // Same string after normalization = unchanged (defense against no-op writes)
  if (replaced === content) return { content, action: "unchanged" };
  return { content: replaced, action: "replaced" };
}

/**
 * Removes the block from the content if it exists. Pure.
 */
export function applyPointerRemove(content: string): {
  content: string;
  removed: boolean;
} {
  const found = findPointerBlock(content);
  if (!found) return { content, removed: false };
  // Removes the block + adjacent whitespace (newline after the end marker)
  let before = content.slice(0, found.startIdx);
  let after = content.slice(found.endIdx);
  // Trim trailing newline from 'before' if 'after' starts with a blank line
  if (before.endsWith("\n\n") && after.startsWith("\n")) {
    before = before.slice(0, -1);
  } else if (before.endsWith("\n") && after.startsWith("\n")) {
    // already has enough separator, do not duplicate
    after = after.replace(/^\n+/, "");
  }
  const merged = before + after;
  return { content: merged, removed: merged !== content };
}

/**
 * Inserts/replaces the pointer in the target file. Idempotent.
 *
 * Uses safe-io with allowPointer=true (the only exception to rule #1,
 * documented here). Throws PathOutsideAllowlistError if opts.file is not
 * AGENTS.md or CLAUDE.md (defense against path injection).
 */
export async function insertPointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult> {
  const absRoot = nodePath.resolve(repoRoot);

  // Decides the target file
  const agentsExists = await safeIo.exists(absRoot, "AGENTS.md").catch(() => false);
  const claudeExists = await safeIo.exists(absRoot, "CLAUDE.md").catch(() => false);
  const file = pickPointerFile(agentsExists, claudeExists, opts.file);

  // Double validation: only AGENTS.md or CLAUDE.md, even if safe-io accepts it
  // (defense in depth — safe-io already validates, but it costs nothing)
  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }

  // Reads current content (if it exists) — uses safe-io with allowPointer
  let current = "";
  if (await safeIo.exists(absRoot, file, { allowPointer: true })) {
    current = await safeIo.readText(absRoot, file, { allowPointer: true });
  }

  // Calculates the new content
  const block = opts.block ?? buildPointerBlock();
  const { content: newContent, action } = applyPointerReplace(current, block);

  // Only writes if it changed (on-disk idempotency — avoids no-op git diff)
  if (action === "unchanged") {
    return { file, action, bytesWritten: 0 };
  }

  await safeIo.writeText(absRoot, file, newContent, { allowPointer: true });
  return { file, action, bytesWritten: newContent.length - current.length };
}

/**
 * Removes the pointer from the target file. No-op if the block does not exist.
 */
export async function removePointer(
  repoRoot: string,
  opts: PointerInsertOptions = {},
): Promise<PointerInsertResult> {
  const absRoot = nodePath.resolve(repoRoot);

  const agentsExists = await safeIo.exists(absRoot, "AGENTS.md").catch(() => false);
  const claudeExists = await safeIo.exists(absRoot, "CLAUDE.md").catch(() => false);
  const file = pickPointerFile(agentsExists, claudeExists, opts.file);

  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }

  if (!(await safeIo.exists(absRoot, file, { allowPointer: true }))) {
    return { file, action: "unchanged", bytesWritten: 0 };
  }
  const current = await safeIo.readText(absRoot, file, { allowPointer: true });
  const { content: newContent, removed } = applyPointerRemove(current);
  if (!removed) return { file, action: "unchanged", bytesWritten: 0 };

  await safeIo.writeText(absRoot, file, newContent, { allowPointer: true });
  return { file, action: "replaced", bytesWritten: newContent.length - current.length };
}

/**
 * Reads the target file and returns the pointer status (present, recent action,
 * etc). Useful for the CLI to report to the user.
 */
export async function readPointerStatus(
  repoRoot: string,
  opts: { file?: PointerFile } = {},
): Promise<{
  file: PointerFile | null;
  present: boolean;
  inner?: string;
}> {
  const absRoot = nodePath.resolve(repoRoot);

  // If file was passed, checks only that one; otherwise checks BOTH (any one with a block = present)
  if (opts.file) {
    const exists = await safeIo.exists(absRoot, opts.file, { allowPointer: true }).catch(() => false);
    if (!exists) return { file: opts.file, present: false };
    const content = await safeIo.readText(absRoot, opts.file, { allowPointer: true });
    const found = findPointerBlock(content);
    return found
      ? { file: opts.file, present: true, inner: found.inner.trim() }
      : { file: opts.file, present: false };
  }

  for (const f of POINTER_FILES) {
    const exists = await safeIo.exists(absRoot, f, { allowPointer: true }).catch(() => false);
    if (!exists) continue;
    const content = await safeIo.readText(absRoot, f, { allowPointer: true });
    const found = findPointerBlock(content);
    if (found) {
      return { file: f, present: true, inner: found.inner.trim() };
    }
  }
  return { file: null, present: false };
}

/**
 * Low-level helper: creates an empty AGENTS.md/CLAUDE.md if it does not exist.
 * Exposed for tests and for cases where the caller wants to guarantee that the
 * file exists before calling insertPointer (but insertPointer already handles
 * that).
 */
export async function ensurePointerFile(
  repoRoot: string,
  file: PointerFile,
): Promise<void> {
  if (!POINTER_FILES.includes(file)) {
    throw new Error(`Invalid pointer file: ${file}`);
  }
  const absRoot = nodePath.resolve(repoRoot);
  const exists = await safeIo.exists(absRoot, file, { allowPointer: true }).catch(() => false);
  if (!exists) {
    await safeIo.writeText(absRoot, file, "", { allowPointer: true });
  }
}

// Re-export so that node:fs is used only internally
export const _internal = { nodeFs };