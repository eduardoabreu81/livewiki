import { describe, it, expect } from "vitest";
import {
  generateFlowDiagram,
  insertFlowDiagramSection,
  FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD,
  truncateFlowchartToBudget,
  renderFlowchartMermaid,
  type FlowchartIR,
} from "./flow-diagram.js";
import { countFlowDiagramElements } from "./artifact.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import type { FlowCandidate } from "./flows.js";
import type { Module } from "./modules.js";

/** Builds a linear-chain IR A -> B -> C -> ... for the given node ids. */
function chainIr(ids: string[]): FlowchartIR {
  return {
    direction: "TD",
    nodes: ids.map((id) => ({ id, shape: "" })),
    edges: ids.slice(0, -1).map((id, i) => ({ from: id, to: ids[i + 1]!, operator: "-->", label: null })),
  };
}

function mod(id: string, paths: string[], displayTitle?: string): Module {
  return { id, paths, symbolCount: paths.length, ...(displayTitle !== undefined ? { displayTitle } : {}) };
}

function candidate(overrides: Partial<FlowCandidate> & { moduleIds: string[] }): FlowCandidate {
  return {
    slug: "example-flow",
    titleSeed: "Example flow",
    seedKeys: [],
    entryKeys: [],
    boundaryKeys: [],
    sinkKeys: [],
    otherProductKeys: [],
    auxiliaryKeys: [],
    signals: { entry: [], persistence: [], external: [] },
    ...overrides,
  };
}

const defaultBudget = { maxNodes: 12, maxEdges: 20 };

describe("generateFlowDiagram — symbol granularity (walk <= 6 modules)", () => {
  const modules = [mod("cli", ["cli.ts"], "CLI"), mod("core", ["core.ts"], "Core"), mod("db", ["db.ts"], "DB")];
  const c = candidate({
    moduleIds: ["cli", "core", "db"],
    entryKeys: ["cli.ts#run"],
    boundaryKeys: ["core.ts#process"],
    sinkKeys: ["db.ts#save"],
    otherProductKeys: ["core.ts#helper"],
    auxiliaryKeys: ["cli.ts#testHelper"],
  });

  it("includes only entry/boundary/sink keys, never other-product/auxiliary keys", () => {
    const diagram = generateFlowDiagram(c, modules, defaultBudget);
    expect(diagram).toContain("run");
    expect(diagram).toContain("process");
    expect(diagram).toContain("save");
    expect(diagram).not.toContain("helper");
    expect(diagram).not.toContain("testHelper");
  });

  it("chains entry -> boundary -> sink", () => {
    const diagram = generateFlowDiagram(c, modules, defaultBudget);
    const lines = diagram.split("\n");
    expect(lines[0]).toBe("flowchart LR");
    expect(diagram).toMatch(/n0.*-->.*n1/);
    expect(diagram).toMatch(/n1.*-->.*n2/);
  });

  it("produces syntactically valid Mermaid (oracle: validateMermaidSyntax)", async () => {
    const diagram = generateFlowDiagram(c, modules, defaultBudget);
    expect(await validateMermaidSyntax(diagram)).toBeNull();
  });

  it("annotates the entry module's node with 'Entry:' and a persistence module with '(persists)'", () => {
    const withSignals = candidate({
      moduleIds: ["cli", "core", "db"],
      entryKeys: ["cli.ts#run"],
      boundaryKeys: ["core.ts#process"],
      sinkKeys: ["db.ts#save"],
      signals: { entry: ["cli"], persistence: ["db"], external: [] },
    });
    const diagram = generateFlowDiagram(withSignals, modules, defaultBudget);
    expect(diagram).toContain("Entry: run");
    expect(diagram).toContain("save - persists");
  });
});

