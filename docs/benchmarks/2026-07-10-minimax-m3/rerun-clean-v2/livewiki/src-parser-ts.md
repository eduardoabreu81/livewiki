---
title: src-parser-ts
owner: generated
anchors:
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#parseSource
---

# parser.ts

Wrapper around `web-tree-sitter` with a per-file `Language` cache. Loads `.wasm` grammars from `packages/core/grammars/` (versioned in the repo). The path is resolved relative to the module's `package.json`, so it works both in dev (`src/`) and after build (`dist/`).

Supported languages in the MVP:
- `typescript` (`.ts`)
- `tsx` (`.tsx`, `.jsx`)
- `javascript` (`.js`, `.mjs`, `.cjs`)
- `python` (`.py`)

`initParser()` is global, idempotent, and must be called once at CLI startup before the first `parseFile()`. Repeated calls are safe — the `Promise` resolves immediately.

## Runtime initialization
<!-- lw:anchors packages/core/src/parser.ts#initParser -->

`initParser()` initializes the tree-sitter WASM runtime. Subsequent calls return the same cached `Promise`, making the function idempotent. It must be awaited once before any parsing happens.

## Grammar resolution
<!-- lw:anchors packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#grammarForExtension -->

`grammarsDir()` locates the `grammars/` directory by walking up from this module's `package.json` — first `./package.json` (dev layout, `src/`), then `../package.json` (build layout, `dist/`). Throws if neither exists. The implementation deliberately avoids `require.resolve("package.json")` because that walks `node_modules` instead of the current package.

`grammarForExtension(ext)` returns the grammar name associated with a file extension (lower-cased before lookup), or `undefined` if the extension is unsupported.

## Language loading
<!-- lw:anchors packages/core/src/parser.ts#loadLanguage -->

`loadLanguage(name)` returns a cached `Language` or loads its `.wasm` from `grammarsDir()/tree-sitter-<name>.wasm`. Loading is memoized in `languageCache` because parsing the WASM module is expensive. Throws if the grammar file is missing for the current build of livewiki.

## Parsing source
<!-- lw:anchors packages/core/src/parser.ts#parseSource -->

`parseSource(ext, source)` parses a source string using the grammar mapped to `ext`. It calls `initParser()` (idempotent), looks up the grammar by extension, loads the language, and runs a fresh `Parser` per call. Throws if the extension has no grammar or if tree-sitter returns a null tree.

## Supported grammars
<!-- lw:anchors packages/core/src/parser.ts#listSupportedGrammars -->

`listSupportedGrammars()` enumerates the `.wasm` files present in `grammarsDir()` and returns the grammar names (stripping the `tree-sitter-` prefix and `.wasm` suffix). Returns an empty array if the directory is missing.

## Test helpers
<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest -->

`_grammarToExtensionForTest(grammar)` returns a representative extension for a grammar, used by tests to assert that each supported grammar is reachable via the extension map.
