import { describe, it, expect } from "vitest";
import {
  parseFlowchartMermaid,
  renderFlowchartMermaid,
  truncateFlowchartToBudget,
  repairOversizedFlowchart,
} from "./flow-diagram-repair.js";
import { countFlowDiagramElements } from "./artifact.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";

describe("parseFlowchartMermaid", () => {
  it("parses a simple chain with labels", () => {
    const ir = parseFlowchartMermaid("flowchart TD\n  A[Start] --> B[Middle] --> C[End]");
    expect(ir).toEqual({
      direction: "TD",
      nodes: [
        { id: "A", shape: "[Start]" },
        { id: "B", shape: "[Middle]" },
        { id: "C", shape: "[End]" },
      ],
      edges: [
        { from: "A", to: "B", operator: "-->", label: null },
        { from: "B", to: "C", operator: "-->", label: null },
      ],
    });
  });

  it("parses an edge label", () => {
    const ir = parseFlowchartMermaid("flowchart LR\n  A -->|on success| B");
    expect(ir?.edges).toEqual([{ from: "A", to: "B", operator: "-->", label: "on success" }]);
  });

  it("captures a label from a later reference when the first was bare", () => {
    const ir = parseFlowchartMermaid("graph TD\n  A --> B\n  B[Later label] --> C");
    expect(ir?.nodes.find((n) => n.id === "B")?.shape).toBe("[Later label]");
  });

  it("returns null for a non-flowchart diagram kind", () => {
    expect(parseFlowchartMermaid("sequenceDiagram\n  A->>B: hi")).toBeNull();
  });

  it("returns null for chained `&` endpoints (out of scope)", () => {
    expect(parseFlowchartMermaid("flowchart TD\n  A & B --> C")).toBeNull();
  });

  it("returns null for empty source", () => {
    expect(parseFlowchartMermaid("")).toBeNull();
  });

  it("skips subgraph/classdef/style directives without breaking parsing", () => {
    const ir = parseFlowchartMermaid(
      ["flowchart TD", "subgraph sg1", "A --> B", "end", "classdef foo fill:#fff", "B --> C"].join("\n"),
    );
    expect(ir?.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["A->B", "B->C"]);
  });

  it("counts a standalone node declaration", () => {
    const ir = parseFlowchartMermaid("flowchart TD\n  A --> B\n  C[Isolated]");
    expect(ir?.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(ir?.edges).toHaveLength(1);
  });
});

describe("truncateFlowchartToBudget", () => {
  it("keeps only the first N nodes and edges fully inside the kept set", () => {
    const ir = parseFlowchartMermaid(
      "flowchart TD\n  A --> B\n  B --> C\n  C --> D\n  D --> E",
    )!;
    const truncated = truncateFlowchartToBudget(ir, 3, 10);
    expect(truncated.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    // D and E are dropped, so C-->D never survives (D not kept).
    expect(truncated.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["A->B", "B->C"]);
  });

  it("caps edges independently of node truncation", () => {
    const ir = parseFlowchartMermaid(
      "flowchart TD\n  A --> B\n  A --> C\n  A --> D",
    )!;
    const truncated = truncateFlowchartToBudget(ir, 10, 2);
    expect(truncated.edges).toHaveLength(2);
  });

  it("is idempotent on an already-small IR", () => {
    const ir = parseFlowchartMermaid("flowchart TD\n  A --> B")!;
    const once = truncateFlowchartToBudget(ir, 12, 20);
    const twice = truncateFlowchartToBudget(once, 12, 20);
    expect(twice).toEqual(once);
  });
});

describe("renderFlowchartMermaid", () => {
  it("round-trips a simple chain to equivalent element counts", () => {
    const source = "flowchart TD\n  A[Start] --> B[Middle] --> C[End]";
    const ir = parseFlowchartMermaid(source)!;
    const rendered = renderFlowchartMermaid(ir);
    const counts = countFlowDiagramElements(rendered);
    expect(counts).toEqual({ nodes: 3, edges: 2 });
  });

  it("emits isolated kept nodes with no surviving edge as standalone declarations", () => {
    const ir = { direction: "TD", nodes: [{ id: "A", shape: "[Lonely]" }], edges: [] };
    const rendered = renderFlowchartMermaid(ir);
    expect(rendered).toBe("flowchart TD\n  A[Lonely]");
  });

  it("re-renders a valid edge label", () => {
    const ir = parseFlowchartMermaid("flowchart LR\n  A -->|go| B")!;
    const rendered = renderFlowchartMermaid(ir);
    expect(rendered).toBe("flowchart LR\n  A -->|go| B");
  });
});

describe("repairOversizedFlowchart", () => {
  it("truncates a diagram exceeding both budgets and produces valid Mermaid within budget", async () => {
    const nodes = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const lines = ["flowchart TD"];
    for (let i = 0; i < nodes.length - 1; i++) lines.push(`  ${nodes[i]} --> ${nodes[i + 1]}`);
    const source = lines.join("\n");
    const before = countFlowDiagramElements(source);
    expect(before.nodes).toBe(20);

    const repaired = repairOversizedFlowchart(source, 12, 20);
    expect(repaired).not.toBeNull();
    const after = countFlowDiagramElements(repaired!);
    expect(after.nodes).toBeLessThanOrEqual(12);
    expect(after.edges).toBeLessThanOrEqual(20);
    expect(await validateMermaidSyntax(repaired!)).toBeNull();
  });

  it("returns null when already within budget (nothing to repair)", () => {
    expect(repairOversizedFlowchart("flowchart TD\n  A --> B", 12, 20)).toBeNull();
  });

  it("returns null for a diagram kind it cannot parse (falls back to LLM repair)", () => {
    expect(repairOversizedFlowchart("sequenceDiagram\n  A->>B: hi", 1, 1)).toBeNull();
  });
});
