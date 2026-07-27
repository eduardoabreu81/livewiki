/**
 * Semantic topic planning for stage 5.
 *
 * The LLM may name and group concepts, but it receives a closed inventory and
 * cannot introduce modules, flows, or source anchors. All identities and disk
 * paths are derived deterministically from the accepted evidence.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { moduleSlug } from "./diagrams.js";
import { getAnchors, parseFrontmatter } from "./frontmatter.js";
import { sha256 } from "./hashes.js";
import {
  classifyModuleRole,
  classifyPathRole,
  matchesAnyPathPattern,
  type Module,
  type PathRole,
  type PathRoleConfig,
} from "./modules.js";
import type { FlowCandidate } from "./flows.js";
import { renderRationaleEvidence, type RationaleEvidenceRow } from "./rationale-evidence.js";

export const TOPIC_GROUP_NAMES = ["contract", "state", "output", "failure"] as const;
export type TopicGroupName = (typeof TOPIC_GROUP_NAMES)[number];
export type TopicKeyGroups = Record<TopicGroupName, string[]>;

export interface TopicModuleEvidence {
  id: string;
  title: string;
  paths: string[];
  role: PathRole;
  responsibility: string | null;
  whenToUse: string[];
  sections: string[];
  anchors: string[];
  importNeighbors: string[];
  signals: string[];
}

export interface TopicFlowEvidence {
  slug: string;
  title: string;
  modules: string[];
  anchors: string[];
  entryKeys: string[];
  boundaryKeys: string[];
  sinkKeys: string[];
  signals: { entry: string[]; persistence: string[]; external: string[] };
}

export interface TopicPlanningInventory {
  modules: TopicModuleEvidence[];
  flows: TopicFlowEvidence[];
  /** Exact role for every anchor known to the inventory. */
  anchorRoles: Record<string, PathRole>;
  /**
   * Exact length of each anchor's rendered evidence span
   * (`renderTopicSourceSpan` — the same helper `buildTopicDocContext` in
   * batch.ts uses), i.e. the defining span with a -6/+10 line margin
   * clamped to file bounds plus the `// === ... ===` header line.
   */
  anchorSourceChars: Record<string, number>;
  /**
   * Indexed rationale rows per anchor file (ordered by start_line, rowid),
   * so the planner can render the same bounded rationale block the
   * generator will. Optional so hand-built fixtures without rationale
   * evidence stay valid; treated as "no rationale rows" when absent.
   */
  anchorRationaleRows?: Record<string, RationaleEvidenceRow[]>;
}

/** One deterministic module cluster (Workstream B): a connected component of the product-module import graph plus its directly-connected auxiliary modules. */
export interface TopicModuleCluster {
  productModuleIds: string[];
  auxiliaryModuleIds: string[];
  /**
   * D2: how the cluster was formed when it is NOT a plain import-graph
   * component — "spoke" (isolated product singletons grouped by shared
   * auxiliary import-neighbors) or "overview" (the remaining singletons
   * merged into ONE product-overview cluster). Absent for import-graph
   * components. Drives the deterministic title in
   * `proposeTopicPlanDeterministically`.
   */
  origin?: "spoke" | "overview";
}

export interface TopicPlanProposal {
  title: string;
  intent: string;
  modules: string[];
  flows: string[];
  groups: TopicKeyGroups;
}

export interface TopicCandidate extends TopicPlanProposal {
  planOrder: number;
  evidenceHash: string;
  slug: string;
  seedKeys: string[];
}

export type TopicPlanValidationCode =
  | "topic_plan_invalid_json"
  | "topic_plan_invalid_shape"
  | "topic_plan_too_many"
  | "topic_plan_empty"
  | "topic_plan_unknown_reference"
  | "topic_plan_auxiliary_only"
  | "topic_plan_auxiliary_disconnected"
  | "topic_plan_unscoped_anchor"
  | "topic_plan_duplicate_title"
  | "topic_plan_duplicate_intent"
  | "topic_plan_module_budget"
  | "topic_plan_flow_budget"
  | "topic_plan_anchor_budget"
  | "topic_plan_missing_group"
  | "topic_plan_anchor_overlap"
  | "topic_plan_insufficient_product_evidence"
  | "topic_plan_source_budget"
  | "topic_plan_text_budget";

export interface TopicPlanValidationError {
  code: TopicPlanValidationCode;
  message: string;
  proposalIndex?: number;
}

export interface TopicPlanValidationResult {
  ok: boolean;
  candidates: TopicCandidate[];
  errors: TopicPlanValidationError[];
}

export interface TopicPlanValidationOptions {
  maxTopics: number;
  maxAnchors: number;
  minimumProductAnchorRatio?: number;
  maximumOverlapRatio?: number;
  maxSourceChars?: number;
  /**
   * D2: concern-grouped topic candidates (deployment/testing) merge into
   * the deterministic plan after the import-graph clusters. Default true;
   * set false to plan only import-graph cluster topics.
   */
  concernTopics?: boolean;
  /**
   * Cap (chars) for the rationale evidence block the generator will append
   * (`rationaleMaxChars` config, default 4,000). The planner's source-budget
   * estimate accounts this block exactly; 0/undefined disables it, matching
   * `buildTopicDocContext`.
   */
  rationaleMaxChars?: number;
}

/** The separator `buildTopicDocContext` (batch.ts) places between consecutive evidence spans. */
export const TOPIC_SOURCE_SPAN_SEPARATOR = "\n\n";

/**
 * Exact topic evidence span math, shared by the planner estimate
 * (`measureTopicAnchorEvidence` / `estimateTopicSourceChars` below) and the
 * generator context (`buildTopicDocContext` in batch.ts) so the two can
 * never drift: the `// === <key> (<path>:<start+1>-<end>) ===` header line
 * plus the file lines from `max(0, startLine-1-6)` to
 * `min(lines.length, endLine+10)` joined with "\n".
 */
export function renderTopicSourceSpan(
  symbol: { key: string; path: string; startLine: number; endLine: number },
  lines: readonly string[],
): string {
  const start = Math.max(0, symbol.startLine - 1 - 6);
  const end = Math.min(lines.length, symbol.endLine + 10);
  return `// === ${symbol.key} (${symbol.path}:${start + 1}-${end}) ===\n${lines.slice(start, end).join("\n")}`;
}

/**
 * Exact planner-side estimate of what `buildTopicDocContext` (batch.ts)
 * will measure for a candidate's evidence:
 *
 *   estimate = sum(renderTopicSourceSpan(k).length for measured k in keys)
 *            + TOPIC_SOURCE_SPAN_SEPARATOR.length * (measured count - 1)
 *            + renderRationaleEvidence(rows of distinct seed-key files,
 *              rationaleMaxChars).length
 *
 * "Measured" means present in `inventory.anchorSourceChars` (a key absent
 * from the index contributes no span and no separator, exactly like the
 * generator skipping a symbol missing from the DB). The rationale side is
 * per-FILE: the generator bounds ONE block over the candidate's distinct
 * seed-key files with the shared `renderRationaleEvidence` cap, so the
 * estimate does the same over `inventory.anchorRationaleRows` rather than
 * reserving a per-anchor share — file paths derive from the key prefix
 * (`path#name`), the same convention the rest of the topic code uses.
 *
 * An accepted candidate can therefore never overflow the hard
 * `topicMaxSourceChars` throw at generation time (Fix A, 2026-07-26).
 */
