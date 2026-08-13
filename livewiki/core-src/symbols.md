---
title: Symbol extraction from tree-sitter ASTs
owner: generated
anchors:
  - packages/core/src/symbols.ts#attributeRationale
  - packages/core/src/symbols.ts#collectRationaleCandidates
  - packages/core/src/symbols.ts#extractCalleeName
  - packages/core/src/symbols.ts#extractCalls
  - packages/core/src/symbols.ts#extractRationales
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#extractSymbolsWithRanges
  - packages/core/src/symbols.ts#goReceiverTypeName
  - packages/core/src/symbols.ts#groupContiguousBlocks
  - packages/core/src/symbols.ts#isLikelyGenerated
  - packages/core/src/symbols.ts#isRustDocComment
  - packages/core/src/symbols.ts#isTsDocstringComment
  - packages/core/src/symbols.ts#javaCreationTypeName
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#normalizeRationaleText
  - packages/core/src/symbols.ts#rustImplTypeName
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#toSymbolRecord
  - packages/core/src/symbols.ts#walkForCalls
  - packages/core/src/symbols.ts#walkNode
---

# Symbol extraction from tree-sitter ASTs

This page describes how livewiki turns a parsed source file into the indexed `SymbolRecord` list that every later phase (graph resolution, docs, dead-code reports) consumes.

## When to use this page

- **Walk through a symbol extraction** when you want to understand how a TS, Python, Go, Rust, or Java file becomes a list of `SymbolRecord`s with stable `path#name` keys.
- **Read the rationale pipeline** when you need to know how comments and docstrings become `RationaleRecord`s and which symbol each one attaches to.
- **Trace a call edge** when you are debugging how a `call_expression` or `method_invocation` becomes a `CallRecord` and which caller key it attributes to.
- **Resolve a "method outside a class" key** when the parser sees a Go receiver, a Rust `impl`, or a Java constructor and you need to know which qualifier wins.

## How it fits

This module lives at `packages/core/src/symbols.ts` and is one of the first post-parse passes in the indexer. The walker hands it a `tree-sitter` `Tree` plus the normalized source string and a relative repo path; in return it emits three flat arrays that the indexer persists: per-file symbols, per-file call edges, and per-file rationale records. The module has no cross-file awareness — `callee_name` resolution and `caller_key` cross-referencing are separate passes that consume the records produced here. Inside `packages/core`, this file sits next to the language grammar loaders and the hashing utilities (`./hashes.js`) it uses to fingerprint each symbol's source slice.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-symbols.mmd
```

## Symbol extraction pipeline

<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#extractSymbolsWithRanges packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#goReceiverTypeName packages/core/src/symbols.ts#rustImplTypeName packages/core/src/symbols.ts#javaCreationTypeName -->

The symbol pipeline walks the AST once, accumulates `ExtractedSymbol` candidates (which extend `SymbolRecord` with byte ranges), and finally de-duplicates them by key. The two public entry points are thin wrappers: `extractSymbols` returns the stripped records the database persists, and `extractSymbolsWithRanges` keeps the byte ranges the indexer uses for per-symbol EOL realignment (roadmap item 12).

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
```

`extractSymbols` takes a parsed tree, the file's repo-relative path, and the source string, and returns a list of `SymbolRecord`s — one per top-level declaration — each carrying its `key`, `name`, `kind`, signature snippet, line range, and a content hash of the byte slice.

The shared core is `walkNode`. It descends into the AST and dispatches per node type, deciding what to extract and how to qualify it. The interesting branches are:

