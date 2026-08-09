/**
 * modules — module graph primitives shared by the batch pipeline.
 *
 * Page-unit construction (batch stage 2) is deterministic and lives in
 * page-units.ts (#29). This module owns:
 *   - the `Module` / `ModuleGraphEdge` types;
 *   - the exact-partition assertion (`assertExactPathPartition`);
 *   - module edge resolution (`resolveModuleEdges`, `resolveRelativeImport`);
 *   - path-role classification (`classifyPathRole`, `classifyModuleRole`);
 *   - stage-4 prioritization (`prioritizeModules`);
 *   - globally-unique deterministic module ids (`makeUniqueDeterministicIds`)
 *     plus the defensive `assertUniqueModuleIds` gate before stage 4.
 *
 * Phase-5 plan (W): the module's slug MUST be globally unique before
 * reaching stage 4 (write of `livewiki/<id>.md`). If two distinct
 * trees share the same leaf ("src" in packages/core/src AND packages/cli/src),
 * the final slug is expanded from right to left (`core-src`, `cli-src`)
 * until all modules are unique. A defensive assertion confirms
 * uniqueness before the next stage.
 */

import ignore from "ignore";
import type { ExtractedImport } from "./imports.js";
import { resolveImportEdges, type ResolvedImportEdge } from "./import-resolution.js";
import { sha256 } from "./hashes.js";

export interface Module {
  /** Slug único do módulo (ex: "auth", "session"). */
  id: string;
  /** Paths relativos dos arquivos que compõem o módulo. */
  paths: string[];
  /** Quantos símbolos ativos tem no módulo (heurística de priorização). */
  symbolCount: number;
  /** Optional presentation-only title suggested by stage 2. Never identity. */
  displayTitle?: string;
}

export interface ModuleGraphEdge {
  from: string; // module id
  to: string;   // module id
}

/** Canonical repo-relative path: forward slashes, no leading `./`. */
export function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export class ExactPartitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactPartitionError";
  }
}

/**
 * Assert every expected path appears in exactly one module, modules are
 * non-empty, and no unknown paths appear. Paths are compared after
 * normalizeRepoPath. Throws ExactPartitionError on violation.
 */
export function assertExactPathPartition(
  modules: Module[],
  expectedPaths: Iterable<string>,
): void {
  const expected = new Set(
    [...expectedPaths].map(normalizeRepoPath).filter((p) => p.length > 0),
  );
  const seen = new Map<string, string>(); // path → module id
  for (const m of modules) {
    if (!m.paths || m.paths.length === 0) {
      throw new ExactPartitionError(
        `module "${m.id}" is empty (exact partition requires non-empty modules)`,
      );
    }
    for (const raw of m.paths) {
      const p = normalizeRepoPath(raw);
      if (!expected.has(p)) {
        throw new ExactPartitionError(
          `module "${m.id}" contains unknown path "${p}" (not in expected inventory)`,
        );
      }
      const prev = seen.get(p);
      if (prev !== undefined) {
        throw new ExactPartitionError(
          `path "${p}" appears in modules "${prev}" and "${m.id}" (exact partition violated)`,
        );
      }
      seen.set(p, m.id);
    }
  }
  const missing: string[] = [];
  for (const p of expected) {
    if (!seen.has(p)) missing.push(p);
  }
  if (missing.length > 0) {
    missing.sort((a, b) => a.localeCompare(b));
    const sample = missing.slice(0, 5).join(", ");
    throw new ExactPartitionError(
      `exact partition missing ${missing.length} path(s) (e.g. ${sample})`,
    );
  }
}

/**
 * Resolve imports pra edges no grafo de módulos. Apenas edges entre módulos
 * DIFERENTES (self-loops são descartados).
 *
 * R10.1 (J): implemented ON TOP of the single file-level resolver
 * (`resolveImportEdges` in import-resolution.ts) — there is no second
 * resolver. Callers that already resolved file edges with the workspace
 * map (batch stage 3, init buildPlan) pass them via `resolvedEdges`;
 * otherwise the edges are resolved here with an EMPTY workspace map, which
 * reproduces the historical behavior exactly: only relative imports
 * (`./foo`, `../bar`) pointing at files in `knownFiles` become edges, and
 * absolute/node_modules specifiers stay external.
 */
