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
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
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

  // manifest.json (snapshotHash + pendingBatch=null pra init sem batch)
  const snapshotHash = await computeSnapshotHash(absRoot);
  await writeManifestIfChanged(
    absRoot,
    buildManifest({
      lastDocumentedCommit: null,
      snapshotHash,
      pendingBatch: null,
    }),
  );
  filesWritten.push("livewiki/.manifest.json");

  // 5. --batch: dispara pipeline LLM (delegado pro batch.ts)
  let batchSummary: InitResult["batchSummary"];
  if (opts.batch) {
    // Import dinâmico evita ciclo se batch.ts importa init.ts
    const { runBatch } = await import("./batch.js");
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

  return { filesWritten, ...(batchSummary ? { batchSummary } : {}) };
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
    const modules = identifyModulesHeuristic(filePaths, symbolCountByPath);

    // Coleta imports pra montar o grafo
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
    "pt-BR": {
      intro: "Guia rápido",
      entry: "Pontos de entrada",
      concepts: "Conceitos-chave",
      module: "Módulo",
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
    language === "pt-BR"
      ? `Este repositório tem **${totalFiles} arquivos** indexados e **${totalSymbols} símbolos** extraídos, organizados em **${modules.length} módulos**.`
      : `This repository has **${totalFiles} files** indexed and **${totalSymbols} symbols** extracted, organized into **${modules.length} modules**.`,
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
    language === "pt-BR"
      ? "Gerado por `livewiki init`. Atualize com `livewiki index` + edits manuais."
      : "Generated by `livewiki init`. Refresh with `livewiki index` + manual edits.",
  );
  lines.push("");
  return lines.join("\n");
}