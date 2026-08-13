---
title: Rationale evidence renderer
owner: generated
anchors:
  - packages/core/src/rationale-evidence.ts#renderRationaleEvidence
---

# Rationale evidence renderer

This page documents the single source of truth that turns a list of indexed rationale rows into a bounded, newline-joined evidence block shared by the doc generator and the topic planner.

## When to use this page

- **Read** `renderRationaleEvidence` when you want to understand how a rationale block is formatted and capped before it is folded into a module or topic document.
- **Reach for** this page when you need to change the line shape of the rationale evidence and want to confirm both the generator and the planner stay in sync.
- **Consult** the `RationaleEvidenceRow` interface when you assemble rows from the schema v6 `rationales` table so the renderer can consume them without coercions.

## How it fits

`packages/core/src/rationale-evidence.ts` lives under `packages/core/src/` and is imported by two distinct call sites: the doc generator (`buildModuleDocContext` and `buildTopicDocContext` in `batch.ts`) assembles the rationale block for the generated document, while the topic planner (`topics.ts`) reads the same renderer to size its per-candidate estimate. Centralising the rendering keeps the planner's accounting from drifting away from what the generator actually emits, which is the whole point of the `Etapa 2b` consolidation. The module is a leaf utility: it depends on nothing else inside the package and has no dynamic behaviour beyond a linear scan over the supplied rows.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-rationale-evidence.mmd
```

## Inputs and the row contract

`renderRationaleEvidence` consumes a `ReadonlyArray<RationaleEvidenceRow>` where each row carries the file path, an optional `symbol_key`, a `kind` tag, free-form `text`, and a `start_line` number. The `symbol_key` is the join key against the indexed symbols, and when it is `null` the renderer treats the row as `file-level` so the evidence line stays informative even when no specific symbol was pinpointed.

## Rendering and the character budget

The renderer walks the rows in the order the caller supplied them and converts each one into a single evidence line of the shape `- [kind] path:line (key | file-level): text`. After building each candidate line it checks whether appending it (plus a joining newline once the buffer is non-empty) would exceed `maxChars`, and if so it stops the loop without writing that line or any later one — so the cap is enforced strictly as an upper bound, not a graceful truncation. If `maxChars` is `0` or negative, the loop never appends and the function returns the empty string; the same empty-string outcome happens naturally when the input array itself is empty. The returned string is therefore either `""` or a newline-joined, order-preserving prefix of the rows, and that prefix is the exact same string the generator and the planner both compute.

<!-- lw:anchors packages/core/src/rationale-evidence.ts#renderRationaleEvidence -->

The exported function is declared as:

```ts
export function renderRationaleEvidence(
  rows: ReadonlyArray<RationaleEvidenceRow>,
  maxChars: number,
): string
```

It takes a read-only list of rationale rows and a non-negative character budget, and returns the bounded newline-joined evidence block (or `""` when the budget is non-positive or the input is empty). It is the only symbol in this module, and it is the anchor that both `batch.ts` and `topics.ts` rely on to keep their rationale accounting aligned.