---
title: Safe I/O for Livewiki Storage
owner: generated
anchors:
- packages/core/src/safe-io.ts#ALLOWED_DIRS
- packages/core/src/safe-io.ts#CompareAndSwapConflictError
- packages/core/src/safe-io.ts#CompareAndSwapConflictError.constructor
- packages/core/src/safe-io.ts#InvalidRelativePathError
- packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
- packages/core/src/safe-io.ts#PathOutsideAllowlistError
- packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
- packages/core/src/safe-io.ts#WriteLockBusyError
- packages/core/src/safe-io.ts#WriteLockBusyError.constructor
- packages/core/src/safe-io.ts#acquireWriteLock
- packages/core/src/safe-io.ts#allowedAbs
- packages/core/src/safe-io.ts#allowlistFor
- packages/core/src/safe-io.ts#exists
- packages/core/src/safe-io.ts#findDeepestExisting
- packages/core/src/safe-io.ts#isInsideAllowlist
- packages/core/src/safe-io.ts#mkdir
- packages/core/src/safe-io.ts#readText
- packages/core/src/safe-io.ts#remove
- packages/core/src/safe-io.ts#removeStaleWriteLock
- packages/core/src/safe-io.ts#renameAtomicTemp
- packages/core/src/safe-io.ts#resolveAndValidate
- packages/core/src/safe-io.ts#validateDeclared
- packages/core/src/safe-io.ts#writeText
- packages/core/src/safe-io.ts#writeTextAtomic
- packages/core/src/safe-io.ts#yieldResolveRetry
---

# Safe I/O for Livewiki Storage

This module is the single authorized gateway for every disk write in the livewiki project, enforcing that all paths stay inside an allowlist of safe directories.

## When to use this page

- Understand why all filesystem mutations must route through `safe-io.ts` before reaching the disk.
- Learn how symlink attacks are detected and blocked during path resolution.
- See how atomic writes and write locks protect concurrent edits to repository authority.
- Identify the exact error types raised when I/O is refused or conflicts occur.

## How it fits

