/**
 * Agent-written bootstrap queue.
 *
 * This is the MCP execution surface for the deterministic batch plan. The
 * user's coding agent supplies Markdown; livewiki owns ordering, bounded
 * attempts, validation, transactional writes, checkpoints, and finalization.
 * It deliberately has no dependency on llm/index.ts or batch.ts.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import type Database from "better-sqlite3";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { runInit, regenerateArchitectureOverview } from "./init.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, type VerifyIssue, type VerifyResult } from "./verify.js";
import {
  CONFIG_DEFAULTS,
  applyDefaults,
  loadConfig,
  type LivewikiConfig,
} from "./config.js";
import {
  assertExactPathPartition,
  assertUniqueModuleIds,
  classifyPathRole,
  classifyModuleRole,
  makeUniqueDeterministicIds,
  prioritizeModules,
  resolveModuleEdges,
  type Module,
  type ModuleGraphEdge,
  type PathRole,
  type PathRoleConfig,
} from "./modules.js";
import {
  planPageUnits,
  type FileUnit,
  type FolderUnit,
  type PageUnitsPlan,
} from "./page-units.js";
import { collectImportsForFiles, type ExtractedImport } from "./imports.js";
import {
  loadEffectiveTsconfig,
  loadGoModulePath,
  loadRustCrateName,
  loadWorkspacePackages,
  resolveImportEdges,
  type ResolvedImportEdge,
} from "./import-resolution.js";
import {
  assignFlowKeySections,
  detectFlowCandidates,
  type FlowCandidate,
  type FlowKeySectionMap,
} from "./flows.js";
import {
  computeCallerCentrality,
  computeCrossModuleCallees,
} from "./call-resolution.js";
import {
  assignTopicKeySections,
  buildTopicPlanningInventory,
  proposeTopicPlanDeterministically,
  type TopicCandidate,
  type TopicKeySectionMap,
} from "./topics.js";
import {
  buildUnderstandingEvidence,
  computeUnderstandingEvidenceHash,
  hasUnderstandingBasis,
  validateUnderstandingArtifact,
} from "./understanding.js";
import {
  buildFolderPurposePrompt,
  buildStage4Prompt,
  buildStage5Prompt,
  buildTopicPrompt,
  buildUnderstandingPrompt,
  type ArtifactValidationError,
  type Language,
  type PromptPair,
} from "./prompts.js";
import {
  countFlowDiagramElements,
  extractInlineModuleDiagram,
  isDegradedArtifact,
  normalizeStage4Artifact,
  validateStage4Artifact,
  type Stage4ValidationContext,
} from "./artifact.js";
import {
  buildFolderPurposeContext,
  extractPageTitle,
  renderFolderPage,
  validateFolderPurpose,
} from "./folder-page.js";
import {
  extractModuleOpeningDigest,
  loadFlowPresentations,
  loadTopicPresentations,
  syncFlowsIndexHub,
  syncTopicsIndexHub,
} from "./navigation.js";
import {
  generateFlowDiagram,
  insertFlowDiagramSection,
} from "./flow-diagram.js";
import { moduleSlug } from "./diagrams.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import { computeSnapshotHash, refreshArtifactReceiptHashes, writeManifestState } from "./manifest.js";
import { sha256 } from "./hashes.js";
import {
  commitDocumentationTask,
  recoverDocumentationReceipt,
} from "./documentation-commit.js";
import { hasCurrentContractBaseline } from "./baseline-operations.js";
import { parseFrontmatter } from "./frontmatter.js";
import type {
  BatchRunSummary,
  BatchRunStatus,
  BatchTaskStatus,
  DiagnosticAttempt,
  TaskCheckpoint,
  UsageAttempt,
} from "./batch-state.js";
import { summarizeDiagnosticErrors } from "./batch-state.js";

export type AgentTaskKind =
  | "file-page"
  | "folder-page"
  | "flow"
  | "topic"
  | "understanding";

export interface AgentTaskValidationSummary {
  moduleDiagramPath?: string;
  title?: string;
  order?: number;
  intent?: string;
  modules?: string[];
  flows?: string[];
  sectionByKey?: Record<string, string>;
}

interface AgentTaskBase {
  kind: AgentTaskKind;
  targetPath: string;
  closedKeys: string[];
  sourcePaths: string[];
  moduleRole: PathRole;
}

export type PersistedAgentTask =
  | (AgentTaskBase & {
      kind: "file-page";
      module: Module;
      fileUnit: FileUnit;
    })
  | (AgentTaskBase & {
      kind: "folder-page";
      module: Module;
      folder: FolderUnit;
      fileUnits: FileUnit[];
      symbolCountByPath: Record<string, number>;
    })
  | (AgentTaskBase & {
      kind: "flow";
      candidate: FlowCandidate;
      modules: Module[];
    })
  | (AgentTaskBase & {
      kind: "topic";
      candidate: TopicCandidate;
    })
  | (AgentTaskBase & {
      kind: "understanding";
      evidenceHash: string;
      suggestedTitle: string;
    });

export interface AgentBootstrapTask {
  taskId: number;
  kind: AgentTaskKind;
  targetPath: string;
  closedKeys: string[];
  sourcePaths: string[];
  formatContract: PromptPair;
  validation: AgentTaskValidationSummary;
  attempts: { used: number; limit: number };
}

export interface AgentQueueResult {
  runId: number;
  status: "task" | "completed" | "completed_with_failures";
  task?: AgentBootstrapTask;
  accounting: "unavailable";
  topicRefine: "not-run";
}

export interface AgentSubmissionResult {
  ok: boolean;
  runId: number;
  taskId: number;
  taskStatus: BatchTaskStatus;
  writtenPaths: string[];
  errors: AgentSubmissionError[];
  attempts: { used: number; limit: number };
}

export interface AgentSubmissionError {
  code: string;
  message: string;
  location?: string;
  sectionSlug?: string;
  offending?: string;
}

type AgentPhase = "files" | "folders" | "flows" | "topics" | "understanding" | "finalizing";

interface AgentRunState {
  version: 1;
  executor: "agent";
  phase: AgentPhase;
  language: Language;
  maxAttempts: number;
  topicRefine: "not-run";
  config: {
    maxFlows: number;
    flowMaxAnchors: number;
    flowMaxOverlap: number;
    flowMaxDiagramNodes: number;
    flowMaxDiagramEdges: number;
    moduleMaxDiagramNodes: number;
    moduleMaxDiagramEdges: number;
    maxTopics: number;
    topicMaxAnchors: number;
    topicMaxSourceChars: number;
    concernTopics: boolean;
    rationaleMaxChars: number;
    understandingSynthesis: boolean;
    moduleDiagrams: boolean;
    deepHierarchy: boolean;
    pathRoles?: PathRoleConfig;
  };
  modules: Module[];
  ordered: Module[];
  edges: ModuleGraphEdge[];
  fileUnits: FileUnit[];
  folderUnits: FolderUnit[];
  symbolCountByPath: Record<string, number>;
  flowCandidates: FlowCandidate[];
  acceptedTopicSlugs: string[];
}

interface TaskRow {
  id: number;
  run_id: number;
  stage: number;
  target: string;
  status: string;
  checkpoint_json: string | null;
}

interface RunRow {
  id: number;
  status: string;
  config_json: string;
}

const ACCOUNTING = "unavailable" as const;
const TOPIC_REFINE = "not-run" as const;

function parseJson<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function usageAttempt(attempt: number): UsageAttempt {
  return {
    attempt,
    usage: null,
    usageKnown: false,
    costUsd: null,
    finishedAt: Date.now(),
  };
}

function checkpointForTask(task: PersistedAgentTask, stage: 4 | 5, startedAt: number): TaskCheckpoint {
  return {
    stage,
    status: "pending",
    attempt: 0,
    startedAt,
    usageHistory: [],
    diagnosticHistory: [],
    agentTask: task,
  };
}

function emptySummary(opts: {
  modules: Module[];
  done: number;
  failed: number;
  pending: number;
}): BatchRunSummary {
  return {
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      models: [],
      usageIncomplete: true,
    },
    byStage: {},
    byModule: [],
    tasksDone: opts.done,
    tasksFailed: opts.failed,
    tasksPending: opts.pending,
    modulesRefined: opts.modules.map(({ id, paths, displayTitle }) => ({
      id,
      paths,
      ...(displayTitle !== undefined ? { displayTitle } : {}),
    })),
    executor: "agent",
    accounting: ACCOUNTING,
    topicRefine: TOPIC_REFINE,
  };
}

interface PlanningSnapshot {
  symbols: SymbolRow[];
  modules: Module[];
  ordered: Module[];
  edges: ModuleGraphEdge[];
  pageUnits: PageUnitsPlan;
  symbolCountByPath: Map<string, number>;
  flowCandidates: FlowCandidate[];
}

async function buildPlanningSnapshot(
  repoRoot: string,
  rawConfig: LivewikiConfig,
): Promise<PlanningSnapshot> {
  const config = applyDefaults(rawConfig);
  const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const symbols = db
      .prepare("SELECT * FROM symbols WHERE status = 'active' ORDER BY key")
      .all() as SymbolRow[];
    const fileRows = db
      .prepare("SELECT path, size FROM files WHERE status = 'active' ORDER BY path")
      .all() as Array<{ path: string; size: number }>;
    const filePaths = fileRows.map((row) => row.path);
    const sizeByPath = new Map(fileRows.map((row) => [row.path, row.size]));
    const symbolCountByPath = new Map<string, number>();
    const symbolsByFile = new Map<string, string[]>();
    for (const symbol of symbols) {
      const filePath = symbol.key.split("#", 1)[0]!;
      symbolCountByPath.set(filePath, (symbolCountByPath.get(filePath) ?? 0) + 1);
      const keys = symbolsByFile.get(filePath) ?? [];
      keys.push(symbol.key);
      symbolsByFile.set(filePath, keys);
    }
    const pageUnits = planPageUnits(
      { filePaths, symbolCountByPath, sizeByPath },
      {
        ...(rawConfig.pathRoles !== undefined ? { pathRoles: rawConfig.pathRoles } : {}),
        fileSplitSourceBytes: config.fileSplitSourceBytes ?? CONFIG_DEFAULTS.fileSplitSourceBytes,
      },
    );
    let modules: Module[] = pageUnits.folderUnits.map((folder) => ({
      id: folder.id,
      paths: folder.entries.map((entry) => entry.filePath),
      symbolCount: folder.entries.reduce(
        (total, entry) => total + (symbolCountByPath.get(entry.filePath) ?? 0),
        0,
      ),
    }));
    modules = makeUniqueDeterministicIds(modules);
    assertExactPathPartition(modules, filePaths);
    assertUniqueModuleIds(modules);

    const importsByFile = await collectImportsForFiles(repoRoot, filePaths);
    const knownFiles = new Set(filePaths);
    const workspacePackages = await loadWorkspacePackages(repoRoot);
    const resolvedImportEdges = resolveImportEdges({
      importsByFile,
      knownFiles,
      workspacePackages,
      tsconfig: await loadEffectiveTsconfig(repoRoot, workspacePackages),
      goModulePath: await loadGoModulePath(repoRoot),
      rustCrateName: await loadRustCrateName(repoRoot),
    });
    const edges = resolveModuleEdges(modules, importsByFile, knownFiles, resolvedImportEdges);
    const ordered = prioritizeModules(modules, edges, config.pathRoles);

    const resolvedOccurrences = new Set(
      resolvedImportEdges.map((edge) => `${edge.fromFile}\0${edge.source}`),
    );
    const externalImportsByFile = new Map<string, string[]>();
    for (const [filePath, refs] of importsByFile) {
      externalImportsByFile.set(
        filePath,
        refs
          .map((ref: ExtractedImport) => ref.source)
          .filter((source: string) => !resolvedOccurrences.has(`${filePath}\0${source}`)),
      );
    }
    const flowCandidates = detectFlowCandidates({
      modules: ordered,
      edges,
      symbolsByFile,
      externalImportsByFile,
      resolvedEdges: resolvedImportEdges,
      ...(config.pathRoles !== undefined ? { pathRoleConfig: config.pathRoles } : {}),
      ...(config.flowSignals !== undefined ? { flowSignals: config.flowSignals } : {}),
      maxFlows: config.maxFlows ?? CONFIG_DEFAULTS.maxFlows,
      flowMaxAnchors: config.flowMaxAnchors ?? CONFIG_DEFAULTS.flowMaxAnchors,
      flowMaxOverlap: config.flowMaxOverlap ?? CONFIG_DEFAULTS.flowMaxOverlap,
      resolvedCrossModuleCallees: computeCrossModuleCallees(db, ordered),
    });

    return {
      symbols,
      modules,
      ordered,
      edges,
      pageUnits,
      symbolCountByPath,
      flowCandidates,
    };
  } finally {
    db.close();
  }
}

function makeRunState(
  rawConfig: LivewikiConfig,
  snapshot: PlanningSnapshot,
): AgentRunState {
  const config = applyDefaults(rawConfig);
  return {
    version: 1,
    executor: "agent",
    phase: "files",
    language: config.language ?? "en",
    maxAttempts: 1 + (config.maxRepairAttempts ?? CONFIG_DEFAULTS.maxRepairAttempts),
    topicRefine: TOPIC_REFINE,
    config: {
      maxFlows: config.maxFlows ?? CONFIG_DEFAULTS.maxFlows,
      flowMaxAnchors: config.flowMaxAnchors ?? CONFIG_DEFAULTS.flowMaxAnchors,
      flowMaxOverlap: config.flowMaxOverlap ?? CONFIG_DEFAULTS.flowMaxOverlap,
      flowMaxDiagramNodes: config.flowMaxDiagramNodes ?? CONFIG_DEFAULTS.flowMaxDiagramNodes,
      flowMaxDiagramEdges: config.flowMaxDiagramEdges ?? CONFIG_DEFAULTS.flowMaxDiagramEdges,
      moduleMaxDiagramNodes:
        config.moduleMaxDiagramNodes ?? CONFIG_DEFAULTS.moduleMaxDiagramNodes,
      moduleMaxDiagramEdges:
        config.moduleMaxDiagramEdges ?? CONFIG_DEFAULTS.moduleMaxDiagramEdges,
      maxTopics: config.maxTopics ?? CONFIG_DEFAULTS.maxTopics,
      topicMaxAnchors: config.topicMaxAnchors ?? CONFIG_DEFAULTS.topicMaxAnchors,
      topicMaxSourceChars: config.topicMaxSourceChars ?? CONFIG_DEFAULTS.topicMaxSourceChars,
      concernTopics: config.concernTopics ?? CONFIG_DEFAULTS.concernTopics,
      rationaleMaxChars: config.rationaleMaxChars ?? CONFIG_DEFAULTS.rationaleMaxChars,
      understandingSynthesis:
        config.understandingSynthesis ?? CONFIG_DEFAULTS.understandingSynthesis,
      moduleDiagrams: config.moduleDiagrams ?? CONFIG_DEFAULTS.moduleDiagrams,
      deepHierarchy: config.deepHierarchy ?? CONFIG_DEFAULTS.deepHierarchy,
      ...(config.pathRoles !== undefined ? { pathRoles: config.pathRoles } : {}),
    },
    modules: snapshot.modules,
    ordered: snapshot.ordered,
    edges: snapshot.edges,
    fileUnits: [...snapshot.pageUnits.fileUnits],
    folderUnits: [...snapshot.pageUnits.folderUnits],
    symbolCountByPath: Object.fromEntries(snapshot.symbolCountByPath),
    flowCandidates: snapshot.flowCandidates,
    acceptedTopicSlugs: [],
  };
}

async function insertTask(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  stage: 4 | 5,
  target: string,
  task: PersistedAgentTask,
  state: AgentRunState,
  now: number,
): Promise<number> {
  const recoveredArtifacts = await recoverTaskArtifacts(repoRoot, task, state);
  const checkpoint = checkpointForTask(task, stage, now);
  if (recoveredArtifacts !== null) {
    checkpoint.status = "done";
    checkpoint.finishedAt = now;
    checkpoint.artifacts = recoveredArtifacts;
  }
  const result = db.prepare(
    "INSERT INTO batch_tasks (run_id, stage, target, status, checkpoint_json, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    runId,
    stage,
    target,
    recoveredArtifacts === null ? "pending" : "done",
    JSON.stringify(checkpoint),
    now,
  );
  return Number(result.lastInsertRowid);
}

async function recoverTaskArtifacts(
  repoRoot: string,
  task: PersistedAgentTask,
  state: AgentRunState,
): Promise<import("./batch-state.js").TaskArtifacts | null> {
  if (task.kind !== "file-page") {
    return recoverDocumentationReceipt({
      repoRoot,
      taskId: receiptTaskId(task),
      kind: task.kind,
      evidence: receiptEvidence(task),
      page: task.targetPath,
      ...(task.kind === "flow"
        ? { diagram: `livewiki/diagrams/flow-${task.candidate.slug}.mmd` }
        : {}),
    });
  }

  if (!await hasCurrentContractBaseline(repoRoot, task.targetPath, task.closedKeys)) return null;
  const page = await safeIo.readText(repoRoot, task.targetPath).catch(() => null);
  if (page === null) return null;
  const normalized = normalizeStage4Artifact(page);
  if (!normalized.ok) return null;
  const slug = moduleSlug(task.module.id);
  const validation = validateStage4Artifact(normalized.content, task.closedKeys, {
    moduleId: task.module.id,
    moduleRole: task.moduleRole,
    // Pages completed under the relaxed round (`quality: degraded`) only
    // pass the relaxed contract they were accepted with.
    ...(isDegradedArtifact(page) ? { relaxed: true } : {}),
    ...(state.config.moduleDiagrams
      ? { expectedModuleDiagram: `livewiki/diagrams/${slug}.mmd` }
      : {}),
  });
  if (!validation.ok) return null;

  if (!state.config.moduleDiagrams) {
    return { wikiPath: task.targetPath, pageHash: sha256(page) };
  }
  const diagramPath = `livewiki/diagrams/${slug}.mmd`;
  const diagram = await safeIo.readText(repoRoot, diagramPath).catch(() => null);
  if (diagram === null || await validateMermaidSyntax(diagram) !== null) return null;
  const elements = countFlowDiagramElements(diagram);
  if (elements.nodes > state.config.moduleMaxDiagramNodes ||
      elements.edges > state.config.moduleMaxDiagramEdges) {
    return null;
  }
  return {
    wikiPath: task.targetPath,
    pageHash: sha256(page),
    diagramPath,
    diagramHash: sha256(diagram),
  };
}

function fileTask(
  unit: FileUnit,
  state: AgentRunState,
  closedKeys: string[],
): PersistedAgentTask {
  const module: Module = {
    id: unit.id,
    paths: [unit.filePath],
    symbolCount: unit.symbolCount,
  };
  return {
    kind: "file-page",
    targetPath: unit.pagePath,
    closedKeys,
    sourcePaths: [unit.filePath],
    moduleRole: classifyModuleRole(module, state.config.pathRoles),
    module,
    fileUnit: unit,
  };
}

async function createAgentRun(repoRoot: string): Promise<RunRow> {
  // Deterministic initialization only. `batch` is intentionally absent, so
  // this branch cannot import the API orchestrator or create an LLM client.
  await runInit({ repoRoot, quiet: true });
  const rawConfig = await loadConfig(repoRoot);
  const snapshot = await buildPlanningSnapshot(repoRoot, rawConfig);
  const state = makeRunState(rawConfig, snapshot);
  const dbPath = await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const now = Date.now();
    const result = db.prepare(
      "INSERT INTO batch_runs (started_at, started_by, stage, config_json, status) " +
        "VALUES (?, 'agent', 4, ?, 'running')",
    ).run(now, JSON.stringify(state));
    const runId = Number(result.lastInsertRowid);
    const folderPriority = new Map(state.ordered.map((module, index) => [module.id, index]));
    const orderedFiles = [...state.fileUnits].sort((a, b) => {
      const aPriority = folderPriority.get(a.folderId) ?? Number.MAX_SAFE_INTEGER;
      const bPriority = folderPriority.get(b.folderId) ?? Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) return aPriority - bPriority;
      if (a.symbolCount !== b.symbolCount) return b.symbolCount - a.symbolCount;
      return a.id.localeCompare(b.id);
    });
    const keysByFile = new Map<string, string[]>();
    for (const symbol of snapshot.symbols) {
      const filePath = symbol.key.split("#", 1)[0]!;
      const keys = keysByFile.get(filePath) ?? [];
      keys.push(symbol.key);
      keysByFile.set(filePath, keys);
    }
    for (const unit of orderedFiles) {
      await insertTask(
        repoRoot,
        db,
        runId,
        4,
        unit.id,
        fileTask(unit, state, [...(keysByFile.get(unit.filePath) ?? [])].sort()),
        state,
        now,
      );
    }
    return { id: runId, status: "running", config_json: JSON.stringify(state) };
  } finally {
    db.close();
  }
}

type ExistingOwner = "generated" | "mixed" | "human" | "untrusted" | "unparseable" | null;

function readOwner(content: string | null): ExistingOwner {
  if (content === null) return null;
  let normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return "untrusted";
  try {
    const frontmatter = parseFrontmatter(normalized).frontmatter;
    if (frontmatter === null) return "untrusted";
    const owner = frontmatter["owner"];
    if (owner === "generated" || owner === "mixed" || owner === "human") return owner;
    return "untrusted";
  } catch {
    return "unparseable";
  }
}

function forceOwner(content: string, owner: "generated" | "mixed"): string {
  const close = content.indexOf("\n---", 4);
  if (!content.startsWith("---\n") || close < 0) return content;
  const yaml = content.slice(4, close);
  const next = /^[ \t]*owner:[^\n]*$/m.test(yaml)
    ? yaml.replace(/^[ \t]*owner:[^\n]*$/m, `owner: ${owner}`)
    : `${yaml.trimEnd()}\nowner: ${owner}`;
  return `---\n${next}${content.slice(close)}`;
}

interface PositionedManualBlock {
  section: string | null;
  bytes: string;
}

function manualBlocks(content: string): PositionedManualBlock[] {
  const matches = [...content.matchAll(/<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->/g)];
  return matches.map((match) => {
    const before = content.slice(0, match.index ?? 0);
    const headings = [...before.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
    const last = headings.at(-1)?.[1]?.trim().toLocaleLowerCase("en-US") ?? null;
    return { section: last, bytes: match[0] };
  });
}

function injectManualBlocks(existing: string, candidate: string): string {
  const blocks = manualBlocks(existing);
  if (blocks.length === 0) return candidate;
  const lines = candidate.split("\n");
  const inserted = new Set<number>();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex]!;
    if (block.section === null) continue;
    let start = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]!);
      if (heading?.[2]?.trim().toLocaleLowerCase("en-US") === block.section) {
        start = i;
        level = heading[1]!.length;
        break;
      }
    }
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const heading = /^(#{1,6})\s+/.exec(lines[i]!);
      if (heading !== null && heading[1]!.length <= level) {
        end = i;
        break;
      }
    }
    while (end > start + 1 && lines[end - 1]!.trim() === "") end--;
    lines.splice(end, 0, "", block.bytes, "");
    inserted.add(blockIndex);
  }
  const orphaned = blocks
    .filter((_block, index) => !inserted.has(index))
    .map((block) => block.bytes);
  let result = lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd();
  if (orphaned.length > 0) result += `\n\n${orphaned.join("\n\n")}`;
  return result + "\n";
}

async function existingPageFacts(repoRoot: string, fileUnits: readonly FileUnit[]): Promise<{
  existingPagePaths: Set<string>;
  titlesByPagePath: Map<string, string>;
  openingsByPagePath: Map<string, string>;
}> {
  const existingPagePaths = new Set<string>();
  const titlesByPagePath = new Map<string, string>();
  const openingsByPagePath = new Map<string, string>();
  for (const unit of fileUnits) {
    const content = await safeIo.readText(repoRoot, unit.pagePath).catch(() => null);
    if (content === null) continue;
    existingPagePaths.add(unit.pagePath);
    const title = extractPageTitle(content);
    if (title !== null) titlesByPagePath.set(unit.pagePath, title);
    openingsByPagePath.set(unit.pagePath, extractModuleOpeningDigest(content));
  }
  return { existingPagePaths, titlesByPagePath, openingsByPagePath };
}

async function proseTitles(repoRoot: string, folder: FolderUnit): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of folder.entries) {
    if (entry.disposition !== "inert" || !/\.(md|mdx|markdown)$/i.test(entry.filePath)) continue;
    const content = await nodeFs.readFile(nodePath.join(repoRoot, entry.filePath), "utf8").catch(() => null);
    if (content === null) continue;
    const title = extractPageTitle(content);
    if (title !== null) result.set(entry.filePath, title);
  }
  return result;
}

async function renderFolderArtifact(
  repoRoot: string,
  task: Extract<PersistedAgentTask, { kind: "folder-page" }>,
  purpose: string,
): Promise<string> {
  const facts = await existingPageFacts(repoRoot, task.fileUnits);
  return renderFolderPage({
    folder: task.folder,
    fileUnits: task.fileUnits,
    symbolCountByPath: new Map(Object.entries(task.symbolCountByPath)),
    existingPagePaths: facts.existingPagePaths,
    titlesByPagePath: facts.titlesByPagePath,
    proseTitlesByFilePath: await proseTitles(repoRoot, task.folder),
    purpose,
    ...(task.moduleRole !== "product" ? { role: task.moduleRole } : {}),
  });
}

function persistRunState(db: Database.Database, runId: number, state: AgentRunState): void {
  db.prepare("UPDATE batch_runs SET stage = ?, config_json = ? WHERE id = ?")
    .run(state.phase === "files" || state.phase === "folders" ? 4 : 5, JSON.stringify(state), runId);
}

function taskCounts(db: Database.Database, runId: number): { done: number; failed: number; pending: number } {
  const rows = db.prepare(
    "SELECT status, COUNT(*) AS count FROM batch_tasks WHERE run_id = ? GROUP BY status",
  ).all(runId) as Array<{ status: string; count: number }>;
  const count = (status: string): number => rows.find((row) => row.status === status)?.count ?? 0;
  return {
    done: count("done"),
    failed: count("failed"),
    pending: count("pending") + count("running"),
  };
}

async function pageExists(repoRoot: string, path: string): Promise<boolean> {
  return safeIo.readText(repoRoot, path).then(() => true, () => false);
}

async function materializeFolderPhase(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  state: AgentRunState,
): Promise<void> {
  const now = Date.now();
  const folderById = new Map(state.folderUnits.map((folder) => [folder.id, folder]));
  for (const module of state.ordered) {
    const folder = folderById.get(module.id);
    if (folder === undefined) continue;
    const fileUnits = state.fileUnits.filter((unit) => unit.folderId === folder.id);
    const moduleRole = classifyModuleRole(module, state.config.pathRoles);
    const task: Extract<PersistedAgentTask, { kind: "folder-page" }> = {
      kind: "folder-page",
      targetPath: folder.pagePath,
      closedKeys: [],
      sourcePaths: folder.entries.map((entry) => entry.filePath),
      moduleRole,
      module,
      folder,
      fileUnits,
      symbolCountByPath: state.symbolCountByPath,
    };
    if (moduleRole === "product") {
      await insertTask(repoRoot, db, runId, 4, module.id, task, state, now);
      continue;
    }

    // Auxiliary folder pages are deterministic in the API pipeline too.
    // They are written here without asking the user's model for prose.
    const existing = await safeIo.readText(repoRoot, folder.pagePath).catch(() => null);
    const owner = readOwner(existing);
    if (owner === "human" || owner === "untrusted" || owner === "unparseable") continue;
    let page = await renderFolderArtifact(repoRoot, task, "");
    if (existing !== null) {
      page = injectManualBlocks(existing, page);
      if (owner === "mixed") page = forceOwner(page, "mixed");
    }
    await safeIo.writeText(repoRoot, folder.pagePath, page);
  }
  state.phase = "folders";
  persistRunState(db, runId, state);
}

async function materializeFlowPhase(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  state: AgentRunState,
): Promise<void> {
  const now = Date.now();
  for (const candidate of state.flowCandidates) {
    if (candidate.skip !== undefined) continue;
    const participantsExist = await Promise.all(
      candidate.moduleIds.map((id) => pageExists(repoRoot, `livewiki/${id}/index.md`)),
    );
    if (participantsExist.some((exists) => !exists)) continue;
    const sourcePaths = state.modules
      .filter((module) => candidate.moduleIds.includes(module.id))
      .flatMap((module) => module.paths);
    const task: Extract<PersistedAgentTask, { kind: "flow" }> = {
      kind: "flow",
      targetPath: `livewiki/flows/${candidate.slug}.md`,
      closedKeys: [...candidate.seedKeys],
      sourcePaths: [...new Set(sourcePaths)].sort(),
      moduleRole: "product",
      candidate,
      modules: state.ordered,
    };
    await insertTask(repoRoot, db, runId, 5, `flow:${candidate.slug}`, task, state, now);
  }
  state.phase = "flows";
  persistRunState(db, runId, state);
}

async function materializeTopicPhase(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  state: AgentRunState,
): Promise<void> {
  const now = Date.now();
  const acceptedFlowSlugs = new Set<string>();
  for (const candidate of state.flowCandidates) {
    if (await pageExists(repoRoot, `livewiki/flows/${candidate.slug}.md`)) {
      acceptedFlowSlugs.add(candidate.slug);
    }
  }
  if (state.config.maxTopics > 0) {
    const inventory = await buildTopicPlanningInventory({
      repoRoot,
      modules: state.modules,
      edges: state.edges,
      flowCandidates: state.flowCandidates,
      allowedFlowSlugs: acceptedFlowSlugs,
      ...(state.config.pathRoles !== undefined
        ? { pathRoleConfig: state.config.pathRoles }
        : {}),
    });
    const candidates = proposeTopicPlanDeterministically(
      inventory,
      computeCallerCentrality(db),
      {
        maxTopics: state.config.maxTopics,
        maxAnchors: state.config.topicMaxAnchors,
        maxSourceChars: state.config.topicMaxSourceChars,
        concernTopics: state.config.concernTopics,
        rationaleMaxChars: state.config.rationaleMaxChars,
      },
    );
    state.acceptedTopicSlugs = candidates.map((candidate) => candidate.slug);
    const modulePaths = new Map(state.modules.map((module) => [module.id, module.paths]));
    for (const candidate of candidates) {
      const sourcePaths = candidate.modules.flatMap((id) => modulePaths.get(id) ?? []);
      const task: Extract<PersistedAgentTask, { kind: "topic" }> = {
        kind: "topic",
        targetPath: `livewiki/topics/${candidate.slug}.md`,
        closedKeys: [...candidate.seedKeys],
        sourcePaths: [
          ...new Set([
            ...sourcePaths,
            ...candidate.flows.map((slug) => `livewiki/flows/${slug}.md`),
          ]),
        ].sort(),
        moduleRole: "product",
        candidate,
      };
      await insertTask(
        repoRoot,
        db,
        runId,
        5,
        `topic:${candidate.evidenceHash}`,
        task,
        state,
        now,
      );
    }
  }
  state.phase = "topics";
  persistRunState(db, runId, state);
}

async function materializeUnderstandingPhase(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  state: AgentRunState,
): Promise<void> {
  if (state.config.understandingSynthesis) {
    const evidence = await buildUnderstandingEvidence({
      repoRoot,
      modules: state.modules,
      ordered: state.ordered,
      ...(state.config.pathRoles !== undefined
        ? { pathRoleConfig: state.config.pathRoles }
        : {}),
    });
    if (hasUnderstandingBasis(evidence)) {
      const evidenceHash = computeUnderstandingEvidenceHash(evidence);
      const candidateSourcePaths = [
        ...(await nodeFs.access(nodePath.join(repoRoot, "README.md")).then(() => ["README.md"], () => [])),
        ...state.fileUnits.map((unit) => unit.pagePath),
        ...state.folderUnits.map((unit) => unit.pagePath),
        ...state.flowCandidates.map((candidate) => `livewiki/flows/${candidate.slug}.md`),
        ...state.acceptedTopicSlugs.map((slug) => `livewiki/topics/${slug}.md`),
      ];
      const sourcePaths: string[] = [];
      for (const path of [...new Set(candidateSourcePaths)].sort()) {
        if (!path.startsWith("livewiki/") || await pageExists(repoRoot, path)) {
          sourcePaths.push(path);
        }
      }
      const task: Extract<PersistedAgentTask, { kind: "understanding" }> = {
        kind: "understanding",
        targetPath: "livewiki/understanding.md",
        closedKeys: [],
        sourcePaths,
        moduleRole: "product",
        evidenceHash,
        suggestedTitle: evidence.readmeTitle ?? "Repository understanding",
      };
      await insertTask(
        repoRoot,
        db,
        runId,
        5,
        `understanding:${evidenceHash}`,
        task,
        state,
        Date.now(),
      );
    }
  }
  state.phase = "understanding";
  persistRunState(db, runId, state);
}

async function finalizeAgentRun(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  state: AgentRunState,
): Promise<"completed" | "completed_with_failures"> {
  state.phase = "finalizing";
  persistRunState(db, runId, state);

  await regenerateArchitectureOverview(repoRoot, {
    acceptedTopicSlugs: new Set(state.acceptedTopicSlugs),
  });
  await runLedger(repoRoot, { quiet: true });
  const verify = await runVerify(repoRoot);
  const counts = taskCounts(db, runId);
  const status: "completed" | "completed_with_failures" =
    counts.failed > 0 || verify.issues.length > 0
      ? "completed_with_failures"
      : "completed";
  if (status === "completed") {
    await refreshCompletedTaskReceipts(repoRoot, db, runId);
  }
  const summary = emptySummary({
    modules: state.modules,
    done: counts.done,
    failed: counts.failed,
    pending: 0,
  });
  db.prepare(
    "UPDATE batch_runs SET status = ?, finished_at = ?, stage = 5, summary_json = ?, config_json = ? WHERE id = ?",
  ).run(status, Date.now(), JSON.stringify(summary), JSON.stringify(state), runId);

  const snapshotHash = await computeSnapshotHash(repoRoot);
  await writeManifestState(repoRoot, {
    lastDocumentedCommit: null,
    snapshotHash,
    pendingBatch: null,
  });
  return status;
}

async function refreshCompletedTaskReceipts(
  repoRoot: string,
  db: Database.Database,
  runId: number,
): Promise<void> {
  const rows = db.prepare(
    "SELECT id, run_id, stage, target, status, checkpoint_json FROM batch_tasks " +
      "WHERE run_id = ? AND status = 'done' ORDER BY id",
  ).all(runId) as TaskRow[];
  // Receipt-only refresh: the finalize navigation regen may have rewritten
  // pages, so re-hash the receipted artifacts. The baseline is NEVER
  // advanced here — code that drifted after the task completed must surface
  // as `changed`, not get silently accepted.
  const changedPaths: string[] = [];
  for (const row of rows) {
    const { task } = readAgentTask(row);
    if (task.kind === "file-page") continue;
    changedPaths.push(task.targetPath);
    if (task.kind === "flow") {
      changedPaths.push(`livewiki/diagrams/flow-${task.candidate.slug}.mmd`);
    }
  }
  await refreshArtifactReceiptHashes(repoRoot, changedPaths);
}

async function advancePhase(
  repoRoot: string,
  db: Database.Database,
  run: RunRow,
  state: AgentRunState,
): Promise<"advanced" | "completed" | "completed_with_failures"> {
  switch (state.phase) {
    case "files":
      await materializeFolderPhase(repoRoot, db, run.id, state);
      return "advanced";
    case "folders":
      await materializeFlowPhase(repoRoot, db, run.id, state);
      return "advanced";
    case "flows":
      await materializeTopicPhase(repoRoot, db, run.id, state);
      return "advanced";
    case "topics":
      await materializeUnderstandingPhase(repoRoot, db, run.id, state);
      return "advanced";
    case "understanding":
    case "finalizing":
      return finalizeAgentRun(repoRoot, db, run.id, state);
  }
}

const FLOW_SECTION_TITLES: Record<string, string> = {
  purpose: "Purpose",
  "ordered-flow": "Ordered flow",
  "failure-and-recovery": "Failure and recovery",
};

const TOPIC_SECTION_TITLES: Record<string, string> = {
  purpose: "Purpose",
  "when-to-use-this-page": "When to use this page",
  "behavioral-contract": "Behavioral contract",
  "failure-and-recovery": "Failure and recovery",
  "change-map": "Change map",
};

function sectionMapRecord(
  map: ReadonlyMap<string, string>,
  titles: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    [...map].map(([key, section]) => [key, titles[section] ?? section]),
  );
}

function flowGroups(candidate: FlowCandidate): {
  entryKeys: readonly string[];
  boundaryKeys: readonly string[];
  sinkKeys: readonly string[];
} {
  return {
    entryKeys: candidate.entryKeys,
    boundaryKeys: candidate.boundaryKeys,
    sinkKeys: candidate.sinkKeys,
  };
}

function taskPresentation(
  taskId: number,
  task: PersistedAgentTask,
  checkpoint: TaskCheckpoint,
  state: AgentRunState,
): AgentBootstrapTask {
  let formatContract: PromptPair;
  const validation: AgentTaskValidationSummary = {};

  switch (task.kind) {
    case "file-page": {
      const moduleDiagrams = state.config.moduleDiagrams
        ? {
            maxNodes: state.config.moduleMaxDiagramNodes,
            maxEdges: state.config.moduleMaxDiagramEdges,
          }
        : undefined;
      formatContract = buildStage4Prompt(
        task.module,
        task.closedKeys,
        "",
        "",
        state.language,
        task.moduleRole,
        undefined,
        {
          ...(moduleDiagrams !== undefined ? { moduleDiagrams } : {}),
          deepHierarchy: state.config.deepHierarchy,
        },
      );
      if (moduleDiagrams !== undefined) {
        validation.moduleDiagramPath = `livewiki/diagrams/${moduleSlug(task.module.id)}.mmd`;
      }
      break;
    }
    case "folder-page":
      formatContract = buildFolderPurposePrompt("", state.language);
      break;
    case "flow": {
      const sectionMap = assignFlowKeySections(task.candidate);
      formatContract = buildStage5Prompt(
        task.candidate,
        task.closedKeys,
        "",
        "",
        "",
        state.language,
        {
          maxNodes: state.config.flowMaxDiagramNodes,
          maxEdges: state.config.flowMaxDiagramEdges,
        },
        flowGroups(task.candidate),
        sectionMap,
      );
      validation.title = task.candidate.titleSeed;
      validation.modules = [...task.candidate.moduleIds];
      validation.sectionByKey = sectionMapRecord(sectionMap, FLOW_SECTION_TITLES);
      break;
    }
    case "topic": {
      const sectionMap = assignTopicKeySections(task.candidate);
      formatContract = buildTopicPrompt(
        task.candidate,
        "",
        "",
        "",
        state.language,
        sectionMap,
      );
      validation.title = task.candidate.title;
      validation.order = task.candidate.planOrder;
      validation.intent = task.candidate.intent;
      validation.modules = [...task.candidate.modules];
      validation.flows = [...task.candidate.flows];
      validation.sectionByKey = sectionMapRecord(sectionMap, TOPIC_SECTION_TITLES);
      break;
    }
    case "understanding":
      formatContract = buildUnderstandingPrompt("", state.language);
      validation.title = task.suggestedTitle;
      break;
  }

  return {
    taskId,
    kind: task.kind,
    targetPath: task.targetPath,
    closedKeys: [...task.closedKeys],
    sourcePaths: [...task.sourcePaths],
    formatContract,
    validation,
    attempts: { used: checkpoint.attempt, limit: state.maxAttempts },
  };
}

function readAgentState(run: RunRow): AgentRunState {
  const state = parseJson<AgentRunState>(run.config_json);
  if (state?.version !== 1 || state.executor !== "agent") {
    throw new Error(`agent bootstrap run #${run.id} has an invalid persisted state`);
  }
  return state;
}

function readAgentTask(row: TaskRow): { task: PersistedAgentTask; checkpoint: TaskCheckpoint } {
  const checkpoint = parseJson<TaskCheckpoint>(row.checkpoint_json);
  if (checkpoint?.agentTask === undefined) {
    throw new Error(`agent bootstrap task #${row.id} has no persisted task descriptor`);
  }
  return { task: checkpoint.agentTask, checkpoint };
}

function latestAgentRun(db: Database.Database): RunRow | undefined {
  return db.prepare(
    "SELECT id, status, config_json FROM batch_runs WHERE started_by = 'agent' ORDER BY id DESC LIMIT 1",
  ).get() as RunRow | undefined;
}

/**
 * Returns the next agent-written Markdown task. The response deliberately
 * contains source paths instead of source bytes: the connected coding agent
 * can read its own checkout, while livewiki retains the complete closed key
 * inventory and the canonical prompt contract.
 */
