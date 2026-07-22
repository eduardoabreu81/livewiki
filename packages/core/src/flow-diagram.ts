/**
 * flow-diagram — deterministic Mermaid flowchart generation for stage-5
 * flow pages, replacing the old "the LLM writes the diagram fence
 * freely" contract.
 *
 * Priority-0 fix (2026-07-22, paid E2E against MoneyPrinterTurbo-Plus):
 * 2 of 4 flows failed 3/3 attempts with `invalid_flow_diagram` — the LLM
 * simply could not emit syntactically valid Mermaid within the node/edge
 * budget, and no mechanical repair exists for genuinely malformed
 * syntax (only oversized-but-valid flowcharts had one, see the removed
 * `repairOversizedFlowchart`). The `FlowCandidate` already carries every
 * fact needed to draw the diagram (`moduleIds` in walk order, the five
 * tiered key groups, `signals`) — the same "the graph decides, the LLM
 * only writes prose" principle already applied to the closed anchor list
 * and flow-section assignment, now applied to the diagram itself
 * (inspired by archify: https://github.com/tt-a1i/archify — a typed IR
 * filled deterministically, rendered by code, never hand-written by an
 * LLM). The LLM never sees or writes anything about `## Diagram`; the
 * orchestrator inserts this function's output wholesale (see batch.ts).
 */

import type { Module } from "./modules.js";
import type { FlowCandidate } from "./flows.js";
import type { FlowDiagramBudget } from "./prompts.js";
import { maskCodeSpansPreservingLength } from "./markdown-mask.js";
import { flowDiagramPlaceholder } from "./artifact.js";

export interface FlowchartNode {
  id: string;
  /** Raw shape+label token, e.g. `[Do the thing]`, `{Decision}`. Empty string for a bare id. */
  shape: string;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  /** Edge operator, e.g. `-->`, `-.->`. */
  operator: string;
  /** Optional `|label|` text between the operator and the target, without the pipes. */
  label: string | null;
}

