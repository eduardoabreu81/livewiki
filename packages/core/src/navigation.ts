import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  classifyModuleRole,
  type Module,
  type PathRoleConfig,
} from "./modules.js";

export interface ModulePresentation {
  moduleId: string;
  displayTitle: string;
  pageExists: boolean;
  owner: "generated" | "mixed" | "human" | null;
  taskBullets: string[];
}

export interface RelatedModule {
  moduleId: string;
  direction: "dependency" | "dependent" | "both";
}

const ROLE_SECTIONS = [
  { role: "product", heading: "Product tasks" },
  { role: "fixture", heading: "Fixture tasks" },
  { role: "tooling", heading: "Tooling and benchmark tasks" },
  { role: "docs", heading: "Documentation maintenance tasks" },
] as const;

const NAV_START = "<!-- livewiki:navigate:start -->";
const NAV_END = "<!-- livewiki:navigate:end -->";
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
    let taskBullets: string[] = [];
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
        taskBullets = extractTaskBullets(parsed.body);
      } catch {
        // A malformed page is not trusted as a source of navigation metadata.
      }
    }
    result.set(module.id, { moduleId: module.id, displayTitle, pageExists, owner, taskBullets });
  }
  return result;
}

export function generateQuickstart(opts: {
  totalFiles: number;
  totalSymbols: number;
  moduleCount: number;
}): string {
  const lines = [
    "# Quickstart",
    "",
    "Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.",
    "",
    "## Choose a path",
    "",
    "- Start with [Tasks](tasks.md) when you know what you want to accomplish.",
    "- Open the [Architecture overview](architecture/overview.md) when you need the repository map and module relationships.",
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

export function generateTasksPage(opts: {
  modules: Module[];
  ordered: Module[];
  presentations: Map<string, ModulePresentation>;
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
    "Choose a module by the work you need to do. Product work is listed first; auxiliary repository roles are kept separate.",
    "",
  ];
  for (const section of ROLE_SECTIONS) {
    const members = opts.modules
      .filter((module) => classifyModuleRole(module, opts.pathRoleConfig) === section.role)
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) || compareModules(a, b));
    if (members.length === 0) continue;
    lines.push(`## ${section.heading}`, "");
    for (const module of members) {
      const presentation = opts.presentations.get(module.id)!;
      lines.push(
        presentation.pageExists
          ? `### [${presentation.displayTitle}](${module.id}.md)`
          : `### ${presentation.displayTitle}`,
        "",
        `Module ID: \`${module.id}\``,
        "",
      );
      if (!presentation.pageExists) {
        lines.push(`Page unavailable: \`livewiki/${module.id}.md\` has not been generated yet.`);
      } else if (presentation.taskBullets.length > 0) {
        lines.push(...presentation.taskBullets);
      } else {
        lines.push(`- Review the indexed reference for ${presentation.displayTitle}.`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
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
  pathRoleConfig?: PathRoleConfig;
}): Promise<string[]> {
  const changed: string[] = [];
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
    const navigate = buildNavigateBlock(module, related, opts.presentations);
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

function buildNavigateBlock(
  module: Module,
  related: RelatedModule[],
  presentations: Map<string, ModulePresentation>,
): string {
  const lines = [
    NAV_START,
    "## Navigate",
    "",
    "- [Quickstart](quickstart.md)",
    "- [Tasks](tasks.md)",
    "- [Architecture](architecture/overview.md)",
  ];
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

function extractTaskBullets(body: string): string[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.findIndex((line) => line.trim() === "## When to use this page");
  if (heading === -1) return [];
  const bullets: string[] = [];
  for (let index = heading + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^#{1,6}\s+/.test(line)) break;
    if (/^\s*[-*+]\s+\S/.test(line)) bullets.push(line);
  }
  return bullets;
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

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