export async function nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult> {
  const absRoot = nodePath.resolve(repoRoot);
  const indexExists = await safeIo.exists(absRoot, ".livewiki/index.db");
  if (!indexExists) await createAgentRun(absRoot);

  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  let db = openIndex(dbPath);
  try {
    let run = latestAgentRun(db);
    if (run === undefined) {
      db.close();
      await createAgentRun(absRoot);
      db = openIndex(dbPath);
      run = latestAgentRun(db);
    }
    if (run === undefined) throw new Error("failed to create the agent bootstrap run");

    if (run.status === "completed" || run.status === "completed_with_failures") {
      return {
        runId: run.id,
        status: run.status,
        accounting: ACCOUNTING,
        topicRefine: TOPIC_REFINE,
      };
    }
    if (run.status !== "running") {
      throw new Error(`agent bootstrap run #${run.id} is ${run.status}, not resumable`);
    }

    const state = readAgentState(run);
    for (;;) {
      const row = db.prepare(
        "SELECT id, run_id, stage, target, status, checkpoint_json FROM batch_tasks " +
          "WHERE run_id = ? AND status IN ('running', 'pending') " +
          "ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, id LIMIT 1",
      ).get(run.id) as TaskRow | undefined;
      if (row !== undefined) {
        const { task, checkpoint } = readAgentTask(row);
        if (row.status === "pending") {
          checkpoint.status = "running";
          db.prepare(
            "UPDATE batch_tasks SET status = 'running', checkpoint_json = ?, updated_at = ? " +
              "WHERE id = ? AND status = 'pending'",
          ).run(JSON.stringify(checkpoint), Date.now(), row.id);
        }
        return {
          runId: run.id,
          status: "task",
          task: taskPresentation(row.id, task, checkpoint, state),
          accounting: ACCOUNTING,
          topicRefine: TOPIC_REFINE,
        };
      }

      const advanced = await advancePhase(absRoot, db, run, state);
      if (advanced !== "advanced") {
        return {
          runId: run.id,
          status: advanced,
          accounting: ACCOUNTING,
          topicRefine: TOPIC_REFINE,
        };
      }
      run = { ...run, config_json: JSON.stringify(state) };
    }
  } finally {
    if (db.open) db.close();
  }
}

