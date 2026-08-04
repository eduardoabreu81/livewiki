/**
 * Deterministic Mermaid diagram generation. No LLM is involved.
 *
 * Output paths:
 * - `livewiki/architecture/structure.mmd`
 * - `livewiki/architecture/modules.mmd`
 * - `livewiki/diagrams/<module-slug>.classes.mmd`
 */

import type { SymbolRow } from "./db.js";
import type { Module, ModuleGraphEdge } from "./modules.js";

/**
 * Exact placeholder line an on-disk module page carries inside its
 * `## Diagram` mermaid fence when `moduleDiagrams` is on (roadmap item 22,
 * D1). The slug is `moduleSlug(module.id)` — the same slug the deterministic
 * class diagram uses. Naming distinction: the MODEL-DRAWN module diagram
 * lives at `livewiki/diagrams/<slug>.mmd`; the DETERMINISTIC class diagram
 * keeps the distinct `livewiki/diagrams/<slug>.classes.mmd` name
 * (`generateClassDiagram`), and flow companion diagrams keep
 * `livewiki/diagrams/flow-<slug>.mmd` (`flowDiagramPlaceholder` in
 * artifact.ts) — the three namespaces never collide.
 */
export function moduleDiagramPlaceholder(slug: string): string {
  return `%% livewiki/diagrams/${slug}.mmd`;
}

/** Returns a lowercase, filesystem-safe module slug. */
export function moduleSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Edge budget for the structure graph. Mermaid's parser rejects diagrams
 * over 500 edges by default and `maxEdges` is a secure config (verify's
 * `invalid_mermaid_diagram` check and the viewer both use defaults), so
 * the generator must stay under it or the artifact fails livewiki's own
 * verify. 450 leaves headroom.
 */
export const STRUCTURE_MAX_EDGES = 450;

/**
 * Generates the repository directory graph. Two deterministic modes:
 *   - exact (≤ STRUCTURE_MAX_EDGES): every directory AND file is a node,
 *     deduped parent→child edges (the historical contract);
 *   - collapsed (over budget): directories stay nodes and each directory's
 *     direct files become ONE `dir/… (N files)` node — medium/large repos
 *     would otherwise emit a graph Mermaid itself refuses to parse.
 * Orientation is LR (like `modules.mmd`): a file tree laid out TD grows
 * tens of thousands of pixels wide; LR grows vertically, which is the
 * natural page-scroll direction.
 */
export function generateStructure(filePaths: string[]): string {
  const exact = buildExactStructureLines(filePaths);
  if (exact.edgeCount <= STRUCTURE_MAX_EDGES) {
    return ["graph LR", ...exact.lines].join("\n") + "\n";
  }
  return ["graph LR", ...buildCollapsedStructureLines(filePaths)].join("\n") + "\n";
}

