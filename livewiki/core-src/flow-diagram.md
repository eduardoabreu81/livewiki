---
title: flow-diagram.ts — deterministic Mermaid renderer for stage-5 flow pages
owner: generated
anchors:
  - packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD
  - packages/core/src/flow-diagram.ts#annotateLabel
  - packages/core/src/flow-diagram.ts#buildDiagramContext
  - packages/core/src/flow-diagram.ts#escapeMermaidLabel
  - packages/core/src/flow-diagram.ts#generateFlowDiagram
  - packages/core/src/flow-diagram.ts#insertFlowDiagramSection
  - packages/core/src/flow-diagram.ts#moduleGranularityIr
  - packages/core/src/flow-diagram.ts#renderFlowchartMermaid
  - packages/core/src/flow-diagram.ts#symbolGranularityIr
  - packages/core/src/flow-diagram.ts#symbolLabel
  - packages/core/src/flow-diagram.ts#truncateFlowchartToBudget
---

# flow-diagram.ts — deterministic Mermaid renderer for stage-5 flow pages

This page is the livewiki reference for `packages/core/src/flow-diagram.ts`, the module that draws the `## Diagram` section of a stage-5 flow page.

## When to use this page

- **Generate a flow diagram for a `FlowCandidate`** when the stage-5 orchestrator needs Mermaid source for the companion `.mmd` file.
- **Diagnose why a flow page is missing or has a stale `## Diagram` section** by reading `insertFlowDiagramSection` and its invariants/fallback logic.
- **Pick the right granularity** (module-per-node vs symbol-per-node) by consulting `FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD` and the two IR builders.
- **Audit the IR → Mermaid pipeline** (`truncateFlowchartToBudget` then `renderFlowchartMermaid`) when validating budget or syntax behavior.

## How it fits

`flow-diagram.ts` lives under `packages/core/src/`, alongside the other stage-5 pipeline modules. It depends on `FlowCandidate` (from `./flows.js`) for the walk-ordered module list and the five tiered key groups, on `Module` (from `./modules.js`) for display names, on `FlowDiagramBudget` (from `./prompts.js`) for the node/edge cap, on `maskCodeSpansPreservingLength` (from `./markdown-mask.js`) to safely locate headings in raw page text, and on `flowDiagramPlaceholder` (from `./artifact.js`) for the on-disk `.mmd` placeholder convention.

The module's role in the pipeline is narrow and mechanical: convert an already-resolved `FlowCandidate` into a syntactically valid, budget-bounded Mermaid `flowchart LR` string, and (separately) splice a `## Diagram` section into the LLM-authored page using the placeholder convention. The file's header comment makes the design intent explicit: the LLM never writes the diagram; the orchestrator inserts this code's output wholesale. The two exported entry points are `generateFlowDiagram` (renders the source) and `insertFlowDiagramSection` (splices the section), and they are independent — callers in `batch.ts` invoke them separately.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-flow-diagram.mmd
```

## IR shape and budget enforcement

The file defines a typed intermediate representation, `FlowchartIR`, that decouples "what the diagram means" from "how Mermaid is spelled". An IR is just a direction, a node list, and an edge list — every node carries an `id` and a pre-shaped `shape` token such as `[Do the thing]` or `{Decision}`, and every edge carries its endpoints, a Mermaid operator like `-->` or `-.->`, and an optional pipe-wrapped label. Everything downstream is a pure function on this IR.

The first piece of the pipeline is `truncateFlowchartToBudget`, which is the single point of budget enforcement.

```ts
export function truncateFlowchartToBudget(
  ir: FlowchartIR,
  maxNodes: number,
  maxEdges: number,
): FlowchartIR
```

`truncateFlowchartToBudget` takes an `IR` and a node/edge cap; it returns an `IR` whose first `maxNodes` nodes (by appearance order) are kept and whose edges are kept only when **both** endpoints survive truncation. The function is deliberately deterministic and idempotent: re-truncating an already-small IR returns it unchanged. Note the asymmetry visible in the source — the node cap is an upper bound only (it never enlarges or duplicates nodes), and the edge cap filters by endpoint membership rather than re-paginating, so an edge whose endpoints both survive is kept iff it appears early enough.

The second piece is `renderFlowchartMermaid`, which turns the (possibly truncated) IR back into Mermaid source.

```ts
export function renderFlowchartMermaid(ir: FlowchartIR): string
```

`renderFlowchartMermaid` walks edges first to emit `from <op> [|label|] to` lines, then makes a second pass to re-declare any kept node that ended up with no surviving edges — a real failure mode after truncation is that an isolated kept node silently vanishes from the rendered diagram unless it gets its own declaration line. The output is deterministic and contains no LLM-generated text.

## Granularity selection

A `FlowCandidate` describes a flow over a list of module IDs, plus five tiered key groups (entry / boundary / sink and two auxiliaries). Whether the diagram should draw one box per module or one per semantic-role symbol key is decided by a single constant.

```ts
export const FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD = 6;
```

The threshold is a count of `candidate.moduleIds`: above it the diagram is module-granular, at or below it the diagram is symbol-granular. The comment on the constant documents this as a mirror of the old free-form prompt rule, which previously stated the same boundary in prose. The branching on the threshold lives in `generateFlowDiagram` itself; the two IR builders are pure and do not re-check it.

## Label shaping

Mermaid parses `[...]` node bodies as a single token, so any unescaped bracket, brace, parenthesis, pipe, or quote inside a label can desync the real parser. Three small helpers keep labels safe and readable.

```ts
function symbolLabel(key: string): string
```

`symbolLabel` strips a closed-list key down to its trailing symbol name (`path/to/file.ts#name` becomes `name`), so diagrams show short symbol names instead of full file paths. The fallback (no `#` in the key) returns the input unchanged.