export function resolveModuleEdges(
  modules: Module[],
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
  resolvedEdges?: ResolvedImportEdge[],
): ModuleGraphEdge[] {
  // Mapa path → moduleId
  const fileToModule = new Map<string, string>();
  for (const m of modules) {
    for (const p of m.paths) {
      fileToModule.set(p, m.id);
    }
  }

  const fileEdges =
    resolvedEdges ??
    resolveImportEdges({ importsByFile, knownFiles, workspacePackages: [] });

  const edges = new Map<string, ModuleGraphEdge>(); // dedup por "from→to"
  for (const fileEdge of fileEdges) {
    const fromModule = fileToModule.get(fileEdge.fromFile);
    if (!fromModule) continue;
    const toModule = fileToModule.get(fileEdge.toFile);
    if (!toModule || toModule === fromModule) continue;
    const key = `${fromModule}→${toModule}`;
    if (!edges.has(key)) {
      edges.set(key, { from: fromModule, to: toModule });
    }
  }
  return [...edges.values()].sort((a, b) =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
  );
}

/**
 * Resolve "./foo" ou "../bar" relativo a `fromFile` pra um path absoluto
 * (forward-slash). Retorna null se não achar em knownFiles.
 *
 * FIX K (rev2): NodeNext (e bundlers em geral) obrigam imports com extensão
 * explícita: `import x from "../utils/crypto.js"` resolve pra `crypto.ts`
 * (ou `.tsx`, `.js`, etc). O resolver antigo tentava `../utils/crypto.js`
 * + sufixos colados (`../utils/crypto.js.ts`), o que nunca batia.
 *
 * Agora strip da extensão `.js`/`.jsx` ANTES de gerar os candidatos, e também
 * trata `index.js` → `index.ts/tsx/js/jsx` (mapeamento de barrels).
 *
 * Exported for the single import resolver (import-resolution.ts, R10.1 J) —
 * relative-specifier resolution must not be duplicated.
 */
export function resolveRelativeImport(
  fromFile: string,
  importPath: string,
  knownFiles: ReadonlySet<string>,
): string | null {
  const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of importPath.split("/")) {
    if (seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  // Strip de extensões NodeNext-style pra achar o source real.
  // "../utils/crypto.js" → "../utils/crypto" (depois testamos .ts/.tsx/...)
  // "../utils/index.js"  → "../utils/index" (e testamos como barrel)
  const joined = parts.join("/");
  const base = stripNodeNextExtension(joined);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.py`,
    // Barrels: o base já é "index" se import era ".../index.js" ou ".../index"
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`,
    `${base}/__init__.py`,
  ];
  for (const c of candidates) {
    if (knownFiles.has(c)) return c;
  }
  return null;
}

/**
 * Remove extensão NodeNext-style do final de um path: ".js" ou ".jsx" ou
 * ".mjs"/".cjs". Se o basename for `index.{js,jsx,...}`, também strip
 * (tratado como barrel — o caller vai testar `${base}/index.*`).
 *
 * "src/utils/crypto.js"  → "src/utils/crypto"
 * "src/utils/index.js"   → "src/utils/index"
 * "src/foo.ts"           → "src/foo"  (idempotente, mas só roda se terminar em .js/.jsx/etc)
 * "src/bar"              → "src/bar"  (sem extensão, no-op)
 */
function stripNodeNextExtension(p: string): string {
  const idx = p.lastIndexOf("/");
  const base = idx === -1 ? p : p.slice(idx + 1);
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0) return p;
  const ext = base.slice(dotIdx + 1);
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return p.slice(0, p.length - (base.length - dotIdx));
  }
  return p;
}

