/**
 * safe-io — the only module authorized to write to disk.
 *
 * SPEC Inviolable Rule #1: all writes go through here. Validation against the
 * allowlist (livewiki/ + .livewiki/ inside repoRoot). Paths outside this =
 * error. No exceptions, not even in tests.
 *
 * Rule #2 (pointer in AGENTS.md/CLAUDE.md): opt-in via explicit flag. This
 * exception does NOT live here — it belongs in a separate Phase 5 module (`pointer.ts`).
 * safe-io only knows the two "safe" directories.
 *
 * Symlink defense:
 *   After validating that the declared path is within the allowlist (fast, fails
 *   early), we walk from the target up to the deepest existing ancestor, resolve
 *   its realpath, reconstruct the final path, and REVALIDATE the allowlist. This
 *   closes attack vectors such as:
 *     - `livewiki` is a symlink to `/tmp/`        → realpath shows /tmp, outside
 *     - `livewiki/sub` is a symlink to `../src`   → realpath shows src, outside
 *     - `livewiki/leaf` is a symlink to `/etc/x`  → realpath shows /etc, outside
 *
 *   Tested from both sides (attack + legitimate path via internal symlink).
 */

import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";

/** Directories inside repoRoot where writing is allowed. */
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
export type AllowedDir = (typeof ALLOWED_DIRS)[number];

export interface SafeIoOptions {
  /**
   * When true, accepts writes to AGENTS.md / CLAUDE.md at the repo root.
   * Implemented in Phase 5 (pointer). Kept in the interface to enforce the
   * explicit path: default false, conscious opt-in.
   */
  allowPointer?: boolean;
  /**
   * When true, accepts writes to README.md at the repository root.
   * Opt-in for the `export readme` target only (rule #6: human content is
   * never rewritten by automation — readme-export enforces the marker-block
   * contract before any write reaches safe-io). Default false.
   */
  allowReadme?: boolean;
}

export class PathOutsideAllowlistError extends Error {
  public readonly repoRoot: string;
  public readonly attempted: string;
  public readonly allowlist: readonly string[];

  constructor(repoRoot: string, attempted: string, allowlist: readonly string[]) {
    super(
      `Refusing I/O outside allowlist: ${attempted} ` +
        `(repoRoot=${repoRoot}, allowlist=${allowlist.join(", ")})`,
    );
    this.name = "PathOutsideAllowlistError";
    this.repoRoot = repoRoot;
    this.attempted = attempted;
    this.allowlist = allowlist;
  }
}

export class InvalidRelativePathError extends Error {
  constructor(relPath: string, reason: string) {
    super(`Invalid relative path ${JSON.stringify(relPath)}: ${reason}`);
    this.name = "InvalidRelativePathError";
  }
}

/** Raised when an authoritative file changed after its caller read it. */
export class CompareAndSwapConflictError extends Error {
  constructor(relPath: string) {
    super(`concurrent write detected for ${relPath}`);
    this.name = "CompareAndSwapConflictError";
  }
}

/** Raised when another process is already updating repository authority. */
export class WriteLockBusyError extends Error {
  constructor(relPath: string) {
    super(
      `write lock is busy: ${relPath}. If no livewiki process is running, ` +
      `delete the lock file ${relPath} and retry.`,
    );
    this.name = "WriteLockBusyError";
  }
}

let atomicTempSequence = 0;
const ATOMIC_RENAME_ATTEMPTS = 20;
const ATOMIC_RENAME_RETRY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
// Writes under the lock are sub-second; a lock older than this is a SIGKILL
// leftover, not a live writer, and is reclaimed once.
const WRITE_LOCK_STALE_MS = 60_000;

function allowlistFor(opts: SafeIoOptions): readonly string[] {
  const extras: string[] = [];
  if (opts.allowPointer) extras.push("AGENTS.md", "CLAUDE.md");
  if (opts.allowReadme) extras.push("README.md");
  return [...ALLOWED_DIRS, ...extras];
}

/**
 * Absolute path of an allowed directory inside repoRoot.
 * Throws if repoRoot is invalid.
 */