```ts
function escapeMermaidLabel(label: string): string
```

`escapeMermaidLabel` replaces the Mermaid-breaking characters (`[`, `]`, `{`, `}`, `(`, `)`, `|`, `"`) with spaces, collapses runs of whitespace to a single space, and trims. It does not re-introduce any wrapping; callers compose the final `[...]` shape token themselves.

```ts
function annotateLabel(baseLabel: string, moduleId: string | undefined, ctx: DiagramContext): string
```

`annotateLabel` layers entry/persistence signals onto a base label: if the owning module is in `ctx.entryModuleIds` it prefixes `Entry: `; if it is in `ctx.persistenceModuleIds` it appends ` - persists`. The implementation deliberately avoids parentheses or brackets in the annotation text — earlier E2E validation rejected an `(persists)` suffix because it desynced the real Mermaid parser. When `moduleId` is `undefined`, the function returns `baseLabel` unchanged; the persistence annotation is only added when the module is recognized, so a missing lookup never corrupts the label.

## Diagram context construction

Both IR builders need to resolve a `Module` from a closed-list key, look up a display title, and check entry/persistence membership. That resolution is factored into one helper.

```ts
function buildDiagramContext(candidate: FlowCandidate, modules: ReadonlyArray<Module>): DiagramContext
```

`buildDiagramContext` walks the provided modules once to build three read-only maps and sets: `displayNameByModuleId` (module id → human title, falling back to the id), `moduleIdByPath` (each path the module owns → its id, so a key like `path/to/file.ts#name` can resolve back to a module via its `path#0`), and the two signal sets derived from `candidate.signals.entry` and `candidate.signals.persistence`. The returned `DiagramContext` is the only object the IR builders and `annotateLabel` consult for label resolution, which keeps them pure with respect to `FlowCandidate` and `Module`.

## Module-granularity IR

When a flow involves many modules, the diagram is intentionally coarse: one node per module, walked in order.

```ts
function moduleGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR
```

`moduleGranularityIr` maps each `candidate.moduleIds` entry to a node whose id is `n<index>` and whose label is the module's display title (run through `escapeMermaidLabel` and `annotateLabel`). Edges connect consecutive nodes in walk order with a plain `-->` and no label, producing a left-to-right chain. The function does not consult `boundaryKeys` / `sinkKeys` / `entryKeys`; module-granularity means the semantic-role keys are deliberately ignored in favor of walk-order adjacency.

## Symbol-granularity IR

When a flow involves few modules, the diagram is finer-grained: one node per semantic-role symbol key (entry / boundary / sink), chained by tier order.