export function estimateTopicSourceChars(
  keys: readonly string[],
  inventory: TopicPlanningInventory,
  rationaleMaxChars = 0,
): number {
  const measured = keys.filter((key) => inventory.anchorSourceChars[key] !== undefined);
  if (measured.length === 0) return 0;
  let total = measured.reduce((sum, key) => sum + inventory.anchorSourceChars[key]!, 0);
  total += TOPIC_SOURCE_SPAN_SEPARATOR.length * (measured.length - 1);
  if (rationaleMaxChars > 0) {
    const paths = [...new Set(measured.map((key) => key.split("#", 1)[0] ?? ""))].sort();
    const rows = paths.flatMap((path) => inventory.anchorRationaleRows?.[path] ?? []);
    total += renderRationaleEvidence(rows, rationaleMaxChars).length;
  }
  return total;
}

/** Builds the closed, sorted planner inventory only from accepted pages. */
export async function buildTopicPlanningInventory(opts: {
  repoRoot: string;
  modules: Module[];
  pathRoleConfig?: PathRoleConfig;
  allowedFlowSlugs?: ReadonlySet<string>;
  edges?: ReadonlyArray<{ from: string; to: string }>;
  flowCandidates?: ReadonlyArray<FlowCandidate>;
}): Promise<TopicPlanningInventory> {
  const modules: TopicModuleEvidence[] = [];
  const anchorRoles: Record<string, PathRole> = {};
  const flowCandidateBySlug = new Map((opts.flowCandidates ?? []).map((candidate) => [candidate.slug, candidate]));

  for (const module of [...opts.modules].sort((a, b) => a.id.localeCompare(b.id))) {
    const relPath = `livewiki/${module.id}.md`;
    if (!(await safeIo.exists(opts.repoRoot, relPath).catch(() => false))) continue;
    const source = await safeIo.readText(opts.repoRoot, relPath).catch(() => null);
    if (source === null) continue;
    let parsed: ReturnType<typeof parseFrontmatter>;
    try {
      parsed = parseFrontmatter(source);
    } catch {
      continue;
    }
    if (parsed.frontmatter === null) continue;
    const role = classifyModuleRole(module, opts.pathRoleConfig);
    const anchors = uniqueSorted(getAnchors(parsed.frontmatter));
    for (const key of anchors) {
      const sourcePath = key.split("#", 1)[0] ?? "";
      anchorRoles[key] = classifyPathRole(sourcePath, opts.pathRoleConfig);
    }
    const rawTitle = parsed.frontmatter["title"];
    modules.push({
      id: module.id,
      title: typeof rawTitle === "string" && rawTitle.trim() !== "" ? rawTitle.trim() : module.id,
      paths: [...module.paths].sort(),
      role,
      responsibility: extractOpeningSentence(parsed.body),
      whenToUse: extractSectionBullets(parsed.body, "When to use this page"),
      sections: extractH2Titles(parsed.body),
      anchors,
      importNeighbors: uniqueSorted((opts.edges ?? []).flatMap((edge) =>
        edge.from === module.id ? [edge.to] : edge.to === module.id ? [edge.from] : []
      )),
      signals: classifyTopicSignals(module.paths, parsed.body),
    });
  }

  const flows: TopicFlowEvidence[] = [];
  const flowsDir = "livewiki/flows";
  if (await safeIo.exists(opts.repoRoot, flowsDir).catch(() => false)) {
    const absFlows = await safeIo.resolveAndValidate(opts.repoRoot, flowsDir);
    const names = (await nodeFs.readdir(absFlows, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
      .map((entry) => entry.name)
      .sort();
    for (const name of names) {
      const slug = name.slice(0, -".md".length);
      if (opts.allowedFlowSlugs !== undefined && !opts.allowedFlowSlugs.has(slug)) continue;
      if (!(await safeIo.exists(opts.repoRoot, `livewiki/diagrams/flow-${slug}.mmd`).catch(() => false))) continue;
      const source = await safeIo.readText(opts.repoRoot, `${flowsDir}/${name}`).catch(() => null);
      if (source === null) continue;
      try {
        const parsed = parseFrontmatter(source);
        if (parsed.frontmatter === null) continue;
        const title = parsed.frontmatter["title"];
        const rawModules = parsed.frontmatter["modules"];
        if (typeof title !== "string" || !Array.isArray(rawModules)) continue;
        const anchors = uniqueSorted(getAnchors(parsed.frontmatter));
        for (const key of anchors) {
          if (anchorRoles[key] !== undefined) continue;
          const sourcePath = key.split("#", 1)[0] ?? "";
          anchorRoles[key] = classifyPathRole(sourcePath, opts.pathRoleConfig);
        }
        const candidate = flowCandidateBySlug.get(slug);
        flows.push({
          slug,
          title: title.trim(),
          modules: uniqueSorted(rawModules),
          anchors,
          entryKeys: uniqueSorted(candidate?.entryKeys ?? []),
          boundaryKeys: uniqueSorted(candidate?.boundaryKeys ?? []),
          sinkKeys: uniqueSorted(candidate?.sinkKeys ?? []),
          signals: candidate?.signals ?? { entry: [], persistence: [], external: [] },
        });
      } catch {
        // Invalid pages are not accepted evidence and remain outside the plan.
      }
    }
  }

  const anchorEvidence = await measureTopicAnchorEvidence(opts.repoRoot, Object.keys(anchorRoles));
  const anchorSourceChars = anchorEvidence.anchorSourceChars;
  const activeKeys = new Set(Object.keys(anchorSourceChars));
  const activeModules = modules.map((module) => ({
    ...module,
    anchors: module.anchors.filter((key) => activeKeys.has(key)),
  }));
  const activeFlows = flows.map((flow) => {
    const anchors = flow.anchors.filter((key) => activeKeys.has(key));
    const accepted = new Set(anchors);
    return {
      ...flow,
      anchors,
      entryKeys: flow.entryKeys.filter((key) => accepted.has(key)),
      boundaryKeys: flow.boundaryKeys.filter((key) => accepted.has(key)),
      sinkKeys: flow.sinkKeys.filter((key) => accepted.has(key)),
    };
  });
  const activeRoles = Object.fromEntries(
    Object.entries(anchorRoles).filter(([key]) => activeKeys.has(key)),
  ) as Record<string, PathRole>;
  return {
    modules: activeModules,
    flows: activeFlows,
    anchorRoles: activeRoles,
    anchorSourceChars,
    anchorRationaleRows: anchorEvidence.anchorRationaleRows,
  };
}

/** Stable JSON representation used by the planner prompt and evidence hash. */
export function serializeTopicPlanningInventory(inventory: TopicPlanningInventory): string {
  return JSON.stringify({ modules: inventory.modules, flows: inventory.flows, anchorSourceChars: inventory.anchorSourceChars }, null, 2);
}

/** Validates planner JSON against the closed evidence inventory. */
export function validateTopicPlan(
  raw: string,
  inventory: TopicPlanningInventory,
  opts: TopicPlanValidationOptions,
): TopicPlanValidationResult {
  const errors: TopicPlanValidationError[] = [];
  let value: unknown;
  try {
    value = JSON.parse(stripOuterJsonFence(raw));
  } catch (error) {
    return fail("topic_plan_invalid_json", `planner output is not valid JSON: ${String(error)}`);
  }

  const rawTopics = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value["topics"])
      ? value["topics"]
      : null;
  if (isRecord(value) && Object.keys(value).some((key) => key !== "topics")) {
    return fail("topic_plan_invalid_shape", "top-level planner object may contain only `topics`");
  }
  if (rawTopics === null) return fail("topic_plan_invalid_shape", "expected an array or { topics: [...] }");
  if (rawTopics.length === 0) return fail("topic_plan_empty", "planner returned no topic proposals");
  if (rawTopics.length > opts.maxTopics) {
    return fail("topic_plan_too_many", `planner returned ${rawTopics.length} topics; maximum is ${opts.maxTopics}`);
  }

  const moduleById = new Map(inventory.modules.map((module) => [module.id, module]));
  const flowBySlug = new Map(inventory.flows.map((flow) => [flow.slug, flow]));
  const knownAnchors = new Set([
    ...inventory.modules.flatMap((module) => module.anchors),
    ...inventory.flows.flatMap((flow) => flow.anchors),
  ]);
  const parsed: TopicPlanProposal[] = [];

  for (let index = 0; index < rawTopics.length; index++) {
    const proposal = parseProposal(rawTopics[index], index, errors);
    if (proposal === null) continue;
    if (proposal.title.length > 80 || proposal.intent.length > 160 || /[\r\n]/.test(`${proposal.title}${proposal.intent}`)) {
      errors.push(errorAt("topic_plan_text_budget", index, "title must be at most 80 characters and intent at most 160, with no line breaks"));
    }
    const modules = uniqueSorted(proposal.modules);
    const flows = uniqueSorted(proposal.flows);
    const groupedKeys = TOPIC_GROUP_NAMES.flatMap((group) => proposal.groups[group]);
    const keys = uniqueSorted(groupedKeys);
    if (modules.length !== proposal.modules.length || flows.length !== proposal.flows.length || keys.length !== groupedKeys.length) {
      errors.push(errorAt("topic_plan_invalid_shape", index, "modules, flows, and evidence groups must not contain duplicate entries; an anchor belongs to exactly one group"));
    }
    const productModules = modules.filter((id) => moduleById.get(id)?.role === "product");
    const unknownModules = modules.filter((id) => !moduleById.has(id));
    const unknownFlows = flows.filter((slug) => !flowBySlug.has(slug));
    const unknownAnchors = keys.filter((key) => !knownAnchors.has(key));
    if (unknownModules.length || unknownFlows.length || unknownAnchors.length) {
      errors.push(errorAt("topic_plan_unknown_reference", index,
        `unknown references: modules=[${unknownModules.join(", ")}], flows=[${unknownFlows.join(", ")}], anchors=[${unknownAnchors.join(", ")}]`));
    }
    const scopedAnchors = new Set([
      ...modules.flatMap((id) => moduleById.get(id)?.anchors ?? []),
      ...flows.flatMap((slug) => flowBySlug.get(slug)?.anchors ?? []),
    ]);
    const unscopedAnchors = keys.filter((key) => knownAnchors.has(key) && !scopedAnchors.has(key));
    if (unscopedAnchors.length > 0) {
      errors.push(errorAt(
        "topic_plan_unscoped_anchor",
        index,
        `anchors are outside the selected module/flow evidence: ${unscopedAnchors.join(", ")}`,
      ));
    }
    if (modules.length < 2 || modules.length > 6) {
      const hasWideFlow = flows.some((slug) => (flowBySlug.get(slug)?.modules.length ?? 0) >= 3);
      if (!(modules.length === 1 && hasWideFlow)) {
        errors.push(errorAt("topic_plan_module_budget", index, "a topic requires 2-6 modules, or one module plus a flow spanning at least three"));
      }
    }
    const hasWideFlow = flows.some((slug) => (flowBySlug.get(slug)?.modules.length ?? 0) >= 3);
    if (productModules.length < 2 && !hasWideFlow) {
      errors.push(errorAt("topic_plan_module_budget", index, "a topic requires at least two product modules unless an accepted flow spans at least three modules"));
    }
    if (flows.length > 2) errors.push(errorAt("topic_plan_flow_budget", index, "a topic may cite at most two flows"));
    if (productModules.length === 0) {
      errors.push(errorAt("topic_plan_auxiliary_only", index, "a topic requires at least one product-role module"));
    }
    for (const moduleId of modules.filter((id) => moduleById.get(id)?.role !== "product")) {
      const neighbors = new Set(moduleById.get(moduleId)?.importNeighbors ?? []);
      if (!productModules.some((productId) => neighbors.has(productId))) {
        errors.push(errorAt("topic_plan_auxiliary_disconnected", index, `auxiliary module "${moduleId}" is not directly connected to a selected product module`));
      }
    }
    if (keys.length < 5 || keys.length > opts.maxAnchors) {
      errors.push(errorAt("topic_plan_anchor_budget", index, `a topic requires 5-${opts.maxAnchors} unique anchors`));
    }
    const sourceChars = estimateTopicSourceChars(keys, inventory, opts.rationaleMaxChars ?? 0);
    if (opts.maxSourceChars !== undefined && sourceChars > opts.maxSourceChars) {
      errors.push(errorAt("topic_plan_source_budget", index, `selected evidence requires ${sourceChars} source characters; maximum is ${opts.maxSourceChars}`));
    }
    for (const group of TOPIC_GROUP_NAMES) {
      if (proposal.groups[group].length === 0) {
        errors.push(errorAt("topic_plan_missing_group", index, `evidence group ${group} is empty`));
      }
    }
    const productAnchors = keys.filter((key) => inventory.anchorRoles[key] === "product");
    const minimumRatio = opts.minimumProductAnchorRatio ?? 0.75;
    if (keys.length > 0 && productAnchors.length / keys.length < minimumRatio) {
      errors.push(errorAt("topic_plan_insufficient_product_evidence", index,
        `product-anchor ratio ${(productAnchors.length / keys.length).toFixed(2)} is below ${minimumRatio}`));
    }
    parsed.push({ ...proposal, modules, flows, groups: normalizeGroups(proposal.groups) });
  }

  const titles = new Map<string, number>();
  const intents = new Map<string, number>();
  for (let index = 0; index < parsed.length; index++) {
    const proposal = parsed[index]!;
    addDuplicateError(titles, normalizeLabel(proposal.title), index, "topic_plan_duplicate_title", "title", errors);
    addDuplicateError(intents, normalizeLabel(proposal.intent), index, "topic_plan_duplicate_intent", "intent", errors);
  }

  const overlapLimit = opts.maximumOverlapRatio ?? 0.75;
  for (let left = 0; left < parsed.length; left++) {
    for (let right = left + 1; right < parsed.length; right++) {
      const a = new Set(TOPIC_GROUP_NAMES.flatMap((group) => parsed[left]!.groups[group]));
      const b = new Set(TOPIC_GROUP_NAMES.flatMap((group) => parsed[right]!.groups[group]));
      const denominator = Math.min(a.size, b.size);
      const overlap = denominator === 0 ? 0 : [...a].filter((key) => b.has(key)).length / denominator;
      if (overlap > overlapLimit) {
        const loser = compareProposalPreference(parsed[left]!, parsed[right]!, moduleById) <= 0 ? right : left;
        const winner = loser === right ? left : right;
        errors.push(errorAt("topic_plan_anchor_overlap", loser,
          `anchor overlap ${(overlap * 100).toFixed(0)}% with preferred proposal ${winner + 1} exceeds ${(overlapLimit * 100).toFixed(0)}%`));
      }
    }
  }

  if (errors.length > 0) return { ok: false, candidates: [], errors };
  const candidates = parsed.map((proposal, index) => toCandidate(proposal, index));
  return { ok: true, candidates, errors: [] };

  function fail(code: TopicPlanValidationCode, message: string): TopicPlanValidationResult {
    return { ok: false, candidates: [], errors: [{ code, message }] };
  }
}

/**
 * Workstream B: connected components over the product-module import
 * graph (`importNeighbors`, already computed by
 * `buildTopicPlanningInventory`), each with its directly-connected
 * auxiliary modules attached. Deterministic and correct-by-construction
 * against `topic_plan_auxiliary_disconnected` — an auxiliary module only
 * ever joins a cluster because it is directly connected to one of that
 * cluster's product modules.
 *
 * D2 spoke-merge fallback: isolated product singletons (no product-product
 * edges) are no longer dropped. They are first grouped by shared
 * AUXILIARY import-neighbors (spoke-sharing): two singletons belong to the
 * same cluster when they share at least one directly-connected auxiliary
 * module, transitively (union-find over the sorted ids keeps the grouping
 * deterministic). Singletons that share no auxiliary neighbor with any
 * other singleton are merged into ONE "Product overview" cluster — only
 * when at least two remain; a lone leftover singleton can never satisfy
 * the 2-product-module floor and is still never proposed. A cluster whose
 * total module count (product + auxiliary) exceeds 6 is trimmed
 * (auxiliary first, then product down to a floor of 2) to fit
 * `topic_plan_module_budget`. The caller caps the resulting cluster list
 * at `maxTopics` in deterministic (sorted first-id) order.
 */
export function clusterModulesByImportGraph(inventory: TopicPlanningInventory): TopicModuleCluster[] {
  const productModules = inventory.modules.filter((m) => m.role === "product");
  const productIds = new Set(productModules.map((m) => m.id));
  const productAdjacency = new Map<string, Set<string>>();
  for (const m of productModules) {
    productAdjacency.set(m.id, new Set(m.importNeighbors.filter((id) => productIds.has(id) && id !== m.id)));
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of [...productIds].sort()) {
    if (visited.has(id)) continue;
    const queue = [id];
    visited.add(id);
    const component: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of [...(productAdjacency.get(current) ?? [])].sort()) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort());
  }

  const multi = components.filter((c) => c.length >= 2).map((c) => [...c]);
  const singletonIds = components
    .filter((c) => c.length < 2)
    .map((c) => c[0])
    .filter((id): id is string => id !== undefined)
    .sort();

  // Spoke-sharing: a singleton's relevant neighbors are its directly-
  // connected AUXILIARY modules (an isolated singleton has no product
  // neighbors by construction).
  const moduleById = new Map(inventory.modules.map((m) => [m.id, m]));
  const auxNeighborsBySingleton = new Map<string, Set<string>>(
    singletonIds.map((id) => [
      id,
      new Set(
        (moduleById.get(id)?.importNeighbors ?? []).filter(
          (neighbor) => !productIds.has(neighbor) && moduleById.has(neighbor),
        ),
      ),
    ]),
  );
  const parent = new Map<string, string>(singletonIds.map((id) => [id, id]));
  const findRoot = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  for (let i = 0; i < singletonIds.length; i++) {
    for (let j = i + 1; j < singletonIds.length; j++) {
      const left = auxNeighborsBySingleton.get(singletonIds[i]!)!;
      const right = auxNeighborsBySingleton.get(singletonIds[j]!)!;
      if ([...left].some((neighbor) => right.has(neighbor))) {
        const rootLeft = findRoot(singletonIds[i]!);
        const rootRight = findRoot(singletonIds[j]!);
        if (rootLeft !== rootRight) parent.set(rootRight, rootLeft);
      }
    }
  }
  const groupsByRoot = new Map<string, string[]>();
  for (const id of singletonIds) {
    const root = findRoot(id);
    const group = groupsByRoot.get(root) ?? [];
    group.push(id);
    groupsByRoot.set(root, group);
  }
  const spokeGroups = [...groupsByRoot.values()]
    .map((members) => members.sort())
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
  const spokeClusters = spokeGroups.filter((members) => members.length >= 2);
  const remainder = spokeGroups
    .filter((members) => members.length < 2)
    .flat()
    .sort();

  const auxiliaryModules = inventory.modules.filter((m) => m.role !== "product");
  const attachAuxiliary = (productModuleIds: string[], origin?: "spoke" | "overview"): TopicModuleCluster => {
    const productSet = new Set(productModuleIds);
    const auxiliaryModuleIds = auxiliaryModules
      .filter((m) => m.importNeighbors.some((n) => productSet.has(n)))
      .map((m) => m.id)
      .sort();
    return {
      ...capClusterSize({ productModuleIds, auxiliaryModuleIds }),
      ...(origin !== undefined ? { origin } : {}),
    };
  };
  const clusters = [
    ...multi.map((ids) => attachAuxiliary(ids)),
    ...spokeClusters.map((ids) => attachAuxiliary(ids, "spoke")),
    ...(remainder.length >= 2 ? [attachAuxiliary(remainder, "overview")] : []),
  ];
  return clusters.sort((a, b) => a.productModuleIds[0]!.localeCompare(b.productModuleIds[0]!));
}

