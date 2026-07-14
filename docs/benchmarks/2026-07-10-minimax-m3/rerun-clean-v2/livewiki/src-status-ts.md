---
title: src-status-ts
owner: generated
anchors:
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/status.ts#run
---

# status

Reports the full state of the wiki plus the index. Phase 1 exposes indexed file counts, symbol counts by kind, language breakdown, and the top-N files by symbol count. Phase 2 exposes open debt (changed/moved/deleted) grouped by assignee and undocumented symbols. A `metrics` field carries incremental token accounting from the update pipeline when available.

## run

<!-- lw:anchors packages/core/src/status.ts#run -->

Public entry point. Resolves `repoRoot` to an absolute path, validates `.livewiki/index.db` via `safeIo.resolveAndValidate`, opens the index with `openIndex`, delegates assembly to `collect`, then best-effort overlays `snapshotMetrics` on `report.metrics` (a failure here does not abort status). Closes the database in a `finally` block. Returns a `Promise<StatusReport>`.

## collect

<!-- lw:anchors packages/core/src/status.ts#collect -->

Internal assembler. Reads `active` rows from `files` and `symbols`, computes `byLang`, `byKind`, and a top-N list of files by symbol count using `topN`. Joins `debt` with `anchors` and `doc_pages` for unresolved debt (`resolved_at IS NULL`), bucketed by `event` (`changed`/`moved`/`deleted`) and `assignee` (`agent`/`human`). Reads `undocumented` rows where `dismissed = 0` and returns a sample of up to 20. Reads `schema_version`, `last_indexed_at`, and `last_ledger_at` from the `meta` table. The returned `metrics` field is `null`; `run` fills it after construction because the snapshot needs `repoRoot`, not the db handle.

## formatHuman

<!-- lw:anchors packages/core/src/status.ts#formatHuman -->

Text renderer for the human mode. Prints a header, indexed-file totals with per-language breakdown, total active symbols with per-kind breakdown, the top-N file list, open-debt totals by event and assignee (followed by one line per debt item showing `[event] assignee target` and optional `detail`), undocumented count with up to 20 sample keys, and a footer line with `schema_version` plus ISO timestamps for `last_indexed_at` and `last_ledger_at` (or `never`). Returns a single newline-joined string.

## Types

<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#run packages/core/src/status.ts#formatHuman -->

- `StatusOptions` — `{ topN?: number }`; default 10.
- `DebtItem` — one open-debt entry with `id`, `event`, `assignee`, `symbol_key | null`, `wiki_path | null`, `detail | null`, `detected_at`.
- `StatusReport` — shape returned by `run`/`collect` and consumed by `formatHuman`. Includes `files`, `symbols`, `debt`, `undocumented`, `metrics: UpdateMetricsSnapshot | null`, and `meta` (`schemaVersion`, `lastIndexedAt`, `lastLedgerAt`).
- TODO: behavior of `formatHuman` when `report.metrics` is non-null — current implementation does not render metrics in text mode.

## Dependencies

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect -->

- `node:path` — absolute-path resolution in `run`.
- `./safe-io.js` — `resolveAndValidate` for `.livewiki/index.db`.
- `./db.js` — `openIndex`, plus `FileRow` / `SymbolRow` row types.
- `./update-metrics.js` — `snapshotMetrics` and the `UpdateMetricsSnapshot` type overlaid on `report.metrics`.