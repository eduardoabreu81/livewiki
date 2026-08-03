/**
 * import-resolution — one resolver, one edge type (R10.1, work item J).
 *
 * Contract: docs/tasks/2026-07-19-r10-1-acceptance-fixes/CONTRACT.md §J.
 *
 * A single internal operation resolves an import specifier to a repo file,
 * producing `ResolvedImportEdge { fromFile, toFile, source }`. Both the
 * module graph (`resolveModuleEdges` in modules.ts) and the stage-5 flow
 * detector's per-occurrence external accounting consume these SAME file
 * edges — there is no second resolver, so the graph and the flow signals
 * can never disagree about where an import resolved.
 *
 * Resolution contract (strict, no guessing):
 *   - Relative specifiers (`./`, `../`) resolve exactly as the historical
 *     `resolveRelativeImport` (modules.ts) does — NodeNext extension
 *     stripping and barrel index handling included (reused, not duplicated).
 *   - Workspace specifiers resolve ONLY against declared packages
 *     (`pnpm-workspace.yaml` `packages:` globs, or `workspaces` in the root
 *     package.json). A folder that merely looks like a package but is not
 *     declared is never inferred.
 *   - Supported package.json `exports` forms: an explicit subpath key
 *     (`"."`, `"./sub"`) whose value is a string or an object with an
 *     `import` then `default` string condition; `main` (then `index`) as
 *     fallback for the bare-name specifier when no exports map exists.
 *     Wildcards, arrays, nested conditions, and missing keys are NOT
 *     resolved (the occurrence stays external).
 *   - Compiled targets are mapped back to source via the package's OWN
 *     effective `rootDir`/`outDir` (strict, per package, no guessing —
 *     contract revision 4): only the direct `compilerOptions` of that
 *     package's `tsconfig.json` are read (no `extends` chain, no base-file
 *     fallback, consistent with the deferred `tsconfig.paths` stance). A
 *     package whose tsconfig is unreadable or lacks either value gets NO
 *     compiled-target mapping: the literal target is tried and nothing
 *     else — inferred `src`/`dist` defaults are never applied and no
 *     other package's layout leaks in. NodeNext extension normalization
 *     (`.js` → `.ts`/`.tsx`, `.jsx` → `.tsx`, `.mjs` → `.mts`, `.cjs` →
 *     `.cts`); the literal target is also tried. EXACTLY ONE candidate
 *     present in `knownFiles` is accepted — zero or ambiguous stays
 *     external.
 *   - `node:*` builtins, absolute paths, and undeclared third-party
 *     packages never produce edges.
 *   - Go (roadmap item 19, pilot): a `go-import` specifier resolves ONLY via
 *     the repo's root `go.mod` module path (`loadGoModulePath`). An import
 *     equal to `<module>/<sub>` maps to the repo-relative directory `<sub>`
 *     and produces one edge per direct `.go` file in it (Go packages are
 *     directories — v1 resolves non-recursively); `<module>` alone maps to
 *     the root directory. Any import not prefixed by the module path — and
 *     every import when no go.mod exists — stays external.
 *   - `tsconfig.paths` is explicitly DEFERRED (needs its full contract).
 *
 * Output is deduped and sorted deterministically (fromFile, toFile,
 * source); self-edges are dropped.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type { ExtractedImport } from "./imports.js";
import { normalizeRepoPath, resolveRelativeImport } from "./modules.js";

/** A resolved file-level import edge. Paths are repo-relative posix. */
export interface ResolvedImportEdge {
  fromFile: string;
  toFile: string;
  /** The literal import specifier as written in the source. */
  source: string;
}

/**
 * A workspace package declared by the workspace map. `dir` is the
 * repo-relative posix directory. `main`/`exports` mirror the package.json
 * fields and are populated by `loadWorkspacePackages` (which already reads
 * each manifest); tests may construct literal packages without them.
 */
export interface WorkspacePackage {
  name: string;
  /** Repo-relative posix dir of the package root. */
  dir: string;
  /** package.json `main`, when declared as a string. */
  main?: string;
  /** package.json `exports`, verbatim (supported forms only — see above). */
  exports?: unknown;
}