- **TS/JS/TSX**: `function_declaration`, `generator_function_declaration`, `class_declaration` (the TS path also keys `method_definition` as `Class.method`), and `export_statement` (which short-circuits a duplicate descent so the inner declaration isn't double-counted; for `export const foo`, only the identifier is emitted with `kind: "export"`).
- **Python**: `function_definition` (qualified as `Class.method` when nested in a `class_definition` body) and `class_definition`. `decorated_definition` peels the decorator and forwards the inner `function_definition` or `class_definition`.
- **Go**: `method_declaration` qualifies with the receiver type via `goReceiverTypeName`; `type_declaration` keys structs as `class` and interfaces as `interface`, skipping type aliases that don't resolve to a struct or interface body.
- **Rust**: `function_item` qualifies as `Type.method` when nested in an `impl_item`; `struct_item`, `enum_item`, and `trait_item` map to `class`, `class`, and `interface` respectively; `impl_item` recurses into the body with the `Type` field as the new `parentClassName` so both `impl T` and `impl Trait for T` qualify members under `T`.
- **Java**: `method_declaration` keys as `Type.name` using the innermost enclosing type (no receiver field); `constructor_declaration` keys as `Type.Type`; `interface_declaration`, `enum_declaration`, and `record_declaration` are gated on `relPath.endsWith(".java")` to avoid TS false positives — interfaces emit members as `Interface.name` (a deliberate delta from the Go/Rust policy), while enum constants and record components are not citable. `annotation_type_declaration` is intentionally not extracted.

Two structural rules thread through every branch:

- **Local classes / impls / type defs inside function bodies are skipped.** A `class FakeThing:` declared inside a test method is an implementation detail, not a module symbol, and the same local name commonly repeats across sibling test methods; extracting all of them would collide on the `path#Name` key and silently drop every duplicate. The flag `insideFunctionBody` flips on when entering any function-like node and propagates so each branch's `if (insideFunctionBody) return;` gate fires.
- **Anonymous functions are skipped.** No name field → no citable key.

Once `walkNode` finishes, `extractSymbolsWithRanges` sorts candidates by `(start_line, source_start_byte, discoveryOrder)` and walks the sorted list, dropping any candidate whose `key` was already seen. The sort is what keeps the first-encountered definition on top when the same key appears more than once. `toSymbolRecord` then strips the byte-range fields before the list crosses the module boundary.

Records are built by `makeRecord`, which stitches together the AST's start/end positions (both lines are converted to 1-based), a signature snippet from `signatureFor` (the first non-empty line of the node's byte slice, clamped to 200 characters), and a content hash from `sha256Slice` over the same byte slice. `signatureFor` is the only place where the source text is actually consulted by this module, and it stops at the first newline or 200 bytes — whichever comes first — so it can never balloon a row.

```ts
function signatureFor(node: Node, source: string): string | null
```

`signatureFor` takes an AST node and the source string it was parsed from, and returns the first trimmed line of that node's text (capped at 200 characters), or null if that first line is empty — a small snippet useful as an anchor label.

The three qualifier helpers handle language-specific shape variation:

```ts
function goReceiverTypeName(receiver: Node | null): string | null
```

`goReceiverTypeName` takes a Go `method_declaration`'s `receiver` parameter_list and returns the bare type name (`T`, not `*T`); it walks `parameter_declaration` → `type` → either `type_identifier`, `pointer_type` → inner `type_identifier`, or `generic_type` → base `type_identifier`. Returns null when the shape doesn't match.

```ts
function rustImplTypeName(typeNode: Node | null): string | null
```

`rustImplTypeName` takes a Rust `impl_item`'s `type` field and returns the qualifying type name — a `type_identifier` for `impl T`, the base type_identifier of a `generic_type` (`impl<T> Vec<T>` → `Vec`), or the right-most name of a `scoped_type_identifier` (`impl a::B` → `B`). Returns null when the shape doesn't match.

```ts
function javaCreationTypeName(typeNode: Node | null): string | null
```

`javaCreationTypeName` takes a Java `object_creation_expression`'s `type` field and returns the right-most class name, descending through `scoped_type_identifier` and `generic_type` wrappers so `new java.util.ArrayList<String>()` resolves to `ArrayList`. Returns null when the shape doesn't match.

## Call-site extraction pipeline

<!-- lw:anchors packages/core/src/symbols.ts#extractCalls packages/core/src/symbols.ts#walkForCalls packages/core/src/symbols.ts#extractCalleeName -->

Call-site extraction runs as a separate walk because the data shape (`CallRecord`) and the consumer (the cross-file resolver in the indexer) differ from symbol extraction. The policy is deliberately "honest": only emit a `callee_name` the parser is confident about, and tag every row with `CallConfidence` so consumers can tell a bare-identifier call apart from a name guess.

```ts
export function extractCalls(tree: Tree, relPath: string, source: string): CallRecord[]
```

`extractCalls` takes the same inputs as `extractSymbols` and returns one `CallRecord` per `call_expression` / `new_expression` / `call` / `method_invocation` / `object_creation_expression` whose enclosing scope is a named function or method. Top-level calls are skipped because there is no caller key to attribute them to.