function withTestsPointer(task: Extract<PersistedAgentTask, { kind: "file-page" }>, content: string): string {
  const lines: string[] = [];
  if (task.fileUnit.pairedTestPath !== undefined) {
    lines.push(
      `Covered by \`${task.fileUnit.pairedTestPath}\` (same-name test file on disk).`,
    );
  }
  for (const likely of task.fileUnit.likelyTestPaths) {
    lines.push(
      `Likely also exercised by \`${likely}\` (name-prefix match, not verified).`,
    );
  }
  return lines.length === 0
    ? content
    : `${content.trimEnd()}\n\n## Tests\n\n${lines.join("\n")}\n`;
}

interface PreparedSubmission {
  pageContent: string;
  companion?: { path: string; content: string };
  rejectAnySeverity: boolean;
  errors: AgentSubmissionError[];
}

function submissionErrors(
  errors: ReadonlyArray<{
    code: string;
    message: string;
    location?: string;
    sectionSlug?: string;
    offending?: string;
  }>,
): AgentSubmissionError[] {
  return errors.map((error) => ({
    code: error.code,
    message: error.message,
    ...(error.location !== undefined ? { location: error.location } : {}),
    ...(error.sectionSlug !== undefined ? { sectionSlug: error.sectionSlug } : {}),
    ...(error.offending !== undefined ? { offending: error.offending } : {}),
  }));
}

