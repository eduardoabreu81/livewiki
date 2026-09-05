/** Wiki-only I/O for agent-facing document operations. */
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { extractAnchors } from "./anchors.js";
import { run as runVerify } from "./verify.js";

/** Resolve aliases once; the internal cache is never a document target. */
export async function resolveWikiDocumentPath(repoRoot: string, path: string): Promise<string> {
  const normalized = nodePath.posix.normalize(path.replace(/\\/g, "/"));
  if (nodePath.isAbsolute(path) || nodePath.win32.isAbsolute(path) ||
      !normalized.startsWith("livewiki/")) {
    throw new safeIo.PathOutsideAllowlistError(repoRoot, path, ["livewiki/"]);
  }
  const root = await nodeFs.realpath(repoRoot);
  const target = await safeIo.resolveAndValidate(root, normalized);
  const canonical = nodePath.relative(root, target).split(nodePath.sep).join("/");
  // safe-io also permits .livewiki/. Recheck the resolved destination so a
  // symlink from the wiki into that internal directory cannot cross this boundary.
  if (!canonical.startsWith("livewiki/")) {
    throw new safeIo.PathOutsideAllowlistError(repoRoot, path, ["livewiki/"]);
  }
  return canonical;
}

export async function readWikiDocument(repoRoot: string, path: string): Promise<string> {
  return safeIo.readText(repoRoot, await resolveWikiDocumentPath(repoRoot, path));
}

export interface WriteWikiDocumentOptions {
  repoRoot: string;
  path: string;
  content: string;
  skipVerify?: boolean;
  verify?: typeof runVerify;
}

export type WriteWikiDocumentResult =
  | { ok: true; path: string; verified: boolean }
  | { ok: false; path: string; error: string };

/** Preserve human content before writing, and restore the prior page on failure. */
export async function writeWikiDocument(opts: WriteWikiDocumentOptions): Promise<WriteWikiDocumentResult> {
  const path = await resolveWikiDocumentPath(opts.repoRoot, opts.path);
  const existing = await readExisting(opts.repoRoot, path);
  if (existing !== null) assertHumanContentPreserved(existing, opts.content);

  await safeIo.writeTextAtomic(opts.repoRoot, path, opts.content, {
    expected: existing,
    tempDirRelPath: ".livewiki",
  });
  if (opts.skipVerify) return { ok: true, path, verified: false };

  let failure: string;
  try {
    const report = await (opts.verify ?? runVerify)(opts.repoRoot);
    const issues = report.issues.filter((issue) =>
      issue.severity === "error" && (issue.wikiPath === "" ||
        nodePath.posix.normalize(issue.wikiPath.replace(/\\/g, "/")) === path));
    if (issues.length === 0) return { ok: true, path, verified: true };
    failure = `verify rejected the page (${issues.length} error issue(s)). ` +
      `First issue: ${issues[0]!.code} — ${issues[0]!.detail}.`;
  } catch (error) {
    failure = `verify crashed: ${error instanceof Error ? error.message : String(error)}.`;
  }

  try {
    if (existing !== null) {
      await safeIo.writeTextAtomic(opts.repoRoot, path, existing, {
        expected: opts.content,
        tempDirRelPath: ".livewiki",
      });
    } else {
      if (await readExisting(opts.repoRoot, path) !== opts.content) {
        throw new safeIo.CompareAndSwapConflictError(path);
      }
      await safeIo.remove(opts.repoRoot, path);
    }
  } catch (error) {
    return {
      ok: false, path,
      error: `${failure} Rollback failed; the disk may hold an UNVERIFIED page at ` +
        `${JSON.stringify(path)}. Inspect that path before continuing. ` +
        (error instanceof Error ? error.message : String(error)),
    };
  }
  return {
    ok: false, path,
    error: `${failure} ` + (existing === null
      ? "Page NOT written; the page was NOT kept."
      : "The previous page was restored byte-for-byte."),
  };
}

async function readExisting(repoRoot: string, path: string): Promise<string | null> {
  try {
    return await safeIo.readText(repoRoot, path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertHumanContentPreserved(existing: string, candidate: string): void {
  const previous = extractAnchors(existing.replace(/^\uFEFF/, ""));
  if (previous.owner === "human") {
    throw new Error("the existing page declares owner: human and was left byte-identical");
  }
  const protectedBlocks = manualBlockContents(existing);
  if (protectedBlocks.length === 0 && previous.owner !== "mixed") return;
  const next = extractAnchors(candidate.replace(/^\uFEFF/, ""));
  if (previous.owner === "mixed" && next.owner !== "mixed") {
    throw new Error("the existing page declares owner: mixed; preserve that ownership");
  }
  const remaining = manualBlockContents(candidate);
  for (const block of protectedBlocks) {
    const index = remaining.indexOf(block);
    if (index < 0) throw new Error("manual_block_altered: existing manual blocks must be preserved byte-for-byte");
    remaining.splice(index, 1);
  }
}

/** Match original bytes: frontmatter parsing normalizes CRLF before computing offsets. */
function manualBlockContents(content: string): string[] {
  return [...content.matchAll(/<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->/g)]
    .map((match) => match[0]);
}