/**
 * A documentation "role" derived
 * PURELY from a file path, used only to influence GROUPING/RANKING
 * decisions (module construction, module prioritization order, which
 * modules get promoted to "top" lists in quickstart/overview). It NEVER
 * affects:
 *   - which files get indexed (walker.ts is untouched)
 *   - closed-list completeness (every symbol in a test/fixture/tooling
 *     module still must be documented, same as a product module)
 *
 * `"product"` is the default for anything that doesn't match a more
 * specific pattern — a project with no tests, fixtures, or benchmark
 * tooling classifies everything as `"product"` and behaves exactly like
 * before this change.
 *
 * `"test"` (#24, 2026-08-04): co-located test files previously classified
 * as product and inflated product modules (43% of this repo's anchored
 * files). Test files are split into their own units at construction
 * time (see `page-units.ts`) and documented through the
 * deterministic zero-token auxiliary channel — they NEVER leave the
 * index, so anchors and `verify` keep working.
 */
export type PathRole = "product" | "test" | "fixture" | "tooling" | "docs";

export interface PathRoleConfig {
  /** Gitignore-style patterns for automated test files. */
  testPatterns?: string[];
  /** Gitignore-style patterns for test fixtures and golden inputs. */
  fixturePatterns?: string[];
  /** Gitignore-style patterns for scripts, benchmarks, and development tools. */
  toolingPatterns?: string[];
  /** Gitignore-style patterns for documentation trees. */
  docsPatterns?: string[];
}

export const DEFAULT_PATH_ROLE_PATTERNS: Required<PathRoleConfig> = {
  testPatterns: [
    // Filename conventions (mirror isTestPath in flows.ts — keep in sync):
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/test_*.py",
    "**/*_test.py",
    "**/*_test.go",
    // JVM conventions:
    "**/*Test.java",
    "**/*Tests.java",
    "**/*Test.kt",
    "**/*Spec.kt",
    "**/*Spec.scala",
    "**/*Suite.scala",
    // .NET convention (prose-tier, role still applies):
    "**/*Tests.cs",
    // Language-DEFINED layouts (Maven/Gradle standard, zero ambiguity —
    // covers test helper classes that do not end in *Test):
    "**/src/test/java/**",
    "**/src/test/kotlin/**",
    // Deliberately OUT (precision): bare `tests/` directories (too many
    // non-test uses — same call isTestPath made) and the Rust Cargo
    // `tests/` layout (needs sibling Cargo.toml detection). Opt in via
    // pathRoles.testPatterns.
  ],
  fixturePatterns: [
    "**/test/fixtures/**",
    "**/tests/fixtures/**",
    "**/__tests__/fixtures/**",
    "**/__fixtures__/**",
    "**/testdata/**",
  ],
  toolingPatterns: ["**/scripts/**", "**/tools/**", "**/benchmarks/**"],
  docsPatterns: ["docs/**", "**/docs/**"],
};

/**
 * Gitignore-style path patterns feeding the stage-5 flow-candidate signals
 * (SPEC §"Semantic product-flow layer"). Same per-category replacement
 * semantics as PathRoleConfig: a supplied category replaces its built-in
 * patterns; an empty array disables that category. The defaults name no
 * product — any repo can override them.
 */
export interface FlowSignalConfig {
  /** Entry-point files (CLI/executable surfaces) used by the entry signal. */
  entryPatterns?: string[];
  /** Persistence files (storage/state) used by the persistence signal. */
  persistencePatterns?: string[];
  /**
   * External import specifiers (e.g. a database driver package) that also
   * mark persistence. Matched against each file's external specifiers with
   * the same combined gitignore semantics; the default is empty — no
   * built-in package-name guessing.
   */
  persistenceImportPatterns?: string[];
}

export const DEFAULT_FLOW_SIGNAL_PATTERNS: Required<FlowSignalConfig> = {
  entryPatterns: ["bin/**", "cmd/**", "**/cli.*", "**/main.*", "**/server.*", "**/app.*"],
  persistencePatterns: [
    "**/db.*",
    "**/database/**",
    "**/store/**",
    "**/state/**",
    "**/persistence/**",
    "**/repository/**",
  ],
  persistenceImportPatterns: [],
};

