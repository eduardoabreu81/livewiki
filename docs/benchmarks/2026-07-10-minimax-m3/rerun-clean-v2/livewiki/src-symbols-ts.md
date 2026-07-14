---
title: src-symbols-ts
owner: generated
anchors:
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#walkNode
---

# `packages/core/src/symbols.ts`

Symbol extraction from tree-sitter ASTs. Produces `SymbolRecord[]` from a parsed `Tree` plus the original source and a relative file path.

The module implements the SPEC §"Fase 1 — Indexador" extraction step. It is intentionally "honest": only emitted symbols are guaranteed to be referenceable from the symbol key (e.g. anonymous arrows and IIFEs are skipped).

## Kinds and coverage

| Language            | Node type                          | Kind        |
|---------------------|------------------------------------|-------------|
| TS / TSX / JS       | `function_declaration`             | `function`  |
| TS / TSX / JS       | `generator_function_declaration`   | `function`  |
| TS / TSX / JS       | `class_declaration`                | `class`     |
| TS / TSX / JS       | `method_definition`                | `method` (parent = enclosing class) |
| TS / TSX / JS       | `arrow_function` with a name       | `function` (assigned to `const`) |
| TS / TSX / JS       | `export_statement`                 | `export` (covers re-exports) |
| Python              | `function_definition`              | `function`  |
| Python              | `class_definition`                 | `class`     |
| Python              | `decorated_definition`             | decorator wraps fn/class |

## Symbol key format (SPEC §"Frontmatter")

- Top-level: `relative/path.ext#Name`
- Method: `relative/path.ext#Class.method`
- Python decorated: `relative/path.ext#decorated_fn`

## `extractSymbols`
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols -->

Entry point. Walks the AST root and returns every extracted symbol.

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
```

`relPath` is the repo-relative path with forward slashes (as produced by the walker). The function delegates entirely to `walkNode` starting at `tree.rootNode` with `parentClassName = null`.

## `walkNode`
<!-- lw:anchors packages/core/src/symbols.ts#walkNode -->

Recursive descent over a tree-sitter `Node`. Dispatches on `node.type` to decide whether to emit a symbol and whether to keep descending.

Key behaviors:

- **TS classes** (`class_declaration`): emits the class, then manually walks children with `parentClassName = name` so methods are qualified.
- **TS `export_statement`**: emits a single entry for `export class` / `export function` (kind = `class` / `function`, **not** `export`); for `export const`, emits each declarator identifier with `kind: "export"`. Already-walked subtrees are skipped to avoid duplication.
- **Python `class_definition`**: emits the class and walks its `body` block to find methods.
- **Python `decorated_definition`**: forwards to the wrapped `function_definition` or `class_definition` so the symbol keeps the inner name.
- **Default**: walks all named children unless an explicit branch already handled the node.

## `makeRecord`
<!-- lw:anchors packages/core/src/symbols.ts#makeRecord -->

Builds a `SymbolRecord` from a node.

```ts
function makeRecord(
  node: Node,
  source: string,
  relPath: string,
  name: string,
  kind: SymbolKind,
): SymbolRecord
```

- `key` — `${relPath}#${name}` (unique per file+path).
- `start_line` / `end_line` — 1-based (tree-sitter rows are 0-based; the function adds 1).
- `content_hash` — `sha256Slice(source, startByte, endByte)` over the node's byte range.
- `signature` — produced by `signatureFor`; may be `null` if the node starts on an empty line.

## `signatureFor`
<!-- lw:anchors packages/core/src/symbols.ts#signatureFor -->

Returns the first non-empty line of the node, trimmed, used for anchor previews in Phase 2.

```ts
function signatureFor(node: Node, source: string): string | null
```

- Reads up to 200 bytes starting at `node.startIndex`.
- Returns `null` if the slice has no trimmed content.
- Truncates with a trailing `…` when the trimmed line exceeds 200 characters.

## Types

```ts
export type SymbolKind = "function" | "class" | "method" | "export";

export interface SymbolRecord {
  /** Full key (path#name or path#parent.name). UNIQUE per file+path. */
  key: string;
  /** Short name (last segment). */
  name: string;
  kind: SymbolKind;
  /** Representative snippet — header or first line — for anchors. */
  signature: string | null;
  start_line: number;
  end_line: number;
  content_hash: string;
}
```

## Dependencies

- `web-tree-sitter` — `Tree`, `Node` types.
- `./hashes.js` — `sha256Slice` for `content_hash`.

TODO: behavior for `arrow_function` with a name is documented in the header comment but the corresponding `case` arm is not visible in the current source excerpt; confirm presence in the full file.