async function prepareSubmission(
  repoRoot: string,
  task: PersistedAgentTask,
  state: AgentRunState,
  rawContent: string,
): Promise<PreparedSubmission> {
  if (task.kind === "folder-page") {
    const errors = submissionErrors(validateFolderPurpose(rawContent));
    return {
      pageContent: errors.length === 0
        ? await renderFolderArtifact(repoRoot, task, rawContent.trim())
        : "",
      rejectAnySeverity: false,
      errors,
    };
  }

  const normalized = normalizeStage4Artifact(rawContent);
  if (!normalized.ok) {
    return {
      pageContent: "",
      rejectAnySeverity: task.kind === "flow" || task.kind === "topic",
      errors: submissionErrors(normalized.errors),
    };
  }

  if (task.kind === "understanding") {
    const errors = submissionErrors(validateUnderstandingArtifact(normalized.content));
    return {
      pageContent: normalized.content,
      rejectAnySeverity: true,
      errors,
    };
  }

  if (task.kind === "file-page") {
    let pageContent = normalized.content;
    let companion: PreparedSubmission["companion"];
    const slug = moduleSlug(task.module.id);
    if (state.config.moduleDiagrams) {
      const extraction = extractInlineModuleDiagram(pageContent, slug);
      if (extraction !== null) {
        const syntaxError = await validateMermaidSyntax(extraction.diagramSource);
        const elements = countFlowDiagramElements(extraction.diagramSource);
        const diagramErrors: AgentSubmissionError[] = [];
        if (extraction.sourceTooLarge || syntaxError !== null) {
          diagramErrors.push({
            code: "invalid_flow_diagram",
            message: syntaxError ?? "the Mermaid diagram exceeds the source-size limit",
            location: "section",
            sectionSlug: "diagram",
          });
        }
        if (
          elements.nodes > state.config.moduleMaxDiagramNodes ||
          elements.edges > state.config.moduleMaxDiagramEdges
        ) {
          diagramErrors.push({
            code: "flow_diagram_too_large",
            message:
              `the diagram has ${elements.nodes} nodes and ${elements.edges} edges; ` +
              `limits are ${state.config.moduleMaxDiagramNodes}/${state.config.moduleMaxDiagramEdges}`,
            location: "section",
            sectionSlug: "diagram",
          });
        }
        if (diagramErrors.length > 0) {
          return { pageContent: "", rejectAnySeverity: false, errors: diagramErrors };
        }
        pageContent = extraction.pageContent;
        companion = {
          path: `livewiki/diagrams/${slug}.mmd`,
          content: extraction.diagramSource,
        };
      }
    }
    const context: Stage4ValidationContext = {
      moduleId: task.module.id,
      moduleRole: task.moduleRole,
      ...(state.config.moduleDiagrams
        ? { expectedModuleDiagram: `livewiki/diagrams/${slug}.mmd` }
        : {}),
    };
    const validation = validateStage4Artifact(pageContent, task.closedKeys, context);
    return {
      pageContent: validation.ok ? withTestsPointer(task, pageContent) : pageContent,
      ...(companion !== undefined ? { companion } : {}),
      rejectAnySeverity: false,
      errors: submissionErrors(validation.errors),
    };
  }

  if (task.kind === "flow") {
    const diagram = generateFlowDiagram(task.candidate, task.modules, {
      maxNodes: state.config.flowMaxDiagramNodes,
      maxEdges: state.config.flowMaxDiagramEdges,
    });
    const syntaxError = await validateMermaidSyntax(diagram);
    if (syntaxError !== null) {
      return {
        pageContent: "",
        rejectAnySeverity: true,
        errors: [{ code: "invalid_flow_diagram", message: syntaxError, location: "section", sectionSlug: "diagram" }],
      };
    }
    const pageContent = insertFlowDiagramSection(normalized.content, task.candidate.slug);
    if (pageContent === null) {
      return {
        pageContent: "",
        rejectAnySeverity: true,
        errors: [{
          code: "flow_missing_required_section",
          message: "the flow page must contain the required Ordered flow and Invariants sections",
          location: "section",
        }],
      };
    }
    const validation = validateStage4Artifact(pageContent, task.closedKeys, {
      pageKind: "flow",
      moduleId: task.candidate.slug,
      moduleRole: "product",
      expectedFlowDiagram: `livewiki/diagrams/flow-${task.candidate.slug}.mmd`,
      expectedFlowModules: task.candidate.moduleIds,
      flowKeyGroups: flowGroups(task.candidate),
    });
    return {
      pageContent,
      companion: {
        path: `livewiki/diagrams/flow-${task.candidate.slug}.mmd`,
        content: diagram,
      },
      rejectAnySeverity: true,
      errors: submissionErrors(validation.errors),
    };
  }

  const validation = validateStage4Artifact(normalized.content, task.closedKeys, {
    pageKind: "topic",
    moduleId: task.candidate.slug,
    moduleRole: "product",
    expectedTopicTitle: task.candidate.title,
    expectedTopicOrder: task.candidate.planOrder,
    expectedTopicIntent: task.candidate.intent,
    expectedTopicModules: task.candidate.modules,
    expectedTopicFlows: task.candidate.flows,
    topicKeyGroups: task.candidate.groups,
    topicProductKeys: task.candidate.seedKeys.filter(
      (key) =>
        classifyPathRole(key.split("#", 1)[0] ?? "", state.config.pathRoles) === "product",
    ),
  });
  return {
    pageContent: normalized.content,
    rejectAnySeverity: true,
    errors: submissionErrors(validation.errors),
  };
}

