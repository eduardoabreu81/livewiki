/**
 * init — `livewiki init` real (Fase 3).
 *
 * SPEC §"Comandos CLI" (Fase 3): "cria livewiki/ + .livewiki/, indexa o repo,
 * gera quickstart.md + structure.mmd mínimos (sem LLM). Com --batch dispara
 * o pipeline de documentação completa".
 *
 * Comportamento:
 *   - init (sem flags): indexa + gera layout determinístico (sem LLM)
 *     - livewiki/quickstart.md (entry point de baixo token)
 *     - livewiki/architecture/structure.mmd (organograma de diretórios)
 *     - livewiki/architecture/modules.mmd (grafo de imports)
 *     - livewiki/diagrams/<slug>.classes.mmd (1 por módulo com classes)
 *     - livewiki/.manifest.json (snapshot hash)
 *   - init --plan: mostra plano de módulos (heurística determinística,
 *     SEM consumir token). Não gera arquivos — só relatório.
 *   - init --batch: depois do init base, dispara batch LLM (4 etapas)
 *   - init --batch --no-refine: pula refinamento LLM da etapa 2
 *     (correção #5 — refinamento é opt-in/degradável)
 *
 * init --plan NUNCA exige config LLM (correção #5). init sem --batch
 * também não. init --batch só exige se for chamar LLM.
 */

import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { ensureGitignoreEntries } from "./gitignore.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  assertUniqueModuleIds,
  type Module,
} from "./modules.js";
import { collectImports } from "./imports.js";
import {
  generateStructure,
  generateModulesGraph,
  generateClassDiagram,
  moduleSlug,
} from "./diagrams.js";
import {
  computeSnapshotHash,
  writeManifestIfChanged,
  buildManifest,
  readManifest,
} from "./manifest.js";

export interface InitOptions {
  repoRoot: string;
  /** --batch: dispara o pipeline LLM completo depois do init base */
  batch?: boolean;
  /** --plan: mostra plano de módulos e sai (sem LLM, sem escrita) */
  plan?: boolean;
  /** --no-refine: pula refinamento LLM da etapa 2 (só com --batch) */
  noRefine?: boolean;
  /** Language do plano/report (default: config.language || "en") */
  language?: string;
  /** Quiet mode (suprime notas informativas) */
  quiet?: boolean;
}

export interface InitPlanReport {
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
}

export interface InitResult {
  /** Arquivos criados/atualizados */
  filesWritten: string[];
  /** Se --plan, o report (sem escritas) */
  plan?: InitPlanReport;
  /** Se --batch, summary do batch run */
  batchSummary?: {
    runId: number;
    status: string;
    tasksDone: number;
    tasksFailed: number;
  };
  /**
   * Exit code POSIX a ser propagado pelo CLI quando --batch termina.
   *   0 = completed
   *   1 = completed_with_failures
   *   2 = aborted
   * Ausente (sem --batch ou --plan) → CLI usa exit 0 (sucesso de init).
   * Cálculo delegado a core/batch.ts:statusToExitCode — fonte única de verdade.
   */
  batchExitCode?: 0 | 1 | 2;
}