export interface FlowchartIR {
  direction: string;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

/**
 * Keeps the first `maxNodes` nodes (appearance order) and the first
 * `maxEdges` edges whose endpoints are BOTH still kept (original edge
 * order). Deterministic and idempotent — re-truncating an already-small
 * IR returns it unchanged.
 */
export function truncateFlowchartToBudget(
  ir: FlowchartIR,
  maxNodes: number,
  maxEdges: number,
): FlowchartIR {
  const keptNodes = ir.nodes.slice(0, Math.max(0, maxNodes));
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges: FlowchartEdge[] = [];
  for (const edge of ir.edges) {
    if (keptEdges.length >= maxEdges) break;
    if (keptIds.has(edge.from) && keptIds.has(edge.to)) keptEdges.push(edge);
  }
  return { direction: ir.direction, nodes: keptNodes, edges: keptEdges };
}

/** Re-serializes an IR into valid, deterministic Mermaid flowchart source. */
export function renderFlowchartMermaid(ir: FlowchartIR): string {
  const lines = [`flowchart ${ir.direction}`];
  const nodeToken = (id: string): string => {
    const shape = ir.nodes.find((n) => n.id === id)?.shape ?? "";
    return `${id}${shape}`;
  };
  const edgeIds = new Set<string>();
  for (const edge of ir.edges) {
    edgeIds.add(edge.from);
    edgeIds.add(edge.to);
    const labelPart = edge.label !== null ? `|${edge.label}|` : "";
    lines.push(`  ${nodeToken(edge.from)} ${edge.operator}${labelPart} ${nodeToken(edge.to)}`);
  }
  // Isolated kept nodes (no surviving edge after truncation) still need a
  // declaration or they silently vanish from the rendered diagram.
  for (const node of ir.nodes) {
    if (!edgeIds.has(node.id)) lines.push(`  ${nodeToken(node.id)}`);
  }
  return lines.join("\n");
}

/**
 * Above this many participating modules, the diagram draws one node per
 * MODULE (walk-order adjacency); at or below it, one node per semantic-
 * role symbol key (entry/boundary/sink). Mirrors the threshold the old
 * free-form prompt rule used to state in prose.
 */
export const FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD = 6;

/** Extracts the trailing symbol name from a closed-list key (`path/to/file.ts#name` -> `name`). */
function symbolLabel(key: string): string {
  const hashIndex = key.lastIndexOf("#");
  return hashIndex === -1 ? key : key.slice(hashIndex + 1);
}

/** Escapes characters that would break a Mermaid `[...]` label token. */
function escapeMermaidLabel(label: string): string {
  return label.replace(/[[\]{}()|"]/g, " ").replace(/\s+/g, " ").trim();
}

interface DiagramContext {
  displayNameByModuleId: ReadonlyMap<string, string>;
  moduleIdByPath: ReadonlyMap<string, string>;
  entryModuleIds: ReadonlySet<string>;
  persistenceModuleIds: ReadonlySet<string>;
}

function buildDiagramContext(candidate: FlowCandidate, modules: ReadonlyArray<Module>): DiagramContext {
  const displayNameByModuleId = new Map<string, string>();
  const moduleIdByPath = new Map<string, string>();
  for (const m of modules) {
    displayNameByModuleId.set(m.id, m.displayTitle ?? m.id);
    for (const path of m.paths) moduleIdByPath.set(path, m.id);
  }
  return {
    displayNameByModuleId,
    moduleIdByPath,
    entryModuleIds: new Set(candidate.signals.entry),
    persistenceModuleIds: new Set(candidate.signals.persistence),
  };
}

/** Annotates a base label with entry/persistence signals for the owning module, when present. */
function annotateLabel(baseLabel: string, moduleId: string | undefined, ctx: DiagramContext): string {
  if (moduleId === undefined) return baseLabel;
  let label = baseLabel;
  // No parentheses/brackets in the annotation — a Mermaid node label is
  // already inside `[...]`, and characters like `(`/`)` inside that span
  // can desync the real Mermaid parser (confirmed by validateMermaidSyntax
  // rejecting an earlier "(persists)" suffix during E2E validation).
  if (ctx.entryModuleIds.has(moduleId)) label = `Entry: ${label}`;
  if (ctx.persistenceModuleIds.has(moduleId)) label = `${label} - persists`;
  return label;
}

function moduleGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR {
  const nodes: FlowchartNode[] = candidate.moduleIds.map((moduleId, index) => {
    const displayName = ctx.displayNameByModuleId.get(moduleId) ?? moduleId;
    const label = annotateLabel(escapeMermaidLabel(displayName), moduleId, ctx);
    return { id: `n${index}`, shape: `[${label}]` };
  });
  const edges: FlowchartEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i]!.id, to: nodes[i + 1]!.id, operator: "-->", label: null });
  }
  return { direction: "LR", nodes, edges };
}

/**
 * Symbol-granularity nodes cover only the semantically-tiered keys
 * (entry/boundary/sink) — T4/T5 (`otherProductKeys`/`auxiliaryKeys`) are
 * left out so the diagram stays the walk's "story", not a dump of every
 * closed-list key. Edges are chained by TIER ORDER (every entry key into
 * the first boundary key, that into the next boundary key, ..., into
 * every sink key) — a deterministic, honestly-labeled APPROXIMATION of
 * role order, not a proven call sequence (the same caution already
 * applied to `resolvedCrossModuleCallees` in flows.ts).
 */
function symbolGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR {
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  for (const key of [...candidate.entryKeys, ...candidate.boundaryKeys, ...candidate.sinkKeys]) {
    if (seen.has(key)) continue;
    seen.add(key);
    orderedKeys.push(key);
  }

  const nodeIdByKey = new Map<string, string>();
  const nodes: FlowchartNode[] = orderedKeys.map((key, index) => {
    const nodeId = `n${index}`;
    nodeIdByKey.set(key, nodeId);
    const moduleId = ctx.moduleIdByPath.get(key.split("#")[0] ?? "");
    const label = annotateLabel(escapeMermaidLabel(symbolLabel(key)), moduleId, ctx);
    return { id: nodeId, shape: `[${label}]` };
  });

  const tierChain = (tierKeys: readonly string[]): string[] =>
    tierKeys.map((k) => nodeIdByKey.get(k)).filter((id): id is string => id !== undefined);
  const entryIds = tierChain(candidate.entryKeys);
  const boundaryIds = tierChain(candidate.boundaryKeys);
  const sinkIds = tierChain(candidate.sinkKeys);

  const edges: FlowchartEdge[] = [];
  const chainInto = (fromIds: readonly string[], toId: string): void => {
    for (const fromId of fromIds) {
      if (fromId === toId) continue;
      edges.push({ from: fromId, to: toId, operator: "-->", label: null });
    }
  };
  // Every entry key feeds the first boundary key (or, absent one, the first sink key).
  const firstMiddle = boundaryIds[0] ?? sinkIds[0];
  if (firstMiddle !== undefined) chainInto(entryIds, firstMiddle);
  // Boundary keys chain in sequence.
  for (let i = 0; i < boundaryIds.length - 1; i++) {
    edges.push({ from: boundaryIds[i]!, to: boundaryIds[i + 1]!, operator: "-->", label: null });
  }
  // The last boundary key (or every entry key, if there is none) feeds every sink key.
  const lastBoundary = boundaryIds[boundaryIds.length - 1];
  for (const sinkId of sinkIds) {
    if (lastBoundary !== undefined && lastBoundary !== sinkId) {
      edges.push({ from: lastBoundary, to: sinkId, operator: "-->", label: null });
    } else if (lastBoundary === undefined) {
      chainInto(entryIds, sinkId);
    }
  }

  return { direction: "LR", nodes, edges };
}

