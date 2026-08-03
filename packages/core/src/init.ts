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

import * as nodeFs from "node:fs/promises";
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
import { parseFrontmatter } from "./frontmatter.js";
import type { FlowCandidate } from "./flows.js";
import type { TopicCandidate } from "./topics.js";
import {
  loadEffectiveTsconfig,
  loadGoModulePath,
  loadRustCrateName,
  loadWorkspacePackages,
  resolveImportEdges,
} from "./import-resolution.js";
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
  loadFlowPresentations,
  loadModulePresentations,
  loadModuleDigests,
  loadTopicPresentations,
  selectRelatedModules,
  syncAuxiliaryIndexHub,
  syncFlowsIndexHub,
  syncTopicsIndexHub,
  updateFlowTopicLinks,
  updateModuleNavigateBlocks,
  type AuxiliaryHubSyncResult,
  type FlowsHubSyncResult,
  type TopicsHubSyncResult,
  type ModulePresentation,
} from "./navigation.js";
import { extractRepoOrientation } from "./orientation.js";
import { loadUnderstandingSynthesis } from "./understanding.js";

export interface InitOptions {
  repoRoot: string;
  /** --batch: dispara o pipeline LLM completo depois do init base */
  batch?: boolean;
  /** --plan: mostra plano de módulos e sai (sem LLM, sem escrita) */
  plan?: boolean;
  /** --no-refine: pula refinamento LLM da etapa 2 (só com --batch) */
  noRefine?: boolean;
  /**
   * Roadmap item 7: stage-4 module-task worker pool size forwarded to
   * `runBatch` (only with --batch). Integer 1..16; default 1 = sequential.
   */
  batchConcurrency?: number;
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
  /**
   * R10.1 C: the stage-5 flows hub was preserved because of ownership
   * (human/mixed or unparseable). Never a silent skip — reported here and
   * in the CLI output, never persisted for status queries.
   */
  skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null };
  /** R11-NAV: the auxiliary hub was preserved because automation does not own it. */
  skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null };
  /** R11-A: the concept hub was preserved because automation does not own it. */
  skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null };
  /**
   * R10.1 K: flow candidates skipped deterministically before any LLM
   * call during --batch (K-a/K-b). Never silent — reported here and in
   * the CLI output, never persisted for status queries.
   */
  skippedFlowCandidates?: Array<{ slug: string; code: string; message: string }>;
  /**
   * Priority-0 fix (v25 paid E2E): the topic planner exhausted every repair
   * attempt without a valid closed plan — a content-quality ceiling, not an
   * operational failure. Never a silent skip — reported here and in the
   * CLI output, never persisted for status queries.
   */
  skippedTopicPlan?: { reason: string; retryCommand: string };
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
  let skippedFlowsHub: InitResult["skippedFlowsHub"];
  let skippedAuxiliaryHub: InitResult["skippedAuxiliaryHub"];
  let skippedTopicsHub: InitResult["skippedTopicsHub"];
  let skippedFlowCandidates: InitResult["skippedFlowCandidates"];
  let skippedTopicPlan: InitResult["skippedTopicPlan"];

  // structure.mmd (organograma de diretórios)
  const structureMmd = generateStructure(filePaths);
  await safeIo.writeText(absRoot, "livewiki/architecture/structure.mmd", structureMmd);
  filesWritten.push("livewiki/architecture/structure.mmd");

  // modules.mmd (grafo de imports entre módulos)
  const modulesMmd = generateModulesGraph(edges);
  await safeIo.writeText(absRoot, "livewiki/architecture/modules.mmd", modulesMmd);
  filesWritten.push("livewiki/architecture/modules.mmd");

  // diagrams/<slug>.classes.mmd — one per module with classes. Synchronizing
  // the whole deterministic surface also removes files left behind by an older
  // module plan (for example `src.classes.mmd` after IDs become `core-src-*`).
  const classDiagrams = await syncClassDiagrams(absRoot, modules, symbols);
  filesWritten.push(...classDiagrams.written);

  // Human navigation is assembled only from the index and existing page metadata.
  const presentations = await loadModulePresentations(absRoot, modules);
  // Stage-5 surface: keep the flows hub consistent with the flow pages
  // on disk so a plain init neither points at a stale hub nor drops a
  // live one.
  const flowPresentations = await loadFlowPresentations(absRoot);
  const flowsHub = await syncFlowsIndexHub(absRoot, flowPresentations);
  if (flowsHub.outcome === "written") filesWritten.push("livewiki/flows/index.md");
  // R10.1 C: a human/mixed/unparseable hub is preserved — never a silent skip.
  if (flowsHub.outcome === "skipped-owner") {
    skippedFlowsHub = { path: flowsHub.path!, owner: flowsHub.owner ?? null };
  }
  const topicPresentations = await loadTopicPresentations(absRoot);
  const topicsHub = await syncTopicsIndexHub(absRoot, topicPresentations);
  if (topicsHub.outcome === "written") filesWritten.push("livewiki/topics/index.md");
  if (topicsHub.outcome === "skipped-owner") {
    skippedTopicsHub = { path: topicsHub.path!, owner: topicsHub.owner ?? null };
  }
  const auxiliaryHub = await syncAuxiliaryIndexHub({
    repoRoot: absRoot,
    modules,
    ordered,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  if (auxiliaryHub.outcome === "written") filesWritten.push("livewiki/auxiliary/index.md");
  if (auxiliaryHub.outcome === "skipped-owner") {
    skippedAuxiliaryHub = { path: auxiliaryHub.path!, owner: auxiliaryHub.owner ?? null };
  }
  // D1.5: the reader digest is computed here too (not only at the batch-end
  // hook). On a first init no module pages exist, so loadModuleDigests
  // returns [] and the block is omitted; on a re-init after a batch the
  // digest is regenerated identically, keeping init idempotent (manifest
  // snapshotHash byte-stable, anti-loop CI rule).
  const moduleDigests = await loadModuleDigests(absRoot, ordered, presentations, pathRoleConfig);
  const quickstart = generateQuickstart({
    totalFiles,
    totalSymbols,
    moduleCount: modules.length,
    flowPresentations,
    topicPresentations,
    hasAuxiliary: modules.some((module) => classifyModuleRole(module, pathRoleConfig) !== "product"),
    orientation: await extractRepoOrientation(absRoot),
    moduleDigests,
    understanding: await loadUnderstandingSynthesis(absRoot),
  });
  await safeIo.writeText(absRoot, "livewiki/quickstart.md", quickstart);
  filesWritten.push("livewiki/quickstart.md");

  const tasks = generateTasksPage({
    modules,
    ordered,
    presentations,
    flowPresentations,
    topicPresentations,
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
    hasTopics: topicPresentations.size > 0,
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
    topicPresentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  filesWritten.push(...navigationPages);
  filesWritten.push(...await updateFlowTopicLinks(absRoot, topicPresentations));

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
      ...(opts.batchConcurrency !== undefined
        ? { concurrency: opts.batchConcurrency }
        : {}),
      // Não re-cria index (já rodou acima). The batch loads
      // `.livewiki/config.json` itself (T0 fail-closed) and forwards
      // `config.ignores` to its own stage-1 indexer. We do NOT pass
      // `extraIgnores` from init — there is no programmatic override;
      // the configured value is the single source of truth.
      skipManifestWrite: true, // init já escreveu; batch não regrava
    });
    // Priority-0 fix: `byModule.length`/`failures.length` mixed done+failed
    // entries across stages and disagreed with `batch status`'s own (also
    // wrong, stage-4-only) count. `result.tasksDone`/`tasksFailed` are the
    // authoritative per-task counters (`cb.done`/`cb.fails`), the same ones
    // `finalizeRun` persists to `batch_runs.summary_json`.
    batchSummary = {
      runId: result.runId,
      status: result.status,
      tasksDone: result.tasksDone,
      tasksFailed: result.tasksFailed,
    };
    // (O): propagar exit code do batch (antes fix: init --batch sempre
    // retornava 0, escondendo completed_with_failures/aborted).
    batchExitCode = statusToExitCode(result.status);
    // R10.1 C: a skipped flows hub in the batch regeneration is surfaced too.
    if (result.skippedFlowsHub) skippedFlowsHub = result.skippedFlowsHub;
    if (result.skippedAuxiliaryHub) skippedAuxiliaryHub = result.skippedAuxiliaryHub;
    if (result.skippedTopicsHub) skippedTopicsHub = result.skippedTopicsHub;
    if (result.skippedFlowCandidates) skippedFlowCandidates = result.skippedFlowCandidates;
    if (result.skippedTopicPlan) skippedTopicPlan = result.skippedTopicPlan;
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
    ...(skippedFlowsHub ? { skippedFlowsHub } : {}),
    ...(skippedAuxiliaryHub ? { skippedAuxiliaryHub } : {}),
    ...(skippedTopicsHub ? { skippedTopicsHub } : {}),
    ...(skippedFlowCandidates ? { skippedFlowCandidates } : {}),
    ...(skippedTopicPlan ? { skippedTopicPlan } : {}),
  };
}