/** Exact per-file graph: node + edge emission in walk order, deduped. */
function buildExactStructureLines(filePaths: string[]): { lines: string[]; edgeCount: number } {
  const lines: string[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  let edgeCount = 0;

  for (const path of filePaths) {
    const segments = path.split("/");
    let parent = "";
    for (const segment of segments) {
      const node = parent ? `${parent}/${segment}` : segment;
      if (!seenNodes.has(node)) {
        lines.push(`  ${mermaidId(node)}["${escapeLabel(node)}"]`);
        seenNodes.add(node);
      }
      if (parent) {
        const edgeKey = JSON.stringify([parent, node]);
        if (!seenEdges.has(edgeKey)) {
          lines.push(`  ${mermaidId(parent)} --> ${mermaidId(node)}`);
          seenEdges.add(edgeKey);
          edgeCount++;
        }
      }
      parent = node;
    }
  }

  return { lines, edgeCount };
}

/** Collapsed graph: directory chain + one `(N files)` node per directory. */
function buildCollapsedStructureLines(filePaths: string[]): string[] {
  const lines: string[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  /** Direct files per directory, insertion order = first seen. */
  const fileCountByDir = new Map<string, number>();

  for (const path of filePaths) {
    const segments = path.split("/");
    let parent = "";
    for (let i = 0; i < segments.length - 1; i++) {
      const node = parent ? `${parent}/${segments[i]!}` : segments[i]!;
      if (!seenNodes.has(node)) {
        lines.push(`  ${mermaidId(node)}["${escapeLabel(node)}"]`);
        seenNodes.add(node);
      }
      if (parent) {
        const edgeKey = JSON.stringify([parent, node]);
        if (!seenEdges.has(edgeKey)) {
          lines.push(`  ${mermaidId(parent)} --> ${mermaidId(node)}`);
          seenEdges.add(edgeKey);
        }
      }
      parent = node;
    }
    fileCountByDir.set(parent, (fileCountByDir.get(parent) ?? 0) + 1);
  }

  for (const [dir, count] of fileCountByDir) {
    const label = dir ? `${dir}/… (${count} files)` : `… (${count} files)`;
    const groupId = mermaidId(`${dir}__files`);
    lines.push(`  ${groupId}["${escapeLabel(label)}"]`);
    if (dir) lines.push(`  ${mermaidId(dir)} --> ${groupId}`);
  }

  return lines;
}

/** Generates the import graph between modules. */
export function generateModulesGraph(edges: ModuleGraphEdge[]): string {
  const lines: string[] = ["graph LR"];
  if (edges.length === 0) {
    lines.push("  root[No module edges detected]");
    return lines.join("\n") + "\n";
  }

  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();
  for (const edge of edges) {
    for (const moduleId of [edge.from, edge.to]) {
      if (!seenNodes.has(moduleId)) {
        lines.push(`  ${mermaidId(moduleId)}["${escapeLabel(moduleId)}"]`);
        seenNodes.add(moduleId);
      }
    }
    const edgeKey = JSON.stringify([edge.from, edge.to]);
    if (!seenEdges.has(edgeKey)) {
      lines.push(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
      seenEdges.add(edgeKey);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Generates a class diagram for one module. Classes with the same display
 * name in different files receive distinct Mermaid IDs, and methods are
 * grouped by the full `(path, className)` identity.
 *
 * `direction TB`: sparse inventories (few/zero edges — e.g. a plain Python
 * class list) render as a tiny horizontal row without it. Verified against
 * the real Mermaid 11 parser (`validateMermaidSyntax` accepts the direction
 * statement). Flow diagrams keep their own direction (LR).
 */
export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string {
  const modulePaths = new Set(module.paths);
  const classSymbols = symbols
    .filter(
      (symbol) =>
        symbol.kind === "class" && modulePaths.has(symbol.key.split("#")[0] ?? ""),
    )
    .sort((a, b) => a.key.localeCompare(b.key));

  if (classSymbols.length === 0) return "";

  const methodsByClass = new Map<string, SymbolRow[]>();
  for (const symbol of symbols) {
    if (symbol.kind !== "method") continue;
    const [path, qualifiedName] = symbol.key.split("#");
    if (!path || !qualifiedName || !modulePaths.has(path)) continue;
    const className = qualifiedName.split(".")[0];
    if (!className) continue;
    const identity = classIdentity(path, className);
    const methods = methodsByClass.get(identity) ?? [];
    methods.push(symbol);
    methodsByClass.set(identity, methods);
  }

  const classIds: string[] = [];
  const declarations: string[] = [];
  for (const [index, classSymbol] of classSymbols.entries()) {
    const [path, className = "Unknown"] = classSymbol.key.split("#");
    const classId = `class_${index + 1}`;
    classIds.push(classId);
    declarations.push(`  class ${classId}["${escapeLabel(className)}"] {`);
    const methods = (methodsByClass.get(classIdentity(path ?? "", className)) ?? [])
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const method of methods) {
      const qualifiedName = method.key.split("#")[1] ?? "method";
      const methodName = qualifiedName.split(".").slice(1).join(".") || "method";
      declarations.push(`    +${mermaidMemberName(methodName)}()`);
    }
    declarations.push("  }");
  }

  // Real structure edges (inheritance/associations) are not emitted
  // today; when they are, they drive the layout and the sparse chain
  // below must stay off (real structure wins).
  const realEdgeLines: string[] = [];

  // Sparse-inventory layout: mermaid honors `direction TB` only when the
  // graph HAS edges — with zero edges it packs disconnected class nodes
  // in a horizontal row (probed: 524×142 viewBox instead of vertical).
  // With no real edges and ≥2 classes, chain consecutive classes with
  // solid links and hide the connectors via the diagram's own themeCSS
  // directive, so the inventory stacks vertically with no visible
  // connectors (probed: 124×628 viewBox, stroke rgba(0,0,0,0), under
  // BOTH securityLevel strict and loose). `~~~` is a flowchart-only
  // idiom (parse error in classDiagram) and linkStyle is parsed but
  // ignored by the class renderer — themeCSS is the only mechanism that
  // works in mermaid 11.16. A renderer that drops the directive still
  // stacks vertically, just with visible connectors.
  const sparseChain = realEdgeLines.length === 0 && classIds.length >= 2;

  const lines: string[] = [];
  if (sparseChain) {
    lines.push(SPARSE_CLASS_DIAGRAM_DIRECTIVE);
  }
  lines.push("classDiagram", "  direction TB", ...declarations, ...realEdgeLines);
  if (sparseChain) {
    for (let index = 0; index < classIds.length - 1; index++) {
      lines.push(`  ${classIds[index]} -- ${classIds[index + 1]}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Mermaid init directive that hides relation connectors — emitted only
 * on edge-less class diagrams, where every relation is a layout chain
 * link (see `generateClassDiagram`).
 */
const SPARSE_CLASS_DIAGRAM_DIRECTIVE =
  '%%{init: {"themeCSS": ".relation { stroke: transparent !important; }"}}%%';

function classIdentity(path: string, className: string): string {
  return JSON.stringify([path, className]);
}

function mermaidId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "_");
}

function mermaidMemberName(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_.]/g, "_");
  return sanitized || "method";
}

function escapeLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
}