function allowedAbs(repoRoot: string, dir: AllowedDir): string {
  const absRoot = nodePath.resolve(repoRoot);
  const absDir = nodePath.resolve(absRoot, dir);
  // Defense in depth: the allowed directory MUST be inside repoRoot.
  const rel = nodePath.relative(absRoot, absDir);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    // Should not happen — `dir` is a controlled literal — but fail closed.
    throw new Error(`Internal: allowed dir ${dir} escapes repoRoot`);
  }
  return absDir;
}

/**
 * Decides whether an absolute path is inside any allowed directory.
 * Compares by prefix + separator (not substring), to avoid
 * `livewiki-evil` being accepted as inside `livewiki/`.
 *
 * Pure: does not touch disk. Used both in initial validation (fast)
 * and in revalidation after realpath.
 */
export function isInsideAllowlist(
  repoRoot: string,
  absPath: string,
  opts: SafeIoOptions = {},
): boolean {
  const target = nodePath.resolve(absPath);
  if (opts.allowPointer) {
    // AGENTS.md and CLAUDE.md at the repoRoot root. Validated by file name,
    // not by directory, because rule #2 states "in AGENTS.md/CLAUDE.md",
    // not "in a directory".
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      const allowed = nodePath.resolve(repoRoot, filename);
      if (target === allowed) return true;
    }
  }
  if (opts.allowReadme) {
    // README.md at the repository root — validated by file name, like the
    // pointer files above, because the opt-in covers exactly one file.
    const allowed = nodePath.resolve(repoRoot, "README.md");
    if (target === allowed) return true;
  }
  return ALLOWED_DIRS.some((dir) => {
    const allowed = allowedAbs(repoRoot, dir);
    const rel = nodePath.relative(allowed, target);
    // Inside if: relative does not start with .., is not absolute, and is not empty
    // (empty = target === allowed, which is the directory itself, ok).
    return !rel.startsWith("..") && !nodePath.isAbsolute(rel);
  });
}

/**
 * Validates the declared path WITHOUT considering symlinks. Fails early on
 * obvious cases (absolute path, traversal, outside the allowlist in declared path).
 */
function validateDeclared(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions,
): string {
  if (nodePath.isAbsolute(relPath)) {
    throw new InvalidRelativePathError(relPath, "must be relative to repoRoot");
  }
  const normalized = nodePath.normalize(relPath);
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new InvalidRelativePathError(relPath, "contains '..' segment");
  }
  const absRoot = nodePath.resolve(repoRoot);
  const absTarget = nodePath.resolve(absRoot, normalized);
  if (!isInsideAllowlist(absRoot, absTarget, opts)) {
    throw new PathOutsideAllowlistError(absRoot, absTarget, allowlistFor(opts));
  }
  return absTarget;
}

/**
 * Finds the deepest existing ancestor starting from `from` and walking
 * toward `stopAt`. Returns a tuple [ancestor, suffix]:
 *   - `ancestor`: the deepest directory (or file) that exists
 *   - `suffix`: the part of the path that does NOT exist yet, to be joined
 *
 * If nothing along the path exists, returns [stopAt, from-relative-to-stopAt].
 *
 * Synchronous implementation because `existsSync` is what makes sense in the loop —
 * `realpath` is async but only called once with the result.
 */
function findDeepestExisting(
  from: string,
  stopAt: string,
): readonly [ancestor: string, suffix: string] {
  let cursor = from;
  let suffix = "";
  while (cursor !== stopAt) {
    if (nodeFsSync.existsSync(cursor)) {
      return [cursor, suffix] as const;
    }
    const parent = nodePath.dirname(cursor);
    if (parent === cursor) {
      // Safety: reached filesystem root without finding even stopAt.
      // Return stopAt with everything as suffix.
      return [stopAt, nodePath.relative(stopAt, from)] as const;
    }
    suffix = suffix
      ? nodePath.join(nodePath.basename(cursor), suffix)
      : nodePath.basename(cursor);
    cursor = parent;
  }
  // cursor === stopAt. If stopAt exists, return it with the full suffix.
  return [stopAt, suffix] as const;
}