export interface ClassDiagramSyncResult {
  written: string[];
  removed: string[];
}

/**
 * Synchronize the generated class-diagram surface with one complete module
 * plan. Files ending in `.classes.mmd` under `livewiki/diagrams/` are owned by
 * this deterministic generator; other files in that directory are preserved.
 */
export async function syncClassDiagrams(
  repoRoot: string,
  modules: Module[],
  symbols: SymbolRow[],
): Promise<ClassDiagramSyncResult> {
  const absRoot = nodePath.resolve(repoRoot);
  const directory = "livewiki/diagrams";
  await safeIo.mkdir(absRoot, directory);

  const desired = new Map<string, string>();
  for (const module of modules) {
    const diagram = generateClassDiagram(module, symbols);
    if (!diagram) continue;
    const relPath = `${directory}/${moduleSlug(module.id)}.classes.mmd`;
    desired.set(relPath, diagram);
  }

  const written: string[] = [];
  for (const [relPath, diagram] of desired) {
    await safeIo.writeText(absRoot, relPath, diagram);
    written.push(relPath);
  }

  const removed: string[] = [];
  const absDirectory = await safeIo.resolveAndValidate(absRoot, directory);
  const entries = await nodeFs.readdir(absDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".classes.mmd")) continue;
    const relPath = `${directory}/${entry.name}`;
    if (desired.has(relPath)) continue;
    await safeIo.remove(absRoot, relPath);
    removed.push(relPath);
  }

  return { written, removed };
}