/** Trims a cluster (auxiliary first, then product down to a floor of 2) to fit the 6-module budget. */
function capClusterSize(cluster: TopicModuleCluster): TopicModuleCluster {
  let { productModuleIds, auxiliaryModuleIds } = cluster;
  while (productModuleIds.length + auxiliaryModuleIds.length > 6 && auxiliaryModuleIds.length > 0) {
    auxiliaryModuleIds = auxiliaryModuleIds.slice(0, -1);
  }
  while (productModuleIds.length + auxiliaryModuleIds.length > 6 && productModuleIds.length > 2) {
    productModuleIds = productModuleIds.slice(0, -1);
  }
  return { productModuleIds, auxiliaryModuleIds };
}

/**
 * D2 concern groups: deployment evidence paths. Matched against module
 * source paths with the same gitignore-style combined matcher the
 * path-role classifier uses (`matchesAnyPathPattern`).
 */
export const DEPLOYMENT_PATH_PATTERNS = [
  "**/Dockerfile*",
  "**/docker-compose*",
  "**/*.bat",
  "**/*.ps1",
  "**/scripts/**",
  "**/deploy/**",
];

interface ConcernGroupRule {
  /** Deterministic topic title for the concern. */
  title: string;
  /** Wording used in the deterministic intent sentence. */
  intentSignal: string;
  matches(module: TopicModuleEvidence): boolean;
}