async function restoreSnapshots(
  repoRoot: string,
  snapshots: ReadonlyArray<{ path: string; content: string | null }>,
): Promise<string[]> {
  const failures: string[] = [];
  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.content === null) await safeIo.remove(repoRoot, snapshot.path);
      else await safeIo.writeText(repoRoot, snapshot.path, snapshot.content);
    } catch (error) {
      failures.push(
        `${snapshot.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return failures;
}

async function writeAndVerifySubmission(
  repoRoot: string,
  task: PersistedAgentTask,
  prepared: PreparedSubmission,
  verify: typeof runVerify,
): Promise<{
  ok: boolean;
  pageContent: string;
  errors: AgentSubmissionError[];
  rollbackFailed: boolean;
}> {
  const pageSnapshot = await safeIo.readText(repoRoot, task.targetPath).catch(() => null);
  let finalPage = prepared.pageContent;
  if (pageSnapshot !== null) {
    finalPage = injectManualBlocks(pageSnapshot, finalPage);
    if (readOwner(pageSnapshot) === "mixed") finalPage = forceOwner(finalPage, "mixed");
  }
  const snapshots = [
    { path: task.targetPath, content: pageSnapshot },
    ...(prepared.companion !== undefined
      ? [{
          path: prepared.companion.path,
          content: await safeIo.readText(repoRoot, prepared.companion.path).catch(() => null),
        }]
      : []),
    ...(task.kind === "flow"
      ? [{
          path: "livewiki/flows/index.md",
          content: await safeIo.readText(repoRoot, "livewiki/flows/index.md").catch(() => null),
        }]
      : []),
    ...(task.kind === "topic"
      ? [{
          path: "livewiki/topics/index.md",
          content: await safeIo.readText(repoRoot, "livewiki/topics/index.md").catch(() => null),
        }]
      : []),
  ];

  try {
    await safeIo.writeText(repoRoot, task.targetPath, finalPage);
    if (prepared.companion !== undefined) {
      await safeIo.writeText(
        repoRoot,
        prepared.companion.path,
        prepared.companion.content.endsWith("\n")
          ? prepared.companion.content
          : `${prepared.companion.content}\n`,
      );
    }
    if (task.kind === "flow") {
      await syncFlowsIndexHub(repoRoot, await loadFlowPresentations(repoRoot));
    } else if (task.kind === "topic") {
      await syncTopicsIndexHub(repoRoot, await loadTopicPresentations(repoRoot));
    }
    const result = await verify(repoRoot);
    const paths = new Set([
      task.targetPath,
      ...(prepared.companion !== undefined ? [prepared.companion.path] : []),
    ]);
    const issues = result.issues.filter(
      (issue) =>
        paths.has(issue.wikiPath) &&
        issue.code !== "baseline_entry_without_anchor" &&
        (prepared.rejectAnySeverity || issue.severity === "error"),
    );
    if (issues.length === 0) {
      return { ok: true, pageContent: finalPage, errors: [], rollbackFailed: false };
    }
    const failures = await restoreSnapshots(repoRoot, snapshots);
    return {
      ok: false,
      pageContent: finalPage,
      errors: submissionErrors(
        issues.map((issue) => ({
          code: issue.code,
          message: issue.detail,
          location: issue.code === "broken_anchor" ? "frontmatter" : "body",
          offending: issue.wikiPath,
        })),
      ),
      rollbackFailed: failures.length > 0,
    };
  } catch (error) {
    const failures = await restoreSnapshots(repoRoot, snapshots);
    return {
      ok: false,
      pageContent: finalPage,
      errors: [{
        code: failures.length > 0 ? "rollback_failed" : "write_verify_exception",
        message:
          `${error instanceof Error ? error.message : String(error)}` +
          (failures.length > 0 ? `; rollback failed: ${failures.join("; ")}` : ""),
        location: "global",
      }],
      rollbackFailed: failures.length > 0,
    };
  }
}

function diagnosticAttempt(
  attempt: number,
  content: string,
  errors: readonly AgentSubmissionError[],
  success: boolean,
): DiagnosticAttempt {
  const summarized = summarizeDiagnosticErrors(
    errors.map((error): ArtifactValidationError => ({
      code: error.code as ArtifactValidationError["code"],
      message: error.message,
      location:
        error.location === "frontmatter" || error.location === "section" ||
        error.location === "body" || error.location === "global"
          ? error.location
          : "global",
      ...(error.sectionSlug !== undefined ? { sectionSlug: error.sectionSlug } : {}),
      ...(error.offending !== undefined ? { offending: error.offending } : {}),
    })),
  );
  return {
    attempt,
    outcome: success ? "success" : "artifact_validation_failed",
    promptKind: attempt === 1 ? "initial" : "repair",
    errors: summarized.errors,
    truncatedErrorCount: summarized.truncatedErrorCount,
    candidateChars: content.length,
    candidateSha256: sha256(content),
    finishedAt: Date.now(),
  };
}

function persistAttempt(
  db: Database.Database,
  row: TaskRow,
  checkpoint: TaskCheckpoint,
  content: string,
  errors: AgentSubmissionError[],
  opts: {
    success: boolean;
    terminal: boolean;
    artifacts?: { wikiPath: string; pageHash: string; diagramPath?: string; diagramHash?: string };
  },
): BatchTaskStatus {
  const attempt = checkpoint.attempt + 1;
  checkpoint.attempt = attempt;
  checkpoint.usageHistory.push(usageAttempt(attempt));
  checkpoint.diagnosticHistory = [
    ...(checkpoint.diagnosticHistory ?? []),
    diagnosticAttempt(attempt, content, errors, opts.success),
  ];
  const status: BatchTaskStatus = opts.success
    ? "done"
    : opts.terminal
      ? "failed"
      : "running";
  checkpoint.status = status;
  if (opts.success) {
    checkpoint.finishedAt = Date.now();
    if (opts.artifacts === undefined) {
      throw new Error(`successful agent task #${row.id} has no artifact checkpoint`);
    }
    checkpoint.artifacts = opts.artifacts;
    delete checkpoint.error;
  } else if (opts.terminal) {
    checkpoint.finishedAt = Date.now();
    checkpoint.error = {
      code: errors[0]?.code ?? "agent_submission_failed",
      message: errors[0]?.message ?? "agent submission failed",
      failedAt: checkpoint.stage,
    };
  }
  db.prepare(
    "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
  ).run(status, JSON.stringify(checkpoint), Date.now(), row.id);
  return status;
}

