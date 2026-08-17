/**
 * init — the real `livewiki init` (Phase 3).
 *
 * SPEC §"CLI commands" (Phase 3): "creates livewiki/ + .livewiki/, indexes the
 * repo, generates a minimal quickstart.md + structure.mmd (no LLM). With
 * --batch it fires the full documentation pipeline".
 *
 * Behavior:
 *   - init (no flags): indexes + generates the deterministic layout (no LLM)
 *     - livewiki/quickstart.md (low-token entry point)
 *     - livewiki/architecture/structure.mmd (directory org chart)
 *     - livewiki/architecture/modules.mmd (import graph)
 *     - livewiki/diagrams/<slug>.classes.mmd (1 per module with classes)
 *     - livewiki/.manifest.json (snapshot hash)
 *   - init --plan: shows the module plan (deterministic heuristic, WITHOUT
 *     consuming tokens). Generates no files — report only.
 *   - init --batch: after the base init, fires the LLM batch (4 steps)
 *   - init --batch --no-refine: skips the step-2 LLM refinement
 *     (fix #5 — refinement is opt-in/degradable)
 *
 * init --plan NEVER requires LLM config (fix #5). init without --batch
 * does not either. init --batch only requires it if it will call the LLM.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { ensureGitignoreEntries } from "./gitignore.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import {
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  assertExactPathPartition,
  assertUniqueModuleIds,
  classifyModuleRole,
  type PathRoleConfig,
  type Module,
} from "./modules.js";
import { planPageUnits } from "./page-units.js";
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
  refreshArtifactReceiptHashes,
  writeManifestState,
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
import {
  emptyBaseline,
  readBaseline,
  writeBaselineCompareAndSwap,
} from "./baseline.js";

export interface InitOptions {
  repoRoot: string;
  /** --batch: fires the full LLM pipeline after the base init */
  batch?: boolean;
  /** --plan: shows the module plan and exits (no LLM, no writes) */
  plan?: boolean;
  /** --no-refine: skips the step-2 LLM refinement (only with --batch) */
  noRefine?: boolean;
  /**
   * Roadmap item 7: stage-4 module-task worker pool size forwarded to
   * `runBatch` (only with --batch). Integer 1..16; default 1 = sequential.
   */
  batchConcurrency?: number;
  /** Language of the plan/report (default: config.language || "en") */
  language?: string;
  /** Quiet mode (suppresses info notes) */
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
  /** Files created/updated */
  filesWritten: string[];
  /** With --plan, the report (no writes) */
  plan?: InitPlanReport;
  /** With --batch, the batch run summary */
  batchSummary?: {
    runId: number;
    status: string;
    tasksDone: number;
    tasksFailed: number;
  };
  /**
   * POSIX exit code to be propagated by the CLI when --batch finishes.
   *   0 = completed
   *   1 = completed_with_failures
   *   2 = aborted
   * Absent (without --batch or --plan) → the CLI uses exit 0 (init success).
   * Computation delegated to core/batch.ts:statusToExitCode — single source of truth.
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
 * Main entry point.
 */