`safe-io.ts` is the backbone of storage safety in `packages/core`. It defines a strict contract: every file operation — read, write, delete, or existence check — first validates its target against an allowlist rooted at the repository root (`repoRoot`). The allowlist contains only `livewiki/` and `.livewiki/` subdirectories, plus optional opt-in files at the root (like `AGENTS.md` or `README.md`) that are not defined here. The module also performs a realpath-based defense against symlink escapes, and provides compare-and-swap (CAS) semantics for authoritative files so concurrent writers cannot silently overwrite each other. Because it is the only authorized writer, all other modules in the project call into this one rather than touching the filesystem directly.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-safe-io.mmd
```

## Path validation flow

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#yieldResolveRetry -->

Every disk operation in this module begins with a full path validation, because the allowlist is the project's invariant #1: no write may occur outside it, with no exceptions even in tests. The flow first performs a cheap lexical check on the declared path, then walks the filesystem to resolve any symlinks, and finally re-checks the real location against the allowlist.

### The allowlist and its construction

The constant `ALLOWED_DIRS` defines the two safe directories relative to the repository root: `livewiki` and `.livewiki`. A type alias `AllowedDir` is derived from it. The helper `allowlistFor(opts: SafeIoOptions): readonly string[]` takes a `SafeIoOptions` object (which may include `allowPointer` or `allowReadme` flags) and returns the full list of allowed names: it starts with `ALLOWED_DIRS` and appends `AGENTS.md`, `CLAUDE.md`, or `README.md` only when the corresponding opt-in flag is set. This function is used both when constructing error messages and internally for clarity, but the actual boolean checks are done by `isInsideAllowlist`.

The function `allowedAbs(repoRoot: string, dir: AllowedDir): string` converts one allowed directory name into an absolute path inside `repoRoot`. It resolves the root and the directory, then checks via `nodePath.relative` that the result does not escape the root; if it does, it throws a generic `Error` — this is a fail-closed defense against an internal mistake, even though the directory names are literal constants.

### Deciding whether a path is allowed

`isInsideAllowlist` is the pure, disk-free decision function. It takes a `repoRoot`, an absolute path, and optional `SafeIoOptions`, and returns a boolean. It first checks the opt-in pointer files by exact equality with the root-relative filenames (so `AGENTS.md` at the root is allowed only when `allowPointer` is true, and `README.md` only when `allowReadme` is true). Then it checks the two subdirectories: for each allowed dir, it computes the relative path from that dir to the target and accepts the target only if that relative path does not start with `..` and is not absolute — this prefix-plus-separator comparison prevents `livewiki-evil` from being mistaken for `livewiki/`. It is used both by the initial fast validation and by the post-realpath revalidation.

### Validating the declared path before touching the disk

`validateDeclared` is the fast, early-fail guard. It receives the repository root, a relative path, and options, and returns the absolute target. It rejects absolute paths with an `InvalidRelativePathError`, rejects normalized paths containing a `..` segment (also with `InvalidRelativePathError`), and rejects paths whose absolute form is not inside the allowlist with a `PathOutsideAllowlistError`. This function deliberately ignores symlinks — it only catches obvious lexical violations.

### Walking to the deepest existing ancestor

`findDeepestExisting` is a synchronous helper that walks upward from a target path toward a stop-at root, returning a tuple `[ancestor, suffix]`. The `ancestor` is the deepest directory (or file) that actually exists, and `suffix` is the portion of the path that does not exist yet and must be appended later. If nothing in the path exists, it returns `[stopAt, from-relativo-a-stopAt]`. It uses `existsSync` in a loop because realpath is asynchronous and is called only once with the result.

### Resolving symlinks and revalidating

`resolveAndValidate` is the exported, asynchronous centerpiece that every I/O operation calls first. It starts by canonicalizing the repository root with `realpath`, falling back to the lexical root if the root does not exist yet (which can happen when a caller will create it below). Then it runs the declared-path validation, and enters a retry loop (up to five attempts) that finds the deepest existing ancestor, calls `realpath` on it, rebuilds the final absolute path by appending the suffix, and re-checks that rebuilt path with `isInsideAllowlist`. If the ancestor's realpath fails (for example because a file was deleted mid-resolve on POSIX), or if the final path escapes the allowlist (a real symlink attack or a Windows tombstone), it retries with a short backoff via `yieldResolveRetry(attempt: number): Promise<void>`, which returns a promise that resolves after up to `2^attempt` milliseconds, capped at 8 ms. It only throws `PathOutsideAllowlistError` when the condition is stable across all attempts.

### The retry backoff helper

`yieldResolveRetry` is a tiny utility: it delays resolution by an exponentially growing but capped number of milliseconds so that a live concurrent process deleting lock or temp files is not raced in a tight loop. It is used only inside the retry loop of `resolveAndValidate`.

## Error types

<!-- lw:anchors packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#CompareAndSwapConflictError packages/core/src/safe-io.ts#CompareAndSwapConflictError.constructor packages/core/src/safe-io.ts#WriteLockBusyError packages/core/src/safe-io.ts#WriteLockBusyError.constructor -->

This module defines a small family of error classes so callers can distinguish the different ways I/O can be refused. Each class extends the built-in `Error` and sets a descriptive `name`, and several carry public fields with the offending path data.

### Path refusal errors

`PathOutsideAllowlistError` is raised whenever a path resolves outside the allowed directories. Its constructor takes three arguments: `repoRoot: string`, `attempted: string`, and `allowlist: readonly string[]`, and stores them as public readonly fields. It formats a message naming the attempted path and the allowlist entries. `InvalidRelativePathError` is raised for lexical violations in a declared path, such as an absolute path or a `..` segment; its constructor takes `relPath: string` and `reason: string`, and the message quotes the path and states the reason. Neither class carries additional behavior beyond the data it stores.

### Concurrency conflict errors

`CompareAndSwapConflictError` is raised when an authoritative file changed after its caller read it — specifically, when `writeTextAtomic` is given an `expected` content and the current file content on disk no longer matches. Its constructor takes a single `relPath: string` and builds a message noting the concurrent write. `WriteLockBusyError` is raised when another process is already holding the write lock; its constructor takes `relPath: string`, and the message instructs the user to delete the lock file if no livewiki process is running. Both classes are thrown only by the atomic write machinery described below.

## Atomic writes and write locks

<!-- lw:anchors packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#writeTextAtomic packages/core/src/safe-io.ts#acquireWriteLock packages/core/src/safe-io.ts#removeStaleWriteLock packages/core/src/safe-io.ts#renameAtomicTemp -->

The module provides both a simple write and an atomic write path. The atomic path is what guards updates to repository authority, ensuring a crash or a racing writer cannot leave the wiki in a half-updated state.

### Plain write

`writeText(repoRoot: string, relPath: string, content: string, opts: SafeIoOptions = {}): Promise<void>` resolves the path with `resolveAndValidate`, creates the parent directory recursively, and writes the file with UTF-8 encoding. It is the basic, non-atomic write used when a simple replace is sufficient.

### Atomic write with compare-and-swap

`writeTextAtomic(repoRoot: string, relPath: string, content: string, opts: SafeIoOptions & { expected?: string | null; lockRelPath?: string } = {}): Promise<void>` is the guarded writer. It takes an optional `expected` content string (or `null`) and an optional custom lock path (defaulting to `.livewiki/write.lock`). It resolves both the target and the lock path, creates both parent directories, acquires the lock, then writes content to a temporary file and renames it into place. Before writing, if `expected` is present in the options, it reads the current file content (treating a missing file as `null`) and throws `CompareAndSwapConflictError` when the current value differs. The temporary file is named as the target plus a `.tmp-` suffix with process id, timestamp, and a monotonically increasing sequence number, all within the allowlist. In a `finally` block it removes the temporary file, closes the lock handle, and unlinks the lock file, so a failure still releases the lock.

### Acquiring and reclaiming the lock

`acquireWriteLock(lockAbs: string, lockRelPath: string): Promise<nodeFs.FileHandle>` attempts to open the lock file with the exclusive-create flag (`"wx"`), which fails with `EEXIST` if another process holds it. On the first `EEXIST`, it tries to reclaim a stale lock via `removeStaleWriteLock`; if that returns `false` (the lock is recent) or on a second `EEXIST`, it throws `WriteLockBusyError`. `removeStaleWriteLock(lockAbs: string): Promise<boolean>` stats the lock file and unlinks it only when its modification time is older than 60 seconds (the `WRITE_LOCK_STALE_MS` constant), which is far beyond any sub-second live write; if the file vanishes between `open` and `stat` (ENOENT), it treats the lock as gone and signals the caller to retry acquisition.

### Renaming the temporary file

`renameAtomicTemp(tempAbs: string, targetAbs: string): Promise<void>` performs the final atomic rename of the prepared temporary file onto the target. It retries up to 20 times (the `ATOMIC_RENAME_ATTEMPTS` constant) when the rename fails with a transient error code from the set `EACCES`, `EBUSY`, or `EPERM` — for example, a Windows virus scanner or a concurrent reader briefly holding the destination. Between attempts it waits a capped exponential backoff. If the error code is not in the retry set, or the attempts run out, it rethrows the original error, meaning the caller sees the failure while the lock is still held.

## Basic file operations

<!-- lw:anchors packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

Beyond writing, this module exposes thin read and metadata operations. All of them resolve and validate their target first, because even observing that a file exists outside the allowlist is considered a leak of information.

### Reading a file

`readText(repoRoot: string, relPath: string, opts: SafeIoOptions = {}): Promise<string>` resolves the path, then reads the file as UTF-8 text and returns its content.

### Checking existence

`exists(repoRoot: string, relPath: string, opts: SafeIoOptions = {}): Promise<boolean>` resolves the path, then calls `access` on it. It returns `true` only when the file exists and the validation succeeded. If the path is outside the allowlist, it rethrows `PathOutsideAllowlistError` (so a caller cannot use this function to probe outside the allowed area); any other error, such as ENOENT, is swallowed and the function returns `false`.

### Creating and removing directories

`mkdir(repoRoot: string, relPath: string, opts: SafeIoOptions = {}): Promise<void>` resolves the path and creates the directory recursively. `remove(repoRoot: string, relPath: string, opts: SafeIoOptions = {}): Promise<void>` resolves the path and removes the file or directory recursively and forcefully. Both first go through the full symlink-defended validation, so they too are bound by the allowlist.

## Tests

Covered by `packages/core/src/safe-io.test.ts` (same-name test file on disk).
