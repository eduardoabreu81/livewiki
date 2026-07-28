# Backlog #5 — `livewiki status --diff` (pre-commit debt preview)

Date: 2026-07-28
Base: `main` @ `91f3ea7` (pushed; tree clean)
Backlog ref: ROADMAP.md item 5 — "The anchor ledger detects debt AFTER a
commit/index. Add a mode that maps the UNCOMMITTED working-tree diff to
the wiki pages whose anchors it would invalidate ('this diff will
invalidate anchors in pages X, Y'), closing the document-as-you-go loop
at pre-commit time instead of post-commit. Read-only: no ledger mutation,
no debt creation — preview only."

## Diagnosis (verified)

The ledger's events (`anchor-ledger.ts:495-516`) compare anchors'
`symbol_hash_at_doc` against the INDEXED symbols' `content_hash`:
missing → `deleted`, mismatch → `changed`. The index lags the working
tree until `livewiki index` runs. A pre-commit preview can apply the SAME
comparison to the working tree directly: re-extract symbols from the
changed files on disk (same `parseSource`/`symbols.ts` path the indexer
uses, hash computed identically) and compare each anchor row against the
working-tree symbol set — without touching the DB or creating debt.

## Design

New core function `previewWorkingTreeDebt(repoRoot)` (new
`packages/core/src/diff-preview.ts`):

1. **Changed files**: ONE `git diff --name-only HEAD` spawn
   (`shell: false`, same pattern as `collectGitChurn` in risk.ts —
   staged + unstaged vs HEAD, forward-slash repo-relative paths). Not a
   git repo / git missing → degrade with a clear message (exit 1 with
   `not_a_git_repo` in JSON; never a crash). Files deleted in the working
   tree count as changed (all their symbols gone). Untracked files are
   skipped (new files can hold no anchors).
2. **Working-tree symbol set**: for changed files present in the index
   (`files` table), re-extract symbols from disk via the indexer's own
   path (`collectImports`-style read + `parseSource` + `extractSymbols` —
   prose-tier files with no grammar yield zero symbols, matching the
   indexer), keyed as `path#name`.
3. **Anchor impact** (read-only queries): for every anchor row whose
   `symbol_key` belongs to a changed file:
   - symbol absent from the working-tree set → event `deleted`;
   - `content_hash` differs from `symbol_hash_at_doc` → event `changed`;
   - otherwise clean (not reported).
   Group hits by `wiki_path` (join `doc_pages`), each with the affected
   symbol keys + events, sorted deterministically (wiki_path, then key).
4. **`moved` is out of scope for v1** (the post-commit ledger catches it
   with full-repo evidence; detecting renames from a partial diff would
   guess). Documented in the plan + output note.

**CLI**: `livewiki status --diff` (flag on the existing status command —
`packages/cli/src/commands/status.ts`). Human output: "N pages would be
invalidated by the working tree" + per-page symbol list, or "working
tree clean vs anchors". `--json`: additive `diffPreview` block
(`{ changedFiles, notGitRepo?, pages: [{ wikiPath, items: [{symbolKey, event}] }] }`).
Exit 0 always (read-only preview; ROADMAP). No `--exit-code` variant in
v1.

**Guarantees**: zero writes (no debt rows, no anchor updates, no index
touch); output carries the `moved` scope note.

## Files to touch

1. `packages/core/src/diff-preview.ts` (new) + `diff-preview.test.ts`
   (new): temp git repos (real `git init` + commits — same pattern as
   existing git-dependent tests) covering: changed symbol → `changed`
   page listed; removed symbol → `deleted`; clean working tree → empty;
   prose-tier changed file → no hits; untracked file ignored; non-git
   dir → clean degrade; sorted deterministic output.
2. `packages/cli/src/commands/status.ts` — `--diff` flag wiring (human +
   `--json` shapes), and the status human formatter addition.
   `packages/cli/src/status-format` (or status.test in core) for the
   human text. Extend an existing CLI E2E or core status test for the
   flag.
3. `packages/core/src/index.ts` + `packages/core/package.json` — subpath
   export (project convention).
4. Docs: ROADMAP.md item 5 marked done; SPEC one-liner in the CLI table
   row for `status`; AGENTS.md backlog note + where-to-touch.

## Non-goals

No `moved` detection (v1), no staged-only/unstaged-only split, no debt
creation, no config keys, no CI wiring (the GH Actions template is
backlog #6).

## Validation gate

`pnpm -r build && pnpm -r test` green; then a live smoke on a real repo
(edit a function in the livewiki repo itself → `status --diff` shows the
module page that anchors it; revert) — free, local, no paid calls.