/**
 * Resolves the path, considering symlinks, and revalidates the allowlist.
 *
 * Algorithm:
 *   1. Validate declared path (fast, fails early)
 *   2. Find deepest existing ancestor
 *   3. Realpath of that ancestor
 *   4. Reconstruct final path = realpath(ancestor) + suffix
 *   5. Revalidate allowlist on the final path (defense against symlink attack)
 *
 * Returns the validated absolute path. Throws PathOutsideAllowlistError /
 * InvalidRelativePathError if any validation fails.
 *
 * Race condition: a window exists between existsSync and realpath. In practice,
 * symlinks are rarely created/removed in normal operation, and the caller
 * (writeText, etc.) already handles I/O errors. Not an issue in Phase 0.
 */
export async function resolveAndValidate(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  // Canonicalize the root BEFORE any comparison: on macOS the temp dir is
  // /var/folders/... with /var → /private/var, so a realpath'd target never
  // prefix-matches a lexical root (and vice versa). The allowlist must apply
  // to the REAL location — that is the whole point of the symlink defense.
  // Fall back to the lexical resolve when the root doesn't exist yet (a
  // caller may create it below; comparisons then stay consistently lexical).
  const lexicalRoot = nodePath.resolve(repoRoot);
  let absRoot: string;
  try {
    absRoot = await nodeFs.realpath(lexicalRoot);
  } catch {
    absRoot = lexicalRoot;
  }
  const absDeclared = validateDeclared(absRoot, relPath, opts);

  // The find-existing → realpath step is a TOCTOU window. Under the stage-4
  // worker pool, concurrent tasks create and delete `.livewiki/*.lock` and
  // `.livewiki/*.tmp-*` files mid-resolve. On Windows, realpath on a file
  // deleted in between resolves to an NTFS tombstone
  // (C:\$Extend\$Deleted\... — outside the allowlist) instead of throwing; on
  // POSIX it throws ENOENT. Both are transient: retry a bounded number of
  // times and only fail closed when the path is stably unresolvable (a real
  // symlink escape is re-detected on every attempt and still fails).
  const attempts = 5;
  for (let attempt = 0; ; attempt++) {
    const [ancestor, suffix] = findDeepestExisting(absDeclared, absRoot);

    let realAncestor: string;
    try {
      realAncestor = await nodeFs.realpath(ancestor);
    } catch {
      if (attempt >= attempts - 1) {
        throw new PathOutsideAllowlistError(absRoot, ancestor, allowlistFor(opts));
      }
      await yieldResolveRetry(attempt);
      continue;
    }

    // Reconstruct final path
    const finalAbs = suffix ? nodePath.join(realAncestor, suffix) : realAncestor;

    // Revalidate: if a symlink in the ancestor redirects outside, it lands here.
    if (isInsideAllowlist(absRoot, finalAbs, opts)) {
      return finalAbs;
    }

    // finalAbs escaped the allowlist: either a real symlink escape or a
    // Windows tombstone from a file deleted mid-resolve. Retry while it could
    // still be transient, then fail closed.
    if (attempt >= attempts - 1) {
      throw new PathOutsideAllowlistError(absRoot, finalAbs, allowlistFor(opts));
    }
    await yieldResolveRetry(attempt);
  }
}

/** Tiny backoff so a live concurrent deleter is not raced in a tight loop. */
function yieldResolveRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 8)));
}

// ── I/O Operations ──────────────────────────────────────────────────────────
// All call resolveAndValidate before touching disk.

