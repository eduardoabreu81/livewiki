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
  /**
   * True when a single file exceeds maxModuleSymbols and cannot be
   * path-split further. Batch still schedules the page (does not abort);
   * stage 4 must bound context for that unit.
   */
  unsplittable?: boolean;
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
  for (const raw of filePaths) {
    const path = normalizeRepoPath(raw);
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

/** Defaults for oversized-module splitting (structural, completion-oriented). */
export const MODULE_SPLIT_DEFAULTS = {
  /** Split when a module has more files than this. */
  maxFiles: 12,
  /** Split when total symbols exceed this (even with fewer files). */
  maxSymbols: 80,
} as const;

/** Sentinel for a disabled size axis (`maxModuleFiles: 0` / `maxModuleSymbols: 0`). */
export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;

export interface SplitOversizedOptions {
  /**
   * Max files per module. Omit → default 12. `0` disables the file axis.
   * Negative values are treated as disabled.
   */
  maxFiles?: number;
  /**
   * Max symbols per module. Omit → default 80. `0` disables the symbol axis.
   * Negative values are treated as disabled.
   */
  maxSymbols?: number;
  /** Optional map path → symbol count (defaults to 0 per file if missing). */
  symbolCountByPath?: Map<string, number>;
}

/**
 * Normalize split thresholds. `0` or negative → axis disabled (no cap).
 * `undefined` → MODULE_SPLIT_DEFAULTS.
 */
export function normalizeSplitLimits(
  maxFiles?: number,
  maxSymbols?: number,
): { maxFiles: number; maxSymbols: number } {
  const files =
    maxFiles === undefined
      ? MODULE_SPLIT_DEFAULTS.maxFiles
      : maxFiles <= 0
        ? SPLIT_AXIS_DISABLED
        : maxFiles;
  const symbols =
    maxSymbols === undefined
      ? MODULE_SPLIT_DEFAULTS.maxSymbols
      : maxSymbols <= 0
        ? SPLIT_AXIS_DISABLED
        : maxSymbols;
  return { maxFiles: files, maxSymbols: symbols };
}

/**
 * Split modules that are too large for a single stage-4 LLM page into
 * smaller units that still complete with valid frontmatter + verify.
 *
 * Strategy (T0 — SPEC: subdirectory, else stable file chunks):
 * 1. True subdirectories only (next path segment with remaining depth).
 * 2. Peer leaf files in the same directory form one flat bucket (never
 *    one module per filename).
 * 3. Oversized flat buckets are packed with dual-axis limits (files +
 *    symbols); chunk IDs are ordinal (`parent-01`, `parent-02`, …).
 * 4. A single file over maxSymbols is emitted as `unsplittable` (batch
 *    continues).
 *
 * **symbolCountByPath contract**
 * - Batch and init always pass the full index map (AST-derived counts).
 * - With that map, each emitted module/chunk gets `symbolCount` = sum of
 *   per-path entries for its paths.
 * - When the map is omitted (or has no entry for the module's paths), an
 *   **intact** module that is not size-split keeps its input `symbolCount`
 *   (fallback so prioritization is not wiped for already-small modules).
 * - When **chunking/splitting** without map data for those paths, **child
 *   chunks receive `symbolCount: 0`**. Do not claim the parent aggregate is
 *   preserved or redistributed across chunks. Correct per-chunk counts
 *   require `symbolCountByPath`.
 *
 * Does not guarantee global id uniqueness — call makeUniqueDeterministicIds after.
 * Output is a deterministic exact partition of the input paths (order-independent).
 */
export function splitOversizedModules(
  modules: Module[],
  opts: SplitOversizedOptions = {},
): Module[] {
  const { maxFiles, maxSymbols } = normalizeSplitLimits(
    opts.maxFiles,
    opts.maxSymbols,
  );
  const symbolCountByPath = opts.symbolCountByPath ?? new Map<string, number>();

  // Stable module order by id then first path — pure function of content.
  const sortedMods = [...modules].sort((a, b) => {
    const c = a.id.localeCompare(b.id);
    if (c !== 0) return c;
    return (a.paths[0] ?? "").localeCompare(b.paths[0] ?? "");
  });

  const out: Module[] = [];
  for (const m of sortedMods) {
    out.push(...splitOneModule(m, maxFiles, maxSymbols, symbolCountByPath));
  }
  return out;
}

function countSymbols(paths: string[], map: Map<string, number>): number {
  return paths.reduce((acc, p) => acc + (map.get(p) ?? 0), 0);
}

/**
 * Resolve symbol count for a path set. Prefer per-path map entries when any
 * path is present in the map; otherwise keep the module-level fallback so
 * an omitted map does not wipe a known `symbolCount`.
 */
function resolveSymbolCount(
  paths: string[],
  map: Map<string, number>,
  moduleFallback: number,
): number {
  let anyKnown = false;
  let sum = 0;
  for (const p of paths) {
    if (map.has(p)) {
      anyKnown = true;
      sum += map.get(p) ?? 0;
    }
  }
  if (anyKnown) return sum;
  return moduleFallback;
}

function axisEnabled(limit: number): boolean {
  return limit < SPLIT_AXIS_DISABLED;
}

function fitsLimits(
  fileCount: number,
  symbolCount: number,
  maxFiles: number,
  maxSymbols: number,
): boolean {
  if (axisEnabled(maxFiles) && fileCount > maxFiles) return false;
  if (axisEnabled(maxSymbols) && symbolCount > maxSymbols) return false;
  return true;
}

function splitOneModule(
  m: Module,
  maxFiles: number,
  maxSymbols: number,
  symbolCountByPath: Map<string, number>,
): Module[] {
  const paths = [...m.paths].map(normalizeRepoPath).sort((a, b) => a.localeCompare(b));
  if (paths.length === 0) {
    return [];
  }

  const sc = resolveSymbolCount(paths, symbolCountByPath, m.symbolCount);

  // Single file: never path-split; mark unsplittable if over symbol cap.
  if (paths.length === 1) {
    const p = paths[0]!;
    const fileSc = resolveSymbolCount([p], symbolCountByPath, m.symbolCount);
    const unsplittable =
      axisEnabled(maxSymbols) && fileSc > maxSymbols ? true : undefined;
    return [
      {
        id: m.id,
        paths,
        symbolCount: fileSc,
        ...(unsplittable ? { unsplittable: true } : {}),
      },
    ];
  }

  if (fitsLimits(paths.length, sc, maxFiles, maxSymbols)) {
    return [{ id: m.id, paths, symbolCount: sc }];
  }

  const { prefixLen, groups } = groupPathsByNextSegment(paths);

  const subdirBuckets: Array<{ seg: string; paths: string[] }> = [];
  const leafPaths: string[] = [];

  for (const [seg, groupPaths] of groups) {
    // Structural only when at least one path has depth beyond the segment
    // (i.e. the segment is a directory, not only a peer leaf filename).
    const isSubdir = groupPaths.some(
      (p) => p.split("/").length > prefixLen + 1,
    );
    if (isSubdir) {
      subdirBuckets.push({
        seg,
        paths: [...groupPaths].sort((a, b) => a.localeCompare(b)),
      });
    } else {
      leafPaths.push(...groupPaths);
    }
  }
  leafPaths.sort((a, b) => a.localeCompare(b));
  subdirBuckets.sort((a, b) => a.seg.localeCompare(b.seg));

  // Pure flat (no true subdirs): dual-axis chunk under parent id.
  if (subdirBuckets.length === 0) {
    return chunkFlatBucket(m.id, paths, maxFiles, maxSymbols, symbolCountByPath);
  }

  // Single nested directory, no peer leaves: descend without a rename.
  if (subdirBuckets.length === 1 && leafPaths.length === 0) {
    const only = subdirBuckets[0]!;
    return splitOneModule(
      {
        id: m.id,
        paths: only.paths,
        symbolCount: resolveSymbolCount(
          only.paths,
          symbolCountByPath,
          m.symbolCount,
        ),
      },
      maxFiles,
      maxSymbols,
      symbolCountByPath,
    );
  }

  const parts: Module[] = [];
  for (const { seg, paths: sp } of subdirBuckets) {
    const id = `${m.id}-${slugifyIdSegment(seg)}`;
    parts.push(
      ...splitOneModule(
        {
          id,
          paths: sp,
          symbolCount: resolveSymbolCount(sp, symbolCountByPath, 0),
        },
        maxFiles,
        maxSymbols,
        symbolCountByPath,
      ),
    );
  }
  if (leafPaths.length > 0) {
    parts.push(
      ...splitOneModule(
        {
          id: m.id,
          paths: leafPaths,
          symbolCount: resolveSymbolCount(leafPaths, symbolCountByPath, 0),
        },
        maxFiles,
        maxSymbols,
        symbolCountByPath,
      ),
    );
  }
  return parts;
}

/**
 * Pack sorted peer paths into chunks that respect both enabled limits.
 * Ordinal ids: `{parentId}-01`, `{parentId}-02`, … when more than one chunk.
 * A single atomic file over maxSymbols is marked unsplittable.
 */
function chunkFlatBucket(
  parentId: string,
  paths: string[],
  maxFiles: number,
  maxSymbols: number,
  symbolCountByPath: Map<string, number>,
): Module[] {
  const sorted = [...paths].sort((a, b) => a.localeCompare(b));
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentSymbols = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      currentSymbols = 0;
    }
  };

  for (const p of sorted) {
    const fileSc = symbolCountByPath.get(p) ?? 0;

    // Atomic over-symbol file: own chunk, marked later.
    if (axisEnabled(maxSymbols) && fileSc > maxSymbols) {
      flush();
      chunks.push([p]);
      continue;
    }

    const nextFiles = current.length + 1;
    const nextSymbols = currentSymbols + fileSc;
    const exceedsFiles =
      current.length > 0 && axisEnabled(maxFiles) && nextFiles > maxFiles;
    const exceedsSymbols =
      current.length > 0 &&
      axisEnabled(maxSymbols) &&
      nextSymbols > maxSymbols;

    if (exceedsFiles || exceedsSymbols) {
      flush();
    }
    current.push(p);
    currentSymbols += fileSc;
  }
  flush();

  if (chunks.length === 0) {
    return [];
  }

  if (chunks.length === 1) {
    const cPaths = chunks[0]!;
    const sc = countSymbols(cPaths, symbolCountByPath);
    const unsplittable =
      cPaths.length === 1 &&
      axisEnabled(maxSymbols) &&
      (symbolCountByPath.get(cPaths[0]!) ?? 0) > maxSymbols;
    return [
      {
        id: parentId,
        paths: cPaths,
        symbolCount: sc,
        ...(unsplittable ? { unsplittable: true } : {}),
      },
    ];
  }

  return chunks.map((cPaths, i) => {
    const ordinal = String(i + 1).padStart(2, "0");
    const sc = countSymbols(cPaths, symbolCountByPath);
    const unsplittable =
      cPaths.length === 1 &&
      axisEnabled(maxSymbols) &&
      (symbolCountByPath.get(cPaths[0]!) ?? 0) > maxSymbols;
    return {
      id: `${parentId}-${ordinal}`,
      paths: cPaths,
      symbolCount: sc,
      ...(unsplittable ? { unsplittable: true } : {}),
    };
  });
}