export async function runInit(opts: InitOptions): Promise<InitResult> {
  const absRoot = nodePath.resolve(opts.repoRoot);
  const wikiExistedBeforeInit = await nodeFs.stat(nodePath.join(absRoot, "livewiki"))
    .then((stat) => stat.isDirectory(), () => false);

  // Ensure .livewiki/ and livewiki/ exist (safe-io)
  await safeIo.mkdir(absRoot, ".livewiki");
  await safeIo.mkdir(absRoot, "livewiki");
  await safeIo.mkdir(absRoot, "livewiki/architecture");
  await safeIo.mkdir(absRoot, "livewiki/diagrams");

  // (R) Ensure `.livewiki/` is in the target repo's `.gitignore` (rule #3:
  // the DB is derived, gitignored, never travels in git). Idempotent —
  // re-init is a no-op if it already contains it.
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

  // 1. Index the repo (always — it is the source of the plan and the diagrams)
  await runIndexer(absRoot, {
    ...(extraIgnores.length > 0 ? { extraIgnores } : {}),
    ...(opts.quiet ? { quiet: true } : {}),
  });
  await runLedger(absRoot, { ...(opts.quiet ? { quiet: true } : {}) });

  // 2. Load symbols + heuristic modules
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

  // 3. --plan: report and exit (no writes, no LLM)
  if (opts.plan) {
    return {
      filesWritten: [],
      plan: { modules, edges, ordered, totalSymbols, totalFiles },
    };
  }

  // 4. Generate the deterministic layout
  const filesWritten: string[] = [];
  if (!wikiExistedBeforeInit && (await readBaseline(absRoot)).state === "unavailable") {
    await writeBaselineCompareAndSwap(absRoot, null, emptyBaseline());
    filesWritten.push("livewiki/.baseline.json");
  }
  let skippedFlowsHub: InitResult["skippedFlowsHub"];
  let skippedAuxiliaryHub: InitResult["skippedAuxiliaryHub"];
  let skippedTopicsHub: InitResult["skippedTopicsHub"];
  let skippedFlowCandidates: InitResult["skippedFlowCandidates"];
  let skippedTopicPlan: InitResult["skippedTopicPlan"];

  // structure.mmd (directory org chart)
  const structureMmd = generateStructure(filePaths);
  await safeIo.writeText(absRoot, "livewiki/architecture/structure.mmd", structureMmd);
  filesWritten.push("livewiki/architecture/structure.mmd");

  // modules.mmd (import graph between modules)
  const modulesMmd = generateModulesGraph(edges);
  await safeIo.writeText(absRoot, "livewiki/architecture/modules.mmd", modulesMmd);
  filesWritten.push("livewiki/architecture/modules.mmd");

  // diagrams/<slug>.classes.mmd — one per module with classes. Synchronizing
  // the whole deterministic surface also removes files left behind by an older
  // module plan (for example `src.classes.mmd` after IDs become `core-src-*`).
  const classDiagrams = await syncClassDiagrams(absRoot, modules, symbols);
  filesWritten.push(...classDiagrams.written);

  // Human navigation is assembled only from the index and existing page metadata.
  const presentations = await loadModulePresentations(absRoot, modules, pathRoleConfig);
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
  const changedFlowPages = await updateFlowTopicLinks(absRoot, topicPresentations);
  filesWritten.push(...changedFlowPages);
  await refreshArtifactReceiptHashes(absRoot, [
    ...navigationPages,
    ...changedFlowPages,
  ]);

  // manifest.json (snapshotHash + pendingBatch=null for init without batch)
  const snapshotHash = await computeSnapshotHash(absRoot);
  // FIX M (rev2): only list the manifest in filesWritten if it was REALLY
  // rewritten. `writeManifestIfChanged` is idempotent (anti-loop CI) —
  // if nothing changed it returns false and we must not pretend it wrote.
  const wroteManifest = await writeManifestState(
    absRoot,
    {
      lastDocumentedCommit: null,
      snapshotHash,
      pendingBatch: null,
    },
  );
  if (wroteManifest) filesWritten.push("livewiki/.manifest.json");

  // 5. --batch: fires the LLM pipeline (delegated to batch.ts)
  let batchSummary: InitResult["batchSummary"];
  let batchExitCode: InitResult["batchExitCode"];
  if (opts.batch) {
    // Dynamic import avoids a cycle if batch.ts imports init.ts
    const { runBatch, statusToExitCode } = await import("./batch.js");
    const result = await runBatch({
      repoRoot: absRoot,
      ...(opts.noRefine ? { noRefine: true } : {}),
      ...(opts.language ? { language: opts.language } : {}),
      ...(opts.batchConcurrency !== undefined
        ? { concurrency: opts.batchConcurrency }
        : {}),
      // Does not re-create the index (already ran above). The batch loads
      // `.livewiki/config.json` itself (T0 fail-closed) and forwards
      // `config.ignores` to its own stage-1 indexer. We do NOT pass
      // `extraIgnores` from init — there is no programmatic override;
      // the configured value is the single source of truth.
      skipManifestWrite: true, // init already wrote it; batch does not rewrite
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
    // (O): propagate the batch exit code (before the fix: init --batch always
    // returned 0, hiding completed_with_failures/aborted).
    batchExitCode = statusToExitCode(result.status);
    // R10.1 C: a skipped flows hub in the batch regeneration is surfaced too.
    if (result.skippedFlowsHub) skippedFlowsHub = result.skippedFlowsHub;
    if (result.skippedAuxiliaryHub) skippedAuxiliaryHub = result.skippedAuxiliaryHub;
    if (result.skippedTopicsHub) skippedTopicsHub = result.skippedTopicsHub;
    if (result.skippedFlowCandidates) skippedFlowCandidates = result.skippedFlowCandidates;
    if (result.skippedTopicPlan) skippedTopicPlan = result.skippedTopicPlan;
    // Update the manifest with pendingBatch if there were failures (handoff)
    if (result.status === "completed_with_failures" || result.status === "aborted") {
      const totalsDone = result.byModule.reduce((a, m) => a + (m.costUsd !== null ? 1 : 0), 0);
      await writeManifestState(
        absRoot,
        {
          lastDocumentedCommit: null,
          snapshotHash: await computeSnapshotHash(absRoot),
          pendingBatch: { runId: result.runId, stage: 4, done: totalsDone, total: ordered.length },
        },
      );
    } else {
      // Run completed without failures — clear pendingBatch from the manifest
      await writeManifestState(
        absRoot,
        {
          lastDocumentedCommit: null,
          snapshotHash: await computeSnapshotHash(absRoot),
          pendingBatch: null,
        },
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

export interface StaleModulePageSyncResult {
  removed: string[];
}

/** Deterministic root-level pages that are never module pages. */
const DETERMINISTIC_ROOT_PAGES = new Set(["quickstart.md", "tasks.md", "understanding.md"]);

/** Reserved livewiki/ hubs with their own stale-sync machinery. */
const RESERVED_WIKI_HUBS = new Set([
  "topics",
  "flows",
  "architecture",
  "diagrams",
  "auxiliary",
]);

/**
 * #29 (2026-08-08): removes generated page-unit pages whose unit is no
 * longer in the current plan — the migration path for partition changes.
 * The keep-set is built from RESOLVED PAGE PATHS (never from module ids —
 * the pre-#29 `${module.id}.md` keep-set would have deleted the whole wiki
 * the moment page paths stopped being module ids, and the pages are
 * `owner: generated`, so the ownership guard would not have saved them).
 *
 * Scope: file/folder unit pages only — `livewiki/<folder>/index.md`,
 * `livewiki/<folder>/<file>.md`, and legacy root-level module pages
 * (`livewiki/<id>.md`, stale by definition under #29). Deterministic root
 * pages and the reserved hubs (topics/, flows/, architecture/, diagrams/,
 * auxiliary/) are out of scope and never touched. Same ownership contract
 * as syncStaleFlowArtifacts: a page is removed ONLY when its frontmatter
 * parses and declares exactly `owner: generated`; human, mixed,
 * unparseable, or ownerless pages are preserved byte-for-byte.
 *
 * Callers must pass the run's EFFECTIVE keep-set and must NOT call this
 * from a plain init or an `--only` run: those derive a plan that may
 * differ from a previously accepted one and would make valid pages look
 * stale.
 */
export async function syncStaleModulePages(
  repoRoot: string,
  keepPagePaths: ReadonlySet<string>,
): Promise<StaleModulePageSyncResult> {
  const absRoot = nodePath.resolve(repoRoot);
  const removed: string[] = [];
  const wikiDir = "livewiki";
  const absWiki = await safeIo.resolveAndValidate(absRoot, wikiDir);

  const walk = async (relDir: string): Promise<void> => {
    const absDir = relDir === "" ? absWiki : nodePath.join(absWiki, relDir);
    let entries;
    try {
      entries = await nodeFs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (RESERVED_WIKI_HUBS.has(entry.name)) continue;
        await walk(rel);
        // Remove the directory when every page inside was removed (or it
        // was already empty) — a stale folder shell must not survive.
        try {
          const rest = await nodeFs.readdir(nodePath.join(absWiki, rel));
          if (rest.length === 0) await nodeFs.rmdir(nodePath.join(absWiki, rel));
        } catch {
          // best-effort
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (relDir === "" && DETERMINISTIC_ROOT_PAGES.has(entry.name)) continue;
      const relPath = `${wikiDir}/${rel}`;
      if (keepPagePaths.has(relPath)) continue;
      const content = await safeIo.readText(absRoot, relPath).catch(() => null);
      if (content === null || readFlowPageOwner(content) !== "generated") continue;
      await safeIo.remove(absRoot, relPath);
      removed.push(relPath);
    }
  };
  await walk("");
  return { removed: removed.sort() };
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
    // #29: real page units — one folder module per real directory (the
    // analysis surface), unique by construction from the planner. There is
    // no size-based split anymore (chunking is a generation concern, D2)
    // and no LLM refine (real units are not refinable).
    const cfg = applyDefaults(rawConfig);
    const sizeRows = db
      .prepare("SELECT path, size FROM files WHERE status = 'active'")
      .all() as Array<{ path: string; size: number }>;
    const sizeByPath = new Map(sizeRows.map((r) => [r.path, r.size]));
    const pageUnitsPlan = planPageUnits(
      { filePaths, symbolCountByPath, sizeByPath },
      {
        ...(rawConfig.pathRoles !== undefined ? { pathRoles: rawConfig.pathRoles } : {}),
        ...(cfg.fileSplitSourceBytes !== undefined
          ? { fileSplitSourceBytes: cfg.fileSplitSourceBytes }
          : {}),
      },
    );
    let modules: Module[] = pageUnitsPlan.folderUnits.map((folder) => ({
      id: folder.id,
      paths: folder.entries.map((e) => e.filePath),
      symbolCount: folder.entries.reduce(
        (acc, e) => acc + (symbolCountByPath.get(e.filePath) ?? 0),
        0,
      ),
    }));
    // Partition vs original indexed inventory (same contract as batch).
    modules = makeUniqueDeterministicIds(modules);
    assertExactPathPartition(modules, filePaths);
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
  const presentations = await loadModulePresentations(absRoot, modules, pathRoleConfig);
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
  const changedModulePages = await updateModuleNavigateBlocks({
    repoRoot: absRoot,
    modules,
    ordered,
    edges,
    presentations,
    topicPresentations,
    ...(pathRoleConfig !== undefined ? { pathRoleConfig } : {}),
  });
  const changedFlowPages = await updateFlowTopicLinks(absRoot, topicPresentations);
  await refreshArtifactReceiptHashes(absRoot, [
    ...changedModulePages,
    ...changedFlowPages,
  ]);

  // Direct `batch` writes its manifest before this regeneration hook. Refresh
  // the snapshot after navigation changes while retaining batch handoff state.
  const manifest = await readManifest(absRoot);
  if (manifest) {
    await writeManifestState(absRoot, {
      lastDocumentedCommit: manifest.lastDocumentedCommit,
      snapshotHash: await computeSnapshotHash(absRoot),
      pendingBatch: manifest.pendingBatch,
    });
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
    `This repository has **${totalFiles} ${totalFiles === 1 ? "file" : "files"}** documented and ` +
      `**${totalSymbols} code ${totalSymbols === 1 ? "symbol" : "symbols"}** indexed, organized into ` +
      `**${modules.length} ${modules.length === 1 ? "folder" : "folders"}** with ` +
      `**${edges.length} documented ${edges.length === 1 ? "dependency" : "dependencies"}** between them.`,
  );
  lines.push("");
  lines.push("The diagrams below are rebuilt by `livewiki init`; the folder pages they link to " +
    "are written by `livewiki init --batch` or by hand.");
  lines.push("");
  lines.push(
    "Folders are listed most-important first and link only to pages that exist. " +
      "Tests and tooling live in a separate inventory.",
  );
  lines.push("");
  if (hasTopics && await safeIo.exists(absRoot, "livewiki/topics/index.md").catch(() => false)) {
    lines.push("## Concept topics");
    lines.push("");
    lines.push("How the product behaves across the code: [Concept topics](../topics/index.md)");
    lines.push("");
  }
  // Existence-gated link to the stage-5 flows hub (same discipline as
  // the per-module artifact links below): emitted only when
  // flows/index.md is present on disk.
  if (await safeIo.exists(absRoot, "livewiki/flows/index.md").catch(() => false)) {
    lines.push("## Flows");
    lines.push("");
    lines.push("End-to-end behavior across the codebase: [How it works](../flows/index.md)");
    lines.push("");
  }
  const productModules = ordered.filter(
    (module) => classifyModuleRole(module, pathRoleConfig) === "product",
  );
  if (productModules.length > 0) {
    lines.push("## Product folders");
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
      lines.push(`**${m.paths.length}** ${m.paths.length === 1 ? "file" : "files"}, **${m.symbolCount}** documented code ${m.symbolCount === 1 ? "symbol" : "symbols"}`);
      lines.push("");
      lines.push("Representative paths:");
      lines.push("");
      for (const path of [...m.paths].sort().slice(0, 3)) lines.push(`- \`${path}\``);
      lines.push("");
      const artifactLinks: string[] = [];
      if (presentation.pageExists) artifactLinks.push(`[folder page](../${m.id}/index.md)`);
      if (classDiagramExists) artifactLinks.push(`[class diagram](${classDiagramPath})`);
      if (artifactLinks.length > 0) lines.push(`Pages: ${artifactLinks.join(" · ")}`, "");
      lines.push(`Depends on: ${formatNeighbors(dependencies, presentations)}`, "");
      lines.push(`Used by: ${formatNeighbors(dependents, presentations)}`, "");
    }
  }
  const auxiliaryCount = modules.length - productModules.length;
  if (
    auxiliaryCount > 0 &&
    await safeIo.exists(absRoot, "livewiki/auxiliary/index.md").catch(() => false)
  ) {
    lines.push("## Auxiliary areas");
    lines.push("");
    lines.push(
      `This repository has **${auxiliaryCount} auxiliary areas** for tests, fixtures, ` +
        "tooling, benchmarks, or repository documentation. " +
        "Open the complete [Auxiliary areas](../auxiliary/index.md) inventory.",
    );
    lines.push("");
  }
  lines.push("## Diagrams");
  lines.push("");
  lines.push("### Structure");
  lines.push("");
  lines.push("Map of the repository's folders and files.");
  lines.push("");
  lines.push("```mermaid");
  lines.push("%% livewiki/architecture/structure.mmd");
  lines.push("```");
  lines.push("");
  lines.push("Open the raw file: [structure.mmd](structure.mmd)");
  lines.push("");
  lines.push("### Folder dependencies");
  lines.push("");
  lines.push("Import graph between folders.");
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
    "or run `livewiki init --batch` to generate the folder and file pages.");
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
      ? `[${presentation.displayTitle}](../${item.moduleId}/index.md)`
      : `${presentation.displayTitle} (page not written yet)`;
  }).join(", ");
}

/**
 * Escapes an id for use in an HTML anchor (`<a id="...">`).
 * Keeps alphanumerics + dot + hyphen + underscore. Anything else becomes `_`.
 * Guarantees the id is valid as an HTML attribute and identical to what the
 * quickstart emits in the link (`#${m.id}`).
 */
function escapeHtmlId(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}
