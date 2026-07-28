# Backlog #2 + #3 — change-impact context + index freshness

Date: 2026-07-28
Base: `main` @ `cd1fed8` (pushed; tree clean)
Backlog refs: ROADMAP.md items 2 and 3 (quoted below). Implemented as TWO
sequential lots under one plan to avoid `packages/mcp/src/server.ts`
collisions.

## Item 2 — native compact change-impact context

ROADMAP: "Extend the existing `livewiki update` work package and MCP
responses with a bounded, documentation-focused impact view: changed
symbols, affected anchors, pages, modules, dependencies, and only the
relevant source snippets. Reuse the local livewiki index; do not call or
require another graph/MCP product. The same structured payload must be
available through CLI JSON and MCP so an active agent or standalone
provider receives equivalent context."

### Diagnosis (verified)

- The update work package (`update.ts:99-161`) already carries debt +
  snippets + validAnchors; `previewWorkingTreeDebt` (backlog #5,
  `diff-preview.ts`) already computes changed/deleted symbols from the
  working tree with ledger-identical hashes; `livewiki_impact`
  (`blast-radius.ts`) already answers per-symbol blast radius. Nothing
  composes them into one bounded package.
- Import edges for the dependency view come from the shared
  `resolveImportEdges` (import-resolution.ts) — same recompute-on-demand
  pattern as everywhere else.

### Design

New core function `computeChangeImpact(repoRoot, opts?)` (new
`packages/core/src/change-impact.ts`):

1. **Changed symbols** — from `previewWorkingTreeDebt` (working-tree
   mode, default) or from open debt (`debt` mode). Deterministic degrade
   outside git (reuse the not_a_git_repo result).
2. **Affected anchors + pages** — anchor rows referencing the changed
   symbol keys, grouped per `wiki_path` (doc_pages join), with event.
3. **Dependencies** — direct importers of the changed FILES via
   `resolveImportEdges` over the indexed inventory (recomputed on demand;
   capped, sorted).
4. **Snippets** — bounded (top-N, default 10) source windows for the
   highest-priority changed symbols, reusing the `update.ts` snippet
   window logic (hoist the private `snippetForSymbol` instead of
   duplicating).
5. **Budgets**: `maxSymbols` 50 / `maxPages` 20 / `maxSnippets` 10 /
   `maxImporters` 25 — constants in one place, counted in the output
   (`truncated: true` when a cap binds; never silent).

**CLI**: `livewiki update` work package gains an additive `impact` block
(same payload); human output lists top affected pages.
**MCP**: `livewiki_impact` accepts an EMPTY `symbolKey` → returns the
same `impact` package instead of the per-symbol blast radius (with
symbolKey it behaves exactly as today). `_hints` updated for the new
mode.

## Item 3 — index freshness and automatic local synchronization

ROADMAP: "Make index freshness explicit and cheap. Long-running livewiki
surfaces should detect repository changes, debounce local re-indexing,
and expose snapshot age and stale/ready state. Startup and recovery
remain rebuildable from the repo and wiki. No daemon, cloud service, or
external watcher may be required for normal CLI use."

### Design (two independent pieces)

1. **Freshness in `status`** (no watcher): `StatusReport.meta` gains
   `snapshotAgeMs` (now − `last_indexed_at`) and `stale` — computed
   cheaply: any indexed file whose on-disk mtime is newer than its
   indexed `mtime`, or any indexed file missing on disk, or any file on
   disk newer than `last_indexed_at` (bounded stat scan). Human output
   prints one line when stale (`index is stale (snapshot <age>; N changed
   files detected)`), JSON additive. Tests assert fresh vs stale.
2. **MCP server watcher**: on `createServer`, `fs.watch(repoRoot,
   { recursive: true })` with a denylist (`.git`, `.livewiki`,
   `node_modules`, `dist`, media/binaries) feeding a debounce (1.5s) that
   runs, per batch of changes: incremental `runIndexer` (hash-incremental
   — unchanged files are skipped by design) → `runLedger` → reindex the
   affected pages in `search.db` (or full rebuild — sub-second, idempotent
   — pick the simpler correct one). Watch failures (unsupported fs,
   EMFILE) degrade to "no watcher, startup-rebuild semantics" with a
   log line, never a crash. `server.close()` stops the watcher (Windows
   handle discipline — the EBUSY lesson).
   Tests: temp repo + real watcher: edit a source file → within the
   debounce window the search index reflects it and the ledger shows the
   debt; close() releases handles.

## Files to touch

Item 2:
1. `packages/core/src/change-impact.ts` (new) + tests (temp git repos;
   caps binding; debt mode; deterministic order).
2. `packages/core/src/update.ts` — hoist `snippetForSymbol` for reuse;
   work package gains `impact`.
3. `packages/cli/src/commands/update.ts` — human output addition.
4. `packages/mcp/src/server.ts` — `livewiki_impact` empty-symbolKey mode +
   hints + `server.test.ts` scenario.
5. Core index.ts/package.json subpath export.

Item 3:
6. `packages/core/src/status.ts` — `snapshotAgeMs` + `stale` (+ tests).
7. `packages/mcp/src/server.ts` — watcher + debounce + close() handling +
   `server.test.ts` watcher scenario.
8. Docs (both items): ROADMAP.md items marked done, AGENTS.md live-state
   + where-to-touch bullets, SPEC one-liners where the surfaces are
   documented.

## Non-goals

No daemon/system service, no cross-process sync protocol, no MCP
notification push to clients (v1 keeps freshness pull-based: responses
reflect the re-indexed state), no config keys unless a test proves one is
needed, no changes to `livewiki_impact`'s per-symbol mode.

## Validation gate

`pnpm -r build && pnpm -r test` green after EACH item (sequential:
item 2 lands, gate, item 3 lands, gate). Live smokes (free, local):
edit a source file in this repo → `update` impact block lists the page;
MCP server picks up an edit within the debounce window. No paid calls.