/**
 * Entry point principal.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  const absRoot = nodePath.resolve(opts.repoRoot);

  // Garante .livewiki/ e livewiki/ existem (safe-io)
  await safeIo.mkdir(absRoot, ".livewiki");
  await safeIo.mkdir(absRoot, "livewiki");
  await safeIo.mkdir(absRoot, "livewiki/architecture");
  await safeIo.mkdir(absRoot, "livewiki/diagrams");

  // (R) Garante `.livewiki/` está no `.gitignore` do repo-alvo (regra #3:
  // banco é derivado, gitignored, nunca viaja no git). Idempotente —
  // re-init é no-op se já contém.
  await ensureGitignoreEntries(absRoot, [".livewiki/"]);

  // 1. Indexa o repo (sempre — é a fonte do plano e dos diagramas)
  await runIndexer(absRoot, { ...(opts.quiet ? { quiet: true } : {}) });
  await runLedger(absRoot, { ...(opts.quiet ? { quiet: true } : {}) });

  // 2. Carrega símbolos + módulos heurísticos
  const { symbols, filePaths, modules, edges, ordered, totalSymbols, totalFiles } = await buildPlan(absRoot);

  // 3. --plan: relatório e sai (sem escrita, sem LLM)
  if (opts.plan) {
    return {
      filesWritten: [],
      plan: { modules, edges, ordered, totalSymbols, totalFiles },
    };
  }

  // 4. Gera layout determinístico
  const filesWritten: string[] = [];

  // structure.mmd (organograma de diretórios)
  const structureMmd = generateStructure(filePaths);
  await safeIo.writeText(absRoot, "livewiki/architecture/structure.mmd", structureMmd);
  filesWritten.push("livewiki/architecture/structure.mmd");

  // modules.mmd (grafo de imports entre módulos)
  const modulesMmd = generateModulesGraph(edges);
  await safeIo.writeText(absRoot, "livewiki/architecture/modules.mmd", modulesMmd);
  filesWritten.push("livewiki/architecture/modules.mmd");

  // diagrams/<slug>.classes.mmd — 1 por módulo com classes
  for (const module of modules) {
    const diagram = generateClassDiagram(module, symbols);
    if (diagram) {
      const slug = moduleSlug(module.id);
      const path = `livewiki/diagrams/${slug}.classes.mmd`;
      await safeIo.writeText(absRoot, path, diagram);
      filesWritten.push(path);
    }
  }

  // quickstart.md (entry point — sem LLM, determinístico)
  const quickstart = generateQuickstartDeterministic(modules, ordered, symbols, totalSymbols, totalFiles);
  await safeIo.writeText(absRoot, "livewiki/quickstart.md", quickstart);
  filesWritten.push("livewiki/quickstart.md");

  // architecture/overview.md (P) — alvo do link `[m.id](architecture/overview.md#${m.id})`
  // que o quickstart emite. Sem este arquivo, links do quickstart quebram e
  // `verify` emite WARNs em run recém-completado (SPEC §"Pipeline batch":
  // "Ao final: gera/atualiza quickstart.md e architecture/overview.md").
  // Gerado em init base (com módulos heurísticos) — batch pode re-gravar depois
  // com lista de pages adicionadas.
  const overview = await generateArchitectureOverview({
    absRoot,
    modules,
    ordered,
    filePaths,
    totalSymbols,
    totalFiles,
    edges,
    symbols,
  });
  await safeIo.writeText(absRoot, "livewiki/architecture/overview.md", overview);
  filesWritten.push("livewiki/architecture/overview.md");

  // manifest.json (snapshotHash + pendingBatch=null pra init sem batch)
  const snapshotHash = await computeSnapshotHash(absRoot);
  // FIX M (rev2): só listar manifest em filesWritten se ele foi REALMENTE
  // regravado. `writeManifestIfChanged` é idempotente (anti-loop CI) —
  // se nada mudou, retorna false e não devemos fingir que escreveu.
  const wroteManifest = await writeManifestIfChanged(
    absRoot,
    buildManifest({
      lastDocumentedCommit: null,
      snapshotHash,
      pendingBatch: null,
    }),
  );
  if (wroteManifest) filesWritten.push("livewiki/.manifest.json");

  // 5. --batch: dispara pipeline LLM (delegado pro batch.ts)
  let batchSummary: InitResult["batchSummary"];
  let batchExitCode: InitResult["batchExitCode"];
  if (opts.batch) {
    // Import dinâmico evita ciclo se batch.ts importa init.ts
    const { runBatch, statusToExitCode } = await import("./batch.js");
    const result = await runBatch({
      repoRoot: absRoot,
      ...(opts.noRefine ? { noRefine: true } : {}),
      ...(opts.language ? { language: opts.language } : {}),
      // Não re-cria index (já rodou acima)
      skipManifestWrite: true, // init já escreveu; batch não regrava
    });
    batchSummary = {
      runId: result.runId,
      status: result.status,
      tasksDone: result.byModule.length,
      tasksFailed: result.failures.length,
    };
    // (O): propagar exit code do batch (antes fix: init --batch sempre
    // retornava 0, escondendo completed_with_failures/aborted).
    batchExitCode = statusToExitCode(result.status);
    // Atualiza manifest com pendingBatch se houve falhas (handoff)
    if (result.status === "completed_with_failures" || result.status === "aborted") {
      const totalsDone = result.byModule.reduce((a, m) => a + (m.costUsd !== null ? 1 : 0), 0);
      await writeManifestIfChanged(
        absRoot,
        buildManifest({
          lastDocumentedCommit: null,
          snapshotHash: await computeSnapshotHash(absRoot),
          pendingBatch: { runId: result.runId, stage: 4, done: totalsDone, total: ordered.length },
        }),
      );
    } else {
      // Run completou sem falhas — limpa pendingBatch do manifest
      await writeManifestIfChanged(
        absRoot,
        buildManifest({
          lastDocumentedCommit: null,
          snapshotHash: await computeSnapshotHash(absRoot),
          pendingBatch: null,
        }),
      );
    }
  }

  return {
    filesWritten,
    ...(batchSummary ? { batchSummary } : {}),
    ...(batchExitCode !== undefined ? { batchExitCode } : {}),
  };
}

async function buildPlan(absRoot: string): Promise<{
  symbols: SymbolRow[];
  filePaths: string[];
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
}> {
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const symbols = db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[];
    const filePaths = [
      ...new Set(symbols.map((s) => s.key.split("#")[0]!)),
    ].sort();
    const symbolCountByPath = new Map<string, number>();
    for (const s of symbols) {
      const p = s.key.split("#")[0]!;
      symbolCountByPath.set(p, (symbolCountByPath.get(p) ?? 0) + 1);
    }
    // Review finding #2: apply the W gate (plan-wide uniqueness) BEFORE
    // resolving edges and prioritizing — so module identity is the same
    // across all derived artifacts (modules.mmd, quickstart.md, overview.md,
    // regenerator, and batch_tasks.target).
    const heuristicModules = identifyModulesHeuristic(filePaths, symbolCountByPath);
    const modules = makeUniqueDeterministicIds(heuristicModules);
    assertUniqueModuleIds(modules);

    // Collect imports to build the graph
    const importsByFile = new Map<string, Awaited<ReturnType<typeof collectImports>>>();
    const nodeFs = await import("node:fs/promises");
    for (const p of filePaths) {
      try {
        const content = await nodeFs.readFile(nodePath.join(absRoot, p), "utf8");
        importsByFile.set(p, await collectImports(p, content));
      } catch {
        // skip
      }
    }
    const edges = resolveModuleEdges(modules, importsByFile, new Set(filePaths));
    const ordered = prioritizeModules(modules, edges);

    return {
      symbols,
      filePaths,
      modules,
      edges,
      ordered,
      totalSymbols: symbols.length,
      totalFiles: filePaths.length,
    };
  } finally {
    db.close();
  }
}

/**
 * Quickstart determinístico (sem LLM). Lista módulos + top symbols + entry points.
 * Linguagem controlada por `language` (default: "en").
 */
