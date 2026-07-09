/**
 * modules — identifica módulos do repo (etapa 2 do batch).
 *
 * SPEC §"Pipeline batch (etapa 2)": "agrupamento por diretório + grafo de
 * imports (heurística determinística; LLM pode refinar nomes/limites dos
 * módulos — 1 chamada)".
 *
 * Heurística determinística:
 *   - Agrupa arquivos por diretório top-level (src/auth/foo.ts + src/auth/bar.ts
 *     → módulo "auth" com slug derivado do path).
 *   - Slug = último segmento do diretório. Para raiz (sem diretório), usa
 *     basename do arquivo.
 *
 * Refinamento LLM (etapa 2 do batch):
 *   - 1 chamada com a lista de módulos heurísticos.
 *   - LLM pode RENOMEAR módulos e AJUSTAR limites (mesclar/dividir).
 *   - Se a chamada falhar (timeout, erro 5xx persistente, etc.), o run
 *     CONTINUA com a heurística — falha de refinamento NÃO é falha de task.
 *   - Flag `--no-refine` pula essa chamada (run 100% determinístico, sem
 *     custo de token).
 */

import type { ExtractedImport } from "./imports.js";

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
  // Tenta com .ts, .tsx, .js, .jsx, .py, /index.ts, etc.
  const base = parts.join("/");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.py`,
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