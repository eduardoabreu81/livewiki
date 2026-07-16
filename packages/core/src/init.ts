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
import { ensureGitignoreEntries } from "./gitignore.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  splitOversizedModules,
  assertExactPathPartition,
  assertUniqueModuleIds,
  classifyModuleRole,
  type PathRoleConfig,
  type Module,
} from "./modules.js";
import { loadConfig, applyDefaults, resolveExtraIgnores, type LivewikiConfig } from "./config.js";
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
import {
  generateQuickstart,
  generateTasksPage,
  loadModulePresentations,
  selectRelatedModules,
  updateModuleNavigateBlocks,
  type ModulePresentation,
} from "./navigation.js";

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

  // Load config ONCE so the init indexer and the private `buildPlan`
  // path see the same configured `ignores` and split thresholds.
  // `runBatch` (called below when `opts.batch`) is a SEPARATE entry
  // point — it loads the same on-disk config itself, so there is no
  // risk of init and batch disagreeing on the configured value. The
  // ledger does not consume ignores (it walks the wiki pages, not
  // the source tree). loadConfig throws on malformed JSON — that is
  // intentional (T0 fail-closed: do not silently apply defaults).
  const rawConfig = await loadConfig(absRoot);
  const extraIgnores = resolveExtraIgnores(rawConfig);

  // 1. Indexa o repo (sempre — é a fonte do plano e dos diagramas)
  await runIndexer(absRoot, {
    ...(extraIgnores.length > 0 ? { extraIgnores } : {}),
    ...(opts.quiet ? { quiet: true } : {}),
  });
  await runLedger(absRoot, { ...(opts.quiet ? { quiet: true } : {}) });

  // 2. Carrega símbolos + módulos heurísticos
  const {
    symbols,
    pathRoleConfig,
    filePaths,
    modules,
    edges,
    ordered,
    totalSymbols,
    totalFiles,
  } = await buildPlan(absRoot, rawConfig);

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

  // Human navigation is assembled only from the index and existing page metadata.
  const presentations = await loadModulePresentations(absRoot, modules);
  const quickstart = generateQuickstart({
    totalFiles,
    totalSymbols,
    moduleCount: modules.length,
  });
  await safeIo.writeText(absRoot, "livewiki/quickstart.md", quickstart);
  filesWritten.push("livewiki/quickstart.md");

  const tasks = generateTasksPage({
    modules,
    ordered,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  await safeIo.writeText(absRoot, "livewiki/tasks.md", tasks);
  filesWritten.push("livewiki/tasks.md");

  const overview = await generateArchitectureOverview({
    absRoot,
    modules,
    ordered,
    totalSymbols,
    totalFiles,
    edges,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  await safeIo.writeText(absRoot, "livewiki/architecture/overview.md", overview);
  filesWritten.push("livewiki/architecture/overview.md");

  const navigationPages = await updateModuleNavigateBlocks({
    repoRoot: absRoot,
    modules,
    ordered,
    edges,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  filesWritten.push(...navigationPages);

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
      // Não re-cria index (já rodou acima). The batch loads
      // `.livewiki/config.json` itself (T0 fail-closed) and forwards
      // `config.ignores` to its own stage-1 indexer. We do NOT pass
      // `extraIgnores` from init — there is no programmatic override;
      // the configured value is the single source of truth.
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

async function buildPlan(
  absRoot: string,
  rawConfig: LivewikiConfig,
): Promise<{
  symbols: SymbolRow[];
  filePaths: string[];
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
  pathRoleConfig?: PathRoleConfig;
}> {
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const symbols = db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[];
    // Planning inventory: the set of active indexed files
    // (`files.status = 'active'`) is the single source of truth. The
    // indexer always inserts an `active` files row before any of its
    // symbols, so every active symbol is guaranteed to point at a file
    // that is present in this set. This includes re-export-only barrels
    // and any other active file with zero extracted symbols (they appear
    // here with symbolCount=0). Deleted file rows are excluded.
    const activeFileRows = db
      .prepare("SELECT path FROM files WHERE status = 'active'")
      .all() as Array<{ path: string }>;
    const filePaths = [...new Set(activeFileRows.map((row) => row.path))].sort();
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
    // Unique first, then split oversized, then unique again (see batch.ts).
    // Prefer config thresholds when present so init --plan matches batch.
    // The config is loaded ONCE in `runInit` and forwarded here — we do
    // NOT re-load from disk. applyDefaults fills in only the unset
    // thresholds; a malformed JSON error already raised in runInit
    // (T0 fail-closed) so we never silently swallow config errors here.
    const splitOpts: Parameters<typeof splitOversizedModules>[1] = {
      symbolCountByPath,
    };
    const cfg = applyDefaults(rawConfig);
    if (cfg.maxModuleFiles !== undefined) {
      splitOpts!.maxFiles = cfg.maxModuleFiles;
    }
    if (cfg.maxModuleSymbols !== undefined) {
      splitOpts!.maxSymbols = cfg.maxModuleSymbols;
    }
    let modules = makeUniqueDeterministicIds(heuristicModules);
    modules = splitOversizedModules(modules, splitOpts);
    // Partition vs original indexed inventory (same contract as batch).
    assertExactPathPartition(modules, filePaths);
    modules = makeUniqueDeterministicIds(modules);
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
    const ordered = prioritizeModules(modules, edges, cfg.pathRoles);

    return {
      symbols,
      filePaths,
      modules,
      edges,
      ordered,
      totalSymbols: symbols.length,
      totalFiles: filePaths.length,
      ...(cfg.pathRoles !== undefined ? { pathRoleConfig: cfg.pathRoles } : {}),
    };
  } finally {
    db.close();
  }
}

/**
 * Regenerates every deterministic navigation surface from the current index
 * and accepted page metadata. The historical function name is retained for
 * the batch hook. No LLM client or network path is involved.
 */
export async function regenerateArchitectureOverview(repoRoot: string): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  // Load the config inside this hook too — the batch.ts caller does not
  // pass it through. The single-read call from `runInit` is still
  // private to that path; the public hook is its own entry point and
  // must not depend on the caller.
  const rawConfig = await loadConfig(absRoot);
  const { modules, edges, ordered, totalSymbols, totalFiles, pathRoleConfig } = await buildPlan(absRoot, rawConfig);
  const presentations = await loadModulePresentations(absRoot, modules);
  await safeIo.writeText(absRoot, "livewiki/quickstart.md", generateQuickstart({
    totalFiles,
    totalSymbols,
    moduleCount: modules.length,
  }));
  await safeIo.writeText(absRoot, "livewiki/tasks.md", generateTasksPage({
    modules,
    ordered,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  }));
  const overview = await generateArchitectureOverview({
    absRoot,
    modules,
    ordered,
    totalSymbols,
    totalFiles,
    edges,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  await safeIo.writeText(absRoot, "livewiki/architecture/overview.md", overview);
  await updateModuleNavigateBlocks({
    repoRoot: absRoot,
    modules,
    ordered,
    edges,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });

  // Direct `batch` writes its manifest before this regeneration hook. Refresh
  // the snapshot after navigation changes while retaining batch handoff state.
  const manifest = await readManifest(absRoot);
  if (manifest) {
    await writeManifestIfChanged(absRoot, buildManifest({
      lastDocumentedCommit: manifest.lastDocumentedCommit,
      snapshotHash: await computeSnapshotHash(absRoot),
      pendingBatch: manifest.pendingBatch,
    }));
  }
}

async function generateArchitectureOverview(opts: {
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
  edges: Array<{ from: string; to: string }>;
  presentations: Map<string, ModulePresentation>;
  pathRoleConfig?: PathRoleConfig;
}): Promise<string> {
  const {
    absRoot,
    modules,
    ordered,
    totalSymbols,
    totalFiles,
    edges,
    presentations,
    pathRoleConfig,
  } = opts;

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
  lines.push("Diagrams in this section are deterministic (regenerated by `livewiki init`); " +
    "the module pages they link to are written by the batch (`livewiki init --batch`) or " +
    "manually.");
  lines.push("");
  lines.push(
    "Modules are grouped by repository role and ordered by prioritization " +
      "within each group. Each module links to artifacts that exist on disk.",
  );
  lines.push("");
  const roleSections: Array<{
    role: ReturnType<typeof classifyModuleRole>;
    heading: string;
  }> = [
    { role: "product", heading: "Product modules" },
    { role: "fixture", heading: "Test fixtures" },
    { role: "tooling", heading: "Tooling and benchmarks" },
    { role: "docs", heading: "Documentation modules" },
  ];
  for (const section of roleSections) {
    const sectionModules = ordered.filter(
      (module) => classifyModuleRole(module, pathRoleConfig) === section.role,
    );
    if (sectionModules.length === 0) continue;
    lines.push(`## ${section.heading}`);
    lines.push("");
    for (const m of sectionModules) {
      const presentation = presentations.get(m.id)!;
      const classDiagramPath = `../diagrams/${moduleSlug(m.id)}.classes.mmd`;
      const classDiagramExists = await safeIo.exists(
        absRoot,
        `livewiki/diagrams/${moduleSlug(m.id)}.classes.mmd`,
      ).catch(() => false);
      const related = selectRelatedModules({
        moduleId: m.id,
        modules,
        edges,
        ordered,
        ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
        limit: Number.MAX_SAFE_INTEGER,
      });
      const dependencies = related.filter((item) => item.direction === "dependency" || item.direction === "both");
      const dependents = related.filter((item) => item.direction === "dependent" || item.direction === "both");

      lines.push(`<a id="${escapeHtmlId(m.id)}"></a>`, "", `### ${presentation.displayTitle}`, "");
      lines.push(`Module ID: \`${m.id}\``);
      lines.push("");
      lines.push(`**${m.symbolCount}** symbols across **${m.paths.length}** files`);
      lines.push("");
      lines.push("Representative paths:");
      lines.push("");
      for (const path of [...m.paths].sort().slice(0, 3)) lines.push(`- \`${path}\``);
      lines.push("");
      const artifactLinks: string[] = [];
      if (presentation.pageExists) artifactLinks.push(`[module page](../${m.id}.md)`);
      if (classDiagramExists) artifactLinks.push(`[class diagram](${classDiagramPath})`);
      if (artifactLinks.length > 0) lines.push(`Available artifacts: ${artifactLinks.join(" · ")}`, "");
      lines.push(`Dependencies: ${formatNeighbors(dependencies, presentations)}`, "");
      lines.push(`Dependents: ${formatNeighbors(dependents, presentations)}`, "");
    }
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
  lines.push("---");
  lines.push("");
  lines.push("Generated by `livewiki init`. Refresh with `livewiki index` + manual edits, " +
    "or run `livewiki init --batch` to generate per-module documentation.");
  lines.push("");
  return lines.join("\n");
}

function formatNeighbors(
  related: Array<{ moduleId: string }>,
  presentations: Map<string, ModulePresentation>,
): string {
  if (related.length === 0) return "none";
  return related.map((item) => {
    const presentation = presentations.get(item.moduleId)!;
    return presentation.pageExists
      ? `[${presentation.displayTitle}](../${item.moduleId}.md)`
      : `${presentation.displayTitle} (page unavailable)`;
  }).join(", ");
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