/**
 * Gitignore-style multi-pattern matcher shared by the path-role classifier
 * and the stage-5 flow-signal detector (flows.ts). Combined-list semantics
 * (later negations apply); an empty pattern list matches nothing.
 */
export function matchesAnyPathPattern(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  return ignore().add(patterns).ignores(path.replace(/\\/g, "/"));
}

/** Classifies a SINGLE path. Config patterns replace (not merge with) the defaults for that category. */
export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole {
  const fixture = config?.fixturePatterns ?? DEFAULT_PATH_ROLE_PATTERNS.fixturePatterns;
  const test = config?.testPatterns ?? DEFAULT_PATH_ROLE_PATTERNS.testPatterns;
  const tooling = config?.toolingPatterns ?? DEFAULT_PATH_ROLE_PATTERNS.toolingPatterns;
  const docs = config?.docsPatterns ?? DEFAULT_PATH_ROLE_PATTERNS.docsPatterns;
  // Precedence: fixture > test > tooling > docs > product — a fixture that
  // happens to match a test filename convention stays a fixture.
  if (matchesAnyPathPattern(path, fixture)) return "fixture";
  if (matchesAnyPathPattern(path, test)) return "test";
  if (matchesAnyPathPattern(path, tooling)) return "tooling";
  if (matchesAnyPathPattern(path, docs)) return "docs";
  return "product";
}

/**
 * Classifies a MODULE by majority vote over its paths. Ties break by a
 * fixed role priority — product > docs > tooling > fixture > test — so a
 * folder mixing product code with same-count test files is a PRODUCT
 * folder (its page documents the product code; test files are covered by
 * deterministic pointers/guide lines, #29 D3), never a test folder.
 * Deterministic: counts first, then the priority list, never input order.
 */
