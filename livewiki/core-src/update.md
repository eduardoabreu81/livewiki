---
title: "Incremental update command: emit work packages and record write-backs"
owner: generated
anchors:
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#SNIPPET_WINDOW
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
---

# Incremental update command: emit work packages and record write-backs

This module builds the focused "work package" a documentation agent consumes when paying down documentation debt between commits, and it records token-accounting metrics for both the package emitted to the agent and the documentation written back.

## When to use this page

- **Build a `WorkPackage`** by calling `loadWorkPackage(repoRoot, opts)` to collect manifest data, debt items, source snippets, valid anchor keys, and change-impact context.
- **Extract a source snippet** for a given symbol key with `snippetForSymbol(absRoot, symbolKey, window)` when the package step needs the current source window around a debt item.
- **Record a write-back** through `recordDocWrittenBack(repoRoot, payload)` to log the size of documentation an agent or human produced after consuming a package.
- **Consult the two exported constants** `CHARS_PER_TOKEN` and `SNIPPET_WINDOW` when reasoning about token estimation bounds or snippet size.

## How it fits

This module lives in `packages/core/src/update.ts` and implements the product's `livewiki update` command, the incremental workflow described in the CLI spec: given the diff since `lastDocumentedCommit`, list the open documentation debt and either hand a focused work package to an in-session documenting agent or, when `--llm` is passed, delegate to a configured LLM to pay the debt. The file composes helpers from `manifest.ts` (manifest reads), `status.ts` (single source of truth for debt), `db.ts` (symbol index lookups), `safe-io.js` (path validation), `update-metrics.ts` (token bookkeeping), and `change-impact.js` (the additive bounded change-impact block referenced as backlog #2). The exports `loadWorkPackage`, `snippetForSymbol`, and `recordDocWrittenBack` are the three entry points the CLI layer and any calling agent invoke; `lookupSymbol` is the in-file fallback used when name-based snippet detection fails. The package intentionally carries only debt plus snippets plus valid anchor keys — never the whole repository — which is what backs the product thesis of "around 800 tokens instead of re-reading the repo."

## Diagram

```mermaid
%% livewiki/diagrams/core-src-update.mmd
```

## Assembling the work package

`loadWorkPackage` is the main entry point and orchestrates the entire update flow. It resolves the repo root, then walks the seven steps in order: read the manifest (or null if no `.livewiki/` exists yet), pull the open debt list from `runStatus`, collect source snippets for debt items that carry a `symbol_key` plus a `wiki_path`, derive the sorted distinct `validAnchors` set, attach the bounded change-impact block, serialize the package, estimate tokens using a fixed denominator, and finally persist an incremental `package_emitted` metric. The function writes only to `.livewiki/update_metrics.json`; it does not invoke any LLM.

```ts
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage>
```

`loadWorkPackage` accepts a repo root path and a `WorkPackageOptions` object (with `language`, `snippetWindow`, and `maxSnippets` fields) and returns a fully populated `WorkPackage` ready for serialization.

<!-- lw:anchors packages/core/src/update.ts#loadWorkPackage -->

The snippet collection step caps iteration at `opts.maxSnippets ?? 50`, slices `debt.slice(0, maxSnippets)`, and skips any item where `symbol_key` or `wiki_path` is missing — `snippetForSymbol` returning `null` is also silently tolerated, so partial source coverage does not abort the package. The token estimate uses `Math.ceil(json.length / CHARS_PER_TOKEN)` against the serialized JSON; `pkg.bytes = json.length` records the raw payload size. The trailing `recordUpdateMetric` call is a side effect: it writes `kind: "package_emitted"` asynchronously after the package has been built, so callers always receive the in-memory package first.

## Token and window constants

The two exported scalars are the tuning knobs the rest of the file leans on, and they deserve a section of their own because they show up in three different places (the `Math.ceil(json.length / CHARS_PER_TOKEN)` token estimate, the default `snippetWindow`, and the implicit `maxSnippets` floor).

```ts
export const CHARS_PER_TOKEN = 4;
export const SNIPPET_WINDOW = 20;
```