/**
 * ONE package's effective compiler layout: BOTH `rootDir` and `outDir`
 * from the direct `compilerOptions` of that package's own `tsconfig.json`.
 * A package without both values has no entry in `EffectiveTsconfigs` and
 * gets no compiled-target mapping (strict, no guessing).
 */
export interface PackageTsconfig {
  rootDir: string;
  outDir: string;
}

/**
 * Per-package effective layouts, keyed by the repo-relative package dir
 * (`WorkspacePackage.dir`). Replaces the revision-3 single shared layout:
 * the resolver consults ONLY the matched package's own entry.
 */
export type EffectiveTsconfigs = ReadonlyMap<string, PackageTsconfig>;

/**
 * Loads the declared workspace packages of a repo. Sources (first match
 * wins): `pnpm-workspace.yaml` `packages:` globs (line-based YAML subset —
 * quoted or bare `- <glob>` entries under a top-level `packages:` key),
 * then the root package.json `workspaces` (array or `{ packages: [] }`).
 *
 * Globs are simple: a literal directory, or a single trailing `/*`
 * one-level expansion (`packages/*`). Anything more complex (`**`,
 * mid-path `*`, `?`, character classes) is skipped, not an error.
 * Negation entries (`!...`) are skipped as well.
 *
 * A missing/unparseable workspace file yields an empty list — no edges,
 * no crash. Output is sorted by name and deduped (first dir wins).
 */
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]> {
  const absRoot = nodePath.resolve(repoRoot);
  const globs = await readWorkspaceGlobs(absRoot);
  if (globs.length === 0) return [];

  const dirs = new Set<string>();
  for (const glob of globs) {
    for (const dir of await expandWorkspaceGlob(absRoot, glob)) {
      dirs.add(dir);
    }
  }

  const packages: WorkspacePackage[] = [];
  for (const dir of [...dirs].sort((a, b) => a.localeCompare(b))) {
    const manifest = await readPackageManifest(absRoot, dir);
    if (manifest === null) continue;
    const name = manifest["name"];
    if (typeof name !== "string" || name.length === 0) continue;
    const main = manifest["main"];
    packages.push({
      name,
      dir,
      ...(typeof main === "string" && main.length > 0 ? { main } : {}),
      ...("exports" in manifest ? { exports: manifest["exports"] } : {}),
    });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name) || a.dir.localeCompare(b.dir));
  const seen = new Set<string>();
  return packages.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

/**
 * Reads ONE package's effective layout from `<pkgDir>/tsconfig.json` —
 * direct `compilerOptions` only. The `extends` chain is NOT resolved
 * (consistent with the deferred full-tsconfig contract) and no
 * `tsconfig.base.json` fallback is tried. Returns undefined when the file
 * is unreadable, unparseable, or lacks either of `rootDir`/`outDir` — a
 * partial layout disables the package's compiled-target mapping entirely
 * (strict, no guessing).
 */
export async function loadPackageTsconfig(
  repoRoot: string,
  pkgDir: string,
): Promise<PackageTsconfig | undefined> {
  const text = await readTextIfExists(
    nodePath.join(nodePath.resolve(repoRoot), pkgDir, "tsconfig.json"),
  );
  if (text === null) return undefined;
  let compilerOptions: unknown;
  try {
    compilerOptions = (JSON.parse(text) as { compilerOptions?: unknown }).compilerOptions;
  } catch {
    return undefined; // JSONC comments etc. are outside this subset
  }
  if (!isPlainObject(compilerOptions)) return undefined;
  const rootDir = normalizeDirOption(compilerOptions["rootDir"]);
  const outDir = normalizeDirOption(compilerOptions["outDir"]);
  if (rootDir === undefined || outDir === undefined) return undefined;
  return { rootDir, outDir };
}

/**
 * Loads the effective layout of EVERY declared package independently
 * (`loadPackageTsconfig` per package). Returns a per-package map keyed by
 * package dir, or undefined when NO package yields a usable layout. Kept
 * under this name for the existing stage-3/init call sites; the
 * revision-3 shared "first package wins" behavior is gone.
 */
export async function loadEffectiveTsconfig(
  repoRoot: string,
  workspacePackages: WorkspacePackage[],
): Promise<EffectiveTsconfigs | undefined> {
  const absRoot = nodePath.resolve(repoRoot);
  const layouts = new Map<string, PackageTsconfig>();
  for (const pkg of workspacePackages) {
    const layout = await loadPackageTsconfig(absRoot, pkg.dir);
    if (layout !== undefined) layouts.set(pkg.dir, layout);
  }
  return layouts.size === 0 ? undefined : layouts;
}

