---
title: Mermaid diagram generation for architecture and class pages
owner: generated
anchors:
  - packages/core/src/diagrams.ts#STRUCTURE_MAX_EDGES
  - packages/core/src/diagrams.ts#buildCollapsedStructureLines
  - packages/core/src/diagrams.ts#buildExactStructureLines
  - packages/core/src/diagrams.ts#classIdentity
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#mermaidMemberName
  - packages/core/src/diagrams.ts#moduleDiagramPlaceholder
  - packages/core/src/diagrams.ts#moduleSlug
---

# Mermaid diagram generation for architecture and class pages

This page documents the module that deterministically emits every Mermaid diagram livewiki writes to disk — no LLM is involved.

## When to use this page

- **Add or change a generated architecture diagram** by editing `generateStructure` (repository tree) or `generateModulesGraph` (cross-module imports) and the helpers they call.
- **Tune the Mermaid output contract** (node IDs, label escaping, member names) by adjusting `mermaidId`, `mermaidMemberName`, and `escapeLabel`.
- **Change how a module's class diagram is laid out** by editing `generateClassDiagram` and the `classIdentity` grouping it uses.
- **Reason about the on-disk file layout** (e.g. `structure.mmd`, `modules.mmd`, `<slug>.classes.mmd`) and the placeholder line that links a module page to its diagram, produced by `moduleDiagramPlaceholder` and `moduleSlug`.

## How it fits

`packages/core/src/diagrams.ts` lives in the `@livewiki/core` package alongside the module discovery (`modules.ts`) and symbol database (`db.js`) layers it imports types from. It is a pure, deterministic string generator: callers pass in file paths, `ModuleGraphEdge` lists, or `(module, SymbolRow[])` pairs, and receive a finished Mermaid source string to write under `livewiki/architecture/` or `livewiki/diagrams/`. The output is consumed by the artifact writer, by `validateMermaidSyntax` during verify, and by the viewer at runtime — every path that ultimately renders an architecture or class diagram goes through this file.

The file exposes three exported entry points (`generateStructure`, `generateModulesGraph`, `generateClassDiagram`) plus two tiny helpers that produce the on-disk filename conventions used elsewhere (`moduleSlug`, `moduleDiagramPlaceholder`). The remaining functions are private support code for sanitizing Mermaid identifiers and labels.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-diagrams.mmd
```

## Filename and placeholder conventions

These two helpers define the naming contract every other diagram-emitting file relies on. The placeholder is a single Mermaid comment line that the on-disk module page embeds in its `## Diagram` fence so the viewer can swap in a real diagram at render time.

<!-- lw:anchors packages/core/src/diagrams.ts#moduleDiagramPlaceholder packages/core/src/diagrams.ts#moduleSlug -->

`moduleDiagramPlaceholder` returns the exact comment line an on-disk module page carries inside its Mermaid fence when `moduleDiagrams` is enabled. Its purpose is to give the viewer a unique, stable string to look up the corresponding model-drawn diagram file, distinct from the deterministic class diagram (`generateClassDiagram` writes `<slug>.classes.mmd`) and the flow companion diagrams (`artifact.ts` writes `flow-<slug>.mmd`) — the three namespaces never collide.

`export function moduleDiagramPlaceholder(slug: string): string`

It takes a module slug and returns a single-line `%% livewiki/diagrams/<slug>.mmd` comment that the viewer can resolve at render time.

`moduleSlug` produces the filesystem-safe identifier used by both the class diagram filename and the placeholder. The purpose is normalization: the same module id must produce the same slug everywhere (class diagram file, placeholder, downstream lookups), so any character that would confuse a path or a Mermaid identifier is folded into a single dash.

`export function moduleSlug(value: string): string`

It takes a raw module id string and returns a lowercase, accent-stripped, dash-separated slug suitable for use as a filename segment.

## Structure graph (repository tree)

`generateStructure` is the only public function that turns a flat list of file paths into the `livewiki/architecture/structure.mmd` graph. It has two modes — exact and collapsed — selected automatically by the `STRUCTURE_MAX_EDGES` budget, because Mermaid's parser refuses diagrams over 500 edges and livewiki's own verify step rejects them at build time.

<!-- lw:anchors packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#STRUCTURE_MAX_EDGES packages/core/src/diagrams.ts#buildExactStructureLines packages/core/src/diagrams.ts#buildCollapsedStructureLines -->

`generateStructure` walks the path list, picks the right builder, prepends the `graph LR` header, and returns the finished Mermaid source. Its purpose is to keep the on-disk `structure.mmd` always parseable regardless of repository size, by falling back from a per-file graph to a directory-plus-summary graph when the per-file graph would exceed the budget.

`export function generateStructure(filePaths: string[]): string`

It takes a list of repository-relative file paths and returns a `graph LR` Mermaid source string ready to write to disk.

`STRUCTURE_MAX_EDGES` is the single numeric threshold that decides which builder runs. The reason it is exposed as a named constant rather than a magic number is that both the generator and the verify step refer to the same budget, and a future tuning pass must change one place. Per the in-file comment, Mermaid's parser rejects diagrams over 500 edges by default, and 450 leaves headroom for downstream tooling.