describe("generateFlowDiagram — module granularity (walk > 6 modules)", () => {
  const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
  const modules = ids.map((id) => mod(id, [`${id}.ts`], `Module ${id.toUpperCase()}`));
  const c = candidate({ moduleIds: ids, entryKeys: [`${ids[0]}.ts#a`], sinkKeys: [`${ids[6]}.ts#z`] });

  it("draws one node per module in walk order with linear adjacency edges", () => {
    expect(ids.length).toBeGreaterThan(FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD);
    const diagram = generateFlowDiagram(c, modules, defaultBudget);
    for (const id of ids) {
      expect(diagram).toContain(`Module ${id.toUpperCase()}`);
    }
    // 7 nodes -> 6 linear edges.
    const edgeLines = diagram.split("\n").filter((l) => l.includes("-->"));
    expect(edgeLines).toHaveLength(6);
  });

  it("falls back to the module id when displayTitle is absent", () => {
    const noTitleModules = ids.map((id) => mod(id, [`${id}.ts`]));
    const diagram = generateFlowDiagram(c, noTitleModules, defaultBudget);
    for (const id of ids) {
      expect(diagram).toContain(`[${id}]`);
    }
  });

  it("produces syntactically valid Mermaid (oracle: validateMermaidSyntax)", async () => {
    const diagram = generateFlowDiagram(c, modules, defaultBudget);
    expect(await validateMermaidSyntax(diagram)).toBeNull();
  });
});

describe("generateFlowDiagram — budget truncation", () => {
  it("never exceeds maxNodes/maxEdges even when the walk has more modules than the budget", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `m${i}`);
    const modules = ids.map((id) => mod(id, [`${id}.ts`]));
    const c = candidate({ moduleIds: ids });
    const tightBudget = { maxNodes: 5, maxEdges: 4 };
    const diagram = generateFlowDiagram(c, modules, tightBudget);
    const nodeTokens = new Set(
      [...diagram.matchAll(/\bn\d+\b/g)].map((m) => m[0]),
    );
    expect(nodeTokens.size).toBeLessThanOrEqual(tightBudget.maxNodes);
    const edgeLines = diagram.split("\n").filter((l) => l.includes("-->"));
    expect(edgeLines.length).toBeLessThanOrEqual(tightBudget.maxEdges);
  });

  it("truncated output is still syntactically valid Mermaid", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `m${i}`);
    const modules = ids.map((id) => mod(id, [`${id}.ts`]));
    const c = candidate({ moduleIds: ids });
    const diagram = generateFlowDiagram(c, modules, { maxNodes: 5, maxEdges: 4 });
    expect(await validateMermaidSyntax(diagram)).toBeNull();
  });
});

describe("generateFlowDiagram — determinism", () => {
  it("is a pure function: same inputs always produce byte-identical output", () => {
    const modules = [mod("cli", ["cli.ts"], "CLI"), mod("core", ["core.ts"], "Core")];
    const c = candidate({ moduleIds: ["cli", "core"], entryKeys: ["cli.ts#run"], sinkKeys: ["core.ts#save"] });
    const a = generateFlowDiagram(c, modules, defaultBudget);
    const b = generateFlowDiagram(c, modules, defaultBudget);
    expect(a).toBe(b);
  });
});