The walker is `walkForCalls`. It threads two pieces of state down the tree: `parentClassName` (for qualifying method keys) and `callerKey` (the `path#Name` of the innermost named function/method). Whenever it enters a function-like node, it updates `nextCallerKey` to that node's full key and recurses; child call nodes then see the right caller. The key-shape rules mirror `walkNode` exactly so a `CallRecord`'s `caller_key` is always a real `SymbolRecord.key`:

- TS `function_declaration` / `generator_function_declaration` → `path#name`.
- TS `method_definition` → `path#Class.name` when nested in a class body.
- Python `function_definition` → `path#Class.name` when nested in a class body.
- Go `method_declaration` → `path#ReceiverType.name` (pointer receivers stripped, via `goReceiverTypeName`); Java `method_declaration` → `path#Type.name` using the innermost enclosing type (Go's receiver field is absent on Java).
- Java `constructor_declaration` → `path#Type.Type` (the `name` field is the class name).
- Rust `function_item` → `path#Type.name` when nested in an `impl_item`; `impl_item` updates `parentClassName` from its `type` field via `rustImplTypeName`.
- TS/JS/Python `class_declaration` / `class_definition` and Java `interface_declaration` / `enum_declaration` / `record_declaration` only update `parentClassName` — they aren't callers themselves, but their bodies contain callers that need the qualifier.

Each call node is then resolved through `extractCalleeName`:

```ts
function extractCalleeName(node: Node | null): { name: string; confidence: CallConfidence } | null
```

`extractCalleeName` takes a callee AST node (the `function` field of a `call_expression`, the `name` of a Java `method_invocation`, etc.) and returns its right-most identifier plus a confidence tag — `extracted` for a bare identifier (the name IS the callee), `inferred` for any member/attribute/selector/field/scoped access (the receiver is unknown here, so the name is only a guess). Rust `generic_function` recurses into its `function` child to inherit the underlying identifier's confidence. Returns null when the shape doesn't match.

The five call-node branches in `walkForCalls` then map those confidence tags onto edges:

- TS/JS/Python `call_expression` and Python `call` — the callee confidence is preserved.
- TS/JS `new_expression` — the callee is always `extracted` (a constructor invocation is explicit about the symbol it targets, even through member paths).
- Java `method_invocation` — `extracted` when there's no `object` field (bare `name()`), `inferred` when there is (`x.m()`, `Type.m()`, `this.m()`).
- Java `object_creation_expression` — always `extracted`, with the callee name resolved through `javaCreationTypeName` so `new java.util.ArrayList<String>()` becomes `ArrayList`.

The output is a flat list with caller keys already shaped like `SymbolRecord.key`, ready for the resolver to match against the per-file symbol index.

## Rationale extraction pipeline

<!-- lw:anchors packages/core/src/symbols.ts#extractRationales packages/core/src/symbols.ts#collectRationaleCandidates packages/core/src/symbols.ts#groupContiguousBlocks packages/core/src/symbols.ts#attributeRationale packages/core/src/symbols.ts#normalizeRationaleText packages/core/src/symbols.ts#isTsDocstringComment packages/core/src/symbols.ts#isRustDocComment packages/core/src/symbols.ts#isLikelyGenerated -->

The rationale pipeline turns comments and docstrings into `RationaleRecord`s, each tagged with the symbol (if any) it attaches to. It runs after symbol extraction because attribution is positional and needs the file's full symbol list as a reference.

```ts
export function extractRationales(
  tree: Tree,
  relPath: string,
  source: string,
): RationaleRecord[]
```

`extractRationales` takes the parsed tree, the relative path, and the source, and returns the list of `RationaleRecord`s for the file. The pipeline has four stages.

**1. Candidate collection.** `collectRationaleCandidates` walks the tree once and pushes every comment node and every Python docstring it sees. The language gymnastics happen here: TS/JS/TSX/Go/Python all expose `comment` nodes, Rust exposes `line_comment` and `block_comment` (so `///` outer doc comments, `//!` inner doc comments, and `/**` blocks are all candidates), and Java Javadoc is a `block_comment`. Rust `line_comment` nodes include their trailing newline, which inflates `endPosition`; the collector clamps `endLine` to the start line so positional attribution isn't skewed by the parser's quirk. Python docstrings — the first statement of a module, `class_definition`, or `function_definition` body — are detected by looking inside the body's `expression_statement` for a `string` first child, and flagged with `pythonDocstring: true` so the normalizer takes the docstring branch.

```ts
function collectRationaleCandidates(node: Node, out: RawRationaleCandidate[]): void
```

`collectRationaleCandidates` takes a tree-sitter node and an accumulator, and appends one `RawRationaleCandidate` per comment or Python docstring it finds. Comment nodes do not descend into children; everything else recurses through `namedChildCount`.

**2. Normalization and kind tagging.** Back in `extractRationales`, each candidate's `rawText` is normalized through `normalizeRationaleText`:

```ts
function normalizeRationaleText(rawText: string, pythonDocstring: boolean): string
```

`normalizeRationaleText` takes a raw comment or docstring plus a flag for whether the docstring branch applies, and returns the cleaned text — markers stripped (`//`, `#`, `///`, `//!`, `/* */` with the optional second `*`), decorative leading `*` on block-comment lines dropped, all whitespace collapsed to single spaces. Python docstrings also have their optional `r`/`b`/`f`/`u` prefix and the surrounding quote pair stripped.

After normalization, the candidate becomes a `docstring` when it's a Python docstring, a `/**`-opening block comment (detected by `isTsDocstringComment`), or a Rust doc line comment (detected by `isRustDocComment` — `///` outer, but NOT `////`, or `//!` inner). Docstrings under 20 normalized characters are dropped as noise. Otherwise, the normalized text must start with a tagged prefix — `WHY:`, `NOTE:`, `HACK:`, `TODO:`, or `FIXME:`, case-insensitive — matched by the regex `RATIONALE_TAG_RE`. The tag becomes the `kind` (lowercased); anything untagged is skipped.

```ts
function isTsDocstringComment(rawText: string): boolean
```

`isTsDocstringComment` takes a raw comment text and returns true when it opens with `/**` (a Javadoc / TSDoc block). Plain `/*` blocks are not docstrings.

```ts
function isRustDocComment(rawText: string): boolean
```

`isRustDocComment` takes a raw comment text and returns true when it opens with `///` (and NOT `////`, which is a plain comment by Rust convention) or `//!`. Rust `/**` blocks are caught by `isTsDocstringComment`.

**3. Generated-file gate.** Before doing anything, the rationale pass consults `isLikelyGenerated`:

```ts
export function isLikelyGenerated(content: string): boolean
```

`isLikelyGenerated` takes the full file source and returns true when any of the first 8 lines (case-insensitive) contains a generated-code marker — `do not edit`, `@generated`, `code generated`, or `auto-generated`. When it returns true, the caller should skip rationale extraction for the whole file; migration/protobuf revision comments are noise, not intent evidence. The snippet above shows the helper used inside `extractRationales`'s caller path; in this file the helper itself only inspects the header — skipping is the caller's responsibility.

**4. Positional attribution.** Surviving candidates are attributed via `attributeRationale`, which needs to know which contiguous block each candidate belongs to. `groupContiguousBlocks` does that bookkeeping:

```ts
function groupContiguousBlocks(
  candidates: RawRationaleCandidate[],
): Map<RawRationaleCandidate, RawRationaleCandidate>
```

`groupContiguousBlocks` takes the candidate list (already in document order from the tree walk) and returns a map from each candidate to the LAST candidate of its block — a block being a maximal run of comments where each starts on the line immediately after the previous one ends (no blank line between).

```ts
function attributeRationale(
  candidate: RawRationaleCandidate,
  blockEnd: Map<RawRationaleCandidate, RawRationaleCandidate>,
  symbols: SymbolRecord[],
): string | null
```

`attributeRationale` takes a single candidate, the block map, and the file's symbol list, and returns the key of the symbol the rationale attaches to (or null for file-level). Three rules apply in order:

1. **Inside a symbol's line range → innermost such symbol.** The candidate's `[startLine, endLine]` must be fully contained in the symbol's `[start_line, end_line]`. When several symbols match, the innermost wins: largest `start_line` first, then smallest `end_line` as the tiebreaker — so a method beats its enclosing class.
2. **Contiguous block ends immediately above the declaration.** If the rule above misses, the block this candidate belongs to (via the map; a single-comment block maps to itself) ends on a line whose `+1` equals some symbol's `start_line`. That symbol owns the rationale.
3. **Otherwise file-level.** The rationale's `symbol_key` is null; it's an unattributed piece of intent evidence.

Each emitted record carries the normalized text, a SHA-256 content hash, the first line of the raw comment/docstring (1-based), and the attributed symbol key — so the indexer can store rationale evidence alongside the symbol it qualifies without needing the source text.

## Tests

Covered by `packages/core/src/symbols.test.ts` (same-name test file on disk).
