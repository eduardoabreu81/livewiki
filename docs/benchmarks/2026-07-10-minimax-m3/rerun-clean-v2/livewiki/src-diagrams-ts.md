---
title: src/diagrams.ts
owner: generated
anchors:
  - packages/core/src/diagrams.ts#moduleSlug
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#escapeLabel
---

# diagrams

Deterministic Mermaid generators for the `livewiki` pipeline. Produces three artifact families without LLM involvement:

- `livewiki/architecture/structure.mmd` — directory/module organogram.
- `livewiki/architecture/modules.mmd` — import graph between modules.
- `livewiki/diagrams/<module-slug>.classes.mmd` — `classDiagram` derived directly from the `symbols` table.

All output files carry `owner: generated`; they are regenerated on every `livewiki index` / `livewiki init` and never age into staleness. Call-graphs and sequence diagrams are intentionally out of scope.

## Helpers (internal)

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#escapeLabel -->

`moduleSlug` produces a safe filesystem slug: lowercase, NFD-normalized with diacritics stripped, non-alphanumerics collapsed to `-`, leading/trailing dashes trimmed.

`mermaidId` replaces every non-alphanumeric character in a node identifier with `_`, ensuring Mermaid accepts the produced IDs.

`escapeLabel` neutralizes characters that would break Mermaid node labels: `"` is backslash-escaped, and `[` / `]` are entity-encoded (`&#91;` / `&#93;`).

## Structure diagram

<!-- lw:anchors packages/core/src/diagrams.ts#generateStructure -->

`generateStructure(filePaths)` emits a Mermaid `graph TD` whose nodes are the cumulative path segments of each file. For each path it walks segments left-to-right, declaring new nodes and creating an `A --> B` edge per parent→child pair. Already-seen segments are not redeclared, so the resulting graph is a tree of directories and leaf files.

## Module dependency graph

<!-- lw:anchors packages/core/src/diagrams.ts#generateModulesGraph -->

`generateModulesGraph(edges)` emits a Mermaid `graph LR` containing one node pair (`from`, `to`) and one directed edge per `ModuleGraphEdge`. When the edge list is empty it short-circuits with a single `root[No module edges detected]` node so the artifact is still a valid Mermaid document.

## Class diagrams

<!-- lw:anchors packages/core/src/diagrams.ts#generateClassDiagram -->

`generateClassDiagram(module, symbols)` emits a Mermaid `classDiagram` containing every class declared under any of the module's paths, followed by its methods (read from the same `symbols` table). Behavior:

- Filters `symbols` to entries of `kind === "class"` whose key starts with `${path}#` for any path on the module.
- If no class symbol matches, returns the empty string — no file is written for that module.
- Bucketizes method symbols by the class segment of their key (`module#Class.method`).
- For each class, writes `class Name {` followed by one line per method (signature is preserved when present, otherwise `+methodName()`, with any embedded `"` escaped).