/**
 * Resolves every import occurrence to a repo file where possible. Pure —
 * no disk I/O; workspace manifests and the per-package effective
 * tsconfigs are inputs. See the module docblock for the resolution
 * contract.
 */
export function resolveImportEdges(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
  workspacePackages: WorkspacePackage[];
  /**
   * Per-package effective layouts (`loadEffectiveTsconfig`), keyed by
   * package dir. A package with no entry gets NO compiled-target mapping
   * — literal targets only, never inferred defaults. (Field retained
   * under its original name for the existing call sites; the shared
   * single-layout form was removed in contract revision 4.)
   */
  tsconfig?: EffectiveTsconfigs | undefined;
  /**
   * The repo's Go module path from the root `go.mod` (`loadGoModulePath`),
   * or null/undefined when there is no go.mod. Go imports not prefixed by
   * this path stay external; without it, EVERY go-import stays external.
   */
  goModulePath?: string | null | undefined;
}): ResolvedImportEdge[] {
  // Longest name first: `@acme/core-utils` must win over `@acme/core` when
  // both are declared (node-style longest-prefix match), deterministically.
  const packages = [...opts.workspacePackages].sort(
    (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name),
  );

  const edges = new Map<string, ResolvedImportEdge>();
  for (const [rawFrom, imports] of opts.importsByFile) {
    const fromFile = normalizeRepoPath(rawFrom);
    for (const imp of imports) {
      const spec = imp.source;
      const targets =
        imp.kind === "py-from" || imp.kind === "py-import"
          ? resolvePythonSpecifier(fromFile, imp, opts.knownFiles)
          : imp.kind === "go-import"
            ? resolveGoSpecifier(spec, opts.knownFiles, opts.goModulePath ?? null)
            : (() => {
                const single = resolveSpecifier(fromFile, spec, packages, opts.tsconfig, opts.knownFiles);
                return single === null ? [] : [single];
              })();
      for (const toFile of targets) {
        if (toFile === fromFile) continue;
        const key = `${fromFile}\0${toFile}\0${spec}`;
        if (!edges.has(key)) {
          edges.set(key, { fromFile, toFile, source: spec });
        }
      }
    }
  }
  return [...edges.values()].sort((a, b) =>
    a.fromFile === b.fromFile
      ? a.toFile === b.toFile
        ? a.source.localeCompare(b.source)
        : a.toFile.localeCompare(b.toFile)
      : a.fromFile.localeCompare(b.fromFile),
  );
}

/**
 * Resolves a Python import occurrence to zero or more repo files. Python
 * import resolution was previously unimplemented at this layer — `imports.ts`
 * extracted `py-import`/`py-from` specifiers correctly, but every occurrence
 * fell through `resolveSpecifier`'s TS-shaped branches (no `./`/`../` prefix,
 * no declared workspace package) and resolved to `null`, so a Python repo's
 * internal module graph was always empty regardless of its actual imports.
 *
 * Two specifier shapes, split by `ExtractedImport.kind`:
 *   - `py-import` (`import foo.bar.baz`): the whole dotted path names ONE
 *     module. Dots become path separators from the REPO ROOT — Python
 *     absolute imports are root-relative, never relative to the importing
 *     file — tried as `<path>.py` then `<path>/__init__.py`.
 *   - `py-from` (`from foo.bar import baz, qux as q`): `source` is the
 *     package/module dotted path being imported FROM; `names` are the
 *     imported symbols. Each name is tried FIRST as a submodule file of
 *     that path (`foo/bar/<name>.py`) — the common case for a package
 *     re-exporting its own submodules (`from app.services import bgm`).
 *     If NO name resolves as its own submodule file (they are attributes/
 *     classes/functions defined inside the package's own `__init__.py`,
 *     not separate files), the "from" target itself is tried as a single
 *     fallback edge.
 *
 * A leading-dot `source` (`.foo`, `..pkg.sub`, or bare `.`/`..`) is a
 * Python RELATIVE import: one dot means the current package (`fromFile`'s
 * own directory, mirroring `from . import x`); each additional dot climbs
 * one more directory level (`from .. import x` = parent package). The
 * remaining dotted segments (if any) resolve the same way as an absolute
 * path from that ancestor directory.
 *
 * Every segment is resolved as either a file (`seg.py`) or a package
 * (`seg/__init__.py`) — never guessed past what `knownFiles` contains.
 */