/**
 * D2 concern-group rules, evaluated in this FIXED order (deterministic
 * precedence after the import clusters): deployment surfaces, then
 * testing fixtures (modules whose `PathRole` classification is
 * "fixture").
 */
const CONCERN_GROUP_RULES: readonly ConcernGroupRule[] = [
  {
    title: "Deployment",
    intentSignal: "deployment",
    matches: (module) => module.paths.some((path) => matchesAnyPathPattern(path, DEPLOYMENT_PATH_PATTERNS)),
  },
  {
    title: "Testing",
    intentSignal: "testing",
    matches: (module) => module.role === "fixture",
  },
];

/**
 * D2: concern-grouped clusters — at most ONE per concern rule, built from
 * the same closed inventory and trimmed by the same 6-module budget as
 * import clusters. A matched product module joins directly; a matched
 * non-product module joins only when directly connected to a selected
 * product module (correct-by-construction against
 * `topic_plan_auxiliary_disconnected`). When no matched module is
 * product-role (e.g. a fixtures-only testing group), product modules
 * directly connected to a matched module are pulled in so the group can
 * satisfy the product floor (`topic_plan_auxiliary_only`); when there are
 * none, the rule produces no cluster.
 */
export function collectConcernTopicClusters(
  inventory: TopicPlanningInventory,
): Array<{ cluster: TopicModuleCluster; title: string; intentSignal: string }> {
  const productIds = new Set(inventory.modules.filter((m) => m.role === "product").map((m) => m.id));
  const moduleById = new Map(inventory.modules.map((m) => [m.id, m]));
  const results: Array<{ cluster: TopicModuleCluster; title: string; intentSignal: string }> = [];
  for (const rule of CONCERN_GROUP_RULES) {
    const matched = inventory.modules
      .filter((module) => rule.matches(module))
      .map((m) => m.id)
      .sort();
    if (matched.length === 0) continue;
    const matchedSet = new Set(matched);
    let productModuleIds = matched.filter((id) => productIds.has(id));
    if (productModuleIds.length === 0) {
      productModuleIds = inventory.modules
        .filter((m) => m.role === "product" && m.importNeighbors.some((n) => matchedSet.has(n)))
        .map((m) => m.id)
        .sort();
    }
    if (productModuleIds.length === 0) continue;
    const productSet = new Set(productModuleIds);
    const auxiliaryModuleIds = matched
      .filter((id) => !productSet.has(id))
      .filter((id) => (moduleById.get(id)?.importNeighbors ?? []).some((n) => productSet.has(n)))
      .sort();
    results.push({
      cluster: capClusterSize({ productModuleIds, auxiliaryModuleIds }),
      title: rule.title,
      intentSignal: rule.intentSignal,
    });
  }
  return results;
}