/**
 * Group paths by the path segment after their longest common directory prefix.
 * Returns prefix length (in segments) and the group map.
 */
function groupPathsByNextSegment(paths: string[]): {
  prefixLen: number;
  groups: Map<string, string[]>;
} {
  if (paths.length === 0) return { prefixLen: 0, groups: new Map() };
  const split = paths.map((p) => p.split("/").filter(Boolean));
  const minLen = Math.min(...split.map((s) => s.length));
  let prefixLen = 0;
  for (let i = 0; i < minLen - 1; i++) {
    const seg = split[0]![i];
    if (split.every((s) => s[i] === seg)) prefixLen++;
    else break;
  }
  const groups = new Map<string, string[]>();
  for (let i = 0; i < paths.length; i++) {
    const segs = split[i]!;
    const key = segs[prefixLen] ?? fileStem(paths[i]!);
    const arr = groups.get(key) ?? [];
    arr.push(paths[i]!);
    groups.set(key, arr);
  }
  return { prefixLen, groups };
}

function fileStem(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function slugifyIdSegment(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "part"
  );
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
 * T0 refine guard: peer leaf files that share a parent directory must not
 * be split across refined modules. Merge/rename of whole directories is OK;
 * path-level size chunking runs after refine. Rejects filename-derived
 * one-file explosion that already satisfies size caps.
 *
 * Returns null if OK, or an error message if fragmented.
 */
export function refinePeerDirectoryFragmentationError(
  modules: Module[],
): string | null {
  // path → module id
  const fileToModule = new Map<string, string>();
  for (const m of modules) {
    for (const raw of m.paths) {
      const p = normalizeRepoPath(raw);
      if (fileToModule.has(p)) {
        return `refined modules assign path "${p}" to more than one module`;
      }
      fileToModule.set(p, m.id);
    }
  }

  // parent dir → peer leaf files (files whose dirname is that parent)
  const peersByDir = new Map<string, string[]>();
  for (const p of fileToModule.keys()) {
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "" : p.slice(0, slash);
    // Only peer leaves at this directory (not nested paths — inventory is files)
    const arr = peersByDir.get(dir) ?? [];
    arr.push(p);
    peersByDir.set(dir, arr);
  }

  for (const [dir, peers] of peersByDir) {
    if (peers.length < 2) continue;
    const moduleIds = new Set(
      peers.map((p) => fileToModule.get(p)!).filter(Boolean),
    );
    if (moduleIds.size > 1) {
      const label = dir === "" ? "(repo root)" : dir;
      return (
        `refined modules fragment peer files under "${label}" across ` +
        `${moduleIds.size} modules — T0 forbids splitting a directory in ` +
        `stage-2 refine (deterministic chunker owns size splits)`
      );
    }
  }
  return null;
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
    const src = modules[i]!;
    out[i] = {
      id: chosen[i]!,
      paths: src.paths,
      symbolCount: src.symbolCount,
      ...(src.unsplittable ? { unsplittable: true } : {}),
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