function resolvePythonSpecifier(
  fromFile: string,
  imp: ExtractedImport,
  knownFiles: ReadonlySet<string>,
): string[] {
  const baseDir = pythonSourceBaseDir(fromFile, imp.source);
  if (baseDir === null) return [];

  if (imp.kind === "py-import") {
    const target = resolvePythonModulePath(baseDir, knownFiles);
    return target === null ? [] : [target];
  }

  const targets: string[] = [];
  for (const rawName of imp.names ?? []) {
    const name = (rawName.split(/\s+as\s+/)[0] ?? "").trim();
    if (name.length === 0 || name === "*") continue;
    const sub = resolvePythonModulePath(`${baseDir}/${name}`, knownFiles);
    if (sub !== null) targets.push(sub);
  }
  if (targets.length > 0) return targets;
  const whole = resolvePythonModulePath(baseDir, knownFiles);
  return whole === null ? [] : [whole];
}

/**
 * Converts a Python "from"/"import" dotted specifier into a repo-relative
 * directory path (no extension), resolving a leading-dot relative
 * specifier against `fromFile`'s own directory. Returns null when a
 * relative specifier climbs above the repo root.
 */
function pythonSourceBaseDir(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return spec.split(".").filter(Boolean).join("/");
  }
  let i = 0;
  while (i < spec.length && spec[i] === ".") i++;
  const dots = i;
  const restParts = spec.slice(i).split(".").filter(Boolean);
  const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const parts = fromDir.split("/").filter(Boolean);
  for (let up = 1; up < dots; up++) {
    if (parts.length === 0) return null;
    parts.pop();
  }
  return [...parts, ...restParts].join("/");
}

/** `<dir>` → `<dir>.py` or `<dir>/__init__.py`, whichever is a known file. */
function resolvePythonModulePath(dir: string, knownFiles: ReadonlySet<string>): string | null {
  const asFile = `${dir}.py`;
  if (knownFiles.has(asFile)) return asFile;
  const asPackage = `${dir}/__init__.py`;
  if (knownFiles.has(asPackage)) return asPackage;
  return null;
}

/**
 * Reads the module path declared by the repo's ROOT `go.mod` (`module
 * <path>` line). Returns null when go.mod is missing, unreadable, or has no
 * module directive — in that case every Go import resolves as external
 * (strict, no guessing). Nested go.mod files (multi-module repos) are out
 * of scope for v1.
 */
export async function loadGoModulePath(repoRoot: string): Promise<string | null> {
  const text = await readTextIfExists(nodePath.join(nodePath.resolve(repoRoot), "go.mod"));
  if (text === null) return null;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^module\s+(\S+)\s*(?:\/\/.*)?$/);
    if (match) return match[1]!;
  }
  return null;
}

/**
 * Resolves ONE Go import occurrence to the `.go` files of the imported
 * package directory (Go packages are directories). Strict contract:
 *
 *   - `spec === goModulePath`          → every direct `.go` file of the
 *                                        repo root directory.
 *   - `spec === goModulePath + "/sub"` → every direct `.go` file of the
 *                                        repo-relative directory `sub`.
 *   - anything else (third-party module, stdlib like `fmt`, or a subpath
 *     with no known .go files) → NO edge: the occurrence stays external.
 *   - `goModulePath === null` (no go.mod) → every import stays external.
 *
 * `_test.go` files are included (they belong to the same package);
 * nested subdirectories are NOT (an import names exactly one directory).
 */
function resolveGoSpecifier(
  spec: string,
  knownFiles: ReadonlySet<string>,
  goModulePath: string | null,
): string[] {
  if (goModulePath === null || goModulePath.length === 0) return [];
  let dir: string;
  if (spec === goModulePath) {
    dir = "";
  } else if (spec.startsWith(goModulePath + "/")) {
    dir = spec.slice(goModulePath.length + 1);
  } else {
    return [];
  }
  const prefix = dir === "" ? "" : `${dir}/`;
  const targets: string[] = [];
  for (const file of knownFiles) {
    if (!file.endsWith(".go")) continue;
    if (!file.startsWith(prefix)) continue;
    if (file.slice(prefix.length).includes("/")) continue; // nested package
    targets.push(file);
  }
  return targets.sort((a, b) => a.localeCompare(b));
}

