---
title: packages/core/src/imports.ts
owner: generated
anchors:
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#extractImportsFromTree
---

# `packages/core/src/imports.ts`

Imports extraction for the ingestion pipeline. Parses source files with tree-sitter and returns the literal import strings without resolving paths. Path resolution (e.g. `./foo` → `src/auth/foo.ts`) is handled downstream in `modules.ts`, once the file map is available.

Coverage:

- **TypeScript / JavaScript**: `import_statement`, `export_statement` (re-exports).
- **Python**: `import_statement`, `import_from_statement`.

Limitation: dynamic imports (`require()` with a variable, `import()` with a non-literal expression) are **not** resolved and surface as `unknown` nodes in the import graph. Acceptable for the MVP — the LLM step can infer them from context.

## `extractImportsFromTree`

<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree -->

Pure function (no I/O) that walks a tree-sitter `Tree` and returns every import literal it can find. Useful in tests where the tree is already available.

### Behaviour

- Receives a parsed `Tree` plus a `lang` discriminator (`"ts"` or `"python"`).
- Recursively visits nodes via a `TreeCursor`.
- For each relevant node type, pushes an `ExtractedImport`:

| Node type              | Language | Kind         | Notes                                                                 |
| ---------------------- | -------- | ------------ | --------------------------------------------------------------------- |
| `import_statement`     | TS       | `ts-import`  | Source from `source` field; surrounding quotes are stripped.          |
| `import_statement`     | Python   | `py-import`  | Falls back to `dotted_name` children when no `source` field exists.   |
| `export_statement`     | TS       | `ts-export`  | Only emits when a `source` field is present (i.e. re-exports).        |
| `import_from_statement`| Python   | `py-from`    | `module_name` is the source; `names` collects `dotted_name` / `aliased_import` children. |

The `lang` argument is not currently used to gate node-type handling — node types themselves are sufficient. `collectImports` still computes it to keep the API symmetric.

### Output shape

```ts
type ImportKind = "ts-import" | "ts-export" | "py-import" | "py-from";

interface ExtractedImport {
  source: string;        // literal as it appears in source, quotes stripped
  kind: ImportKind;
  names?: string[];      // py-from only: ["bar", "*", ...]
}
```

## `collectImports`

<!-- lw:anchors packages/core/src/imports.ts#collectImports -->

High-level entry point. Given a relative file path and its raw content, returns the list of extracted imports.

### Behaviour

1. Calls `initParser()` once (cached internally).
2. Derives the language from the file extension: `.py` → `"python"`, anything else → `"ts"`.
3. Parses the source via `parseSource()`.
4. On parse failure, returns `[]` (graceful degradation — unparseable files contribute nothing to the graph rather than aborting the pipeline).
5. Delegates to `extractImportsFromTree`.

### Signature

```ts
async function collectImports(
  relPath: string,
  content: string,
): Promise<ExtractedImport[]>
```

## Pipeline role

<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

Both symbols implement SPEC §"Pipeline batch (etapa 2)" — directory grouping plus the deterministic import graph that the LLM refines in one call.

- `collectImports` is the I/O-aware wrapper used by the batch runner.
- `extractImportsFromTree` is the pure traversal core, used directly in unit tests and exposed so other modules can reuse the extraction logic without re-initialising the parser.

TODO: document the exact `ImportKind` → graph edge mapping used by `modules.ts` once that module's reference page is generated.