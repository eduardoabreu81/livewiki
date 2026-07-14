---
title: src-update-ts
owner: generated
anchors:
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
---

# src/update.ts

Incremental update pipeline. Loads the current manifest, computes open debt, builds a focused `WorkPackage` (debt + snippets + valid anchors + token estimate), and records metrics on emission and on agent write-back.

## Constants

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN -->

`CHARS_PER_TOKEN` is the default token-size heuristic: roughly 4 characters per token for English/code (matches the GPT tokenizer report referenced in SPEC §"Contabilidade de tokens"). The exported value (`4`) is used by `loadWorkPackage` to convert the serialized JSON size of a package into `tokensEstimated`.

## `loadWorkPackage`
<!-- lw:anchors packages/core/src/update.ts#loadWorkPackage -->

Entry point for the `livewiki update` command's incremental mode. Does **not** call the LLM — it emits a `WorkPackage` for an in-session agent (or the `--llm` path elsewhere) to consume.

Pipeline:

1. **Manifest** — read via `readManifest(absRoot)`; project to a minimal view (`lastDocumentedCommit`, `pendingBatch`), or `null` if uninitialized.
2. **Debt** — delegated to `runStatus(absRoot)` (single source of truth from Phase 2).
3. **Snippets** — for each debt item (capped by `opts.maxSnippets`, default 50), call `snippetForSymbol` with a default window of ±20 lines (`SNIPPET_WINDOW`).
4. **Valid anchors** — de-duplicated, sorted subset of debt `symbol_key` values; these are the keys the agent is allowed to anchor against.
5. **Token estimation** — `tokensEstimated = ceil(JSON.stringify(pkg).length / CHARS_PER_TOKEN)`. `bytes` mirrors the serialized length.
6. **Metric** — emits a `package_emitted` record via `recordUpdateMetric` (side effect on `.livewiki/update_metrics.json`; idempotent rewrite).

`WorkPackageOptions` accepts `language` (reserved, currently unused), `snippetWindow`, and `maxSnippets`.

## `snippetForSymbol`
<!-- lw:anchors packages/core/src/update.ts#snippetForSymbol -->

Internal helper that reads the source file backing a debt item's `symbol_key` and returns a bounded window of lines around the symbol.

- Splits the key on `#` to recover `filePath` and the symbol name.
- If the file is missing on disk, returns `null` (debt item is silently skipped upstream).
- First attempt: regex-style line match for common definition forms (`function`, `class`, `def`, `const`, plus `export` variants). When found, `symEnd` is approximated as `symStart + window`.
- On miss, falls back to `lookupSymbol` against the index DB.
- On second miss, falls back to the first `window` lines of the file as a minimal-context snippet.
- Final output adds 3 lines of context above and below, each line prefixed with its 1-indexed number.

## `lookupSymbol`
<!-- lw:anchors packages/core/src/update.ts#lookupSymbol -->

DB fallback used by `snippetForSymbol` when name-based line matching fails. Opens `.livewiki/index.db` (path validated via `safeIo.resolveAndValidate`) and selects `start_line`, `end_line` from `symbols` where `key = ?` and `status = 'active'`. Returns `null` when no active row matches; the DB is always closed in a `finally` block.

## `recordDocWrittenBack`
<!-- lw:anchors packages/core/src/update.ts#recordDocWrittenBack -->

Called by the skill / CLI after the agent (or a human) finishes updating the wiki. Records the **output** side of the accounting loop with `kind: 'write_received'`, carrying the `wikiPath`, `bytes`, and `tokensEstimated` of the written-back doc.

Pairing this with the `package_emitted` record from `loadWorkPackage` yields the product's headline efficiency metric: a large package that yields a small write-back is good economy; a large package yielding a large write-back is poor economy.

The module also re-exports `UpdateMetric` for CLI convenience.