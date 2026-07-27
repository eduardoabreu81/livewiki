import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  classifyModuleRole,
  type Module,
  type PathRoleConfig,
} from "./modules.js";
import { clipSentence, type RepoOrientation } from "./orientation.js";
import { maskCodeSpansPreservingLength } from "./markdown-mask.js";

export interface ModulePresentation {
  moduleId: string;
  displayTitle: string;
  pageExists: boolean;
  owner: "generated" | "mixed" | "human" | null;
}

export interface FlowPresentation {
  slug: string;
  title: string | null;
  modules: string[];
}

export interface TopicPresentation {
  slug: string;
  title: string;
  intent: string | null;
  modules: string[];
  flows: string[];
  owner: "generated" | "mixed" | "human" | null;
  planOrder: number;
}

export interface RelatedModule {
  moduleId: string;
  direction: "dependency" | "dependent" | "both";
}

const AUXILIARY_ROLE_SECTIONS = [
  { role: "fixture", heading: "Test fixtures" },
  { role: "tooling", heading: "Tooling and benchmarks" },
  { role: "docs", heading: "Repository documentation" },
] as const;

const NAV_START = "<!-- livewiki:navigate:start -->";
const NAV_END = "<!-- livewiki:navigate:end -->";
const TOPIC_RELATED_START = "<!-- livewiki:topics:start -->";
const TOPIC_RELATED_END = "<!-- livewiki:topics:end -->";
const MANUAL_BLOCK_RE = /<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->/g;

/**
 * Builds human-facing fallback titles without changing module identity.
 * Module.id remains the sole key used by graphs, pages, tasks, checkpoints,
 * anchors, and filenames; this map is presentation-only.
 */
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
  const stable = [...modules].sort(compareModules);
  const commonDirs = new Map(stable.map((module) => [module.id, commonDirectory(module.paths)]));
  const suffixes = new Map<string, string>();

  for (const module of stable) {
    const segments = commonDirs.get(module.id) ?? [];
    let chosen = segments.length > 0 ? segments.slice(-1) : ["repository"];
    for (let length = 1; length <= Math.max(segments.length, 1); length++) {
      const candidate = segments.length > 0 ? segments.slice(-length) : ["repository"];
      const key = candidate.join("/").toLowerCase();
      const collision = stable.some((other) => {
        if (other.id === module.id) return false;
        const otherSegments = commonDirs.get(other.id) ?? [];
        if (otherSegments.join("/").toLowerCase() === segments.join("/").toLowerCase()) return false;
        const otherCandidate = otherSegments.length > 0
          ? otherSegments.slice(-Math.min(length, otherSegments.length))
          : ["repository"];
        return otherCandidate.join("/").toLowerCase() === key;
      });
      chosen = candidate;
      if (!collision) break;
    }
    if (
      !chosen.some((segment) => /^(src|source)$/i.test(segment)) &&
      segments.some((segment) => /^(src|source)$/i.test(segment))
    ) {
      chosen = [...chosen, "source"];
    }
    suffixes.set(module.id, humanizeSegments(chosen));
  }

  const byDirectory = new Map<string, Module[]>();
  for (const module of stable) {
    const directoryKey = (commonDirs.get(module.id) ?? []).join("/").toLowerCase();
    const group = byDirectory.get(directoryKey) ?? [];
    group.push(module);
    byDirectory.set(directoryKey, group);
  }

  const result = new Map<string, string>();
  for (const module of stable) {
    let title = suffixes.get(module.id) ?? "Repository module";
    if (normalizeLabel(title) === normalizeLabel(module.id)) title += " module";
    const group = byDirectory.get((commonDirs.get(module.id) ?? []).join("/").toLowerCase()) ?? [];
    if (group.length > 1) {
      const part = group.findIndex((candidate) => candidate.id === module.id) + 1;
      title += ` — part ${part} of ${group.length}`;
    }
    result.set(module.id, title);
  }
  return result;
}

export async function loadModulePresentations(
  repoRoot: string,
  modules: Module[],
): Promise<Map<string, ModulePresentation>> {
  const fallbacks = buildDisplayTitleFallbacks(modules);
  const result = new Map<string, ModulePresentation>();
  for (const module of [...modules].sort(compareModules)) {
    const relPath = `livewiki/${module.id}.md`;
    const pageExists = await safeIo.exists(repoRoot, relPath).catch(() => false);
    let owner: ModulePresentation["owner"] = null;
    let displayTitle = fallbacks.get(module.id) ?? "Repository module";
    if (pageExists) {
      try {
        const source = await safeIo.readText(repoRoot, relPath);
        const parsed = parseFrontmatter(source);
        const rawOwner = parsed.frontmatter?.["owner"];
        if (rawOwner === "generated" || rawOwner === "mixed" || rawOwner === "human") {
          owner = rawOwner;
        }
        const rawTitle = parsed.frontmatter?.["title"];
        if (
          typeof rawTitle === "string" &&
          rawTitle.trim() !== "" &&
          normalizeLabel(rawTitle) !== normalizeLabel(module.id)
        ) {
          displayTitle = rawTitle.trim();
        }
      } catch {
        // A malformed page is not trusted as a source of navigation metadata.
      }
    }
    result.set(module.id, { moduleId: module.id, displayTitle, pageExists, owner });
  }
  return result;
}