```ts
function symbolGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR
```

`symbolGranularityIr` first deduplicates keys while preserving a flat `[...entryKeys, ...boundaryKeys, ...sinkKeys]` walk order, so every node id is stable and unique. Each key becomes a node whose label is `symbolLabel(key)` (the trailing symbol name), escaped and annotated. Tier-4 (`otherProductKeys`) and tier-5 (`auxiliaryKeys`) keys are intentionally not drawn — the diagram should be the walk's story, not a dump of every closed-list key.

Edges are chained by tier order as a deterministic APPROXIMATION of role order, not a proven call sequence: every entry key feeds the first boundary key (or, when no boundary key exists, the first sink key), boundary keys chain in sequence, and the last boundary key feeds every sink key. The implementation explicitly notes that this mirrors the same caution applied to `resolvedCrossModuleCallees` in `flows.ts`. The final shape is left-to-right, matching the module-granularity builder.

## End-to-end entry point

The two IR builders, the budget enforcer, and the Mermaid renderer are composed in one exported function.

```ts
export function generateFlowDiagram(
  candidate: FlowCandidate,
  modules: ReadonlyArray<Module>,
  budget: FlowDiagramBudget,
): string
```

`generateFlowDiagram` builds the `DiagramContext`, picks the granularity by comparing `candidate.moduleIds.length` against `FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD`, truncates the resulting IR with `truncateFlowchartToBudget` (using `budget.maxNodes` and `budget.maxEdges`), and renders it with `renderFlowchartMermaid`. The function makes zero LLM calls and always produces output within the budget — truncation happens before rendering, never after. The file's docstring notes that callers should still run `validateMermaidSyntax` as defense in depth against a renderer bug; a failure there is treated as a code bug, not a content-generation failure.

## Splicing the `## Diagram` section

The companion function handles the markdown side: it inserts a `## Diagram` section into the LLM-authored page using the on-disk placeholder convention.

```ts
export function insertFlowDiagramSection(
  pageContent: string,
  slug: string,
  opts?: {
    allowMissingInvariants?: boolean;
  },
): string | null
```

`insertFlowDiagramSection` first runs `maskCodeSpansPreservingLength` over the page so that a literal "## Invariants" or "## Diagram" appearing inside a fenced or inline code example cannot be mistaken for a real heading. It then collects the offsets of every real `## heading`, and proceeds in three cases:

1. **A `## Diagram` heading already exists.** The whole section (from that heading up to the next H2) is replaced with the canonical insertion. A defensive path documented in the comment: real paid E2E runs sometimes saw the LLM disregard the "do not write Diagram" instruction, and replacing the stale section prevents the validator from seeing it first.
2. **`## Diagram` is absent and `## Invariants` is present.** The insertion is spliced immediately before `## Invariants`.
3. **`## Diagram` and `## Invariants` are both absent.** With `opts.allowMissingInvariants === true`, the insertion is spliced right after the `## Ordered flow` section. Without that flag, the function returns `null` — same treatment as any other missing/out-of-order required section.

The insertion body itself is fixed: `## Diagram`, a blank line, a ```` ```mermaid ```` fence whose contents are `flowDiagramPlaceholder(slug)` (the on-disk placeholder convention — the page never holds the real Mermaid source, the companion `.mmd` file does), a closing fence, and a trailing blank line. `generateFlowDiagram`'s output is written to the `.mmd` file by the caller, not by this function.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD packages/core/src/flow-diagram.ts#annotateLabel packages/core/src/flow-diagram.ts#buildDiagramContext packages/core/src/flow-diagram.ts#escapeMermaidLabel packages/core/src/flow-diagram.ts#generateFlowDiagram packages/core/src/flow-diagram.ts#insertFlowDiagramSection packages/core/src/flow-diagram.ts#moduleGranularityIr packages/core/src/flow-diagram.ts#renderFlowchartMermaid packages/core/src/flow-diagram.ts#symbolGranularityIr packages/core/src/flow-diagram.ts#symbolLabel packages/core/src/flow-diagram.ts#truncateFlowchartToBudget -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Covered by `packages/core/src/flow-diagram.test.ts` (same-name test file on disk).