/** Resolves ONE specifier occurrence; null means "stays external". */
function resolveSpecifier(
  fromFile: string,
  spec: string,
  packages: WorkspacePackage[],
  tsconfigs: EffectiveTsconfigs | undefined,
  knownFiles: ReadonlySet<string>,
): string | null {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return resolveRelativeImport(fromFile, spec, knownFiles);
  }
  if (spec.length === 0 || spec.startsWith("node:") || spec.startsWith("/")) {
    return null; // builtins and absolute paths are never internal edges
  }
  const pkg = packages.find((p) => spec === p.name || spec.startsWith(p.name + "/"));
  if (pkg === undefined) return null; // undeclared: never inferred by folder name
  const subpath = spec === pkg.name ? "." : `./${spec.slice(pkg.name.length + 1)}`;
  const target = resolvePackageTarget(pkg, subpath);
  if (target === null) return null;
  return mapCompiledTargetToSource(pkg.dir, target, tsconfigs?.get(pkg.dir), knownFiles);
}

/**
 * Maps a specifier to its package-relative compiled target via the
 * supported `exports` forms (explicit subpath key; string value, or
 * `import` then `default` string condition). Without an exports map, the
 * bare name falls back to `main`, then `index`. Anything else — wildcard
 * or directory keys, arrays, nested conditions, a missing key — is
 * unsupported and returns null (external).
 */
function resolvePackageTarget(pkg: WorkspacePackage, subpath: string): string | null {
  if (isPlainObject(pkg.exports)) {
    if (Object.prototype.hasOwnProperty.call(pkg.exports, subpath)) {
      return resolveExportsValue(pkg.exports[subpath]);
    }
    return null; // missing key: the exports map encapsulates — no main fallback
  }
  if (subpath !== ".") return null; // subpaths require an exports map
  if (typeof pkg.main === "string" && pkg.main.length > 0) {
    return stripLeadingDotSlash(pkg.main);
  }
  return "index.js"; // classic main/index fallback
}

function resolveExportsValue(value: unknown): string | null {
  if (typeof value === "string") return stripLeadingDotSlash(value);
  if (isPlainObject(value)) {
    const importCondition = value["import"];
    if (typeof importCondition === "string") return stripLeadingDotSlash(importCondition);
    const defaultCondition = value["default"];
    if (typeof defaultCondition === "string") return stripLeadingDotSlash(defaultCondition);
  }
  return null;
}

/**
 * Maps a package-relative compiled target back to a source file. The
 * literal target (`pkgDir/target`) is always a candidate; when the
 * package has an effective layout, a target under its `outDir`
 * additionally rewrites `outDir/rel.js` → `rootDir/rel.ts` with
 * NodeNext-family extension normalization. A package WITHOUT a layout
 * gets the literal candidate only (strict, no guessing). EXACTLY ONE
 * candidate present in `knownFiles` is accepted — zero or ambiguous
 * returns null (external).
 */
function mapCompiledTargetToSource(
  pkgDir: string,
  target: string,
  layout: PackageTsconfig | undefined,
  knownFiles: ReadonlySet<string>,
): string | null {
  const prefix = pkgDir === "" ? "" : `${pkgDir}/`;
  const candidates = new Set<string>([`${prefix}${target}`]);
  if (layout !== undefined && target.startsWith(`${layout.outDir}/`)) {
    const rel = target.slice(layout.outDir.length + 1);
    for (const mapped of sourceCandidatesForCompiled(`${prefix}${layout.rootDir}/${rel}`)) {
      candidates.add(mapped);
    }
  }
  const present = [...candidates].filter((c) => knownFiles.has(c));
  return present.length === 1 ? present[0]! : null;
}

/**
 * `pkg/src/sub.js` → `pkg/src/sub.ts` + `pkg/src/sub.tsx`; same-family
 * mapping for `.jsx` → `.tsx`, `.mjs` → `.mts`, `.cjs` → `.cts`. Any
 * other extension yields no mapped candidate (literal target only).
 */
