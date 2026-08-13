---
title: safe-io — the only module allowed to touch disk
owner: generated
anchors:
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/safe-io.ts#remove
---

# safe-io — the only module allowed to touch disk

This page is the entry point for the livewiki daemon's safe disk-I/O module.

## When to use this page

- **Read** the validation flow when you need to understand why a write was rejected (allowlist, symlink, traversal).
- **Extend** the file with a new I/O operation (e.g. `rename`, `copy`) by following the existing pattern of calling `resolveAndValidate` first.
- **Audit** the symlink defense when reviewing any change that touches path resolution or the allowlist.
- **Diagnose** a `PathOutsideAllowlistError` or `InvalidRelativePathError` thrown from the daemon by mapping the message to the relevant step in this file.

## How it fits

`safe-io` lives at `packages/core/src/safe-io.ts` and is the single funnel for any read, write, existence-check, or removal the livewiki daemon performs. Its job is to enforce an allowlist of directories inside the repository root (`livewiki/` and `.livewiki/`) and to defeat symlink-based escape attempts. Every other module that needs to touch disk is expected to import one of the exported wrappers (`writeText`, `readText`, `exists`, `mkdir`, `remove`) rather than calling `node:fs` directly. The opt-in flags for `AGENTS.md`/`CLAUDE.md` (pointer files) and `README.md` are deliberately scoped to this module so the surface that can write to human-authored content stays explicit and opt-in.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-safe-io.mmd
```

## Allowlist configuration

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist -->

The allowlist is the heart of the module's safety contract: it answers "is this absolute path inside a directory we are willing to write to?" Three small pieces cooperate to produce that answer.

`ALLOWED_DIRS` is the static baseline — the two literal directory names that are always permitted as subdirectories of the repository root. Its shape is a `readonly` tuple so the type system can derive the `AllowedDir` union from it.

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

`ALLOWED_DIRS` names the directories inside the repo root where writing is permitted.

`allowlistFor` assembles the effective allowlist for a given call by appending the opt-in filenames to the static baseline. The result is used both for containment checks and for the error message that surfaces which entries were considered.

```ts
function allowlistFor(opts: SafeIoOptions): readonly string[] {
  const extras: string[] = [];
  if (opts.allowPointer) extras.push("AGENTS.md", "CLAUDE.md");
  if (opts.allowReadme) extras.push("README.md");
  return [...ALLOWED_DIRS, ...extras];
}
```

`allowlistFor` takes a `SafeIoOptions` and returns the list of entries that must be satisfied for the call to be allowed.

`allowedAbs` turns one of the literal directory names into an absolute path inside the repository root, with a defensive guard that throws if the resolved directory would escape the root (it cannot, given the literals, but the code fails closed).

```ts
function allowedAbs(repoRoot: string, dir: AllowedDir): string {
  const absRoot = nodePath.resolve(repoRoot);
  const absDir = nodePath.resolve(absRoot, dir);
  const rel = nodePath.relative(absRoot, absDir);
  if (rel.startsWith("..") || nodePath.isAbsolute(rel)) {
    throw new Error(`Internal: allowed dir ${dir} escapes repoRoot`);
  }
  return absDir;
}
```

`allowedAbs` takes a repo root and a literal allowed directory name, and returns the resolved absolute path of that directory.

`isInsideAllowlist` is the predicate that everything else relies on. It compares the candidate path against each allowed directory using a `path.relative` check that requires both "not absolute" and "does not start with `..`" — this is what blocks `livewiki-evil` from being treated as inside `livewiki/`. The two opt-in filenames are checked by exact equality against the same root, because the spec rules for the pointer files and for `README.md` say "this file at the repo root," not "a directory."

```ts
export function isInsideAllowlist(
  repoRoot: string,
  absPath: string,
  opts: SafeIoOptions = {},
): boolean {
  const target = nodePath.resolve(absPath);
  if (opts.allowPointer) {
    for (const filename of ["AGENTS.md", "CLAUDE.md"]) {
      const allowed = nodePath.resolve(repoRoot, filename);
      if (target === allowed) return true;
    }
  }
  if (opts.allowReadme) {
    const allowed = nodePath.resolve(repoRoot, "README.md");
    if (target === allowed) return true;
  }
  return ALLOWED_DIRS.some((dir) => {
    const allowed = allowedAbs(repoRoot, dir);
    const rel = nodePath.relative(allowed, target);
    return !rel.startsWith("..") && !nodePath.isAbsolute(rel);
  });
}
```

`isInsideAllowlist` takes a repo root, a candidate absolute path, and options, and returns whether the candidate lands inside one of the allowed directories or matches an opt-in file name at the root.

## Error types

<!-- lw:anchors packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor -->

Two error classes encode the failure modes for callers that want to branch on them (e.g. `exists` swallows "not found" but re-throws allowlist violations).

`PathOutsideAllowlistError` is thrown when the resolved path is not inside the allowlist, and it carries the repo root, the attempted path, and the allowlist that was considered so the error message is self-explanatory.

```ts
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
```

`PathOutsideAllowlistError.constructor` takes the repo root, the attempted path, and the allowlist, and produces an `Error` whose message names all three.

`InvalidRelativePathError` is thrown when the caller hands in a path that is absolute or contains a `..` segment — the cheap rejections that happen before any disk access.

```ts
export class InvalidRelativePathError extends Error {
  constructor(relPath: string, reason: string) {
    super(`Invalid relative path ${JSON.stringify(relPath)}: ${reason}`);
    this.name = "InvalidRelativePathError";
  }
}
```

`InvalidRelativePathError.constructor` takes a path string and a human-readable reason, and produces an `Error` whose message spells out both.

## Declared-path validation

<!-- lw:anchors packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting -->

The first wall of validation is purely lexical: it does not touch disk and it catches the obvious mistakes before any symlink-aware work happens.

`validateDeclared` rejects absolute paths with `InvalidRelativePathError`, normalizes the input, rejects any `..` segment (so traversal above the repo root is impossible at this stage), resolves the result against the root, and then defers to `isInsideAllowlist` for the containment check. On success it returns the resolved absolute path; on any failure it throws.

```ts
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
```

`validateDeclared` takes a repo root, a relative path, and options, and returns the absolute path of the target if it is relative, normalized, and inside the allowlist; otherwise it throws.

`findDeepestExisting` walks from a starting path back toward `stopAt` (the repo root) until it finds the deepest ancestor that already exists on disk. It returns the pair `[ancestor, suffix]` where `suffix` is the not-yet-existing remainder that must be reattached after `realpath` resolves the ancestor. The walk uses `existsSync` so it can run inside a tight loop; only the chosen ancestor is later passed to the async `realpath`.

```ts
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
      return [stopAt, nodePath.relative(stopAt, from)] as const;
    }
    suffix = suffix
      ? nodePath.join(nodePath.basename(cursor), suffix)
      : nodePath.basename(cursor);
    cursor = parent;
  }
  return [stopAt, suffix] as const;
}
```

`findDeepestExisting` takes a starting path and a stop path, and returns a tuple of the deepest existing ancestor and the suffix that must be appended after that ancestor is resolved.

## Symlink-resolving validation

<!-- lw:anchors packages/core/src/safe-io.ts#resolveAndValidate -->

`resolveAndValidate` is the entry point that every public I/O helper calls. It layers a realpath pass on top of the lexical check so that a symlink anywhere inside an allowed directory cannot redirect a write out of the allowlist.

The function canonicalizes the repo root first: on macOS the temp directory lives under `/var/...` which realpath-resolves to `/private/var/...`, so a lexical root would never prefix-match a realpath'd target. If the root does not exist yet, the lexical resolve is kept (the caller may create it). It then runs `validateDeclared`, finds the deepest existing ancestor with `findDeepestExisting`, calls `realpath` on that ancestor, rejoins the suffix, and re-checks `isInsideAllowlist` against the reconstructed absolute path. If the ancestor's realpath fails (race or missing), it throws `PathOutsideAllowlistError` rather than falling back to a less-checked path.

```ts
export async function resolveAndValidate(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  const lexicalRoot = nodePath.resolve(repoRoot);
  let absRoot: string;
  try {
    absRoot = await nodeFs.realpath(lexicalRoot);
  } catch {
    absRoot = lexicalRoot;
  }
  const absDeclared = validateDeclared(absRoot, relPath, opts);

  const [ancestor, suffix] = findDeepestExisting(absDeclared, absRoot);

  let realAncestor: string;
  try {
    realAncestor = await nodeFs.realpath(ancestor);
  } catch {
    throw new PathOutsideAllowlistError(
      absRoot,
      ancestor,
      allowlistFor(opts),
    );
  }

  const finalAbs = suffix ? nodePath.join(realAncestor, suffix) : realAncestor;

  if (!isInsideAllowlist(absRoot, finalAbs, opts)) {
    throw new PathOutsideAllowlistError(absRoot, finalAbs, allowlistFor(opts));
  }
  return finalAbs;
}
```

`resolveAndValidate` takes a repo root, a relative path, and options, and returns an absolute path that is both inside the allowlist and free of symlink redirection, or throws if either check fails.

## I/O operations

<!-- lw:anchors packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

Each public I/O helper is a thin wrapper that resolves and validates the path before delegating to `node:fs/promises`. They exist so the rest of the codebase can never reach the filesystem without paying for validation.

`writeText` resolves the target, creates the parent directory recursively, and writes the file as UTF-8 text.

```ts
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
```

`writeText` takes a repo root, a relative path, text content, and options, and returns a `Promise` that resolves once the file has been written.

`readText` resolves the target and reads it as UTF-8 text.

```ts
export async function readText(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<string> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  return nodeFs.readFile(abs, "utf8");
}
```

`readText` takes a repo root, a relative path, and options, and returns the file contents as a string.

`exists` still validates the allowlist (knowing whether a file outside `livewiki/` exists is itself a leak) and then probes with `fs.access`. Allowlist violations are re-thrown; any other error is treated as "not found" and returns `false`.

```ts
export async function exists(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<boolean> {
  try {
    const abs = await resolveAndValidate(repoRoot, relPath, opts);
    await nodeFs.access(abs);
    return true;
  } catch (err) {
    if (err instanceof PathOutsideAllowlistError) throw err;
    return false;
  }
}
```

`exists` takes a repo root, a relative path, and options, and returns `true` if the path resolves through the allowlist and is accessible; allowlist rejections propagate as errors.

`mkdir` resolves the target and creates the directory recursively.

```ts
export async function mkdir(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.mkdir(abs, { recursive: true });
}
```

`mkdir` takes a repo root, a relative path, and options, and returns a `Promise` that resolves once the directory exists.

`remove` resolves the target and deletes it recursively, with `force: true` so missing files do not error.

```ts
export async function remove(
  repoRoot: string,
  relPath: string,
  opts: SafeIoOptions = {},
): Promise<void> {
  const abs = await resolveAndValidate(repoRoot, relPath, opts);
  await nodeFs.rm(abs, { recursive: true, force: true });
}
```

`remove` takes a repo root, a relative path, and options, and returns a `Promise` that resolves once the path has been removed.

## Tests

Covered by `packages/core/src/safe-io.test.ts` (same-name test file on disk).
