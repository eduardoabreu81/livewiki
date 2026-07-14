---
title: src-update-test-ts
owner: generated
anchors:
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
---

# src-update-test-ts

Test module covering the incremental update mode (Phase 5) of livewiki. Validates the core thesis: a focused work package (~800 tokens) replaces re-reading the whole repository (~12.5k tokens). The tests exercise `loadWorkPackage` debt detection, snippet sourcing, valid anchor resolution, token estimation, and metric accounting (`recordDocWrittenBack`, `snapshotMetrics`, `status --json`).

## File writers
<!-- lw:anchors packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

`writeCode` writes a source file at `repoRoot/rel`, creating parent directories as needed. It is the primary helper used to plant and mutate TypeScript fixtures (`src/foo.ts`, `src/fileN.ts`) under a temp `repoRoot`.

`writeWiki` mirrors `writeCode` but for wiki pages under the `livewiki/` tree. It is used to author pages whose frontmatter anchors drive debt detection — without an anchored page, the anchor-ledger emits no debt.

Both helpers are async and return `Promise<void>`.

## Anchor-aware setup
<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor -->

`setupWithAnchor` builds the minimum fixture required for debt to exist: it writes `src/foo.ts` exporting `bar`, runs the indexer and ledger, then writes `livewiki/foo.md` with an explicit `anchors:` entry pointing at `src/foo.ts#bar`, and re-runs the indexer and ledger so the new anchor is recorded. The docstring captures the invariant — without this anchor in place, the ledger cannot detect a change, so all "changed" assertions in the suite depend on this helper running first.

The setup is invoked at the start of every test that asserts debt, snippets, `validAnchors`, or metrics that depend on a prior `loadWorkPackage` call.

## Suite coverage

The tests below `setupWithAnchor`, `writeCode`, and `writeWiki` are grouped into five `describe` blocks:

- **`update.loadWorkPackage — Fase 5 (modo incremental)`** — manifest presence/absence on init vs no-init, `changed` detection when a sourced symbol is mutated, snippets containing real source plus context lines, `tokensEstimated > 0` and bounded, `validAnchors` populated from active symbols, and bounds enforcement via `maxSnippets` and `snippetWindow`.
- **`update — contabilidade (SPEC §Contabilidade)`** — `recordDocWrittenBack` updates `efficiencyRatio`; fresh repo snapshot is null-efficiency; `status --json` exposes metrics with non-null `packagesEmitted` and `totalPackageTokens`.
- **`update — economia (tese do produto)`** — with 20 anchored files all modified, `tokensEstimated < 12500` while remaining positive, confirming the package stays well below the "re-read whole repo" baseline.
- **`update — CHARS_PER_TOKEN (heurística)`** — pins the `CHARS_PER_TOKEN` constant to `4`.
- **`update — files persistidos`** — asserts `.livewiki/update_metrics.json` is written with `version: 1`, an `entries` array, and a first entry of `kind: "package_emitted"`.

## Imports and fixtures

The module imports `vitest` primitives (`describe`, `it`, `expect`, `beforeEach`, `afterEach`), `node:fs/promises` for IO, `node:os` for `tmpdir`, and `node:path` for joins. From `./update.js` it pulls `loadWorkPackage`, `recordDocWrittenBack`, and `CHARS_PER_TOKEN`; from `./update-metrics.js` it pulls `snapshotMetrics` and `clearMetricsForTests`; and it imports `runInit`, `runIndexer`, `runLedger`, and `runStatus` from their respective modules to drive the pipeline.

A module-scoped `repoRoot: string` is reassigned in each `beforeEach` to a fresh `mkdtemp` directory under `tmpdir` (prefix `livewiki-update-`), and `rm` recursively cleans it up in `afterEach`. `clearMetricsForTests` is called per test to keep the metrics ledger isolated.

## Notes and constraints

- All tests are black-box against the exported API of `./update.js` and `./update-metrics.js`; the helpers are local.
- TODO: source-budget did not include the full tail of the file — any additional `describe` blocks past the `update — files persistidos` group are not represented here.
- TODO: behavior of `loadWorkPackage` when `maxSnippets` is omitted is not directly tested beyond the bounds checks shown.