/** Maps a module's dominant `classifyTopicSignals` tag to the topic evidence group it best fits. */
const SIGNAL_TO_TOPIC_GROUP: Readonly<Record<string, TopicGroupName>> = {
  configuration: "contract",
  "entry/boundary": "contract",
  "persistence/state": "state",
  output: "output",
  "validation/recovery": "failure",
};

/**
 * Workstream B: deterministic anchor selection for one module cluster.
 * Buckets every anchor into one of the 4 evidence groups by inheriting
 * its owning module's dominant signal (via `SIGNAL_TO_TOPIC_GROUP`),
 * ranks within each bucket by caller centrality (a cheap "how central is
 * this symbol" proxy from `computeCallerCentrality`) descending, fills
 * every group's floor of 1 anchor first (borrowing from the unclassified
 * pool when a bucket is empty), then round-robins the remaining budget —
 * tracking the running product-anchor ratio exactly like
 * `repairTopicPlanSourceBudgetMechanically`'s `canRemove`, but additive
 * instead of subtractive. Returns null when a group's floor cannot be
 * met at all, or the 5-anchor floor is unreachable.
 */
export function selectTopicAnchors(
  cluster: TopicModuleCluster,
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: { maxAnchors: number; maxSourceChars?: number; minimumProductAnchorRatio?: number; rationaleMaxChars?: number },
): TopicKeyGroups | null {
  const moduleIds = [...cluster.productModuleIds, ...cluster.auxiliaryModuleIds];
  const moduleById = new Map(inventory.modules.map((m) => [m.id, m]));
  const minimumRatio = opts.minimumProductAnchorRatio ?? 0.75;

  interface Entry {
    key: string;
    group: TopicGroupName | null;
    chars: number;
    isProduct: boolean;
    centrality: number;
  }
  const entries: Entry[] = [];
  const seenKeys = new Set<string>();
  for (const moduleId of moduleIds) {
    const module = moduleById.get(moduleId);
    if (module === undefined) continue;
    const dominantGroup = module.signals.map((s) => SIGNAL_TO_TOPIC_GROUP[s]).find((g) => g !== undefined) ?? null;
    for (const key of [...module.anchors].sort()) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      entries.push({
        key,
        group: dominantGroup,
        chars: inventory.anchorSourceChars[key] ?? 0,
        isProduct: inventory.anchorRoles[key] === "product",
        centrality: centrality.get(key) ?? 0,
      });
    }
  }
  if (entries.length === 0) return null;

  const byGroup = new Map<TopicGroupName, Entry[]>(TOPIC_GROUP_NAMES.map((g) => [g, []]));
  const unclassified: Entry[] = [];
  for (const entry of entries) {
    if (entry.group !== null) byGroup.get(entry.group)!.push(entry);
    else unclassified.push(entry);
  }
  const rank = (a: Entry, b: Entry): number =>
    b.centrality - a.centrality || a.chars - b.chars || a.key.localeCompare(b.key);
  for (const list of byGroup.values()) list.sort(rank);
  unclassified.sort(rank);

  const picked = new Set<Entry>();
  const groups: TopicKeyGroups = { contract: [], state: [], output: [], failure: [] };
  const rankedAll = [...entries].sort(rank);

  for (const group of TOPIC_GROUP_NAMES) {
    const own = byGroup.get(group)!.find((e) => !picked.has(e));
    // Prefer the group's own dominant-signal bucket, then the fully
    // unclassified pool, then — since a real cluster often has anchors
    // concentrated in just 1-2 signals — the best remaining entry from
    // ANY bucket. A group already handled earlier in this loop already
    // secured its own floor pick, so borrowing one of its leftovers here
    // never starves it.
    const chosen =
      own ?? unclassified.find((e) => !picked.has(e)) ?? rankedAll.find((e) => !picked.has(e));
    if (chosen === undefined) return null;
    picked.add(chosen);
    groups[group].push(chosen.key);
  }

  const pickedKeys = [...picked].map((e) => e.key);
  let productCount = [...picked].filter((e) => e.isProduct).length;
  let totalCount = picked.size;

  const pools = new Map<TopicGroupName, Entry[]>(
    TOPIC_GROUP_NAMES.map((g) => [g, [...byGroup.get(g)!, ...unclassified].sort(rank)]),
  );

  let progressed = true;
  while (progressed && totalCount < opts.maxAnchors) {
    progressed = false;
    for (const group of TOPIC_GROUP_NAMES) {
      if (totalCount >= opts.maxAnchors) break;
      const pool = pools.get(group)!;
      const entry = pool.find((e) => !picked.has(e));
      if (entry === undefined) continue;
      // Exact estimate (spans + separators + rationale block), not an
      // incremental sum: the rationale block is bounded per FILE set with
      // a global cap, so its marginal cost is not additive per anchor.
      const nextChars = estimateTopicSourceChars([...pickedKeys, entry.key], inventory, opts.rationaleMaxChars ?? 0);
      if (opts.maxSourceChars !== undefined && nextChars > opts.maxSourceChars) continue;
      const nextTotal = totalCount + 1;
      const nextProduct = productCount + (entry.isProduct ? 1 : 0);
      if (nextProduct / nextTotal < minimumRatio) continue;
      picked.add(entry);
      groups[group].push(entry.key);
      pickedKeys.push(entry.key);
      productCount = nextProduct;
      totalCount = nextTotal;
      progressed = true;
    }
  }

  if (totalCount < 5) return null;
  return groups;
}