export async function writeText(
  repoRoot: string,
  relPath: string,
  content: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

/**
 * Atomically replace an allowlisted text file, optionally guarded by an exact
 * compare-and-swap. The short-lived lock belongs in `.livewiki/`, so a crash
 * cannot leave uncommitted lock state in the versioned wiki.
 *
 * `tempDirRelPath` moves the staged temp file out of the target's own
 * directory. Use it whenever another component enumerates that directory
 * concurrently: a reader that lists the directory and then opens each entry
 * races the rename and fails with ENOENT on a temp file that is no longer
 * there. The rename stays atomic as long as both live on the same volume,
 * which any path inside the repository does.
 */
export async function writeTextAtomic(
  repoRoot: string,
  relPath: string,
  content: string,
  opts: SafeIoOptions & {
    expected?: string | null;
    lockRelPath?: string;
    tempDirRelPath?: string;
  } = {},
): Promise<void> {
  const {
    expected,
    lockRelPath = ".livewiki/write.lock",
    tempDirRelPath,
    ...safeOpts
  } = opts;
  const abs = await resolveAndValidate(repoRoot, relPath, safeOpts);
  const lockAbs = await resolveAndValidate(repoRoot, lockRelPath);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.mkdir(nodePath.dirname(lockAbs), { recursive: true });

  const lock = await acquireWriteLock(lockAbs, lockRelPath);

  const tempBaseName = tempDirRelPath === undefined
    ? relPath
    : `${tempDirRelPath.replace(/\/$/, "")}/${nodePath.posix.basename(relPath)}`;
  const tempRelPath =
    `${tempBaseName}.tmp-${process.pid}-${Date.now()}-${atomicTempSequence++}`;
  const tempAbs = await resolveAndValidate(repoRoot, tempRelPath, safeOpts);
  if (tempDirRelPath !== undefined) {
    await nodeFs.mkdir(nodePath.dirname(tempAbs), { recursive: true });
  }
  try {
    if (Object.prototype.hasOwnProperty.call(opts, "expected")) {
      let current: string | null;
      try {
        current = await nodeFs.readFile(abs, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        current = null;
      }
      if (current !== expected) throw new CompareAndSwapConflictError(relPath);
    }
    await nodeFs.writeFile(tempAbs, content, "utf8");
    await renameAtomicTemp(tempAbs, abs);
  } finally {
    await nodeFs.rm(tempAbs, { force: true }).catch(() => undefined);
    await lock.close().catch(() => undefined);
    await nodeFs.rm(lockAbs, { force: true }).catch(() => undefined);
  }
}

async function acquireWriteLock(
  lockAbs: string,
  lockRelPath: string,
): Promise<nodeFs.FileHandle> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await nodeFs.open(lockAbs, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt > 0 || !await removeStaleWriteLock(lockAbs)) {
        throw new WriteLockBusyError(lockRelPath);
      }
    }
  }
  throw new WriteLockBusyError(lockRelPath);
}

/** Unlink a lock only when it is older than any plausible live write. */
async function removeStaleWriteLock(lockAbs: string): Promise<boolean> {
  try {
    const stat = await nodeFs.stat(lockAbs);
    if (Date.now() - stat.mtimeMs < WRITE_LOCK_STALE_MS) return false;
    await nodeFs.rm(lockAbs, { force: true });
  } catch (error) {
    // The holder finished between open and stat; retry the acquisition.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return true;
}

async function renameAtomicTemp(tempAbs: string, targetAbs: string): Promise<void> {
  for (let attempt = 0; attempt < ATOMIC_RENAME_ATTEMPTS; attempt++) {
    try {
      await nodeFs.rename(tempAbs, targetAbs);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !code ||
        !ATOMIC_RENAME_RETRY_CODES.has(code) ||
        attempt === ATOMIC_RENAME_ATTEMPTS - 1
      ) {
        throw error;
      }
      // Windows virus scanners and concurrent readers can hold a just-read
      // destination briefly. Keep the lock and retry the same prepared temp
      // file so compare-and-swap remains atomic from the caller's perspective.
      await new Promise((resolve) => setTimeout(resolve, Math.min(2 ** attempt, 25)));
    }
  }
}

export async function readText(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  return nodeFs.readFile(abs, "utf8");
}

export async function exists(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<boolean> {
  // exists() reads metadata — still validates allowlist (with symlink check).
  // Knowing the existence of a file outside livewiki/ is already an info leak.
  try {
    const abs = await resolveAndValidate(repoRoot, relPath, opts);
    await nodeFs.access(abs);
    return true;
  } catch (err) {
    if (err instanceof PathOutsideAllowlistError) throw err;
    return false;
  }
}

export async function mkdir(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.mkdir(abs, { recursive: true });
}

export async function remove(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.rm(abs, { recursive: true, force: true });
}
