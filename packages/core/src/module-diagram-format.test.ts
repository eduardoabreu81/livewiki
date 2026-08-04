/**
 * module-diagram-format.test.ts — roadmap item 22 (CodeWiki-grade module
 * pages), unit-level contracts:
 *
 *   - moduleDiagramPlaceholder naming (`<slug>.mmd`, distinct from
 *     `<slug>.classes.mmd` and `flow-<slug>.mmd`);
 *   - validateStage4Artifact module kind + `expectedModuleDiagram`: the
 *     `## Diagram` placeholder check (accept / missing section / missing
 *     fence / wrong placeholder), strict under the relaxed round, inert for
 *     flow/topic kinds and when the context field is absent;
 *   - extractInlineModuleDiagram: placeholder substitution, placeholder-only
 *     fence → null, missing section → null;
 *   - repair-contract: the new/changed codes are classified per page kind
 *     (module directives render; flow/topic report-only);
 *   - prompt flags: buildStage4Prompt/buildRepairPrompt render the diagram
 *     rules + hierarchy guidance only behind the flags — flags off is the
 *     byte-identical pre-#22 prompt.
 */

import { describe, it, expect } from "vitest";
import {
  validateStage4Artifact,
  extractInlineModuleDiagram,
  flowDiagramPlaceholder,
} from "./artifact.js";
import { moduleDiagramPlaceholder } from "./diagrams.js";
import { SUPPORTED_FIXES, UNCLASSIFIED, renderActionDirective } from "./repair-contract.js";
import { buildStage4Prompt, buildRepairPrompt } from "./prompts.js";
import type { Module } from "./modules.js";

// === Placeholder naming (D1) ===

describe("diagrams.moduleDiagramPlaceholder", () => {
  it("is the %% livewiki/diagrams/<slug>.mmd form", () => {
    expect(moduleDiagramPlaceholder("core")).toBe("%% livewiki/diagrams/core.mmd");
  });

  it("never collides with the classes-diagram or flow-diagram namespaces", () => {
    expect(moduleDiagramPlaceholder("core")).not.toContain(".classes.mmd");
    expect(moduleDiagramPlaceholder("core")).not.toContain("flow-");
    expect(flowDiagramPlaceholder("core")).toBe("%% livewiki/diagrams/flow-core.mmd");
  });
});

// === validateStage4Artifact: expectedModuleDiagram (module kind) ===