`CHARS_PER_TOKEN` is a numeric divisor used to convert a character count into an estimated token count, and `SNIPPET_WINDOW` is a numeric line count defaulting the radius of the source window centered on a symbol. The first is the "four chars per token" heuristic called out in the file-level comment, and the second names the default ±20-line window used when no explicit override is passed via `opts.snippetWindow`.

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#SNIPPET_WINDOW -->

Neither constant is mutable, and they are referenced from the type contract surface through `WorkPackageOptions` (`snippetWindow?: number`, `maxSnippets?: number`) so callers can override them per invocation without mutating module state.

## Source window extraction

`snippetForSymbol` produces the bounded source window around a symbol key. It splits the key on `#`, reads the file from `absRoot` via `nodeFs.readFile`, and returns `null` if the file has gone missing or the key is malformed — that null path is the visible catch branch and what the caller in `loadWorkPackage` silently tolerates.

```ts
export async function snippetForSymbol(
  absRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null>
```

`snippetForSymbol` takes an absolute repo root, a `path/to/file.ts#name` symbol key, and a window size in lines, and returns a `DebtSnippet` (with the `1:`-prefixed source lines plus the resolved `startLine` and `endLine`) or `null` if the file cannot be read or the key cannot be parsed.

<!-- lw:anchors packages/core/src/update.ts#snippetForSymbol -->

The function tries a fast name-based match first: it iterates lines and looks for definitions using common JavaScript/TypeScript/Python declaration prefixes (`function`, `class`, `def`, `const`, plus their `export` variants), capturing the first hit and estimating `symEnd` as `start + window`. If the name scan misses — `symStart` stays `-1` — the function falls through to `lookupSymbol` against the index DB; if that also fails, it defaults `symStart = 0` and `symEnd = window` so the agent at least sees the head of the file. The final window is `max(0, symStart - 3)` to `min(lines.length, symEnd + 3)` (three lines of context before and after), each prefixed with `i + 1` for human debugging. This is why the export is "hoisted" — `change-impact.js` reuses it without duplicating the parsing logic, and that reuse is the cycle the file-level comment at the import line marks as safe.

## Index-based symbol lookup

`lookupSymbol` is the private fallback used when the name-based scan inside `snippetForSymbol` cannot locate a symbol. It opens the symbol index DB at `.livewiki/index.db`, queries for the row matching `key = ?` with `status = 'active'`, and returns the 1-indexed line range.

```ts
async function lookupSymbol(
  absRoot: string,
  symbolKey: string,
): Promise<{ startLine: number; endLine: number } | null>
```

`lookupSymbol` accepts an absolute repo root and the `path/to/file.ts#name` symbol key, and returns a `{ startLine, endLine }` pair (both 1-indexed and measured in source-file lines) or `null` if the index has no active row for that key.

<!-- lw:anchors packages/core/src/update.ts#lookupSymbol -->

It does not use the `filePath` portion of the key directly — only the full `symbolKey` is bound — and it always closes the DB via `db.close()` inside a `finally` block, so a query failure cannot leak an open handle. If the row is absent, the caller in `snippetForSymbol` proceeds to the file-head fallback described in the previous section.

## Recording write-back metrics

`recordDocWrittenBack` is the second entry point of the module and tracks the opposite direction of `loadWorkPackage`: instead of measuring what went out to the agent, it measures what came back.

```ts
export async function recordDocWrittenBack(
  repoRoot: string,
  payload: {
    wikiPath: string;
    bytes: number;
    tokensEstimated: number;
  },
): Promise<void>
```

`recordDocWrittenBack` takes a repo root and a payload object holding `wikiPath` (the page that was updated), `bytes` (size of the produced documentation), and `tokensEstimated` (the same heuristic estimate as the package), and returns `void` after persisting the metric.

<!-- lw:anchors packages/core/src/update.ts#recordDocWrittenBack -->

It resolves the repo root and forwards a `kind: "write_received"` record to `recordUpdateMetric`, alongside the caller-supplied `wikiPath`/`bytes`/`tokensEstimated`. The asymmetry with `loadWorkPackage` is deliberate: a small package followed by a large write-back is bad economy, while a large package followed by a small write-back is good — the file-level comment names this as "economia" accounting. The function never throws based on the supplied payload; `recordUpdateMetric` is responsible for its own idempotent-write behavior.

## Tests

Covered by `packages/core/src/update.test.ts` (same-name test file on disk).