/** The five headings a topic page may carry an `lw:anchors` marker in. */
export type TopicRequiredSection =
  | "purpose"
  | "when-to-use-this-page"
  | "behavioral-contract"
  | "failure-and-recovery"
  | "change-map";

export type TopicKeySectionMap = ReadonlyMap<string, TopicRequiredSection>;

/**
 * Deterministic replacement for the freeform "PRIMARY-SECTION RULE" the LLM
 * used to decide on its own for topic pages — same motivation as
 * `assignFlowKeySections` in flows.ts. Without it, the model repeatedly
 * double-cited a key across sections (most often re-listing an already-used
 * key in "Change map", whose natural role as a recap invites exactly that),
 * producing `duplicate_anchor` thrashing that neither the mechanical nor the
 * LLM repair path reliably recovered from (confirmed via a real paid E2E
 * run, 2026-07-23).
 *
 * Maps each of the candidate's 4 evidence groups (contract/state/output/
 * failure) onto one of the 5 required sections, then routes every leftover
 * key to "behavioral-contract" as the catch-all — mirroring flow's
 * boundary/other/auxiliary -> "ordered-flow" pattern. `selectTopicAnchors`
 * guarantees every group is non-empty and the total is >= 5, so `purpose`,
 * `when-to-use-this-page`, `failure-and-recovery`, and `change-map` each
 * always get their one guaranteed key, and the >= 5 floor guarantees
 * `behavioral-contract` always gets at least one leftover key too — total
 * over `candidate.seedKeys`, never a starved required section.
 */
export function assignTopicKeySections(candidate: TopicCandidate): TopicKeySectionMap {
  const map = new Map<string, TopicRequiredSection>();
  const { contract, state, output, failure } = candidate.groups;
  if (contract[0] !== undefined) map.set(contract[0], "purpose");
  for (const key of contract.slice(1)) map.set(key, "behavioral-contract");
  if (state[0] !== undefined) map.set(state[0], "when-to-use-this-page");
  for (const key of state.slice(1)) map.set(key, "behavioral-contract");
  if (failure[0] !== undefined) map.set(failure[0], "failure-and-recovery");
  for (const key of failure.slice(1)) map.set(key, "behavioral-contract");
  if (output[0] !== undefined) map.set(output[0], "change-map");
  for (const key of output.slice(1)) map.set(key, "behavioral-contract");
  // Any seed key outside the 4 groups (should not normally happen, since
  // `selectTopicAnchors` only ever picks from them) still needs a home.
  for (const key of candidate.seedKeys) {
    if (!map.has(key)) map.set(key, "behavioral-contract");
  }
  return map;
}

/**
 * Workstream B orchestrator: clusters modules (`clusterModulesByImportGraph`,
 * including the D2 spoke-merge/overview fallback), selects anchors per
 * cluster (`selectTopicAnchors`), builds a deterministic title/intent/flows
 * for each surviving cluster, appends the D2 concern-grouped candidates
 * (deployment/testing, at most one each, import clusters first), caps the
 * merged plan at `maxTopics`, and validates the WHOLE batch through the
 * unchanged `validateTopicPlan` — construction and validation stay
 * decoupled, so a proposal that construction got wrong (e.g. a duplicate
 * title against another cluster) is dropped and the remainder re-validated,
 * rather than surfacing an invalid plan. Returns already-accepted
 * `TopicCandidate`s, ready for the same per-topic prose-generation loop the
 * LLM-proposed path fed before.
 */
export function proposeTopicPlanDeterministically(
  inventory: TopicPlanningInventory,
  centrality: ReadonlyMap<string, number>,
  opts: TopicPlanValidationOptions,
): TopicCandidate[] {
  const clusters = clusterModulesByImportGraph(inventory);
  const moduleById = new Map(inventory.modules.map((m) => [m.id, m]));
  const selectOpts = {
    maxAnchors: opts.maxAnchors,
    ...(opts.maxSourceChars !== undefined ? { maxSourceChars: opts.maxSourceChars } : {}),
    ...(opts.minimumProductAnchorRatio !== undefined
      ? { minimumProductAnchorRatio: opts.minimumProductAnchorRatio }
      : {}),
    ...(opts.rationaleMaxChars !== undefined ? { rationaleMaxChars: opts.rationaleMaxChars } : {}),
  };
  const flowsWithin = (moduleIds: string[]): string[] =>
    inventory.flows
      .filter((f) => f.modules.length > 0 && f.modules.every((m) => moduleIds.includes(m)))
      .map((f) => f.slug)
      .sort()
      .slice(0, 2);

  let proposals: TopicPlanProposal[] = [];
  for (const cluster of clusters) {
    const groups = selectTopicAnchors(cluster, inventory, centrality, selectOpts);
    if (groups === null) continue;

    const moduleIds = [...cluster.productModuleIds, ...cluster.auxiliaryModuleIds].sort();
    const primaryId = cluster.productModuleIds[0]!;
    const secondId = cluster.productModuleIds[1];
    const primaryTitle = moduleById.get(primaryId)?.title ?? primaryId;
    const secondTitle = secondId !== undefined ? moduleById.get(secondId)?.title ?? secondId : undefined;
    const rawTitle =
      cluster.origin === "overview"
        ? "Product overview"
        : secondTitle !== undefined
          ? `${primaryTitle} and ${secondTitle}`
          : `${primaryTitle} overview`;
    const title = rawTitle.slice(0, 80);
    const dominantSignal =
      cluster.productModuleIds.map((id) => moduleById.get(id)?.signals[0]).find((s) => s !== undefined) ??
      "cross-module behavior";
    const intent = `Explains how ${moduleIds.length} related modules coordinate ${dominantSignal}.`.slice(0, 160);

    proposals.push({ title, intent, modules: moduleIds, flows: flowsWithin(moduleIds), groups });
  }

  // D2: concern-grouped candidates (deployment, testing) merge into the
  // same plan AFTER the import clusters — deterministic precedence — each
  // concern producing at most one candidate through the same anchor
  // selection and whole-plan validation. A concern group whose anchor
  // selection fails (zero or insufficient evidence) yields NO candidate,
  // never a stub.
  if (opts.concernTopics !== false) {
    for (const { cluster, title, intentSignal } of collectConcernTopicClusters(inventory)) {
      const groups = selectTopicAnchors(cluster, inventory, centrality, selectOpts);
      if (groups === null) continue;
      const moduleIds = [...cluster.productModuleIds, ...cluster.auxiliaryModuleIds].sort();
      const intent = `Explains how ${moduleIds.length} related modules coordinate ${intentSignal}.`.slice(0, 160);
      proposals.push({ title, intent, modules: moduleIds, flows: flowsWithin(moduleIds), groups });
    }
  }

  // D2: maxTopics caps the merged plan (import clusters first, then
  // concern groups) BEFORE validation — validateTopicPlan rejects a plan
  // larger than maxTopics outright (with no proposal index), which would
  // otherwise discard even the valid prefix.
  proposals = proposals.slice(0, opts.maxTopics);

  for (;;) {
    if (proposals.length === 0) return [];
    const raw = JSON.stringify({ topics: proposals });
    const result = validateTopicPlan(raw, inventory, opts);
    if (result.ok) return result.candidates;
    const badIndexes = new Set(
      result.errors.map((e) => e.proposalIndex).filter((i): i is number => i !== undefined),
    );
    if (badIndexes.size === 0) return [];
    proposals = proposals.filter((_, i) => !badIndexes.has(i));
  }
}

