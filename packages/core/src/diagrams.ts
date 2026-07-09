/**
 * diagrams — geração determinística de Mermaid (sem LLM).
 *
 * SPEC §"Diagramas determinísticos (Fase 3)" (commit 34e34d9): "structure.mmd
 * (organograma de diretórios/módulos), modules.mmd (grafo de dependências por
 * imports — subproduto da etapa 2 do pipeline) e diagrams/<modulo>.classes.mmd
 * (classDiagram Mermaid: classes/métodos/herança, direto da tabela `symbols`)".
 *
 * **Paths SPEC (correção #2 da revisão do plano)**:
 *   - livewiki/architecture/structure.mmd
 *   - livewiki/architecture/modules.mmd
 *   - livewiki/diagrams/<module-slug>.classes.mmd
 *
 * `owner: generated` puros — nunca envelhecem, nunca entram em dívida.
 * Regenerados a cada `livewiki index` / `livewiki init`.
 *
 * Call-graph de funções e diagramas de sequência estão FORA (VISION §"Fora
 * do escopo desenhado").
 */

import type { Module, ModuleGraphEdge } from "./modules.js";
import type { SymbolRow } from "./db.js";

/** Slug válido pra nome de arquivo: lowercase, alfanum + hífen. */
export function moduleSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Gera `structure.mmd` — organograma de diretórios. Mermaid `graph TD`.
 * Cada nó é um path de arquivo; edges = "pertence a".
 */
export function generateStructure(filePaths: string[]): string {
  const lines: string[] = ["graph TD"];
  const seen = new Set<string>();
  for (const p of filePaths) {
    // Edge chain: src → src/auth → src/auth/login.ts
    const segments = p.split("/");
    let parent = "";
    for (const seg of segments) {
      const node = parent ? `${parent}/${seg}` : seg;
      if (!seen.has(node)) {
        lines.push(`  ${mermaidId(node)}["${escapeLabel(node)}"]`);
        seen.add(node);
      }
      if (parent) {
        lines.push(`  ${mermaidId(parent)} --> ${mermaidId(node)}`);
      }
      parent = node;
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Gera `modules.mmd` — grafo de imports entre módulos. Mermaid `graph LR`.
 */
export function generateModulesGraph(edges: ModuleGraphEdge[]): string {
  const lines: string[] = ["graph LR"];
  if (edges.length === 0) {
    lines.push("  root[No module edges detected]");
    return lines.join("\n") + "\n";
  }
  for (const e of edges) {
    lines.push(`  ${mermaidId(e.from)}["${escapeLabel(e.from)}"]`);
    lines.push(`  ${mermaidId(e.to)}["${escapeLabel(e.to)}"]`);
    lines.push(`  ${mermaidId(e.from)} --> ${mermaidId(e.to)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Gera `diagrams/<slug>.classes.mmd` — classDiagram Mermaid por módulo.
 * Apenas classes e métodos (sem call-graphs). Subproduto direto da tabela
 * symbols.
 */
export function generateClassDiagram(
  module: Module,
  symbols: SymbolRow[],
): string {
  const classSymbols = symbols.filter(
    (s) =>
      s.kind === "class" &&
      module.paths.some((p) => s.key.startsWith(`${p}#`)),
  );
  if (classSymbols.length === 0) {
    return ""; // sem classes → sem arquivo (correção: SPEC fala "quando há classes")
  }

  const lines: string[] = ["classDiagram"];
  const methodSymbolsByClass = new Map<string, SymbolRow[]>();
  for (const s of symbols) {
    if (s.kind !== "method") continue;
    if (!module.paths.some((p) => s.key.startsWith(`${p}#`))) continue;
    const parts = s.key.split("#");
    if (parts.length < 2) continue;
    const className = parts[1]!.split(".")[0];
    if (!className) continue;
    const arr = methodSymbolsByClass.get(className) ?? [];
    arr.push(s);
    methodSymbolsByClass.set(className, arr);
  }

  for (const cls of classSymbols) {
    const name = cls.key.split("#")[1] ?? "Unknown";
    lines.push(`  class ${name} {`);
    const methods = methodSymbolsByClass.get(name) ?? [];
    for (const m of methods) {
      const mname = m.key.split("#")[1]?.split(".").slice(1).join(".") ?? "?";
      // signature pode ser null; usa fallback
      const sig = (m.signature ?? `+${mname}()`).replace(/"/g, '\\"');
      lines.push(`    ${sig}`);
    }
    lines.push(`  }`);
  }
  return lines.join("\n") + "\n";
}

/** ID válido pra nó Mermaid (sem caracteres especiais). */
function mermaidId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

function escapeLabel(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
}