describe("artifact.validateStage4Artifact — module diagram placeholder (roadmap #22)", () => {
  const keys = ["core/db.ts#connect"];
  const MODULE_FRONTMATTER = `---
title: Core data layer
owner: generated
anchors:
  - core/db.ts#connect
---
`;
  const OPENING = `# Core data layer

This page documents the module's indexed responsibilities.

## When to use this page

- Review this module's behavior.
- Change this module's implementation.

## How it fits

This module provides one part of the repository implementation.`;
  const DIAGRAM = `## Diagram

\`\`\`mermaid
%% livewiki/diagrams/core.mmd
\`\`\``;
  const DETAILS = `## Details

<!-- lw:anchors core/db.ts#connect -->

The connect function opens the data layer.`;

  const page = (parts: string[]) => `${MODULE_FRONTMATTER}\n${parts.join("\n\n")}\n`;
  const context = {
    moduleId: "core",
    moduleRole: "product",
    expectedModuleDiagram: "livewiki/diagrams/core.mmd",
  } as const;

  it("accepts a valid module page with the exact placeholder", () => {
    const r = validateStage4Artifact(page([OPENING, DIAGRAM, DETAILS]), keys, context);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("missing ## Diagram section → module_diagram_placeholder", () => {
    const r = validateStage4Artifact(page([OPENING, DETAILS]), keys, context);
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.code === "module_diagram_placeholder");
    expect(err).toBeDefined();
    expect(err!.message).toContain('"Diagram" H2 section');
  });

  it("Diagram section without a mermaid fence → module_diagram_placeholder", () => {
    const noFence = `## Diagram

This module has no diagram block.`;
    const r = validateStage4Artifact(page([OPENING, noFence, DETAILS]), keys, context);
    const err = r.errors.find((e) => e.code === "module_diagram_placeholder");
    expect(err).toBeDefined();
    expect(err!.message).toContain("fenced mermaid code block");
  });

  it("wrong placeholder → module_diagram_placeholder naming the expected one", () => {
    const wrong = `## Diagram

\`\`\`mermaid
%% livewiki/diagrams/other.mmd
\`\`\``;
    const r = validateStage4Artifact(page([OPENING, wrong, DETAILS]), keys, context);
    const err = r.errors.find((e) => e.code === "module_diagram_placeholder");
    expect(err).toBeDefined();
    expect(err!.message).toContain('"%% livewiki/diagrams/core.mmd"');
    expect(err!.offending).toContain("other.mmd");
  });

  it("a flow-* placeholder is NOT accepted for a module page", () => {
    const flowForm = `## Diagram

\`\`\`mermaid
%% livewiki/diagrams/flow-core.mmd
\`\`\``;
    const r = validateStage4Artifact(page([OPENING, flowForm, DETAILS]), keys, context);
    expect(r.errors.some((e) => e.code === "module_diagram_placeholder")).toBe(true);
  });

  it("stays strict under the relaxed completion round", () => {
    const r = validateStage4Artifact(page([OPENING, DETAILS]), keys, {
      ...context,
      relaxed: true,
    });
    expect(r.errors.some((e) => e.code === "module_diagram_placeholder")).toBe(true);
  });

  it("is inert when expectedModuleDiagram is absent (pre-#22 contract)", () => {
    const r = validateStage4Artifact(page([OPENING, DETAILS]), keys, {
      moduleId: "core",
      moduleRole: "product",
    });
    expect(r.errors).toEqual([]);
  });

  it("is inert for flow pages even when the field is set", () => {
    // Flow pages have their own Diagram/placeholder contract; the module
    // check must never fire for them.
    const flowPage = `---
title: Some flow
owner: generated
anchors:
  - core/db.ts#connect
modules:
  - core
---

# Some flow

This page explains one end-to-end behavior.

## Purpose

<!-- lw:anchors core/db.ts#connect -->

The flow starts here.
`;
    const r = validateStage4Artifact(flowPage, keys, {
      moduleId: "some-flow",
      moduleRole: "product",
      pageKind: "flow",
      expectedModuleDiagram: "livewiki/diagrams/core.mmd",
    });
    expect(r.errors.some((e) => e.code === "module_diagram_placeholder")).toBe(false);
  });
});

// === extractInlineModuleDiagram ===

describe("artifact.extractInlineModuleDiagram", () => {
  const page = (diagramBody: string) =>
    [
      "# Core",
      "",
      "Sentence.",
      "",
      "## How it fits",
      "",
      "Prose.",
      "",
      "## Diagram",
      "",
      "```mermaid",
      diagramBody,
      "```",
      "",
      "## Details",
      "",
      "More prose.",
      "",
    ].join("\n");

  it("extracts the inline diagram and substitutes the module placeholder", () => {
    const r = extractInlineModuleDiagram(page("flowchart LR\n  a --> b"), "core");
    expect(r).not.toBeNull();
    expect(r!.diagramSource).toBe("flowchart LR\n  a --> b");
    expect(r!.pageContent).toContain("%% livewiki/diagrams/core.mmd");
    expect(r!.pageContent).not.toContain("a --> b");
    expect(r!.sourceTooLarge).toBe(false);
  });

  it("returns null when the fence holds only the placeholder comment", () => {
    const r = extractInlineModuleDiagram(page("%% livewiki/diagrams/core.mmd"), "core");
    expect(r).toBeNull();
  });

  it("returns null when the page has no Diagram section", () => {
    const r = extractInlineModuleDiagram("# Core\n\nSentence.\n", "core");
    expect(r).toBeNull();
  });
});

// === repair-contract classification of the new/changed codes ===

describe("repair-contract — module diagram codes (roadmap #22)", () => {
  it("module kind supports module_diagram_placeholder with an actionable directive", () => {
    const directive = renderActionDirective(
      "module",
      { code: "module_diagram_placeholder", message: "no Diagram section", location: "body" },
      { messageSafe: "no Diagram section" },
    );
    expect(directive).toContain("## Diagram");
    expect(directive).toContain("mermaid");
  });

  it("module kind supports invalid_flow_diagram and flow_diagram_too_large (live gate)", () => {
    const invalid = renderActionDirective(
      "module",
      { code: "invalid_flow_diagram", message: "parse error", location: "body" },
      { messageSafe: "parse error" },
    );
    expect(invalid).toContain("Mermaid");
    const tooLarge = renderActionDirective(
      "module",
      { code: "flow_diagram_too_large", message: "over budget", location: "body" },
      { messageSafe: "over budget" },
    );
    expect(tooLarge).toContain("budget");
    // They are no longer report-only for the module kind.
    expect(UNCLASSIFIED.module["invalid_flow_diagram"]).toBeUndefined();
    expect(UNCLASSIFIED.module["flow_diagram_too_large"]).toBeUndefined();
  });

  it("module_diagram_placeholder is report-only for flow and topic kinds", () => {
    expect(UNCLASSIFIED.flow["module_diagram_placeholder"]).toBeDefined();
    expect(UNCLASSIFIED.topic["module_diagram_placeholder"]).toBeDefined();
    expect(SUPPORTED_FIXES.flow["module_diagram_placeholder"]).toBeUndefined();
    expect(SUPPORTED_FIXES.topic["module_diagram_placeholder"]).toBeUndefined();
  });
});

// === Prompt flags rendering ===

describe("prompts — module format flags (roadmap #22, D3 off by default)", () => {
  const module: Module = {
    id: "core",
    paths: ["core/db.ts"],
    symbolCount: 2,
  };
  const keys = ["core/db.ts#connect", "core/db.ts#close"];
  const budgets = { maxNodes: 12, maxEdges: 20 };

  it("flags off: no diagram rules, no hierarchy guidance (byte-identical prompt)", () => {
    const without = buildStage4Prompt(module, keys, "table", "source", "en", "product");
    const explicitOff = buildStage4Prompt(module, keys, "table", "source", "en", "product", undefined, {});
    expect(explicitOff.system).toBe(without.system);
    expect(without.system).not.toContain("mermaid fenced block");
    expect(without.system).not.toContain("concept-named H2 sections");
  });

  it("moduleDiagrams on: diagram rules with the interpolated budget + rejection line", () => {
    const p = buildStage4Prompt(module, keys, "table", "source", "en", "product", undefined, {
      moduleDiagrams: budgets,
    });
    expect(p.system).toContain("emit ONE H2 `Diagram` section");
    expect(p.system).toContain("at most 12 nodes and 20 edges");
    expect(p.system).toContain("NEVER write a `%% livewiki/...` placeholder comment");
    expect(p.system).toContain("The required `Diagram` section is missing");
    expect(p.system).not.toContain("concept-named H2 sections");
  });

  it("deepHierarchy on: concept-grouped hierarchy guidance only", () => {
    const p = buildStage4Prompt(module, keys, "table", "source", "en", "product", undefined, {
      deepHierarchy: true,
    });
    expect(p.system).toContain("concept-named H2 sections");
    expect(p.system).toContain("8 or more symbols");
    expect(p.system).not.toContain("emit ONE H2 `Diagram` section");
  });

  it("repair prompt mirrors the same flags", () => {
    const off = buildRepairPrompt(module, keys, "table", "source", "prior", [], 1000, "en");
    expect(off.system).not.toContain("emit ONE H2 `Diagram` section");
    expect(off.system).not.toContain("concept-named H2 sections");
    const on = buildRepairPrompt(module, keys, "table", "source", "prior", [], 1000, "en", undefined, undefined, undefined, {
      moduleDiagrams: budgets,
      deepHierarchy: true,
    });
    expect(on.system).toContain("emit ONE H2 `Diagram` section");
    expect(on.system).toContain("at most 12 nodes and 20 edges");
    expect(on.system).toContain("concept-named H2 sections");
  });
});