/**
 * Cross-checked mechanical repair for `topic_plan_source_budget` alone.
 *
 * Priority-0 follow-up (2026-07-21 improvement pass): the v22 paid E2E
 * showed the planner proposing evidence up to ~120k chars against a 40k
 * cap and never converging in 3 repair rounds. Unlike the flow-diagram
 * budget (a pure rendering concern), a topic's anchor set is cross-
 * constrained — dropping anchors blindly can push `keys.length` below the
 * 5-anchor floor, empty an evidence group, or drop the product-anchor
 * ratio below the accepted minimum. This function drops the COSTLIEST
 * anchors first (non-product before product, to protect the ratio) and
 * re-validates the WHOLE plan afterward — it only returns a result when
 * every constraint still holds, product or not. Only proposals actually
 * flagged with `topic_plan_source_budget` are touched; a co-occurring
 * unrelated error on a DIFFERENT proposal (e.g. another candidate hitting
 * `topic_plan_text_budget`/`topic_plan_anchor_budget`) no longer blocks
 * this repair outright — the mandatory final `validateTopicPlan` re-check
 * is the actual safety net, so any error this function can't fix (on any
 * proposal) still surfaces as a `null` return, same as before.
 *
 * Priority-0 follow-up #2 (2026-07-21, v23 paid E2E): the original gate
 * required EVERY reported error across the whole plan to be
 * `topic_plan_source_budget`, so a single unrelated violation on an
 * unrelated candidate topic silently disabled this repair for the whole
 * batch and the exhausted failure repeated unchanged across 3 rounds.
 */
export function repairTopicPlanSourceBudgetMechanically(
  raw: string,
  errors: readonly TopicPlanValidationError[],
  inventory: TopicPlanningInventory,
  opts: TopicPlanValidationOptions,
): { content: string; result: TopicPlanValidationResult } | null {
  if (errors.length === 0) return null;
  if (opts.maxSourceChars === undefined) return null;
  const maxSourceChars = opts.maxSourceChars;

  let value: unknown;
  try {
    value = JSON.parse(stripOuterJsonFence(raw));
  } catch {
    return null;
  }
  const rawTopics = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value["topics"])
      ? value["topics"]
      : null;
  if (rawTopics === null) return null;

  const flaggedIndexes = new Set(
    errors
      .filter((e) => e.code === "topic_plan_source_budget")
      .map((e) => e.proposalIndex)
      .filter((i): i is number => i !== undefined),
  );
  if (flaggedIndexes.size === 0) return null;
  const minimumRatio = opts.minimumProductAnchorRatio ?? 0.75;

  for (const index of flaggedIndexes) {
    const proposalRaw = rawTopics[index];
    if (!isRecord(proposalRaw) || !isRecord(proposalRaw["groups"])) return null;
    const groups = proposalRaw["groups"];

    interface Entry {
      group: TopicGroupName;
      key: string;
      chars: number;
      isProduct: boolean;
    }
    const entries: Entry[] = [];
    for (const groupName of TOPIC_GROUP_NAMES) {
      const groupKeys = groups[groupName];
      if (!isStringArray(groupKeys)) return null;
      for (const key of groupKeys) {
        entries.push({
          group: groupName,
          key,
          chars: inventory.anchorSourceChars[key] ?? 0,
          isProduct: inventory.anchorRoles[key] === "product",
        });
      }
    }

    let totalChars = estimateTopicSourceChars(
      entries.map((e) => e.key),
      inventory,
      opts.rationaleMaxChars ?? 0,
    );
    if (totalChars <= maxSourceChars) continue; // nothing to drop for this proposal

    const removed = new Set<Entry>();
    const canRemove = (entry: Entry): boolean => {
      const remainingKeys = entries.length - removed.size - 1;
      if (remainingKeys < 5) return false;
      const remainingInGroup =
        entries.filter((e) => e.group === entry.group).length -
        [...removed].filter((e) => e.group === entry.group).length;
      if (remainingInGroup <= 1) return false;
      if (entry.isProduct) {
        const remainingProduct =
          entries.filter((e) => e.isProduct && !removed.has(e)).length - 1;
        if (remainingProduct / remainingKeys < minimumRatio) return false;
      }
      return true;
    };

    const dropPass = (pool: Entry[]): void => {
      for (const entry of [...pool].sort((a, b) => b.chars - a.chars)) {
        if (totalChars <= maxSourceChars) break;
        if (removed.has(entry) || !canRemove(entry)) continue;
        removed.add(entry);
        // Recompute the exact estimate after each removal — the rationale
        // block's per-file-set cap makes the marginal cost non-additive.
        totalChars = estimateTopicSourceChars(
          entries.filter((e) => !removed.has(e)).map((e) => e.key),
          inventory,
          opts.rationaleMaxChars ?? 0,
        );
      }
    };
    dropPass(entries.filter((e) => !e.isProduct));
    if (totalChars > maxSourceChars) dropPass(entries.filter((e) => e.isProduct));
    if (totalChars > maxSourceChars) return null; // can't fit without breaking another rule

    for (const groupName of TOPIC_GROUP_NAMES) {
      groups[groupName] = entries
        .filter((e) => e.group === groupName && !removed.has(e))
        .map((e) => e.key);
    }
  }

  const repairedRaw = JSON.stringify(value);
  const result = validateTopicPlan(repairedRaw, inventory, opts);
  if (!result.ok) return null;
  return { content: repairedRaw, result };
}

/** Lower values win overlap conflicts, independent of planner array order. */
function compareProposalPreference(
  left: TopicPlanProposal,
  right: TopicPlanProposal,
  moduleById: ReadonlyMap<string, TopicModuleEvidence>,
): number {
  const leftGroups = TOPIC_GROUP_NAMES.filter((name) => left.groups[name].length > 0).length;
  const rightGroups = TOPIC_GROUP_NAMES.filter((name) => right.groups[name].length > 0).length;
  if (leftGroups !== rightGroups) return rightGroups - leftGroups;
  const leftProductModules = left.modules.filter((id) => moduleById.get(id)?.role === "product").length;
  const rightProductModules = right.modules.filter((id) => moduleById.get(id)?.role === "product").length;
  if (leftProductModules !== rightProductModules) return rightProductModules - leftProductModules;
  return normalizeLabel(left.title).localeCompare(normalizeLabel(right.title));
}