/**
 * Reads every `livewiki/flows/<slug>.md` page (except the `index.md` hub)
 * into navigation metadata, sorted by slug. A missing/unparseable
 * frontmatter degrades honestly: title is null and the hub falls back to
 * the slug.
 */
export async function loadFlowPresentations(
  repoRoot: string,
): Promise<Map<string, FlowPresentation>> {
  const result = new Map<string, FlowPresentation>();
  const flowsDir = "livewiki/flows";
  if (!(await safeIo.exists(repoRoot, flowsDir).catch(() => false))) return result;
  const absFlows = await safeIo.resolveAndValidate(repoRoot, flowsDir);
  const slugs = (await nodeFs.readdir(absFlows, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => entry.name.slice(0, -".md".length))
    .sort();
  for (const slug of slugs) {
    let title: string | null = null;
    let modules: string[] = [];
    try {
      const source = await safeIo.readText(repoRoot, `${flowsDir}/${slug}.md`);
      const parsed = parseFrontmatter(source);
      if (parsed.frontmatter !== null) {
        const rawTitle = parsed.frontmatter["title"];
        if (typeof rawTitle === "string" && rawTitle.trim() !== "") {
          title = rawTitle.trim();
        }
        const rawModules = parsed.frontmatter["modules"];
        if (Array.isArray(rawModules)) {
          modules = rawModules.map((value) => value.trim()).filter((value) => value !== "");
        }
      }
    } catch {
      // A malformed flow page is not trusted as a source of navigation metadata.
    }
    result.set(slug, { slug, title, modules });
  }
  return result;
}

/** Reads accepted semantic topic pages into deterministic navigation metadata. */
export async function loadTopicPresentations(
  repoRoot: string,
  allowedSlugs?: ReadonlySet<string>,
): Promise<Map<string, TopicPresentation>> {
  const result = new Map<string, TopicPresentation>();
  const topicsDir = "livewiki/topics";
  if (!(await safeIo.exists(repoRoot, topicsDir).catch(() => false))) return result;
  const absTopics = await safeIo.resolveAndValidate(repoRoot, topicsDir);
  const names = (await nodeFs.readdir(absTopics, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const slug = name.slice(0, -".md".length);
    if (allowedSlugs !== undefined && !allowedSlugs.has(slug)) continue;
    try {
      const parsed = parseFrontmatter(await safeIo.readText(repoRoot, `${topicsDir}/${name}`));
      const title = parsed.frontmatter?.["title"];
      const intent = parsed.frontmatter?.["intent"];
      const modules = parsed.frontmatter?.["modules"];
      const flows = parsed.frontmatter?.["flows"];
      const owner = parsed.frontmatter?.["owner"];
      const kind = parsed.frontmatter?.["kind"];
      const rawOrder = parsed.frontmatter?.["order"];
      if (
        typeof title !== "string" || title.trim() === "" ||
        typeof intent !== "string" || intent.trim() === "" ||
        !Array.isArray(modules) || !Array.isArray(flows) ||
        (owner !== "generated" && owner !== "mixed" && owner !== "human") ||
        kind !== "topic" || typeof rawOrder !== "string" || !/^\d+$/.test(rawOrder)
      ) continue;
      const planOrder = Number(rawOrder);
      result.set(slug, {
        slug,
        title: title.trim(),
        intent: intent.trim(),
        modules: modules.map((value) => value.trim()).filter(Boolean),
        flows: flows.map((value) => value.trim()).filter(Boolean),
        owner,
        planOrder,
      });
    } catch {
      // Malformed pages are never navigation evidence.
    }
  }
  return result;
}

/**
 * D1.5 reader-digest entry for the quickstart. `responsibility` is the
 * accepted page's opening responsibility sentence; `null` renders a
 * title-link-only bullet (never invented prose).
 */
export interface ModuleDigest {
  id: string;
  title: string;
  responsibility: string | null;
}

/** Cap for the quickstart reader digest (top product modules shown). */
export const MODULE_DIGEST_CAP = 6;

/** Per-module cap (chars) for the accepted-page opening digest. */
const FLOW_MODULE_OPENING_CAP = 1200;

/** Cap (chars) for a single responsibility sentence in the reader digest. */
export const RESPONSIBILITY_MAX_CHARS = 240;

/**
 * Builds the quickstart reader digest from the accepted module pages: the
 * top product modules in prioritization order, each with its display title
 * and the opening responsibility sentence of its page. A module whose page
 * file is absent contributes nothing (it is not "in the wiki" and a link to
 * it would trip verify); a page that exists but yields no opening paragraph
 * contributes a title-link-only entry.
 */
export async function loadModuleDigests(
  repoRoot: string,
  ordered: Module[],
  presentations: Map<string, ModulePresentation>,
  pathRoleConfig?: PathRoleConfig,
  cap: number = MODULE_DIGEST_CAP,
): Promise<ModuleDigest[]> {
  const result: ModuleDigest[] = [];
  for (const module of ordered) {
    if (result.length >= cap) break;
    if (classifyModuleRole(module, pathRoleConfig) !== "product") continue;
    const presentation = presentations.get(module.id);
    if (presentation === undefined || !presentation.pageExists) continue;
    let responsibility: string | null = null;
    try {
      responsibility = extractModuleResponsibility(
        await safeIo.readText(repoRoot, `livewiki/${module.id}.md`),
      );
    } catch {
      // Unreadable page: title-link-only entry, never invented prose.
    }
    result.push({ id: module.id, title: presentation.displayTitle, responsibility });
  }
  return result;
}

interface ModuleOpeningParts {
  title: string | null;
  paragraph: string | null;
  howItFits: string | null;
}

/**
 * Parses the H1 + opening paragraph + `How it fits` block of an accepted
 * module page. Heading detection runs on the length-preserving masked view
 * so fenced code cannot fake an H1 or a section boundary; text comes from
 * the raw page. Shared by extractModuleOpeningDigest (stage-5 flow context)
 * and extractModuleResponsibility (D1.5 quickstart digest).
 */
function parseModuleOpening(pageContent: string): ModuleOpeningParts {
  let body = pageContent;
  try {
    body = parseFrontmatter(pageContent).body;
  } catch {
    // Unparseable frontmatter: digest the raw content.
  }
  const rawLines = body.split("\n");
  const maskedLines = maskCodeSpansPreservingLength(body).split("\n");

  let title: string | null = null;
  let paragraph: string | null = null;
  let howItFits: string | null = null;

  const h1Index = maskedLines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index >= 0) {
    title = rawLines[h1Index]!.trim().replace(/^#\s+/, "");
    const buffer: string[] = [];
    for (let i = h1Index + 1; i < maskedLines.length; i++) {
      const masked = maskedLines[i]!.trim();
      if (masked === "") {
        if (buffer.length > 0) break;
        continue;
      }
      if (/^#{1,6}\s/.test(masked)) break;
      buffer.push(rawLines[i]!.trim());
    }
    if (buffer.length > 0) paragraph = buffer.join(" ");
  }

  const howIndex = maskedLines.findIndex(
    (line) =>
      /^##\s+\S/.test(line.trim()) &&
      line.trim().slice(3).trim().toLocaleLowerCase("en-US") === "how it fits",
  );
  if (howIndex >= 0) {
    const block: string[] = [];
    for (let i = howIndex + 1; i < maskedLines.length; i++) {
      const masked = maskedLines[i]!.trim();
      if (/^#{1,6}\s/.test(masked)) break;
      if (masked !== "") block.push(rawLines[i]!.trim());
    }
    if (block.length > 0) howItFits = block.join(" ");
  }

  return { title, paragraph, howItFits };
}

/**
 * Extracts the H1 + responsibility paragraph + `How it fits` block of an
 * accepted module page, bounded to FLOW_MODULE_OPENING_CAP chars. Moved here
 * from batch.ts (D1.5) so both the batch flow-context builder and the
 * quickstart reader digest share one opening parser.
 */
export function extractModuleOpeningDigest(pageContent: string): string {
  const opening = parseModuleOpening(pageContent);
  const parts: string[] = [];
  if (opening.title !== null) parts.push(opening.title);
  if (opening.paragraph !== null) parts.push(opening.paragraph);
  if (opening.howItFits !== null) parts.push(`How it fits: ${opening.howItFits}`);
  let digest = parts.join("\n\n");
  if (digest.length > FLOW_MODULE_OPENING_CAP) {
    digest = digest.slice(0, FLOW_MODULE_OPENING_CAP) + "…";
  }
  return digest.length > 0 ? digest : "(opening unavailable)";
}

/**
 * The single-line opening responsibility sentence of an accepted module
 * page (the paragraph right after the H1), sentence-clipped to
 * RESPONSIBILITY_MAX_CHARS. `null` when the page has no usable opening.
 */
export function extractModuleResponsibility(pageContent: string): string | null {
  const { paragraph } = parseModuleOpening(pageContent);
  if (paragraph === null) return null;
  const singleLine = paragraph.replace(/\s+/g, " ").trim();
  if (singleLine === "") return null;
  return clipSentence(singleLine, RESPONSIBILITY_MAX_CHARS);
}

export function generateQuickstart(opts: {  totalFiles: number;
  totalSymbols: number;
  moduleCount: number;
  flowPresentations: Map<string, FlowPresentation>;
  topicPresentations?: Map<string, TopicPresentation>;
  hasAuxiliary: boolean;
  orientation?: RepoOrientation | null;
  moduleDigests?: ModuleDigest[];
}): string {
  const topicPresentations = opts.topicPresentations ?? new Map<string, TopicPresentation>();
  const moduleDigests = opts.moduleDigests ?? [];
  const orientationBlock = buildOrientationBlock(opts.orientation ?? null, moduleDigests);
  const digestBlock = buildModuleDigestBlock(moduleDigests);
  const workByIntent = [
    "- **Change product behavior:** start with [Tasks](tasks.md).",
  ];
  if (opts.flowPresentations.size > 0) {
    workByIntent.push("- **Follow end-to-end behavior:**");
    for (const slug of [...opts.flowPresentations.keys()].sort()) {
      const flow = opts.flowPresentations.get(slug)!;
      workByIntent.push(`  - [${flow.title ?? slug}](flows/${slug}.md)`);
    }
    workByIntent.push("  - Browse the complete [How it works](flows/index.md) index.");
  }
  workByIntent.push(
    "- **Inspect implementation relationships:** open the [Architecture overview](architecture/overview.md).",
  );
  if (opts.hasAuxiliary) {
    workByIntent.push(
      "- **Maintain tests, fixtures, tooling, benchmarks, or repository documentation:** open the [Auxiliary modules](auxiliary/index.md) inventory.",
    );
  }
  const lines = [
    "# Quickstart",
    "",
    ...orientationBlock,
    ...digestBlock,
    "Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.",
    "",
    ...(topicPresentations.size > 0
      ? [
          "## Understand the product",
          "",
          ...[...topicPresentations.values()].sort(compareTopics).map((topic) => `- [${topic.title}](topics/${topic.slug}.md)`),
          "- Browse the complete [Concept topics](topics/index.md) index.",
          "",
        ]
      : []),
    "## Work by intent",
    "",
    ...workByIntent,
    "",
    "## Document a repo",
    "",
    "1. Run `livewiki init` to index the repository and create deterministic navigation.",
    "2. Run `livewiki init --batch` when you also want generated module pages.",
    "3. Run `livewiki verify` before relying on or publishing the wiki.",
    "",
    "## Query the wiki from an agent",
    "",
    "1. Read `livewiki_quickstart` for orientation.",
    "2. Use `livewiki_search` to find relevant pages.",
    "3. Use `livewiki_read` to inspect the selected page in full.",
    "",
    "## Pay documentation debt",
    "",
    "1. Inspect open debt with `livewiki_debt` or `livewiki status --json`.",
    "2. Update a page with `livewiki_write_doc`, or edit it directly while preserving its ownership rules.",
    "3. Run `livewiki verify`, then close resolved items with `livewiki_resolve_debt`.",
    "",
    "## Repository facts",
    "",
    `- **${opts.totalFiles} files** indexed`,
    `- **${opts.totalSymbols} symbols** extracted`,
    `- **${opts.moduleCount} modules** identified`,
    "",
  ];
  return lines.join("\n");
}

/**
 * D1 product-orientation block: the FIRST section after the H1, before any
 * livewiki tool-meta. Emitted only when there is real evidence — a README
 * purpose excerpt and/or entry-point surfaces; never invented text. The
 * purpose is marked with its README provenance, and a detected fast-path
 * README section is pointed at by name (plain code span, not a link, so a
 * repo-root README never trips verify's internal-link check).
 *
 * D1.5: when the README yields no purpose but accepted module pages exist,
 * the purpose is synthesized deterministically from the module digests (up
 * to 3, Oxford comma) and marked with its own provenance line. A README
 * purpose always wins over the synthesis.
 */
function buildOrientationBlock(
  orientation: RepoOrientation | null,
  moduleDigests: ModuleDigest[] = [],
): string[] {
  const purpose = orientation?.purpose ?? null;
  const synthesizedPurpose = purpose === null
    ? synthesizePurposeFromDigests(moduleDigests)
    : null;
  const surfaces = orientation?.surfaces ?? [];
  if (purpose === null && synthesizedPurpose === null && surfaces.length === 0) return [];
  const block = ["## What this repository is", ""];
  if (purpose !== null) {
    block.push(purpose, "");
    const source = orientation?.readmePath ?? "README";
    block.push(`*(Purpose excerpt from the repository README: \`${source}\`.)*`, "");
  } else if (synthesizedPurpose !== null) {
    block.push(synthesizedPurpose, "");
    block.push("*(Synthesized from the generated module pages.)*", "");
  }
  if (surfaces.length > 0) {
    block.push("**Entry points and surfaces**", "");
    for (const surface of surfaces) block.push(`- ${surface}`);
    block.push("");
  }
  if (orientation !== null && orientation.fastPathSection !== null && orientation.readmePath !== null) {
    block.push(
      `**Fastest local path:** see the "${orientation.fastPathSection}" section of \`${orientation.readmePath}\`.`,
      "",
    );
  }
  return block;
}

/**
 * D1.5 reader digest: `## What you'll find in this wiki`, placed right after
 * the orientation block and before the remaining product sections. One
 * bullet per top product module (prioritization order, capped at
 * MODULE_DIGEST_CAP by the caller; re-capped here defensively). A module
 * without a parseable responsibility contributes a title-link only — prose
 * is never invented.
 */
function buildModuleDigestBlock(moduleDigests: ModuleDigest[]): string[] {
  if (moduleDigests.length === 0) return [];
  const block = ["## What you'll find in this wiki", ""];
  for (const digest of moduleDigests.slice(0, MODULE_DIGEST_CAP)) {
    block.push(
      digest.responsibility !== null
        ? `- **[${digest.title}](${digest.id}.md)** — ${digest.responsibility}`
        : `- **[${digest.title}](${digest.id}.md)**`,
    );
  }
  block.push("");
  return block;
}

/** Deterministic no-README purpose: up to 3 digests with a responsibility, Oxford comma. */
function synthesizePurposeFromDigests(moduleDigests: ModuleDigest[]): string | null {
  const usable = moduleDigests.filter((digest) => digest.responsibility !== null).slice(0, 3);
  if (usable.length === 0) return null;
  const items = usable.map((digest) => `${digest.title} (${digest.responsibility})`);
  const joined =
    items.length === 1
      ? items[0]!
      : items.length === 2
        ? `${items[0]} and ${items[1]}`
        : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  return `This repository is organized around ${joined}.`;
}

export function generateTasksPage(opts: {
  modules: Module[];
  ordered: Module[];
  presentations: Map<string, ModulePresentation>;
  flowPresentations: Map<string, FlowPresentation>;
  topicPresentations?: Map<string, TopicPresentation>;
  pathRoleConfig?: PathRoleConfig;
}): string {
  const order = new Map(opts.ordered.map((module, index) => [module.id, index]));
  const lines = [
    "---",
    "title: Tasks",
    "owner: generated",
    "---",
    "",
    "# Tasks",
    "",
    "Choose an end-to-end behavior or a product area. Auxiliary repository roles are available through one separate inventory.",
    "",
  ];
  const topicPresentations = opts.topicPresentations ?? new Map<string, TopicPresentation>();
  if (topicPresentations.size > 0) {
    lines.push("## Concept topics", "");
    for (const topic of [...topicPresentations.values()].sort(compareTopics)) {
      lines.push(`### [${topic.title}](topics/${topic.slug}.md)`, "");
    }
  }
  if (opts.flowPresentations.size > 0) {
    lines.push("## End-to-end behavior", "");
    for (const slug of [...opts.flowPresentations.keys()].sort()) {
      const flow = opts.flowPresentations.get(slug)!;
      lines.push(`### [${flow.title ?? slug}](flows/${slug}.md)`, "");
    }
  }

  const productModules = opts.modules
    .filter((module) => classifyModuleRole(module, opts.pathRoleConfig) === "product")
    .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || compareModules(a, b));
  if (productModules.length > 0) {
    lines.push("## Implementation reference", "");
    for (const module of productModules) {
      const presentation = opts.presentations.get(module.id)!;
      if (!presentation.pageExists) {
        lines.push(
          `### ${presentation.displayTitle}`,
          "",
          `Page unavailable: \`livewiki/${module.id}.md\` has not been generated yet.`,
          "",
        );
        continue;
      }
      lines.push(
        `### [${presentation.displayTitle}](${module.id}.md)`,
        "",
      );
    }
  }

  if (opts.modules.some((module) => classifyModuleRole(module, opts.pathRoleConfig) !== "product")) {
    lines.push(
      "## Auxiliary work",
      "",
      "Use the complete [Auxiliary modules](auxiliary/index.md) inventory for tests, fixtures, tooling, benchmarks, and repository documentation.",
      "",
    );
  }
  return lines.join("\n");
}

/**
 * Deterministic inventory for non-product modules. Primary hubs link only to
 * this page; individual auxiliary pages remain discoverable here and through
 * search without competing with product destinations.
 */
export function generateAuxiliaryIndex(opts: {
  modules: Module[];
  ordered: Module[];
  presentations: Map<string, ModulePresentation>;
  pathRoleConfig?: PathRoleConfig;
}): string {
  const order = new Map(opts.ordered.map((module, index) => [module.id, index]));
  const lines = [
    "---",
    "title: Auxiliary modules",
    "owner: generated",
    "---",
    "",
    "# Auxiliary modules",
    "",
    "Reference inventory for tests, fixtures, tooling, benchmarks, and repository documentation.",
    "",
  ];
  for (const section of AUXILIARY_ROLE_SECTIONS) {
    const members = opts.modules
      .filter((module) => classifyModuleRole(module, opts.pathRoleConfig) === section.role)
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || compareModules(a, b));
    if (members.length === 0) continue;
    lines.push(`## ${section.heading}`, "");
    for (const module of members) {
      const presentation = opts.presentations.get(module.id)!;
      lines.push(presentation.pageExists
        ? `- [${presentation.displayTitle}](../${module.id}.md)`
        : `- ${presentation.displayTitle} — page unavailable`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Deterministic `livewiki/flows/index.md` hub (SPEC §"Semantic product-flow
 * layer"): one entry per existing flow page in slug order — title (or slug)
 * and link only, no copied purpose sentence. No anchors, no lw: markers.
 */
export function generateFlowsIndex(opts: {
  presentations: Map<string, FlowPresentation>;
}): string {
  const lines = [
    "---",
    "title: How it works",
    "owner: generated",
    "---",
    "",
    "# How it works",
    "",
    "Each page below explains one principal end-to-end flow across modules, with its companion diagram.",
    "",
  ];
  for (const slug of [...opts.presentations.keys()].sort()) {
    const presentation = opts.presentations.get(slug)!;
    lines.push(`### [${presentation.title ?? slug}](${slug}.md)`, "");
  }
  return lines.join("\n");
}

/** Deterministic title+link-only concept hub. */
export function generateTopicsIndex(opts: {
  presentations: Map<string, TopicPresentation>;
}): string {
  const lines = [
    "---",
    "title: Concept topics",
    "owner: generated",
    "---",
    "",
    "# Concept topics",
    "",
  ];
  for (const topic of [...opts.presentations.values()].sort(compareTopics)) {
    lines.push(`- [${topic.title}](${topic.slug}.md)`);
  }
  lines.push("");
  return lines.join("\n");
}

export interface FlowsHubSyncResult {
  outcome: "written" | "removed" | "none" | "skipped-owner";
  /** Present on "skipped-owner": the preserved hub path. */
  path?: string;
  /**
   * Present on "skipped-owner": the declared owner, or null when the hub
   * has content but no parseable `owner: human|mixed` frontmatter.
   */
  owner?: "human" | "mixed" | null;
}

export interface AuxiliaryHubSyncResult {
  outcome: "written" | "removed" | "none" | "skipped-owner";
  path?: string;
  owner?: "human" | "mixed" | null;
}

export type TopicsHubSyncResult = FlowsHubSyncResult;

/**
 * Ensures a link-safe topics hub exists before the first topic page is
 * transactionally verified. The scaffold contains no candidate links, so an
 * interrupted run cannot leave broken navigation behind; final regeneration
 * fills or removes it. Existing non-generated content is preserved.
 */
export async function ensureTopicsIndexScaffold(
  repoRoot: string,
): Promise<TopicsHubSyncResult> {
  const relPath = "livewiki/topics/index.md";
  const content = await safeIo.readText(repoRoot, relPath).catch(() => null);
  if (content === null || content.trim() === "") {
    await safeIo.writeText(
      repoRoot,
      relPath,
      generateTopicsIndex({ presentations: new Map<string, TopicPresentation>() }),
    );
    return { outcome: "written" };
  }
  const owner = readHubDeclaredOwner(content);
  if (owner !== "generated") return { outcome: "skipped-owner", path: relPath, owner };
  return { outcome: "none" };
}

export async function syncTopicsIndexHub(
  repoRoot: string,
  presentations: Map<string, TopicPresentation>,
): Promise<TopicsHubSyncResult> {
  const relPath = "livewiki/topics/index.md";
  const content = await safeIo.readText(repoRoot, relPath).catch(() => null);
  if (presentations.size > 0) {
    if (content !== null && content.trim() !== "") {
      const owner = readHubDeclaredOwner(content);
      if (owner !== "generated") return { outcome: "skipped-owner", path: relPath, owner };
    }
    await safeIo.writeText(repoRoot, relPath, generateTopicsIndex({ presentations }));
    return { outcome: "written" };
  }
  if (content === null) return { outcome: "none" };
  if (readHubDeclaredOwner(content) !== "generated") return { outcome: "none" };
  await safeIo.remove(repoRoot, relPath);
  return { outcome: "removed" };
}

/**
 * Keeps `livewiki/flows/index.md` consistent with the flow pages on disk:
 * (re)writes the hub when at least one flow page exists; removes the hub
 * when none exist AND the file is a parseable `owner: generated` page.
 * Human, mixed, or unparseable hubs are preserved byte-for-byte in BOTH
 * directions — when flows exist the write is skipped and reported as
 * "skipped-owner" (path + owner), never silently (R10.1 C; hub-specific
 * conservative exception to the general `owner: mixed` semantics, because
 * the flat hub has no anchored sections for manual-block reinsertion).
 */
export async function syncFlowsIndexHub(
  repoRoot: string,
  presentations: Map<string, FlowPresentation>,
): Promise<FlowsHubSyncResult> {
  const relPath = "livewiki/flows/index.md";
  const content = await safeIo.readText(repoRoot, relPath).catch(() => null);
  if (presentations.size > 0) {
    if (content !== null && content.trim() !== "") {
      const owner = readHubDeclaredOwner(content);
      if (owner !== "generated") {
        return { outcome: "skipped-owner", path: relPath, owner };
      }
    }
    await safeIo.writeText(repoRoot, relPath, generateFlowsIndex({ presentations }));
    return { outcome: "written" };
  }
  if (content === null) return { outcome: "none" };
  let generated = false;
  try {
    generated = parseFrontmatter(content).frontmatter?.["owner"] === "generated";
  } catch {
    generated = false;
  }
  if (!generated) return { outcome: "none" };
  await safeIo.remove(repoRoot, relPath);
  return { outcome: "removed" };
}

/**
 * Keeps the single auxiliary inventory synchronized with the current module
 * plan. The flat hub follows the same conservative ownership rule as the flow
 * hub: only `owner: generated` content may be replaced or removed.
 */
export async function syncAuxiliaryIndexHub(opts: {
  repoRoot: string;
  modules: Module[];
  ordered: Module[];
  presentations: Map<string, ModulePresentation>;
  pathRoleConfig?: PathRoleConfig;
}): Promise<AuxiliaryHubSyncResult> {
  const relPath = "livewiki/auxiliary/index.md";
  const auxiliaryModules = opts.modules.filter(
    (module) => classifyModuleRole(module, opts.pathRoleConfig) !== "product",
  );
  const content = await safeIo.readText(opts.repoRoot, relPath).catch(() => null);
  if (auxiliaryModules.length > 0) {
    if (content !== null && content.trim() !== "") {
      const owner = readHubDeclaredOwner(content);
      if (owner !== "generated") {
        return { outcome: "skipped-owner", path: relPath, owner };
      }
    }
    await safeIo.writeText(opts.repoRoot, relPath, generateAuxiliaryIndex(opts));
    return { outcome: "written" };
  }
  if (content === null) return { outcome: "none" };
  const owner = readHubDeclaredOwner(content);
  if (owner !== "generated") {
    return { outcome: "skipped-owner", path: relPath, owner };
  }
  await safeIo.remove(opts.repoRoot, relPath);
  return { outcome: "removed" };
}

/**
 * Declared frontmatter owner of a generated navigation hub. Returns
 * "generated" ONLY for a parseable page declaring exactly `owner: generated`;
 * "human"/"mixed" for
 * those declarations; null for anything else (missing or unknown owner, or
 * unparseable frontmatter). BOM- and CRLF-tolerant, same house style as the
 * flow-page owner gate in init.ts.
 */
function readHubDeclaredOwner(content: string): "generated" | "human" | "mixed" | null {
  let s = content;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return null;
  s = s.replace(/\r\n/g, "\n");
  try {
    const raw = parseFrontmatter(s).frontmatter?.["owner"];
    return raw === "generated" || raw === "human" || raw === "mixed" ? raw : null;
  } catch {
    return null;
  }
}

export function selectRelatedModules(opts: {
  moduleId: string;
  modules: Module[];
  edges: Array<{ from: string; to: string }>;
  ordered: Module[];
  pathRoleConfig?: PathRoleConfig;
  limit?: number;
}): RelatedModule[] {
  const directions = new Map<string, { dependency: boolean; dependent: boolean }>();
  for (const edge of opts.edges) {
    if (edge.from === opts.moduleId && edge.to !== opts.moduleId) {
      const current = directions.get(edge.to) ?? { dependency: false, dependent: false };
      current.dependency = true;
      directions.set(edge.to, current);
    }
    if (edge.to === opts.moduleId && edge.from !== opts.moduleId) {
      const current = directions.get(edge.from) ?? { dependency: false, dependent: false };
      current.dependent = true;
      directions.set(edge.from, current);
    }
  }
  const byId = new Map(opts.modules.map((module) => [module.id, module]));
  const priority = new Map(opts.ordered.map((module, index) => [module.id, index]));
  return [...directions.entries()]
    .filter(([id]) => byId.has(id))
    .sort(([a], [b]) => {
      const aModule = byId.get(a)!;
      const bModule = byId.get(b)!;
      const aProduct = classifyModuleRole(aModule, opts.pathRoleConfig) === "product" ? 0 : 1;
      const bProduct = classifyModuleRole(bModule, opts.pathRoleConfig) === "product" ? 0 : 1;
      return aProduct - bProduct ||
        (priority.get(a) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        a.localeCompare(b);
    })
    .slice(0, opts.limit ?? 3)
    .map(([moduleId, value]) => ({
      moduleId,
      direction: value.dependency && value.dependent
        ? "both"
        : value.dependency
          ? "dependency"
          : "dependent",
    }));
}

export async function updateModuleNavigateBlocks(opts: {
  repoRoot: string;
  modules: Module[];
  ordered: Module[];
  edges: Array<{ from: string; to: string }>;
  presentations: Map<string, ModulePresentation>;
  topicPresentations?: Map<string, TopicPresentation>;
  pathRoleConfig?: PathRoleConfig;
}): Promise<string[]> {
  const changed: string[] = [];
  // Flow participation is loaded once: a module links at most one flow page
  // (lowest slug wins) when an existing flow page lists it in `modules:`.
  const flowPresentations = await loadFlowPresentations(opts.repoRoot);
  const topicPresentations = opts.topicPresentations ?? await loadTopicPresentations(opts.repoRoot);
  const flowByModule = new Map<string, FlowPresentation>();
  for (const slug of [...flowPresentations.keys()].sort()) {
    const flow = flowPresentations.get(slug)!;
    for (const moduleId of flow.modules) {
      if (!flowByModule.has(moduleId)) flowByModule.set(moduleId, flow);
    }
  }
  const topicsByModule = new Map<string, TopicPresentation[]>();
  for (const topic of [...topicPresentations.values()].sort(compareTopics)) {
    for (const moduleId of topic.modules) {
      const existing = topicsByModule.get(moduleId) ?? [];
      if (existing.length < 2) existing.push(topic);
      topicsByModule.set(moduleId, existing);
    }
  }
  for (const module of [...opts.modules].sort(compareModules)) {
    const presentation = opts.presentations.get(module.id);
    if (!presentation?.pageExists || (presentation.owner !== "generated" && presentation.owner !== "mixed")) continue;
    const relPath = `livewiki/${module.id}.md`;
    const source = await safeIo.readText(opts.repoRoot, relPath);
    const beforeManual = source.match(MANUAL_BLOCK_RE) ?? [];
    const linkableModules = opts.modules.filter((candidate) =>
      candidate.id === module.id || opts.presentations.get(candidate.id)?.pageExists,
    );
    const linkableIds = new Set(linkableModules.map((candidate) => candidate.id));
    const related = selectRelatedModules({
      moduleId: module.id,
      modules: linkableModules,
      edges: opts.edges.filter((edge) => linkableIds.has(edge.from) && linkableIds.has(edge.to)),
      ordered: opts.ordered,
      ...(opts.pathRoleConfig !== undefined ? { pathRoleConfig: opts.pathRoleConfig } : {}),
      limit: 3,
    });
    const navigate = buildNavigateBlock(
      module,
      related,
      opts.presentations,
      flowByModule.get(module.id) ?? null,
      topicsByModule.get(module.id) ?? [],
    );
    const existingStart = source.indexOf(NAV_START);
    const existingEnd = source.indexOf(NAV_END);
    let next: string;
    if (existingStart !== -1 || existingEnd !== -1) {
      if (existingStart === -1 || existingEnd < existingStart) continue;
      const end = existingEnd + NAV_END.length;
      const oldBlock = source.slice(existingStart, end);
      if (MANUAL_BLOCK_RE.test(oldBlock)) {
        MANUAL_BLOCK_RE.lastIndex = 0;
        continue;
      }
      MANUAL_BLOCK_RE.lastIndex = 0;
      next = `${source.slice(0, existingStart).trimEnd()}\n\n${navigate}${source.slice(end)}`;
    } else {
      next = `${source.trimEnd()}\n\n${navigate}\n`;
    }
    const afterManual = next.match(MANUAL_BLOCK_RE) ?? [];
    if (!sameStrings(beforeManual, afterManual)) {
      throw new Error(`Refusing to rewrite ${relPath}: lw:manual blocks would change`);
    }
    if (next !== source) {
      await safeIo.writeText(opts.repoRoot, relPath, next);
      changed.push(relPath);
    }
  }
  return changed;
}

/** Adds bounded topic routes to generated flow pages without copying topic prose. */
export async function updateFlowTopicLinks(
  repoRoot: string,
  topics: Map<string, TopicPresentation>,
): Promise<string[]> {
  const changed: string[] = [];
  const byFlow = new Map<string, TopicPresentation[]>();
  for (const topic of [...topics.values()].sort(compareTopics)) {
    for (const flowSlug of topic.flows) {
      const existing = byFlow.get(flowSlug) ?? [];
      if (existing.length < 2) existing.push(topic);
      byFlow.set(flowSlug, existing);
    }
  }
  const flows = await loadFlowPresentations(repoRoot);
  for (const flow of flows.values()) {
    const relPath = `livewiki/flows/${flow.slug}.md`;
    const source = await safeIo.readText(repoRoot, relPath);
    const owner = readHubDeclaredOwner(source);
    if (owner !== "generated" && owner !== "mixed") continue;
    const selected = byFlow.get(flow.slug) ?? [];
    const block = selected.length === 0
      ? ""
      : [
          TOPIC_RELATED_START,
          "## Concept topics",
          "",
          ...selected.map((topic) => `- [${topic.title}](../topics/${topic.slug}.md)`),
          TOPIC_RELATED_END,
        ].join("\n");
    const start = source.indexOf(TOPIC_RELATED_START);
    const endMarker = source.indexOf(TOPIC_RELATED_END);
    let next = source;
    if (start >= 0 && endMarker >= start) {
      const end = endMarker + TOPIC_RELATED_END.length;
      next = `${source.slice(0, start).trimEnd()}${block ? `\n\n${block}` : ""}${source.slice(end)}`;
    } else if (block !== "") {
      next = `${source.trimEnd()}\n\n${block}\n`;
    }
    if (next !== source) {
      const beforeManual = source.match(MANUAL_BLOCK_RE) ?? [];
      const afterManual = next.match(MANUAL_BLOCK_RE) ?? [];
      if (!sameStrings(beforeManual, afterManual)) throw new Error(`Refusing to rewrite ${relPath}: lw:manual blocks would change`);
      await safeIo.writeText(repoRoot, relPath, next);
      changed.push(relPath);
    }
  }
  return changed;
}

function buildNavigateBlock(
  module: Module,
  related: RelatedModule[],
  presentations: Map<string, ModulePresentation>,
  flow: FlowPresentation | null,
  topics: TopicPresentation[],
): string {
  const lines = [
    NAV_START,
    "## Navigate",
    "",
    "- [Quickstart](quickstart.md)",
    "- [Tasks](tasks.md)",
    "- [Architecture](architecture/overview.md)",
  ];
  if (flow !== null) {
    lines.push(`- Flow: [${flow.title ?? flow.slug}](flows/${flow.slug}.md)`);
  }
  for (const topic of topics.slice(0, 2)) {
    lines.push(`- Topic: [${topic.title}](topics/${topic.slug}.md)`);
  }
  for (const item of related) {
    const title = presentations.get(item.moduleId)?.displayTitle ?? item.moduleId;
    const label = item.direction === "both"
      ? "dependency and dependent"
      : item.direction;
    lines.push(`- [${title}](${item.moduleId}.md) — ${label}`);
  }
  lines.push(NAV_END);
  return lines.join("\n");
}

function commonDirectory(paths: string[]): string[] {
  const directories = paths
    .map((path) => nodePath.posix.dirname(path.replace(/\\/g, "/")))
    .map((directory) => directory === "." ? [] : directory.split("/").filter(Boolean));
  if (directories.length === 0) return [];
  const common: string[] = [];
  const shortest = Math.min(...directories.map((segments) => segments.length));
  for (let index = 0; index < shortest; index++) {
    const value = directories[0]![index]!;
    if (!directories.every((segments) => segments[index]?.toLowerCase() === value.toLowerCase())) break;
    common.push(value);
  }
  return common;
}

function humanizeSegments(segments: string[]): string {
  const words = segments.flatMap((segment) => segment.split(/[-_.]+/)).filter(Boolean);
  const acronyms = new Set(["api", "cli", "db", "fts", "llm", "mcp", "ui"]);
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    const value = lower === "src" ? "source" : lower === "docs" ? "documentation" : lower;
    if (acronyms.has(value)) return value.toUpperCase();
    return index === 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }).join(" ") || "Repository module";
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function compareModules(a: Module, b: Module): number {
  return a.id.localeCompare(b.id) ||
    [...a.paths].sort()[0]!.localeCompare([...b.paths].sort()[0]!);
}

function compareTopics(a: TopicPresentation, b: TopicPresentation): number {
  return a.planOrder - b.planOrder || a.slug.localeCompare(b.slug);
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
