---
title: Extract imports from a parsed source file
owner: generated
anchors:
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#collectImportsForFiles
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/imports.ts#pushGoImportSpec
  - packages/core/src/imports.ts#pushRustUsePath
---

# Extract imports from a parsed source file

This page documents the module that walks a tree-sitter parse tree and pulls out every import-style declaration it recognises, returning them as the literal strings that appear in the source.

## When to use this page

- **Extract imports from an already-parsed tree** when a caller already holds a `Tree` (typical in tests or in callers that re-use a parser) and needs the `ExtractedImport[]` shape without touching the filesystem.
- **Resolve imports for a single file by path and contents** when the caller has the file's repo-relative path and the source text in hand and wants a graceful empty result on a parse failure.
- **Build a per-file import map for a batch of paths** when a batch pipeline needs an on-demand `Map<relativePath, ExtractedImport[]>` and is happy to skip unreadable or unparseable files silently.
- **Understand why a Go `import_spec`, a Rust `use_declaration`, or a Java `import_declaration` is normalised the way it is** — aliases, blank imports, dot imports, brace lists, wildcards, and `mod foo;` declarations all funnel into a single recorded module path.

## How it fits

The file lives at `packages/core/src/imports.ts` and sits between the project's tree-sitter parser bootstrap and the downstream consumers that turn raw import strings into a real import graph. It depends on `web-tree-sitter` for the `Tree` and `Node` types and on the sibling `./parser.js` module for `initParser` and `parseSource`, which it calls lazily so the parser is paid for once and reused. The output is intentionally only the string literal that appears in the source (for example `"./auth"`, `"express"`, `"../utils"`); the module does not turn `./foo` into `src/auth/foo.ts`. That resolution step happens later, in `modules.ts`, once a file map exists. The module also does not persist any result on disk — when a batch wants imports it asks again, and the helper hoisted into this file exists precisely so every call site recomputes the same on-demand map.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-imports.mmd
```

## Parsing the tree into import records

<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree -->

`extractImportsFromTree` is the pure, no-I/O core of the module. It walks a `Tree` once with a tree-sitter cursor and pushes an `ExtractedImport` for every node shape it cares about.

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
```

The function takes a parsed `Tree` and a language hint (`"python"` or `"ts"`) and returns the array of imports it could extract; it does not read files and does not throw.

The cursor is opened on the root, then a recursive `visit` walks depth-first: it inspects `cursor.currentNode.type`, switches on the grammar shape, then descends with `gotoFirstChild` and `gotoNextSibling` before returning. The cases it knows are:

- `import_statement` — used for both TypeScript/JavaScript (`import x from "y"`) and Python (`import os` / `import os.path`). When the node has a `source` field the quotes are stripped and the result is recorded as `ts-import`; otherwise the `dotted_name` children are recorded as `py-import`.
- `export_statement` — a re-export with a `from` clause. The `source` field, when present, is quote-stripped and recorded as `ts-export`. Re-exports without a `from` are skipped.
- `import_from_statement` — Python `from foo import bar`. The `module_name` field becomes `source`; the other `dotted_name` and `aliased_import` children become `names`. The module-name node is excluded by byte range so it is not double-counted as a name.
- `import_declaration` — Go or Java. Go forms (`import "fmt"` and `import ( … )`) carry one or more `import_spec` children and are handled by `pushGoImportSpec`. If no `import_spec` is found the same node type is interpreted as Java: the first `scoped_identifier` or `identifier` child is recorded as `java-import` (Java's wildcard `*` is a separate child and is never part of the recorded source; `import static` keeps the member in the recorded path).
- `use_declaration` — Rust. The `argument` field is delegated to `pushRustUsePath`.
- `mod_item` — Rust. Only the `mod foo;` form (no `body` field) is recorded as `rust-mod`; inline `mod foo { … }` is not an import.

Dynamic forms — variable `require()`, `import()` with an expression — are out of scope; they have no stable string literal to record.

## Go import_spec normalisation

<!-- lw:anchors packages/core/src/imports.ts#pushGoImportSpec -->

Go's import specs come in three visually different shapes (`x "a/b"`, `. "a/b"`, `_ "a/b"`), but they share the same grammar field. `pushGoImportSpec` extracts that field, strips the delimiter, and pushes a `go-import` record — or skips the spec when there is no path or the path is empty.

```ts
function pushGoImportSpec(spec: Node, out: ExtractedImport[]): void
```

It takes a single `import_spec` node and the output array it should append to, and returns nothing; the side effect is the new entry in `out`.

The path child is read with `childForFieldName("path")`. If that field is missing the function returns without pushing. Otherwise the literal's leading and trailing `"` or `` ` `` are stripped by a single regex; both `interpreted_string_literal` (double-quoted) and `raw_string_literal` (back-ticked) forms go through the same strip. An empty string after stripping is treated as "not an import" and the spec is dropped, which keeps a stray `import ""` out of the graph.

## Rust use path normalisation

<!-- lw:anchors packages/core/src/imports.ts#pushRustUsePath -->

Rust `use` declarations come in four shapes that all funnel into a single recorded module path. `pushRustUsePath` normalises them so the downstream graph resolver always sees the same kind of string for the same dependency.

```ts
function pushRustUsePath(argument: Node | null, out: ExtractedImport[]): void
```

It takes the `argument` of a `use_declaration` and the output array to append to, and returns nothing.

The shape switch:

- `identifier` / `scoped_identifier` (the plain `use std::fmt` form) — the whole node text is the path.
- `scoped_use_list` (`use a::{b, c}`) — only the shared `path` prefix is recorded (`a`); the items inside the braces are not dependencies, they are names brought into scope.
- `use_as_clause` (`use a::b as c`) — the `path` field (`a::b`) is recorded and the alias `c` is dropped, because the graph resolver targets the module, not the local name.
- `use_wildcard` (`use a::b::*`) — the `::*` suffix is stripped, so the recorded path is `a::b`.

A `use_list` without a shared prefix and any shape the function does not recognise short-circuit through the `default` branch and produce no record. The function also drops a path that is null or empty after extraction.

## High-level entry point

<!-- lw:anchors packages/core/src/imports.ts#collectImports -->

`collectImports` is the path-and-content entry point: given a repo-relative path and the source text, it lazily initialises the tree-sitter parser, parses the file by extension, and hands the resulting `Tree` to `extractImportsFromTree`. If the parser throws on the file, `collectImports` swallows the error and returns `[]` — the contract is graceful degradation for an unreadable or unparseable file rather than a hard failure.

The language hint is derived from the file extension: `.py` maps to `"python"`, everything else is treated as `"ts"` and handed to the TypeScript/JavaScript grammar (which also covers the `export_statement` re-export shape). `collectImports` is the symbol every per-file caller reaches for; tests that already own a parsed tree use `extractImportsFromTree` directly instead.

## Batch wrapper

<!-- lw:anchors packages/core/src/imports.ts#collectImportsForFiles -->

`collectImportsForFiles` is the batch entry point: it reads each repo-relative path under `absRoot` from disk and collects the per-file result into a `Map<string, ExtractedImport[]>`. Files that throw on read or on parse are skipped silently, so a single bad file does not abort the batch.

The map is built on demand and not persisted — the docstring notes that this is by design, so that downstream stages that want to recompute imports (the status risk analysis at Etapa 2c) get the same map without reading a stale cache. Every caller reaches `extractImportsFromTree` through `collectImports`, so a single import-shape change in the tree walker propagates everywhere automatically.

## Tests

Covered by `packages/core/src/imports.test.ts` (same-name test file on disk).