export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole {
  const TIE_PRIORITY: readonly PathRole[] = ["product", "docs", "tooling", "fixture", "test"];
  const counts = new Map<PathRole, number>();
  for (const p of module.paths) {
    const role = classifyPathRole(p, config);
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  let best: PathRole = classifyPathRole(module.paths[0] ?? "", config);
  let bestCount = -1;
  for (const role of TIE_PRIORITY) {
    const count = counts.get(role);
    if (count !== undefined && count > bestCount) {
      best = role;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Ordena módulos pra etapa 4 por centralidade (quantos outros dependem)
 * e tamanho (symbolCount). Centralidade maior primeiro; empate vai pro
 * maior symbolCount.
 *
 * `"product"` modules always rank above fixture/tooling/docs
 * modules, regardless of centrality — a heavily-imported test fixture
 * must not outrank a real product module for "top entry point" purposes.
 * Within the same role, ordering is unchanged (centrality then size).
 * This only reorders the returned list — no module is dropped, and
 * `pathRoleConfig` is entirely optional (default behavior for a repo
 * with no fixture/tooling/docs paths is identical to before).
 */
export function prioritizeModules(
  modules: Module[],
  edges: ModuleGraphEdge[],
  pathRoleConfig?: PathRoleConfig,
): Module[] {
  const indegree = new Map<string, number>();
  for (const m of modules) indegree.set(m.id, 0);
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }
  const scored = modules.map((m) => ({
    m,
    roleRank: classifyModuleRole(m, pathRoleConfig) === "product" ? 0 : 1,
    score: (indegree.get(m.id) ?? 0) * 1000 + m.symbolCount,
  }));
  scored.sort((a, b) => {
    if (a.roleRank !== b.roleRank) return a.roleRank - b.roleRank;
    return b.score - a.score || a.m.id.localeCompare(b.m.id);
  });
  return scored.map((s) => s.m);
}

/**
 * Phase-5 plan (W), review revision: given a set of modules (with
 * caller-supplied candidate IDs), returns a new list where EACH
 * `id` is globally unique. Rules:
 *
 *   1. The FIRST candidate of each module is its own `m.id` (slug of the
 *      module.id) — an already-unique caller-supplied ID is preserved
 *      (e.g. "core-src" beats "src" from the leaf).
 *   2. If `m.id` is in collision, the algorithm expands by path
 *      (right-to-left, leaf → parent → grandparent...) ONLY for the groups in
 *      collision. Unique candidates stay locked at the level where
 *      they appeared.
 *   3. No candidate present in `taken` is assigned (idempotency
 *      under iteration).
 *   4. Stable fallback: for modules whose entire path is exhausted
 *      and still collide (degenerate case: 2+ modules with same path AND
 *      same id), uses the full-path slug + SHA-256 hash of the path
 *      + counter. NEVER depends on input order (unlocked modules are
 *      sorted by path string before the fallback).
 *
 * Determinism:
 *   - Module iteration is stable: wave loop + sort-by-path in the
 *     fallback.
 *   - path → id mapping is a pure function of the path and m.id.
 *
 * Does NOT mutate the input modules — returns new objects.
 */
export function makeUniqueDeterministicIds(modules: Module[]): Module[] {
  if (modules.length === 0) return [];

  // Each module starts with m.id as candidate 0, followed by the path
  // expansions (leaf → parent → grandparent). m.id is preserved when
  // unique (revision #1: "preserve refined IDs that are already unique").
  const sequences: string[][] = modules.map(candidateIdSequence);
  const maxLen = Math.max(...sequences.map((s) => s.length), 0);

  const chosen: (string | null)[] = new Array(modules.length).fill(null);
  const taken = new Set<string>();

  // Wave-based: at each level, group modules by candidate. A group
  // is ONLY locked if BOTH conditions hold:
  //   1. `indices.length === 1` (no other un-locked module offers
  //      the same candidate at this level)
  //   2. `!taken.has(c)` (no previous level has already locked that candidate)
  // Otherwise (collision: size>1, OR size===1 but already in taken) all
  // members of the group advance to the next level. This guarantees that a
  // candidate locked at a previous level is never re-appropriated by a
  // module that only discovers it at a deeper level.
  for (let level = 0; level < maxLen; level++) {
    const byCandidate = new Map<string, number[]>();
    for (let i = 0; i < modules.length; i++) {
      if (chosen[i] !== null) continue;
      if (level >= sequences[i]!.length) continue;
      const c = sequences[i]![level]!;
      const arr = byCandidate.get(c) ?? [];
      arr.push(i);
      byCandidate.set(c, arr);
    }
    for (const [c, indices] of byCandidate) {
      if (indices.length === 1 && !taken.has(c)) {
        const i = indices[0]!;
        chosen[i] = c;
        taken.add(c);
      }
      // Otherwise: collision. Group members advance to the next level
      // (or to the fallback if the sequence runs out).
    }
  }

  // Stable fallback (revision #1: "stable fallback by full path/hash, not
  // by input order"). Sorts un-locked by path string → deterministic
  // order. Base = full path slug; suffix = hash of the path
  // joined + counter.
  const unlocked: number[] = [];
  for (let i = 0; i < modules.length; i++) {
    if (chosen[i] === null) unlocked.push(i);
  }
  unlocked.sort((a, b) => {
    const pa = modules[a]!.paths[0] ?? "";
    const pb = modules[b]!.paths[0] ?? "";
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });

  const out: Module[] = new Array(modules.length);
  for (const i of unlocked) {
    const m = modules[i]!;
    const base = pathSlugOf(m) || m.id;
    const pathStr = m.paths.join("|");
    const hash = sha256(pathStr).slice(0, 8);
    let id = base;
    let n = 1;
    while (taken.has(id)) {
      id = `${base}-${hash}-${n}`;
      n++;
    }
    chosen[i] = id;
    taken.add(id);
  }
  for (let i = 0; i < modules.length; i++) {
    const src = modules[i]!;
    out[i] = {
      id: chosen[i]!,
      paths: src.paths,
      symbolCount: src.symbolCount,
      ...(src.displayTitle ? { displayTitle: src.displayTitle } : {}),
    };
  }
  return out;
}

/**
 * Full path slug of the module (segments joined by `-`). Used as
 * base for the stable fallback: represents the module when no unique
 * `m.id` is available.
 */
function pathSlugOf(m: Module): string {
  const segments = pathSegmentsFor(m);
  return segments.map(slugifySegment).join("-");
}

/**
 * Sequence of candidates for a module. The FIRST candidate is
 * `m.id` (preserves refined IDs). The subsequent ones are right-to-left
 * path expansions (leaf, parent+leaf, grandparent+parent+leaf...).
 * Each candidate is added only if different from the previous one.
 *
 *   modules/id="src"          path="packages/core/src"   → ["src", "core-src", "packages-core-src"]
 *   modules/id="core-src"     path="packages/core/src"   → ["core-src", "src", "packages-core-src"]
 *   modules/id="auth"         path="src/auth.ts"         → ["auth", "auth", "src-auth"]
 *   modules/id="index"        path="index.ts"            → ["index"]
 */
function candidateIdSequence(m: Module): string[] {
  // #24: a trailing `-tests` marks a test-role sibling unit (split out at
  // page-unit construction). It must survive path expansion —
  // otherwise co-located product/test modules under a colliding leaf dir
  // (`src` in N packages) trade the suffix for a longer path prefix and the
  // test module's id stops saying it holds tests ("packages-core-src"
  // instead of "core-src-tests").
  const suffix = m.id.endsWith("-tests") ? "-tests" : "";
  const result: string[] = [m.id];
  const segments = pathSegmentsFor(m);
  for (let n = 1; n <= segments.length; n++) {
    const tail =
      segments
        .slice(segments.length - n)
        .map(slugifySegment)
        .join("-") + suffix;
    if (tail.length > 0 && !result.includes(tail)) {
      result.push(tail);
    }
  }
  return result;
}

/**
 * Path segments of the module (left-to-right, without the file basename).
 * Para path "packages/core/src/auth.ts" → ["packages", "core", "src"].
 * Para path "index.ts" (raiz) → [].
 */
function pathSegmentsFor(m: Module): string[] {
  const first = m.paths[0] ?? m.id;
  if (!first.includes("/")) return [];
  const slash = first.lastIndexOf("/");
  const dir = first.slice(0, slash);
  return dir.split("/").filter(Boolean);
}

/** Slugify a single path segment (lowercase, alphanumeric + hyphen). */
function slugifySegment(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w-]/g, "")
    .replace(/^-+|-+$/g, "");
}

/**
 * Phase-5 plan (W): defensive assertion before stage 4 task creation,
 * LLM call or page write. Throws `DuplicateModuleIdError` (terminal, not
 * recoverable within the run — caller must abort the run with a non-zero status)
 * if any id appears more than once.
 *
 * This is the LAST barrier before reaching disk. The heuristic +
 * `makeUniqueDeterministicIds` should guarantee uniqueness; this function
 * exists so that a future regression in these layers does not produce the bug
 * seen in the benchmark (5 "src" directories overwriting `livewiki/src.md`).
 */
export function assertUniqueModuleIds(modules: Module[]): void {
  const seen = new Map<string, number>();
  const dups = new Map<string, number>();
  for (const m of modules) {
    seen.set(m.id, (seen.get(m.id) ?? 0) + 1);
    if (seen.get(m.id)! > 1) dups.set(m.id, seen.get(m.id)!);
  }
  if (dups.size > 0) {
    const lines: string[] = [];
    for (const [id, count] of [...dups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const samples = modules.filter((m) => m.id === id).map((m) => m.paths[0] ?? "").slice(0, 3);
      lines.push(`  - "${id}" appears ${count} times (e.g. ${samples.join(", ")})`);
    }
    throw new DuplicateModuleIdError(
      `Module ID collision: ${dups.size} duplicate id(s) would map to one page. ` +
        `This is a hard pipeline error (U–X, plan W) — the run MUST abort.\n` +
        lines.join("\n"),
    );
  }
}

export class DuplicateModuleIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateModuleIdError";
  }
}