function sourceCandidatesForCompiled(sourcePath: string): string[] {
  const slash = sourcePath.lastIndexOf("/");
  const baseName = slash === -1 ? sourcePath : sourcePath.slice(slash + 1);
  const dot = baseName.lastIndexOf(".");
  if (dot <= 0) return [];
  const stem = sourcePath.slice(0, sourcePath.length - (baseName.length - dot));
  switch (baseName.slice(dot + 1)) {
    case "js":
      return [`${stem}.ts`, `${stem}.tsx`];
    case "jsx":
      return [`${stem}.tsx`];
    case "mjs":
      return [`${stem}.mts`];
    case "cjs":
      return [`${stem}.cts`];
    default:
      return [];
  }
}

/** Reads `pnpm-workspace.yaml` globs, else root package.json `workspaces`. */
async function readWorkspaceGlobs(absRoot: string): Promise<string[]> {
  const pnpmText = await readTextIfExists(nodePath.join(absRoot, "pnpm-workspace.yaml"));
  if (pnpmText !== null) return parsePnpmWorkspaceGlobs(pnpmText);

  const rootText = await readTextIfExists(nodePath.join(absRoot, "package.json"));
  if (rootText === null) return [];
  try {
    const workspaces = (JSON.parse(rootText) as { workspaces?: unknown }).workspaces;
    if (Array.isArray(workspaces)) return stringEntries(workspaces);
    if (isPlainObject(workspaces) && Array.isArray(workspaces["packages"])) {
      return stringEntries(workspaces["packages"]);
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Line-based YAML subset for `pnpm-workspace.yaml`: bare or quoted
 * `- <glob>` entries indented under a top-level `packages:` key; the next
 * top-level key ends the block. Flow-style (`packages: ["a"]`), comments,
 * and negations are outside the subset (skipped, not errors).
 */
function parsePnpmWorkspaceGlobs(text: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (!inPackages) {
      if (/^packages\s*:\s*(?:#.*)?$/.test(line)) inPackages = true;
      continue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\S/.test(line)) break; // next top-level key
    const match = line.match(/^\s*-\s*(?:"([^"]+)"|'([^']+)'|([^#"'\s]+))\s*(?:#.*)?$/);
    const glob = match?.[1] ?? match?.[2] ?? match?.[3];
    if (glob !== undefined && !glob.startsWith("!")) globs.push(glob);
  }
  return globs;
}

/**
 * Expands one workspace glob to repo-relative posix directories containing
 * a package.json. Supported: a literal directory, or a single trailing
 * `/*` one-level expansion. Anything more complex is skipped, not an
 * error.
 */
async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]> {
  const normalized = glob.replace(/\\/g, "/").replace(/\/+$/, "");
  const starCount = (normalized.match(/\*/g) ?? []).length;
  if (starCount === 0) {
    return (await hasPackageManifest(absRoot, normalized)) ? [normalized] : [];
  }
  if (starCount !== 1 || !normalized.endsWith("/*")) {
    return []; // `**`, mid-path `*`, `?`, `[...]` — outside this subset
  }
  const parent = normalized.slice(0, -"/*".length);
  let entries;
  try {
    entries = await nodeFs.readdir(nodePath.join(absRoot, parent), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = parent === "" ? entry.name : `${parent}/${entry.name}`;
    if (await hasPackageManifest(absRoot, dir)) out.push(dir);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

async function hasPackageManifest(absRoot: string, dir: string): Promise<boolean> {
  return (await readPackageManifest(absRoot, dir)) !== null;
}

async function readPackageManifest(
  absRoot: string,
  dir: string,
): Promise<Record<string, unknown> | null> {
  const text = await readTextIfExists(nodePath.join(absRoot, dir, "package.json"));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readTextIfExists(absPath: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(absPath, "utf8");
  } catch {
    return null;
  }
}

function stringEntries(values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripLeadingDotSlash(p: string): string {
  return p.replace(/^\.\//, "");
}

/** `./src` → `src`; trims trailing slashes. Non-strings are dropped. */
function normalizeDirOption(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const normalized = stripLeadingDotSlash(value).replace(/\/+$/, "");
  return normalized === "" ? undefined : normalized;
}
