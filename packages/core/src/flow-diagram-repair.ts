/**
 * flow-diagram-repair — deterministic, localized repair for an
 * over-budget stage-5 flowchart diagram.
 *
 * Priority-0 Phase 2 fix (2026-07-20 improvement pass, "typed IR" idea
 * adapted from archify): `flow_diagram_too_large` previously always sent
 * the WHOLE flow page back to the LLM for a fresh repair attempt, burning
 * a repair slot to fix a purely mechanical problem — too many nodes/edges
 * for the configured budget (R11-A E2E v21, `flow:cli-src-to-core-src-03`:
 * 19 nodes / 18 edges vs a 12/20 budget). This module parses the model's
 * Mermaid flowchart into a small structural IR, truncates it to the
 * budget deterministically (first N nodes in appearance order, only
 * edges between kept nodes), and re-renders valid Mermaid — the page
 * prose the model already wrote is untouched.
 *
 * Scope: flowchart/graph diagrams only (the only kind stage-5 flow pages
 * actually produce — see `batch-stage5.test.ts` fixtures and prompts.ts).
 * `sequenceDiagram`/`stateDiagram` sources, or any flowchart line this
 * parser cannot confidently round-trip, return `null` — the caller falls
 * back to the existing LLM-repair path. A truncation this module cannot
 * prove correct is worse than no truncation at all.
 */

export interface FlowchartNode {
  id: string;
  /** Raw shape+label token as written by the model, e.g. `[Do the thing]`, `{Decision}`. Empty string for a bare id. */
  shape: string;
}

export interface FlowchartEdge {
  from: string;
  to: string;
  /** Edge operator as written, e.g. `-->`, `-.->`. */
  operator: string;
  /** Optional `|label|` text between the operator and the target, without the pipes. */
  label: string | null;
}

export interface FlowchartIR {
  direction: string;
  nodes: FlowchartNode[];
  edges: FlowchartEdge[];
}

const HEADER_RE = /^(flowchart|graph)\s+(\S+)\s*$/i;
const SKIP_RE =
  /^(?:subgraph\b|end\b|classdef\b|class\b|style\b|linkstyle\b|click\b|direction\b)/i;
/** Longest-operator-first so `<-->` is never split as two shorter operators. */
const EDGE_OP_RE =
  /(<-->|-->|<--|-\.->|-\.-|==>|===|o--o|x--x|--o|o--|--x|x--|---)(\|[^|]*\|)?/g;
const NODE_TOKEN_RE =
  /^([A-Za-z0-9_]+)(\[[^\]]*\]|\(\([^)]*\)\)|\([^)]*\)|\{[^}]*\}|>[^\]]*\])?$/;

/**
 * Parses a flowchart/graph Mermaid source into a structural IR. Returns
 * null for any construct this deliberately-narrow parser cannot safely
 * round-trip (a different diagram kind, node-chaining with `&`, or any
 * line it cannot cleanly tokenize) — never a best-effort guess.
 */
export function parseFlowchartMermaid(source: string): FlowchartIR | null {
  const lines = source
    .split("\n")
    .map((line) => line.replace(/;+\s*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("%%"));
  if (lines.length === 0) return null;

  const header = HEADER_RE.exec(lines[0]!);
  if (!header) return null;
  const direction = header[2]!;

  const nodeOrder: string[] = [];
  const nodeShapes = new Map<string, string>();
  const edges: FlowchartEdge[] = [];

  const recordNode = (token: string): string | null => {
    const match = NODE_TOKEN_RE.exec(token.trim());
    if (!match) return null;
    const id = match[1]!;
    const shape = match[2] ?? "";
    if (!nodeShapes.has(id)) {
      nodeShapes.set(id, shape);
      nodeOrder.push(id);
    } else if (shape !== "" && nodeShapes.get(id) === "") {
      // A later occurrence carries the label the first (bare) reference lacked.
      nodeShapes.set(id, shape);
    }
    return id;
  };

  for (const line of lines.slice(1)) {
    if (SKIP_RE.test(line)) continue;
    if (line.includes("&")) return null; // chained endpoints — out of scope

    // `split` on a regex with N capture groups interleaves them:
    // [text, op, label, text, op, label, ..., text]. Every 3rd entry
    // (index % 3 === 0) is plain text; the pairs in between are the
    // captured operator and optional `|label|`.
    const parts = line.split(EDGE_OP_RE);
    if (parts.length === 1) {
      if (recordNode(line) === null) return null;
      continue;
    }
    if ((parts.length - 1) % 3 !== 0) return null;
    const edgeCount = (parts.length - 1) / 3;

    const segments: string[] = [];
    for (let i = 0; i <= edgeCount; i++) segments.push(parts[i * 3]!);
    const ids: Array<string | null> = segments.map((segment) => recordNode(segment));
    if (ids.some((id) => id === null)) return null;

    for (let i = 0; i < edgeCount; i++) {
      const operator = parts[i * 3 + 1];
      const rawLabel = parts[i * 3 + 2];
      if (!operator) return null;
      edges.push({
        from: ids[i]!,
        to: ids[i + 1]!,
        operator,
        label: rawLabel ? rawLabel.slice(1, -1) : null,
      });
    }
  }

  return {
    direction,
    nodes: nodeOrder.map((id) => ({ id, shape: nodeShapes.get(id) ?? "" })),
    edges,
  };
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
 * One-shot mechanical repair: parses `source`, and if it is a flowchart
 * this parser can safely round-trip, truncates it to budget and returns
 * the re-rendered Mermaid. Returns null when the source is not a
 * flowchart/graph or isn't already over budget in a way truncation
 * would fix (the caller should fall back to the LLM repair path).
 */
export function repairOversizedFlowchart(
  source: string,
  maxNodes: number,
  maxEdges: number,
): string | null {
  const ir = parseFlowchartMermaid(source);
  if (ir === null) return null;
  if (ir.nodes.length <= maxNodes && ir.edges.length <= maxEdges) return null;
  const truncated = truncateFlowchartToBudget(ir, maxNodes, maxEdges);
  if (truncated.nodes.length === 0) return null;
  return renderFlowchartMermaid(truncated);
}
