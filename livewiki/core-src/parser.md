---
title: parser — language bootstrap and per-extension grammar resolution
owner: generated
anchors:
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarState
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#parseSource
---

# parser — language bootstrap and per-extension grammar resolution

This module is the single entry point that turns a file extension into a real tree-sitter syntax tree for the livewiki indexer.

## When to use this page

- **Initialize** the tree-sitter WASM runtime once at CLI startup with `initParser`.
- **Parse** a source string into a `Tree` for a known extension (`parseSource`).
- **Discover** which languages the current build supports (`listSupportedGrammars`, `grammarForExtension`).
- **Inspect** the grammar-set state stored under `meta.grammar_state` so the indexer can decide what to re-parse (`grammarState`).

## How it fits

`packages/core/src/parser.ts` is the language layer between the livewiki indexer and the upstream `web-tree-sitter` bindings. It owns three pieces of state that the rest of the pipeline depends on: the one-time WASM runtime boot, a per-grammar in-memory `Language` cache, and a static extension-to-grammar table. The `.wasm` artifacts are vendored in `packages/core/grammars/` and resolved relative to this module's own `package.json`, which is what lets the same code work whether the package is consumed from `src/` (dev) or `dist/` (build). Other modules in the package call `parseSource` to get a `Tree`, and the indexer reads `grammarState` to detect grammar additions, removals, remaps, and version bumps between runs.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-parser.mmd
```

## WASM runtime bootstrap

<!-- lw:anchors packages/core/src/parser.ts#initParser -->

`initParser` is the one safe place to bring the tree-sitter WASM runtime up. It is global, idempotent, and must be called once at CLI startup before the first `parseSource`; extra calls return the same in-flight `Promise` and resolve immediately.

```ts
export async function initParser(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = Parser.init();
  return initPromise;
}
```

`initParser` closes over a module-scoped `initPromise` so the WASM init runs at most once per process. The visible path is "return the cached promise if present, otherwise call `Parser.init()` and cache it"; there is no visible rollback or failure branch beyond whatever `Parser.init()` itself throws.

## Grammar artifact resolution

<!-- lw:anchors packages/core/src/parser.ts#grammarsDir -->

`grammarsDir` locates the vendored `packages/core/grammars/` directory by walking up from `import.meta.url` to this module's own `package.json`. Trying `./package.json` (dev: `src/`) and then `../package.json` (build: `dist/`) is the strategy that keeps the resolved path stable across both layouts; `require.resolve("package.json")` is intentionally avoided because it searches `node_modules` rather than the package itself.

```ts
function grammarsDir(): string {
  const req = createRequire(import.meta.url);
  for (const rel of ["./package.json", "../package.json"]) {
    try {
      const pkgPath = req.resolve(rel);
      return nodePath.join(nodePath.dirname(pkgPath), "grammars");
    } catch {
      // tenta o próximo
    }
  }
  throw new Error(
    "Não foi possível localizar package.json a partir de " + import.meta.url,
  );
}
```

The visible path is "try the dev path, fall back to the build path, and throw otherwise." A failed lookup throws an `Error`; the fallback is between two candidate relative paths, not between arbitrary inputs.

## Per-grammar Language cache

<!-- lw:anchors packages/core/src/parser.ts#loadLanguage -->

`loadLanguage` is the only function that materializes a `web-tree-sitter` `Language` from a `.wasm` file. Because parsing WASM is expensive, results are stashed in a module-scoped `Map<string, Language>` keyed by grammar name, so repeated parses for the same language reuse the same object.

```ts
async function loadLanguage(name: string): Promise<Language>
```

`loadLanguage` takes a grammar name (the bare identifier used in the `.wasm` filename, e.g. `typescript`) and returns the loaded `Language`, serving it from `languageCache` when present and otherwise loading from `grammarsDir()` and caching the result. When the expected `tree-sitter-<name>.wasm` is missing on disk, it throws an `Error` rather than silently returning `undefined`.

## Extension ↔ grammar mapping

<!-- lw:anchors packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#_grammarToExtensionForTest -->

The static table `EXT_TO_GRAMMAR` declares which file extensions livewiki knows how to parse (`ts`, `tsx`, `js`, `mjs`, `cjs`, `py`, `go`, `rs`, `java`). `grammarForExtension` is the public lookup used by callers that only have an extension in hand, and it normalizes the input to lowercase before consulting the table.

```ts
export function grammarForExtension(ext: string): string | undefined
```

`grammarForExtension` takes a file extension string (with or without the leading dot) and returns the grammar name (`ts` → `typescript`) or `undefined` when the extension is not supported. `_grammarToExtensionForTest` is the inverse, used by tests to confirm that every advertised grammar is reachable from the table; it returns the first extension the table maps to the given grammar name.

## Parsing a source string

<!-- lw:anchors packages/core/src/parser.ts#parseSource -->

`parseSource` is the main entry point that downstream callers actually use. It composes `initParser`, the extension lookup, `loadLanguage`, and a fresh `Parser` instance into one call that returns a tree-sitter `Tree`.

```ts
export async function parseSource(
  ext: string,
  source: string,
): Promise<Tree>
```

`parseSource` takes a file extension and the raw source text and returns a `Tree`. It first ensures the WASM runtime is up, then resolves the grammar from `EXT_TO_GRAMMAR` (throwing if the extension is unknown), loads the `Language` (which may hit the cache), constructs a `Parser`, sets the language, and parses the source. There is a visible `if (!tree)` guard after `parser.parse(source)` — tree-sitter only returns `null` in exceptional cases, so the function throws rather than propagating a null tree to the caller.

## Grammar-set state for incremental indexing

<!-- lw:anchors packages/core/src/parser.ts#grammarState -->

The indexer persists a snapshot of the grammar world under `meta.grammar_state` and diffs it on every run to decide which files need re-parsing. `grammarState` produces that snapshot as a plain object containing two fields: the extension-to-grammar map (so adding, removing, or remapping an extension is detectable) and the per-grammar `.wasm` sha256 (so a tree-sitter upgrade that changes the WASM but leaves the extension map alone still triggers a re-parse).

```ts
export function grammarState(): GrammarState
```

`grammarState` returns a `GrammarState` object with `map` (extension → grammar name) and `artifacts` (grammar name → sha256 of the vendored `.wasm`, or the literal string `"missing"` when the file is not present on disk). Internally it walks every unique grammar in `EXT_TO_GRAMMAR` and hashes the on-disk `.wasm` via the local `sha256` helper, so the returned state's `artifacts` always reflects what's actually vendored in this build.

## Listing supported grammars on disk

<!-- lw:anchors packages/core/src/parser.ts#listSupportedGrammars -->

`listSupportedGrammars` is the discovery helper for tooling that needs to know what a given build of the package can actually parse. It reads `grammarsDir()` directly and returns grammar names derived from the `tree-sitter-*.wasm` filenames present on disk.

```ts
export function listSupportedGrammars(): string[]
```

`listSupportedGrammars` takes no arguments and returns an array of grammar names (the substring between `tree-sitter-` and `.wasm` in each `.wasm` filename), or an empty array when the `grammars/` directory is missing. It reflects only what's shipped in this build — it does not filter by `EXT_TO_GRAMMAR`, so a `.wasm` for a language the extension table does not reference will still appear here.

## Tests

Covered by `packages/core/src/parser.test.ts` (same-name test file on disk).