// Ported from the removed flow-diagram-repair.ts (parseFlowchartMermaid /
// repairOversizedFlowchart are gone — the diagram is generated within
// budget from the start, never parsed back from LLM-written Mermaid).
describe("truncateFlowchartToBudget", () => {
  it("keeps only the first N nodes and edges fully inside the kept set", () => {
    const ir = chainIr(["A", "B", "C", "D", "E"]);
    const truncated = truncateFlowchartToBudget(ir, 3, 10);
    expect(truncated.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    // D and E are dropped, so C-->D never survives (D not kept).
    expect(truncated.edges.map((e) => `${e.from}->${e.to}`)).toEqual(["A->B", "B->C"]);
  });

  it("caps edges independently of node truncation", () => {
    const ir: FlowchartIR = {
      direction: "TD",
      nodes: [{ id: "A", shape: "" }, { id: "B", shape: "" }, { id: "C", shape: "" }, { id: "D", shape: "" }],
      edges: [
        { from: "A", to: "B", operator: "-->", label: null },
        { from: "A", to: "C", operator: "-->", label: null },
        { from: "A", to: "D", operator: "-->", label: null },
      ],
    };
    const truncated = truncateFlowchartToBudget(ir, 10, 2);
    expect(truncated.edges).toHaveLength(2);
  });

  it("is idempotent on an already-small IR", () => {
    const ir = chainIr(["A", "B"]);
    const once = truncateFlowchartToBudget(ir, 12, 20);
    const twice = truncateFlowchartToBudget(once, 12, 20);
    expect(twice).toEqual(once);
  });
});

describe("renderFlowchartMermaid", () => {
  it("round-trips a simple chain to equivalent element counts", () => {
    const ir = chainIr(["A", "B", "C"]);
    const rendered = renderFlowchartMermaid(ir);
    const counts = countFlowDiagramElements(rendered);
    expect(counts).toEqual({ nodes: 3, edges: 2 });
  });

  it("emits isolated kept nodes with no surviving edge as standalone declarations", () => {
    const ir: FlowchartIR = { direction: "TD", nodes: [{ id: "A", shape: "[Lonely]" }], edges: [] };
    const rendered = renderFlowchartMermaid(ir);
    expect(rendered).toBe("flowchart TD\n  A[Lonely]");
  });

  it("re-renders a valid edge label", () => {
    const ir: FlowchartIR = {
      direction: "LR",
      nodes: [{ id: "A", shape: "" }, { id: "B", shape: "" }],
      edges: [{ from: "A", to: "B", operator: "-->", label: "go" }],
    };
    const rendered = renderFlowchartMermaid(ir);
    expect(rendered).toBe("flowchart LR\n  A -->|go| B");
  });
});

describe("insertFlowDiagramSection", () => {
  const withoutDiagram = [
    "# Example flow",
    "",
    "Responsibility sentence.",
    "",
    "## Purpose",
    "",
    "Prose.",
    "",
    "## Ordered flow",
    "",
    "1. Step one.",
    "",
    "## Invariants",
    "",
    "- Some invariant.",
    "",
    "## Failure and recovery",
    "",
    "Prose.",
    "",
    "## Related pages",
    "",
    "- [x](../x.md)",
    "",
  ].join("\n");

  it("inserts the section before Invariants when the LLM wrote no Diagram section", () => {
    const result = insertFlowDiagramSection(withoutDiagram, "example-flow");
    expect(result).not.toBeNull();
    expect(result).toContain("## Diagram\n\n```mermaid\n%% livewiki/diagrams/flow-example-flow.mmd\n```\n\n## Invariants");
  });

  it("returns null when Invariants cannot be located and there is no existing Diagram section either", () => {
    const noInvariants = withoutDiagram.replace("## Invariants", "## SomethingElse");
    expect(insertFlowDiagramSection(noInvariants, "example-flow")).toBeNull();
  });

  it("REPLACES an existing Diagram section instead of inserting a second one (regression: real E2E showed the LLM sometimes writes one anyway)", () => {
    const withLlmWrittenDiagram = [
      "# Example flow",
      "",
      "Responsibility sentence.",
      "",
      "## Purpose",
      "",
      "Prose.",
      "",
      "## Ordered flow",
      "",
      "1. Step one.",
      "",
      "## Diagram",
      "",
      "```mermaid",
      "flowchart LR",
      "  a --> b",
      "```",
      "",
      "## Invariants",
      "",
      "- Some invariant.",
      "",
      "## Failure and recovery",
      "",
      "Prose.",
      "",
      "## Related pages",
      "",
      "- [x](../x.md)",
      "",
    ].join("\n");

    const result = insertFlowDiagramSection(withLlmWrittenDiagram, "example-flow");
    expect(result).not.toBeNull();
    // Exactly one "## Diagram" heading survives, carrying the placeholder —
    // never the LLM's own (possibly invalid) Mermaid.
    expect(result!.match(/^## Diagram$/gm)).toHaveLength(1);
    expect(result).toContain("%% livewiki/diagrams/flow-example-flow.mmd");
    expect(result).not.toContain("a --> b");
    expect(result).toContain("## Invariants");
    expect(result).toContain("## Failure and recovery");
  });

  it("a code example containing the literal text '## Diagram' inside a fence is never mistaken for a real heading", () => {
    const withFakeDiagramInCode = withoutDiagram.replace(
      "## Purpose\n\nProse.",
      "## Purpose\n\n```markdown\n## Diagram\n```\n\nProse.",
    );
    const result = insertFlowDiagramSection(withFakeDiagramInCode, "example-flow");
    expect(result).not.toBeNull();
    // The fenced example text survives untouched, AND the real section was
    // inserted right before "## Invariants" (not duplicated/misplaced).
    expect(result).toContain("```markdown\n## Diagram\n```");
    expect(result).toContain("## Diagram\n\n```mermaid\n%% livewiki/diagrams/flow-example-flow.mmd\n```\n\n## Invariants");
  });
});