export interface StaleFlowSyncResult {
  removed: string[];
}

/**
 * Stage 5 counterpart of syncClassDiagrams (SPEC §"Semantic product-flow
 * layer"): removes flow artifacts whose slug is no longer in the current
 * candidate set. Safety contract (same philosophy as the class-diagram
 * prefix ownership):
 *
 *   - A flow page is removed ONLY when its frontmatter parses and declares
 *     exactly `owner: generated`. Human, mixed, unparseable, or
 *     ownerless pages are preserved byte-for-byte.
 *   - A companion `flow-<slug>.mmd` diagram (no frontmatter of its own)
 *     is removed only when the companion page is absent or was itself
 *     removed above — the diagram of a preserved human/mixed page is
 *     never touched.
 *   - `flows/index.md` (the deterministic hub) and any non-matching
 *     file are never touched.
 */
export async function syncStaleFlowArtifacts(
  repoRoot: string,
  candidates: FlowCandidate[],
): Promise<StaleFlowSyncResult> {
  const absRoot = nodePath.resolve(repoRoot);
  const keep = new Set(candidates.map((candidate) => candidate.slug));
  const removed: string[] = [];

  const flowsDir = "livewiki/flows";
  const stalePageSlugs = new Set<string>();
  if (await safeIo.exists(absRoot, flowsDir).catch(() => false)) {
    const absFlows = await safeIo.resolveAndValidate(absRoot, flowsDir);
    for (const entry of await nodeFs.readdir(absFlows, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
      const slug = entry.name.slice(0, -".md".length);
      if (keep.has(slug)) continue;
      const relPath = `${flowsDir}/${entry.name}`;
      const content = await safeIo.readText(absRoot, relPath).catch(() => null);
      if (content === null || readFlowPageOwner(content) !== "generated") continue;
      await safeIo.remove(absRoot, relPath);
      stalePageSlugs.add(slug);
      removed.push(relPath);
    }
  }

  const diagramsDir = "livewiki/diagrams";
  if (await safeIo.exists(absRoot, diagramsDir).catch(() => false)) {
    const absDiagrams = await safeIo.resolveAndValidate(absRoot, diagramsDir);
    for (const entry of await nodeFs.readdir(absDiagrams, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith("flow-") || !entry.name.endsWith(".mmd")) continue;
      const slug = entry.name.slice("flow-".length, -".mmd".length);
      if (keep.has(slug)) continue;
      // Ownership proxy: the companion page. Remove the diagram only when
      // the page is absent or was removed above as owner: generated.
      if (!stalePageSlugs.has(slug)) {
        const pageContent = await safeIo
          .readText(absRoot, `${flowsDir}/${slug}.md`)
          .catch(() => null);
        if (pageContent !== null) continue;
      }
      await safeIo.remove(absRoot, `${diagramsDir}/${entry.name}`);
      removed.push(`${diagramsDir}/${entry.name}`);
    }
  }

  return { removed };
}

/** Removes stale generated topic pages while preserving human/mixed content. */
export async function syncStaleTopicArtifacts(
  repoRoot: string,
  candidates: ReadonlyArray<TopicCandidate>,
): Promise<string[]> {
  const absRoot = nodePath.resolve(repoRoot);
  const topicsDir = "livewiki/topics";
  const keep = new Set(candidates.map((candidate) => candidate.slug));
  const removed: string[] = [];
  if (!(await safeIo.exists(absRoot, topicsDir).catch(() => false))) return removed;
  const absTopics = await safeIo.resolveAndValidate(absRoot, topicsDir);
  for (const entry of await nodeFs.readdir(absTopics, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "index.md") continue;
    const slug = entry.name.slice(0, -".md".length);
    if (keep.has(slug)) continue;
    const relPath = `${topicsDir}/${entry.name}`;
    const content = await safeIo.readText(absRoot, relPath).catch(() => null);
    if (content === null || readFlowPageOwner(content) !== "generated") continue;
    await safeIo.remove(absRoot, relPath);
    removed.push(relPath);
  }
  return removed.sort();
}

/**
 * Frontmatter owner of a flow page for stale cleanup. Returns "generated"
 * ONLY for a parseable page declaring exactly `owner: generated`;
 * anything else (human, mixed, missing, invalid, unparseable) is "other"
 * and preserved. BOM- and CRLF-tolerant, same as the batch pre-owner gate.
 */
function readFlowPageOwner(content: string): "generated" | "other" {
  let s = content;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return "other";
  s = s.replace(/\r\n/g, "\n");
  try {
    const fm = parseFrontmatter(s).frontmatter;
    if (fm === null) return "other";
    return fm["owner"] === "generated" ? "generated" : "other";
  } catch {
    return "other";
  }
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
    // R10.1 (J): same one-resolver wiring as batch stage 3, so
    // init --plan and batch agree on module edges (relative AND
    // declared-workspace specifiers).
    const knownFiles = new Set(filePaths);
    const workspacePackages = await loadWorkspacePackages(absRoot);
    const resolvedImportEdges = resolveImportEdges({
      importsByFile,
      knownFiles,
      workspacePackages,
      tsconfig: await loadEffectiveTsconfig(absRoot, workspacePackages),
      goModulePath: await loadGoModulePath(absRoot),
      rustCrateName: await loadRustCrateName(absRoot),
    });
    const edges = resolveModuleEdges(modules, importsByFile, knownFiles, resolvedImportEdges);
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
 * the batch hook. No LLM client or network path is involved. Returns the
 * generated-hub sync outcomes so the caller can surface protected hubs that
 * were preserved instead of rewritten (R10.1 C / R11-NAV).
 */
export async function regenerateArchitectureOverview(
  repoRoot: string,
  opts: { acceptedTopicSlugs?: ReadonlySet<string> } = {},
): Promise<{ flowsHub: FlowsHubSyncResult; topicsHub: TopicsHubSyncResult; auxiliaryHub: AuxiliaryHubSyncResult }> {
  const absRoot = nodePath.resolve(repoRoot);
  // Load the config inside this hook too — the batch.ts caller does not
  // pass it through. The single-read call from `runInit` is still
  // private to that path; the public hook is its own entry point and
  // must not depend on the caller.
  const rawConfig = await loadConfig(absRoot);
  const { modules, edges, ordered, totalSymbols, totalFiles, pathRoleConfig } = await buildPlan(absRoot, rawConfig);
  const presentations = await loadModulePresentations(absRoot, modules);
  // Sync the stage-5 flows hub with the flow pages on disk before any
  // gated link (quickstart, overview) is regenerated.
  const flowPresentations = await loadFlowPresentations(absRoot);
  const flowsHub = await syncFlowsIndexHub(absRoot, flowPresentations);
  const topicPresentations = await loadTopicPresentations(absRoot, opts.acceptedTopicSlugs);
  const topicsHub = await syncTopicsIndexHub(absRoot, topicPresentations);
  const auxiliaryHub = await syncAuxiliaryIndexHub({
    repoRoot: absRoot,
    modules,
    ordered,
    presentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  // D1.5: at the batch-end regeneration the accepted module pages exist, so
  // the quickstart also carries the reader digest (top product modules with
  // their opening responsibility sentences) and, when no README purpose was
  // found, a synthesized purpose from those digests.
  const moduleDigests = await loadModuleDigests(absRoot, ordered, presentations, pathRoleConfig);
  await safeIo.writeText(absRoot, "livewiki/quickstart.md", generateQuickstart({
    totalFiles,
    totalSymbols,
    moduleCount: modules.length,
    flowPresentations,
    topicPresentations,
    hasAuxiliary: modules.some((module) => classifyModuleRole(module, pathRoleConfig) !== "product"),
    orientation: await extractRepoOrientation(absRoot),
    moduleDigests,
    understanding: await loadUnderstandingSynthesis(absRoot),
  }));
  await safeIo.writeText(absRoot, "livewiki/tasks.md", generateTasksPage({
    modules,
    ordered,
    presentations,
    flowPresentations,
    topicPresentations,
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
    hasTopics: topicPresentations.size > 0,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  await safeIo.writeText(absRoot, "livewiki/architecture/overview.md", overview);
  await updateModuleNavigateBlocks({
    repoRoot: absRoot,
    modules,
    ordered,
    edges,
    presentations,
    topicPresentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  await updateFlowTopicLinks(absRoot, topicPresentations);

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
  return { flowsHub, topicsHub, auxiliaryHub };
}

async function generateArchitectureOverview(opts: {
  absRoot: string;
  modules: Module[];
  ordered: Module[];
  totalSymbols: number;
  totalFiles: number;
  edges: Array<{ from: string; to: string }>;
  presentations: Map<string, ModulePresentation>;
  hasTopics: boolean;
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
    hasTopics,
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
    "Product modules are ordered by prioritization and link only to artifacts " +
      "that exist on disk. Auxiliary modules are kept in a separate inventory.",
  );
  lines.push("");
  if (hasTopics && await safeIo.exists(absRoot, "livewiki/topics/index.md").catch(() => false)) {
    lines.push("## Concept topics");
    lines.push("");
    lines.push("Behavioral contracts spanning implementation modules: [Concept topics](../topics/index.md)");
    lines.push("");
  }
  // Existence-gated link to the stage-5 flows hub (same discipline as
  // the per-module artifact links below): emitted only when
  // flows/index.md is present on disk.
  if (await safeIo.exists(absRoot, "livewiki/flows/index.md").catch(() => false)) {
    lines.push("## Flows");
    lines.push("");
    lines.push("End-to-end behavior across modules: [How it works](../flows/index.md)");
    lines.push("");
  }
  const productModules = ordered.filter(
    (module) => classifyModuleRole(module, pathRoleConfig) === "product",
  );
  if (productModules.length > 0) {
    lines.push("## Product modules");
    lines.push("");
    for (const m of productModules) {
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
  const auxiliaryCount = modules.length - productModules.length;
  if (
    auxiliaryCount > 0 &&
    await safeIo.exists(absRoot, "livewiki/auxiliary/index.md").catch(() => false)
  ) {
    lines.push("## Auxiliary modules");
    lines.push("");
    lines.push(
      `This repository has **${auxiliaryCount} auxiliary modules** for tests, fixtures, ` +
        "tooling, benchmarks, or repository documentation. " +
        "Open the complete [Auxiliary modules](../auxiliary/index.md) inventory.",
    );
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
