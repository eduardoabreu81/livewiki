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

/** Returns a lowercase, filesystem-safe module slug. */
export function moduleSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Generates the repository directory graph. */
export function generateStructure(filePaths: string[]): string {
  const lines: string[] = ["graph TD"];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

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
        }
      }
      parent = node;
    }
  }

  return lines.join("\n") + "\n";
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

  const lines: string[] = ["classDiagram"];
  for (const [index, classSymbol] of classSymbols.entries()) {
    const [path, className = "Unknown"] = classSymbol.key.split("#");
    const classId = `class_${index + 1}`;
    lines.push(`  class ${classId}["${escapeLabel(className)}"] {`);
    const methods = (methodsByClass.get(classIdentity(path ?? "", className)) ?? [])
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const method of methods) {
      const qualifiedName = method.key.split("#")[1] ?? "method";
      const methodName = qualifiedName.split(".").slice(1).join(".") || "method";
      lines.push(`    +${mermaidMemberName(methodName)}()`);
    }
    lines.push("  }");
  }

  return lines.join("\n") + "\n";
}

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
