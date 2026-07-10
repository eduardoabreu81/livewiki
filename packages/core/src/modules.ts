/**
 * modules — identifica módulos do repo (etapa 2 do batch).
 *
 * SPEC §"Batch pipeline (stage 2)": "grouping by directory + import graph
 * (deterministic heuristic; LLM may refine module names/boundaries —
 * módulos — 1 chamada)".
 *
 * Deterministic heuristic:
 *   - Groups files by top-level directory (src/auth/foo.ts + src/auth/bar.ts
 *     → "auth" module with slug derived from path).
 *   - Slug = last segment of the directory. For root (no directory), uses
 *     the file basename.
 *
  * Phase-5 plan (W): the module's slug MUST be globally unique before
 * reaching stage 4 (write of `livewiki/<id>.md`). If two distinct
 * trees share the same leaf ("src" in packages/core/src AND packages/cli/src),
  * the final slug is expanded from right to left (`core-src`, `cli-src`)
  * until all modules are unique. A defensive assertion confirms
 * uniqueness before the next stage.
 *
 * LLM refinement (batch stage 2):
 *   - 1 call with the list of heuristic modules.
 *   - LLM may RENAME modules and ADJUST boundaries (merge/split).
 *   - If the call fails (timeout, persistent 5xx error, etc.), the run
 *     CONTINUES with the heuristic — refinement failure is NOT a task failure.
 *   - Flag `--no-refine` skips this call (run 100% deterministic, no
 *     token cost).
 */

import type { ExtractedImport } from "./imports.js";
import { sha256 } from "./hashes.js";

export interface Module {
  /** Slug único do módulo (ex: "auth", "session"). */
  id: string;
  /** Paths relativos dos arquivos que compõem o módulo. */
  paths: string[];
  /** Quantos símbolos ativos tem no módulo (heurística de priorização). */
  symbolCount: number;
}

export interface ModuleGraphEdge {
  from: string; // module id
  to: string;   // module id
}

/**
 * Identifica módulos via heurística determinística (sem LLM). Agrupa por
 * diretório top-level.
 *
 * `filePaths` são os paths relativos (forward-slash) que o walker devolveu.
 * Arquivos com `path` que não tem diretório (raiz):
 *   - Se for o ÚNICO arquivo do repo → usa basename (sem extensão) como id
 *   - Caso contrário (raiz + outros módulos) → id = "root"
 */
export function identifyModulesHeuristic(
  filePaths: string[],
  symbolCountByPath: Map<string, number> = new Map(),
): Module[] {
  const byDir = new Map<string, string[]>();
  for (const path of filePaths) {
    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash);
    const arr = byDir.get(dir) ?? [];
    arr.push(path);
    byDir.set(dir, arr);
  }
  const totalDirs = byDir.size;
  const modules: Module[] = [];
  for (const [dir, paths] of byDir) {
    const id = dirToModuleId(dir, paths, totalDirs);
    const symbolCount = paths.reduce(
      (acc, p) => acc + (symbolCountByPath.get(p) ?? 0),
      0,
    );
    modules.push({ id, paths, symbolCount });
  }
  // Ordena por id pra saída determinística
  modules.sort((a, b) => a.id.localeCompare(b.id));
  return modules;
}

function dirToModuleId(dir: string, paths: string[], totalDirs: number): string {
  if (dir === "") {
    // raiz com só 1 arquivo E nenhum outro módulo: usa basename
    if (totalDirs === 1 && paths.length === 1) {
      return paths[0]!.split(".")[0]!;
    }
    return "root";
  }
  // Último segmento do path
  const segments = dir.split("/");
  return segments[segments.length - 1]!;
}

/**
 * Resolve imports pra edges no grafo de módulos. Apenas edges entre módulos
 * DIFERENTES (self-loops são descartados).
 *
 * Limitação MVP: resolve só imports relativos (./foo, ../bar) que apontam
 * pra arquivos existentes no `knownFiles`. Imports absolutos/node_modules
 * viram "external" e não geram edges internos.
 */
export function resolveModuleEdges(
  modules: Module[],
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
): ModuleGraphEdge[] {
  // Mapa path → moduleId
  const fileToModule = new Map<string, string>();
  for (const m of modules) {
    for (const p of m.paths) {
      fileToModule.set(p, m.id);
    }
  }

  const edges = new Map<string, ModuleGraphEdge>(); // dedup por "from→to"
  for (const [filePath, imports] of importsByFile) {
    const fromModule = fileToModule.get(filePath);
    if (!fromModule) continue;
    for (const imp of imports) {
      // Só imports relativos (./ ou ../)
      if (!imp.source.startsWith("./") && !imp.source.startsWith("../")) continue;
      const resolved = resolveRelativeImport(filePath, imp.source, knownFiles);
      if (!resolved) continue;
      const toModule = fileToModule.get(resolved);
      if (!toModule || toModule === fromModule) continue;
      const key = `${fromModule}→${toModule}`;
      if (!edges.has(key)) {
        edges.set(key, { from: fromModule, to: toModule });
      }
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
 */
function resolveRelativeImport(
  fromFile: string,
  importPath: string,
  knownFiles: Set<string>,
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
 * Ordena módulos pra etapa 4 por centralidade (quantos outros dependem)
 * e tamanho (symbolCount). Centralidade maior primeiro; empate vai pro
 * maior symbolCount.
 */
export function prioritizeModules(
  modules: Module[],
  edges: ModuleGraphEdge[],
): Module[] {
  const indegree = new Map<string, number>();
  for (const m of modules) indegree.set(m.id, 0);
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }
  const scored = modules.map((m) => ({
    m,
    score: (indegree.get(m.id) ?? 0) * 1000 + m.symbolCount,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.m);
}

/**
 * Phase-5 plan (W), review revision: given a set of modules (with IDs
 * heuristic or refined by the LLM), returns a new list where EACH
 * `id` is globally unique. Rules:
 *
 *   1. The FIRST candidate of each module is its own `m.id` (slug of the
 *      module.id) — this preserves IDs refined by the LLM that are already
 *      unique (e.g. "core-src" after refine beats "src" from the leaf).
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
    out[i] = {
      id: chosen[i]!,
      paths: modules[i]!.paths,
      symbolCount: modules[i]!.symbolCount,
    };
  }
  return out;
}

/**
 * Full path slug of the module (segments joined by `-`). Used as
 * base for the stable fallback: represents the module in the absence of a
 * m.id único disponível.
 */
function pathSlugOf(m: Module): string {
  const segments = pathSegmentsFor(m);
  return segments.map(slugifySegment).join("-");
}

/**
 * Sequence of candidates for a module. The FIRST candidate is
 * `m.id` (preserves refined IDs). The subsequent ones are expansions
 * right-to-left do path (leaf, parent+leaf, grandparent+parent+leaf...).
 * Each candidate is added only if different from the previous one.
 *
 *   modules/id="src"          path="packages/core/src"   → ["src", "core-src", "packages-core-src"]
 *   modules/id="core-src"     path="packages/core/src"   → ["core-src", "src", "packages-core-src"]
 *   modules/id="auth"         path="src/auth.ts"         → ["auth", "auth", "src-auth"]
 *   modules/id="index"        path="index.ts"            → ["index"]
 */
function candidateIdSequence(m: Module): string[] {
  const result: string[] = [m.id];
  const segments = pathSegmentsFor(m);
  for (let n = 1; n <= segments.length; n++) {
    const tail = segments
      .slice(segments.length - n)
      .map(slugifySegment)
      .join("-");
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