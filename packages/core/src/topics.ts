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
  type Module,
  type PathRole,
  type PathRoleConfig,
} from "./modules.js";
import type { FlowCandidate } from "./flows.js";

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
  /** Complete defining span plus a small controlling-branch margin. */
  anchorSourceChars: Record<string, number>;
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

  const anchorSourceChars = await measureAnchorSourceChars(opts.repoRoot, Object.keys(anchorRoles));
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
  return { modules: activeModules, flows: activeFlows, anchorRoles: activeRoles, anchorSourceChars };
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
    const sourceChars = keys.reduce((sum, key) => sum + (inventory.anchorSourceChars[key] ?? 0), 0);
    if (opts.maxSourceChars !== undefined && sourceChars > opts.maxSourceChars) {
      errors.push(errorAt("topic_plan_source_budget", index, `selected evidence requires approximately ${sourceChars} source characters; maximum is ${opts.maxSourceChars}`));
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

async function measureAnchorSourceChars(repoRoot: string, keys: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (keys.length === 0) return result;
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
      const start = Math.max(0, row.startLine - 1 - 6);
      const end = Math.min(lines.length, row.endLine + 10);
      result[row.key] = lines.slice(start, end).join("\n").length + row.path.length + row.key.length + 48;
    }
    return result;
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