`export const STRUCTURE_MAX_EDGES = 450;`

`buildExactStructureLines` is the per-file path: it splits each path on `/`, walks the segments, and emits a node for every directory and every file plus one deduped parent→child edge. The purpose is to honour the historical livewiki contract that the exact graph contains every directory and file as its own node, so a reader can see the full file tree in the rendered diagram.

`function buildExactStructureLines(filePaths: string[]): { lines: string[]; edgeCount: number }`

It takes a list of file paths and returns both the Mermaid lines and the exact edge count, so the caller can decide whether to stay in exact mode or fall back to collapsed mode.

`buildCollapsedStructureLines` is the fallback: it walks paths the same way but stops one segment short, emitting a directory chain and then ONE summary node per directory — `dir/… (N files)` — attached to the directory. The purpose is to keep medium and large repos renderable: without this mode the file tree graph would exceed the 500-edge limit and the artifact would fail livewiki's own verify.

`function buildCollapsedStructureLines(filePaths: string[]): string[]`

It takes a list of file paths and returns just the Mermaid lines (no edge count is needed because collapsed output always stays under the budget by construction).

## Module import graph

`generateModulesGraph` produces `livewiki/architecture/modules.mmd`, the cross-module import graph. The purpose is to surface, at a glance, which modules depend on which — a different question from "what does the file tree look like", which is what `generateStructure` answers.

<!-- lw:anchors packages/core/src/diagrams.ts#generateModulesGraph -->

`export function generateModulesGraph(edges: ModuleGraphEdge[]): string`

It takes a list of `ModuleGraphEdge` records (each carrying a `from` and `to` module id) and returns a `graph LR` Mermaid source string. When the list is empty the function emits a single `root[No cross-folder imports detected]` node instead of a blank graph, so the viewer always has something to render.

## Class diagram per module

`generateClassDiagram` is the most intricate of the three generators. It picks the class symbols belonging to the module out of a flat `SymbolRow` list, groups their methods by `(path, className)` identity, and emits a `classDiagram` block with `direction TB`. The purpose is to render a vertical inventory of the module's classes even when there are no real inheritance or association edges between them.

<!-- lw:anchors packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity -->

`export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string`

It takes a `Module` (used for its `paths` set) and the full project-wide `SymbolRow[]` list, and returns a Mermaid `classDiagram` source string — or an empty string if the module has no class symbols at all.

The function applies three rules in order. First, it filters `symbols` to entries whose `kind` is `class` and whose file path belongs to the module, then sorts them by key for deterministic output. Second, it builds a side map from `classIdentity(path, className)` to that class's method rows, again sorted by key, so two classes with the same display name in different files end up with distinct method groups. Third, it decides whether to apply the sparse-chain layout: when the real-edge list is empty AND there are at least two classes, it emits the `SPARSE_CLASS_DIAGRAM_DIRECTIVE` themeCSS line and chains consecutive classes with `--` links so the viewer stacks them vertically instead of packing them into one horizontal row. The comment in the source notes that when real structure edges are eventually emitted, they will drive the layout and the sparse chain will be turned off.

`classIdentity` is the helper that produces the grouping key. Its purpose is collision resistance: a class named `Config` in two different files must not share a method group, so the key is the JSON-serialized `[path, className]` pair.

`function classIdentity(path: string, className: string): string`

It takes a file path and a class display name and returns a stable string identity that is unique across files and names.

## Mermaid identifier and label sanitization

These three small helpers are the contract between free-form repository strings and the Mermaid grammar. Every node id, member name, and quoted label in the file flows through one of them.

<!-- lw:anchors packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`mermaidId` folds every non-alphanumeric character to an underscore, producing a string that is a valid Mermaid node id regardless of the source path or module id. Its purpose is to make any input safe to drop into the left-hand side of a node declaration or edge.

`function mermaidId(value: string): string`

It takes an arbitrary string and returns a Mermaid-safe identifier.

`mermaidMemberName` is the method-name variant: it keeps alphanumerics plus `_` and `.` (so nested member paths survive) and replaces everything else with an underscore, falling back to the literal string `"method"` when the sanitized result is empty. Its purpose is to let a method like `Foo.bar.baz` round-trip into the Mermaid class body without losing the dot path.

`function mermaidMemberName(value: string): string`

It takes a method name string and returns a Mermaid-safe member name, or the literal `"method"` if sanitization would produce an empty string.

`escapeLabel` is the only one that touches the inside of a quoted label: it replaces `&`, `"`, `[`, and `]` with their HTML-entity equivalents. Its purpose is to keep a label that legitimately contains a quote or a bracket from terminating the Mermaid string early or being parsed as syntax. Other characters are intentionally left alone — Mermaid accepts more inside a `["…"]` label than inside an id, and over-escaping makes labels harder to read.

`function escapeLabel(value: string): string`

It takes a label string and returns the same string with the four characters that can break a Mermaid quoted label replaced by their entity equivalents.

## Tests

Covered by `packages/core/src/diagrams.test.ts` (same-name test file on disk).