/**
 * Generates a complete, budget-respecting Mermaid `flowchart LR` source
 * for a flow candidate — zero LLM calls. Always produces output within
 * `budget` (truncation happens before rendering, never after), and the
 * caller is expected to still run `validateMermaidSyntax` as defense in
 * depth against a bug in this renderer (never as a signal to retry via
 * the LLM — a failure here is a code bug, not a content-generation
 * failure).
 */
export function generateFlowDiagram(
  candidate: FlowCandidate,
  modules: ReadonlyArray<Module>,
  budget: FlowDiagramBudget,
): string {
  const ctx = buildDiagramContext(candidate, modules);
  const ir =
    candidate.moduleIds.length > FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD
      ? moduleGranularityIr(candidate, ctx)
      : symbolGranularityIr(candidate, ctx);
  const truncated = truncateFlowchartToBudget(ir, budget.maxNodes, budget.maxEdges);
  return renderFlowchartMermaid(truncated);
}

/**
 * Inserts a complete `## Diagram` section between `## Ordered flow` and
 * `## Invariants` in a flow page whose raw LLM output is expected to
 * never have a `## Diagram` section at all (the prompt instructs the LLM
 * not to write one). The section's fence carries the ON-DISK PLACEHOLDER
 * (`flowDiagramPlaceholder(slug)`), matching the existing contract: the
 * page itself never holds the real Mermaid source — only the companion
 * `.mmd` file does. `generateFlowDiagram`'s output is written to that
 * `.mmd` file separately by the caller.
 *
 * Defensive: a real paid E2E run showed the LLM sometimes disregards the
 * "do not write Diagram" instruction anyway. If a `## Diagram` heading is
 * ALREADY present, this function REPLACES that whole section (heading
 * through the next H2) with the correct one instead of inserting a
 * second — otherwise the validator would see the LLM's stale section
 * first and reject it, never reaching the correct one.
 *
 * Returns null when the `Invariants` H2 cannot be located (heading search
 * runs over a code-span-masked, offset-preserving view so a code example
 * that happens to contain the literal text "## Invariants"/"## Diagram"
 * can never be mistaken for a real heading) — the caller treats that as
 * a structural opening failure, same as any other missing/out-of-order
 * required section.
 */
export function insertFlowDiagramSection(pageContent: string, slug: string): string | null {
  const masked = maskCodeSpansPreservingLength(pageContent);
  const headingRe = /^##[ \t]+(.+?)[ \t]*$/gm;
  const matches = [...masked.matchAll(headingRe)];
  const headings = matches.map((m, i) => ({
    name: m[1]!.trim().toLowerCase(),
    start: m.index!,
    end: i + 1 < matches.length ? matches[i + 1]!.index! : pageContent.length,
  }));

  const insertion = `## Diagram\n\n\`\`\`mermaid\n${flowDiagramPlaceholder(slug)}\n\`\`\`\n\n`;

  const existingDiagram = headings.find((h) => h.name === "diagram");
  if (existingDiagram !== undefined) {
    return pageContent.slice(0, existingDiagram.start) + insertion + pageContent.slice(existingDiagram.end);
  }

  const invariants = headings.find((h) => h.name === "invariants");
  if (invariants === undefined) return null;
  return pageContent.slice(0, invariants.start) + insertion + pageContent.slice(invariants.start);
}