export interface SubmitAgentBootstrapTaskOptions {
  repoRoot: string;
  taskId: number;
  path: string;
  content: string;
  /** Test seam; production uses the core verifier. */
  verify?: typeof runVerify;
}

/** Validates, writes, verifies, and checkpoints one agent-supplied task. */
export async function submitAgentBootstrapTask(
  opts: SubmitAgentBootstrapTaskOptions,
): Promise<AgentSubmissionResult> {
  const absRoot = nodePath.resolve(opts.repoRoot);
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const row = db.prepare(
      "SELECT t.id, t.run_id, t.stage, t.target, t.status, t.checkpoint_json " +
        "FROM batch_tasks t JOIN batch_runs r ON r.id = t.run_id " +
        "WHERE t.id = ? AND r.started_by = 'agent'",
    ).get(opts.taskId) as TaskRow | undefined;
    if (row === undefined) throw new Error(`unknown agent bootstrap task #${opts.taskId}`);
    const run = db.prepare(
      "SELECT id, status, config_json FROM batch_runs WHERE id = ?",
    ).get(row.run_id) as RunRow;
    if (run.status !== "running") {
      throw new Error(`agent bootstrap run #${run.id} is ${run.status}`);
    }
    if (row.status !== "running") {
      throw new Error(`agent bootstrap task #${row.id} is ${row.status}, not writable`);
    }
    const state = readAgentState(run);
    const { task, checkpoint } = readAgentTask(row);
    if (opts.path !== task.targetPath) {
      throw new Error(
        `task #${row.id} targets ${JSON.stringify(task.targetPath)}, not ${JSON.stringify(opts.path)}`,
      );
    }

    const existing = await safeIo.readText(absRoot, task.targetPath).catch(() => null);
    const owner = readOwner(existing);
    if (owner === "human" || owner === "untrusted" || owner === "unparseable") {
      const errors: AgentSubmissionError[] = [{
        code: owner === "human" ? "refused_owned_page" : "refused_untrusted_page",
        message:
          owner === "human"
            ? `the existing page declares owner: human and was left byte-identical`
            : `the existing page has untrusted ownership metadata and was left byte-identical`,
        location: "frontmatter",
        offending: task.targetPath,
      }];
      const taskStatus = persistAttempt(db, row, checkpoint, opts.content, errors, {
        success: false,
        terminal: true,
      });
      return {
        ok: false,
        runId: run.id,
        taskId: row.id,
        taskStatus,
        writtenPaths: [],
        errors,
        attempts: { used: checkpoint.attempt, limit: state.maxAttempts },
      };
    }

    const prepared = await prepareSubmission(absRoot, task, state, opts.content);
    if (prepared.errors.length > 0) {
      const terminal = checkpoint.attempt + 1 >= state.maxAttempts;
      const taskStatus = persistAttempt(
        db,
        row,
        checkpoint,
        opts.content,
        prepared.errors,
        { success: false, terminal },
      );
      return {
        ok: false,
        runId: run.id,
        taskId: row.id,
        taskStatus,
        writtenPaths: [],
        errors: prepared.errors,
        attempts: { used: checkpoint.attempt, limit: state.maxAttempts },
      };
    }

    const write = await writeAndVerifySubmission(
      absRoot,
      task,
      prepared,
      opts.verify ?? runVerify,
    );
    if (!write.ok) {
      const terminal = write.rollbackFailed || checkpoint.attempt + 1 >= state.maxAttempts;
      const taskStatus = persistAttempt(
        db,
        row,
        checkpoint,
        opts.content,
        write.errors,
        { success: false, terminal },
      );
      return {
        ok: false,
        runId: run.id,
        taskId: row.id,
        taskStatus,
        writtenPaths: [],
        errors: write.errors,
        attempts: { used: checkpoint.attempt, limit: state.maxAttempts },
      };
    }

    const writtenPaths = [
      task.targetPath,
      ...(prepared.companion !== undefined ? [prepared.companion.path] : []),
    ];
    const artifacts = {
      wikiPath: task.targetPath,
      pageHash: sha256(write.pageContent),
      ...(prepared.companion !== undefined
        ? {
            diagramPath: prepared.companion.path,
            diagramHash: sha256(
              prepared.companion.content.endsWith("\n")
                ? prepared.companion.content
                : `${prepared.companion.content}\n`,
            ),
          }
        : {}),
    };
    await commitDocumentationTask({
      repoRoot: absRoot,
      taskId: receiptTaskId(task),
      kind: task.kind,
      page: task.targetPath,
      symbolKeys: task.closedKeys,
      evidence: receiptEvidence(task),
      artifacts,
    });
    const taskStatus = persistAttempt(db, row, checkpoint, opts.content, [], {
      success: true,
      terminal: true,
      artifacts,
    });
    return {
      ok: true,
      runId: run.id,
      taskId: row.id,
      taskStatus,
      writtenPaths,
      errors: [],
      attempts: { used: checkpoint.attempt, limit: state.maxAttempts },
    };
  } finally {
    db.close();
  }
}

function receiptTaskId(task: PersistedAgentTask): string {
  switch (task.kind) {
    case "file-page": return `file:${task.targetPath}`;
    case "folder-page": return `folder:${task.targetPath}`;
    case "flow": return `flow:${task.candidate.slug}`;
    case "topic": return `topic:${task.candidate.evidenceHash}`;
    case "understanding": return `understanding:${task.evidenceHash}`;
  }
}

function receiptEvidence(task: PersistedAgentTask): unknown {
  switch (task.kind) {
    case "file-page": return task.fileUnit;
    case "folder-page": return task.folder;
    case "flow": return task.candidate;
    case "topic": return task.candidate;
    case "understanding": return { evidenceHash: task.evidenceHash };
  }
}
