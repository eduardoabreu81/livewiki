# Lot E — coalesce duplicate symbol keys at extraction (SENIOR)

**Date:** 2026-07-13
**Base commit:** `10153f4` (HEAD = origin/main)
**Severity:** init-blocking product defect, found by benchmark clean v12
(zero paid calls — deterministic failure before stage 4).

## Root cause (already diagnosed and reproduced by the lead)

`livewiki init` / `livewiki index` crashes with
`UNIQUE constraint failed: symbols.key` when a single file contains two
symbols with the same name:

- `extractSymbols` builds `key = ${relPath}#${name}`
  (`packages/core/src/symbols.ts:207`) without qualifying methods by their
  container, so two objects/classes in one file with a same-named method
  (e.g. two stub clients each having a `generate` method — the actual
  trigger is `packages/core/src/key-leak.test.ts#generate`) produce
  duplicate keys.
- The indexer does a plain `INSERT` (`packages/core/src/indexer.ts:205-208`)
  against the partial unique index
  `idx_symbols_active_key ON symbols(key) WHERE status = 'active'`
  (`packages/core/src/db.ts:179-180`) → the whole indexing transaction
  aborts. ANY user repository with two same-named methods in one file
  cannot be indexed at all.

Reproduce: run the built CLI `index` against the livewiki repo itself at
`10153f4` — it fails on `key-leak.test.ts`.

## Frozen design decision (do not deviate)

The anchor key format `path#name` is established SPEC semantics — it is
the format of every anchor in every existing wiki page; changing it (e.g.
qualifying with the container name) would invalidate existing wikis and
the ledger. Anchor granularity is NAME-PER-FILE. Therefore:

- **Coalesce at extraction:** `extractSymbols` must return at most ONE
  symbol per key. When several same-file symbols share a name, the FIRST
  by source order (lowest start line; tie-break lowest start byte) wins;
  later duplicates are dropped deterministically. Pure function behavior;
  no mutation of intermediate arrays that callers can observe.
- No schema change, no migration, no key-format change, no
  `INSERT OR IGNORE` masking (the invariant "extractSymbols output has
  unique keys" is the fix; the DB unique index stays as the safety net).
- Provider/benchmark-agnostic: this is an indexer correctness fix.

## Deliverables

### E1. SPEC.md delta (before code)

One short paragraph in the indexing/anchors section: anchor keys are
`path#name`; same-named symbols within one file coalesce into a single
anchor (first by source order); duplicates never abort indexing.

### E2. Coalescing in `packages/core/src/symbols.ts`

Per the frozen decision. Keep it inside `extractSymbols` (single choke
point) so every caller — indexer, tests, future tools — gets the
invariant.

### E3. Tests

- `packages/core/src/symbols.test.ts` (or the existing symbols test file):
  a TS source with two classes and two object literals sharing method
  names yields unique keys, first-occurrence line ranges, deterministic
  order; a file with a function and a same-named method also coalesces.
- Indexer regression (`packages/core/src/indexer.test.ts` or closest):
  indexing a fixture file with duplicate same-name methods succeeds
  (no UNIQUE violation) and stores exactly one active row for that key.
- The real trigger: an E2E-ish assertion that indexing a file shaped like
  two stub objects with `generate` methods works (mirror of
  `key-leak.test.ts`'s shape — do NOT modify key-leak.test.ts itself).

## Hard rules

- No paid API calls. No commits/pushes — leave changes in the working tree
  for lead review. English durable text.
- Do not touch: validators, prompts, batch state machine, diagnostics,
  `docs/benchmarks/**`, `.claude/`, `.codegraph/`. Never `git clean -fdx`.
- Changes ONLY in: `SPEC.md`, `packages/core/src/symbols.ts`, and test
  files.

## Validation gates

```text
pnpm -r build
pnpm -r test
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
```

Plus the reproduction check: the built CLI `index --repo .` on the livewiki
repo itself (a throwaway worktree at the working-tree state) completes
without error.