function parseProposal(value: unknown, index: number, errors: TopicPlanValidationError[]): TopicPlanProposal | null {
  if (!isRecord(value)) {
    errors.push(errorAt("topic_plan_invalid_shape", index, "proposal must be an object"));
    return null;
  }
  const allowedFields = new Set(["title", "intent", "modules", "flows", "groups"]);
  const unknownFields = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    errors.push(errorAt("topic_plan_invalid_shape", index, `proposal contains unknown fields: ${unknownFields.join(", ")}`));
    return null;
  }
  const title = value["title"];
  const intent = value["intent"];
  const modules = value["modules"];
  const flows = value["flows"];
  const groups = value["groups"];
  if (
    typeof title !== "string" || title.trim() === "" ||
    typeof intent !== "string" || intent.trim() === "" ||
    !isStringArray(modules) || !isStringArray(flows) || !isRecord(groups)
  ) {
    errors.push(errorAt("topic_plan_invalid_shape", index, "proposal requires title, intent, modules[], flows[], and groups"));
    return null;
  }
  const parsedGroups = {} as TopicKeyGroups;
  const unknownGroups = Object.keys(groups).filter((key) => !TOPIC_GROUP_NAMES.includes(key as TopicGroupName));
  if (unknownGroups.length > 0) {
    errors.push(errorAt("topic_plan_invalid_shape", index, `groups contains unknown fields: ${unknownGroups.join(", ")}`));
    return null;
  }
  for (const name of TOPIC_GROUP_NAMES) {
    const rawGroup = groups[name];
    if (!isStringArray(rawGroup)) {
      errors.push(errorAt("topic_plan_invalid_shape", index, `groups.${name} must be a string array`));
      return null;
    }
    parsedGroups[name] = [...rawGroup];
  }
  return { title: title.trim(), intent: intent.trim(), modules: [...modules], flows: [...flows], groups: parsedGroups };
}

function toCandidate(proposal: TopicPlanProposal, planOrder: number): TopicCandidate {
  const groups = normalizeGroups(proposal.groups);
  const evidence = JSON.stringify({ modules: proposal.modules, flows: proposal.flows, groups });
  const evidenceHash = sha256(evidence).slice(0, 12);
  const base = moduleSlug(proposal.title) || "topic";
  return {
    ...proposal,
    planOrder,
    groups,
    evidenceHash,
    slug: `${base}-${evidenceHash.slice(0, 8)}`,
    seedKeys: uniqueSorted(TOPIC_GROUP_NAMES.flatMap((group) => groups[group])),
  };
}

function normalizeGroups(groups: TopicKeyGroups): TopicKeyGroups {
  return {
    contract: uniqueSorted(groups.contract),
    state: uniqueSorted(groups.state),
    output: uniqueSorted(groups.output),
    failure: uniqueSorted(groups.failure),
  };
}

function extractOpeningSentence(body: string): string | null {
  const withoutHeading = body.replace(/^\s*#[^\n]*\n/, "").trim();
  const paragraph = withoutHeading.split(/\n\s*\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
  return paragraph === "" || paragraph.startsWith("## ") ? null : paragraph;
}

function classifyTopicSignals(paths: readonly string[], body: string): string[] {
  const haystack = `${paths.join(" ")} ${extractH2Titles(body).join(" ")}`.toLowerCase();
  const signals: string[] = [];
  if (/config|preset|provider|setting|option|environment/.test(haystack)) signals.push("configuration");
  if (/database|\bdb\b|persist|storage|store|cache|checkpoint|state/.test(haystack)) signals.push("persistence/state");
  if (/validat|verif|schema|guard|safety|rollback|recover|error/.test(haystack)) signals.push("validation/recovery");
  if (/output|export|render|write|emit|response|artifact/.test(haystack)) signals.push("output");
  if (/command|cli|route|handler|server|entry/.test(haystack)) signals.push("entry/boundary");
  return signals;
}

/** Measured evidence cost for every requested anchor, exact against the generator. */
export interface TopicAnchorEvidence {
  anchorSourceChars: Record<string, number>;
  anchorRationaleRows: Record<string, RationaleEvidenceRow[]>;
}

/**
 * Measures the exact per-anchor evidence cost used by the planner estimate:
 * `anchorSourceChars[key]` is the full length of the rendered span produced
 * by `renderTopicSourceSpan` (the same helper `buildTopicDocContext` uses),
 * and `anchorRationaleRows` holds the indexed rationale rows per anchor file
 * (per-file slices of the same `ORDER BY f.path, r.start_line, r.id` query
 * the generator runs, so each slice stays in start_line/rowid order).
 */
export async function measureTopicAnchorEvidence(repoRoot: string, keys: string[]): Promise<TopicAnchorEvidence> {
  const anchorSourceChars: Record<string, number> = {};
  const anchorRationaleRows: Record<string, RationaleEvidenceRow[]> = {};
  if (keys.length === 0) return { anchorSourceChars, anchorRationaleRows };
  const db = openIndex(await safeIo.resolveAndValidate(repoRoot, ".livewiki/index.db"));
  try {
    const rows = db.prepare(
      `SELECT s.key, s.start_line AS startLine, s.end_line AS endLine, f.path
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.status = 'active' AND s.key IN (${keys.map(() => "?").join(",")})`,
    ).all(...keys) as Array<{ key: string; path: string; startLine: number; endLine: number }>;
    const files = new Map<string, string[]>();
    for (const row of rows) {
      let lines = files.get(row.path);
      if (lines === undefined) {
        const source = await nodeFs.readFile(nodePath.join(repoRoot, row.path), "utf8").catch(() => "");
        lines = source.split("\n");
        files.set(row.path, lines);
      }
      anchorSourceChars[row.key] = renderTopicSourceSpan(row, lines).length;
    }
    const paths = [...new Set(rows.map((row) => row.path))].sort();
    if (paths.length > 0) {
      const rationaleRows = db.prepare(
        `SELECT f.path, r.symbol_key, r.kind, r.text, r.start_line
         FROM rationales r JOIN files f ON f.id = r.file_id
         WHERE f.path IN (${paths.map(() => "?").join(",")})
         ORDER BY f.path, r.start_line, r.id`,
      ).all(...paths) as RationaleEvidenceRow[];
      for (const row of rationaleRows) {
        (anchorRationaleRows[row.path] ??= []).push(row);
      }
    }
    return { anchorSourceChars, anchorRationaleRows };
  } finally {
    db.close();
  }
}

function extractH2Titles(body: string): string[] {
  return [...body.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]!.trim());
}

function extractSectionBullets(body: string, title: string): string[] {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "mi"));
  if (!match?.[1]) return [];
  return [...match[1].matchAll(/^\s*[-*]\s+(.+?)\s*$/gm)].map((item) => item[1]!.trim());
}

function stripOuterJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeLabel(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function errorAt(code: TopicPlanValidationCode, proposalIndex: number, message: string): TopicPlanValidationError {
  return { code, proposalIndex, message };
}

function addDuplicateError(
  seen: Map<string, number>,
  value: string,
  index: number,
  code: "topic_plan_duplicate_title" | "topic_plan_duplicate_intent",
  label: string,
  errors: TopicPlanValidationError[],
): void {
  const previous = seen.get(value);
  if (previous !== undefined) {
    errors.push(errorAt(code, index, `${label} duplicates proposal ${previous + 1}`));
  } else {
    seen.set(value, index);
  }
}