function generateQuickstartDeterministic(
  modules: Module[],
  ordered: Module[],
  symbols: SymbolRow[],
  totalSymbols: number,
  totalFiles: number,
  language: string = "en",
): string {
  const labels: Record<string, { intro: string; entry: string; concepts: string; module: string }> = {
    en: {
      intro: "Quickstart",
      entry: "Top entry points",
      concepts: "Key concepts",
      module: "Module",
    },
  };
  const l = labels[language] ?? labels.en!;

  const topModules = ordered.slice(0, 3);
  const topSymbols = symbols
    .filter((s) => s.kind === "function" || s.kind === "class")
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`# ${l.intro}`);
  lines.push("");
  lines.push(
    `This repository has **${totalFiles} files** indexed and **${totalSymbols} symbols** extracted, organized into **${modules.length} modules**.`,
  );
  lines.push("");
  lines.push(`## ${l.entry}`);
  lines.push("");
  for (const m of topModules) {
    lines.push(`- [${m.id}](architecture/overview.md#${m.id}) — ${m.paths.length} files, ${m.symbolCount} symbols`);
  }
  lines.push("");
  lines.push(`## ${l.concepts}`);
  lines.push("");
  for (const s of topSymbols) {
    lines.push(`- \`${s.key}\` (${s.kind})`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(
    "Generated by `livewiki init`. Refresh with `livewiki index` + manual edits.",
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * (P) `architecture/overview.md` — alvo do link que o quickstart emite
 * (`architecture/overview.md#${module.id}`).
 *
 * Sem este arquivo, links do quickstart quebram e `verify` emite WARNs em
 * run recém-completado. SPEC §"Pipeline batch" explicita: "Ao final:
 * gera/atualiza quickstart.md e architecture/overview.md, grava manifest."
 *
 * Conteúdo:
 *   - Frontmatter `owner: generated` (regra dos diagramas: nunca envelhece)
 *   - Resumo (files / symbols / modules / edges)
 *   - Module index: anchor HTML inline (id exato) + links para diagram
 *     de classes + link para page do módulo (livewiki/<id>.md, se existir)
 *   - Diagrams: embed de structure.mmd e modules.mmd em code fence mermaid
 *   - Per-file index (top N arquivos por número de símbolos) — ajuda a
 *     encontrar entry points antes do batch gerar doc dedicada
 *
 * Anchor HTML inline (`<a id="auth"></a>`) é usado para garantir match
 * EXATO com o link do quickstart, independente de como o renderer markdown
 * slugifica headings (lowercase, remoção de punct, etc.).
 */
/**
 * Regenera APENAS o `architecture/overview.md` com base no estado atual da wiki.
 *
 * Usado tanto por `runInit` (após criar layout base) quanto por `batch`
 * (após criar as pages dos módulos) — assim os links `[page](../m.id.md)`
 * aparecem quando as páginas existem e somem quando ainda não existem
 * (evita broken_internal_link warnings no `verify`).
 *
 * Idempotente. Lê o índice SQLite pra extrair símbolos/módulos.
 */
export async function regenerateArchitectureOverview(repoRoot: string): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  const { modules, edges, ordered, totalSymbols, totalFiles, symbols, filePaths } =
    await buildPlan(absRoot);
  const overview = await generateArchitectureOverview({
    absRoot,
    modules,
    ordered,
    filePaths,
    totalSymbols,
    totalFiles,
    edges,
    symbols,
  });
  await safeIo.writeText(absRoot, "livewiki/architecture/overview.md", overview);
}

async function generateArchitectureOverview(opts: {
  /** Repo root (abs path) — usado pra checar se páginas de módulo já existem. */
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  filePaths: string[];
  totalSymbols: number;
  totalFiles: number;
  edges: Array<{ from: string; to: string }>;
  symbols: SymbolRow[];
}): Promise<string> {
  const { absRoot, modules, ordered, filePaths, totalSymbols, totalFiles, edges, symbols } = opts;

  // Top arquivos por número de símbolos (entry points heurísticos).
  const symbolsByFile = new Map<string, number>();
  for (const s of symbols) {
    const p = s.key.split("#")[0]!;
    symbolsByFile.set(p, (symbolsByFile.get(p) ?? 0) + 1);
  }
  const topFiles = [...symbolsByFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  // Conta símbolos por módulo (top symbols por módulo pro resumo).
  const symbolsByModule = new Map<string, number>();
  for (const m of modules) symbolsByModule.set(m.id, m.symbolCount);

  const lines: string[] = [];
  lines.push("---");
  lines.push("title: Architecture overview");
  lines.push("owner: generated");
  lines.push("---");
  lines.push("");
  lines.push("# Architecture overview");
  lines.push("");
  lines.push(
    `This repository has **${totalFiles} files** indexed and **${totalSymbols} symbols** ` +
      `extracted, organized into **${modules.length} modules** with **${edges.length} edges** ` +
      `between them.`,
  );
  lines.push("");
  lines.push("Diagrams in this section are deterministic (regenerated by `livewiki init` / `index`); " +
    "the module pages they link to are written by the batch (`livewiki init --batch`) or " +
    "manually.");
  lines.push("");
  lines.push("## Module index");
  lines.push("");
  lines.push("Ordered by prioritization (centrality + size). Each module links to its class " +
    "diagram and (when available) to its generated page.");
  lines.push("");
  for (const m of ordered) {
    // Anchor HTML inline garante match exato com o link `[id](overview.md#id)` do quickstart.
    lines.push(`<a id="${escapeHtmlId(m.id)}"></a>`);
    lines.push("");
    const classDiagramPath = `../diagrams/${moduleSlug(m.id)}.classes.mmd`;
    const pageRelPath = `${m.id}.md`;
    // Page link só é emitido se a página EXISTE — senão vira broken_internal_link
    // warning no `verify`. init roda ANTES do batch (que cria as pages), então
    // omitir o link aqui é o correto. Re-rodar init após batch vai popular.
    // (Fase 5 step E2E: critério é "verify zero issues" — sem isso, sempre falha.)
    const pageExists = await nodeFs
      .stat(nodePath.join(absRoot, "livewiki", pageRelPath))
      .then(() => true)
      .catch(() => false);
    const parts: string[] = [];
    parts.push(`**${m.symbolCount}** symbols across **${m.paths.length}** files`);
    parts.push(`[class diagram](${classDiagramPath})`);
    if (pageExists) {
      parts.push(`[page](../${pageRelPath})`);
    }
    lines.push(`### ${m.id}`);
    lines.push("");
    lines.push(parts.join(" · "));
    lines.push("");
  }
  lines.push("## Diagrams");
  lines.push("");
  lines.push("### Structure");
  lines.push("");
  lines.push("Organogram of files and directories.");
  lines.push("");
  lines.push("```mermaid");
  lines.push("%% livewiki/architecture/structure.mmd");
  lines.push("```");
  lines.push("");
  lines.push("Open the raw file: [structure.mmd](structure.mmd)");
  lines.push("");
  lines.push("### Module dependencies");
  lines.push("");
  lines.push("Import graph between modules.");
  lines.push("");
  lines.push("```mermaid");
  lines.push("%% livewiki/architecture/modules.mmd");
  lines.push("```");
  lines.push("");
  lines.push("Open the raw file: [modules.mmd](modules.mmd)");
  lines.push("");
  lines.push("## Top files by symbol count");
  lines.push("");
  lines.push("Heuristic entry points — most symbols per file.");
  lines.push("");
  for (const f of topFiles) {
    lines.push(`- \`${f.path}\` (${f.count} symbols)`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("Generated by `livewiki init`. Refresh with `livewiki index` + manual edits, " +
    "or run `livewiki init --batch` to generate per-module documentation.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Escape de id para uso em anchor HTML (`<a id="...">`).
 * Mantém alfanum + ponto + hífen + underscore. Qualquer outro vira `_`.
 * Garante que o id seja válido como atributo HTML e idêntico ao que o
 * quickstart emite no link (`#${m.id}`).
 */
function escapeHtmlId(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}