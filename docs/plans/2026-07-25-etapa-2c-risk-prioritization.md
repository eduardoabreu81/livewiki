# Etapa 2c — test-gap signal + risk-weighted debt prioritization

Date: 2026-07-25
Base: `main` @ `f33ec85` (clean tree; untracked benchmark evidence + handoffs untouched)
Backlog ref: `docs/plans/2026-07-23-capability-backlog.md` item 3
Handoff ref: `docs/handoffs/2026-07-24-vision-and-capability-lots.md` next action #1

## Goal

Rank open debts in `livewiki status` (and, through the same array, in
`livewiki update`'s work package) by a deterministic, transparent risk
score combining three signals — all computed without any LLM call:

1. **Test gap** — a file that no test file imports (resolved import edge)
   carries more risk when its docs go stale. Test files are classified by
   the existing `isTestPath` (`packages/core/src/flows.ts:627`).
2. **Fan-in** — how many distinct files import the file (file-level
   import edges via the shared `resolveImportEdges`,
   `packages/core/src/import-resolution.ts:200`).
3. **Git churn** — how often the file changed in recent history
   (one `git log` spawn; graceful degradation when git is absent or the
   directory is not a repo).

Ordering changes only; debt identity/dedup untouched (SPEC §"Debt dedup"
constraint). JSON changes are purely additive; consumers reading today's
fields keep working.

## Key findings that shape the design

- Imports are **never persisted** (no edges table in schema v6). Batch and
  init recompute them per run (`batch.ts:2629 collectAllImports`,
  `init.ts:619`). We follow the same pattern: recompute on demand — **no
  schema bump** in this lot.
- `symbol_key` = `${relPath}#${name}` (`symbols.ts:263`) ⇒ the source
  file path of a debt item is `key.slice(0, key.indexOf("#"))`. The
  `debt.symbol_key` column survives even when the anchor row is gone
  (deleted symbols), so it is the reliable path source.
- Both `status` (`status.ts:155-163`, chronological `ORDER BY
  d.detected_at ASC`) and `update` (`update.ts:116-117`,
  `loadWorkPackage` consumes `status.debt.items` verbatim — including the
  50-snippet budget) read the SAME array. Ranking once inside
  `status.collect` covers both surfaces with zero `update.ts` logic
  change.
- No git helper exists anywhere in production code. SPEC.md:100-104
  explicitly allows a future subprocess via `child_process.spawn` with
  an argument array and `shell: false`. This lot introduces the first
  one; it must degrade gracefully (git missing / not a repo ⇒ churn
  factor 0, never an error).
- `status.collect` currently does not load config; `runStatus` does the
  DB open. Config load must be optional-safe (repo without
  `.livewiki/config.json` ⇒ defaults, never throw).

## Scoring rubric (deterministic, documented in code + SPEC)

Per debt item, on the item's source file (when derivable):

| Factor | Rule | Points |
|---|---|---|
| event | `changed` / `deleted` | +10 |
| event | `moved` | +5 |
| testGap | anchored-tier file with no importing test file | +40 |
| testGap | prose-tier file (import coverage not possible) | +10 |
| fanIn | 1–2 importers / 3–5 / 6–10 / >10 | +5 / +10 / +15 / +20 |
| churn | 1–3 commits / 4–9 / ≥10 in window | +5 / +10 / +15 |

Missing data ⇒ factor 0 (no churn info, no derivable path, prose file
with zero fan-in). Score = sum. Sort: `score` desc, then `detected_at`
asc, then `id` asc (stable + deterministic). The weights are constants
in one place with a comment, mirroring the `prioritizeModules` idiom
(`modules.ts:931`) — ranking never removes obligations, it only orders.

`DebtItem` gains an optional additive field:

```ts
risk?: {
  score: number;
  factors: { event: number; testGap: number; fanIn: number; churn: number };
};
```

## Files to touch

1. **`packages/core/src/risk.ts` (new)** — pure, deterministic:
   - `RiskFactors`, `RiskScore`, `scoreDebtItem(...)` (the rubric above).
   - `computeTestCoverageAndFanIn(files, importsByFile, knownFiles)` →
     `{ coveredByTest: Set<string>, fanIn: Map<string, number> }`,
     reusing `resolveImportEdges` + `isTestPath` (workspace packages
     empty — same strictness as the module graph without workspace map;
     relative edges, which carry the signal, resolve identically).
   - `parseGitChurnOutput(text): Map<string, number>` (pure; posix
     paths, blank-line tolerant).
   - `collectGitChurn(absRoot, maxCommits, spawnImpl?)` → `Map | null`;
     injectable spawn for tests; production default spawns
     `git log --no-merges --max-count=<N> --name-only --format=` with
     `shell: false` per SPEC; any failure ⇒ `null`.
   - `derivePathFromSymbolKey(key)` helper.
2. **`packages/core/src/status.ts`** — `DebtItem` gains `risk?`;
   `collect` (after debt items are built, only when `items.length > 0`
   and `riskAnalysis !== false`) builds the signals and sorts;
   `formatHuman` prints `[risk N]` after each item when present.
   Config loaded defensively in `runStatus` (try/catch ⇒ defaults).
3. **`packages/core/src/imports.ts`** — hoist a shared
   `collectImportsForFiles(absRoot, paths)` (the `collectAllImports`
   body from `batch.ts:2629`); `batch.ts` refactored to call it
   (delete the private copy — no behavior change).
4. **`packages/core/src/config.ts`** — two new keys, four touch points
   each (interface + defaults + applyDefaults + strict validation):
   - `riskAnalysis` boolean, default `true`.
   - `riskChurnCommits` integer 0..10000, default `500`; `0` disables
     the git spawn entirely.
5. **`packages/core/src/index.ts`** + `packages/core/package.json` —
   export the risk surface (subpath `./risk`).
6. **`packages/core/src/risk.test.ts` (new)**:
   - coverage/fan-in maps from synthetic edges (covered, uncovered,
     prose-tier, self-edge, test-imports-test);
   - rubric math per factor + tie-break determinism (same input twice ⇒
     byte-identical order);
   - `parseGitChurnOutput` on fixture text (paths with spaces,
     duplicate paths across commits, blank lines);
   - `collectGitChurn` degradation: non-git temp dir ⇒ `null`, no throw;
   - disabled config ⇒ no `risk` field, original chronological order.
7. **`packages/core/src/status.test.ts`** — update `StatusReport`
   literals (additive field), plus an integration case: temp repo with
   `src/a.ts` (imported by `src/a.test.ts`) and `src/b.ts` (uncovered),
   `changed` debt on both ⇒ `b` ranks first, `risk` fields present;
   human format shows the marker.
8. **`packages/core/src/update.test.ts`** — assert `loadWorkPackage`
   debt/snippet order follows the risk ranking (snippets go to the
   highest-risk items first).
9. **`packages/core/src/config.test.ts`** — validation: rejects
   non-integer/out-of-range `riskChurnCommits`, non-boolean
   `riskAnalysis`; defaults applied.
10. **SPEC.md** — small amendment: risk-weighted ordering paragraph in
    the `status`/`update` contract (§"Fase 2"/§CLI lines 468-469), the
    rubric table, the two config keys, and the subprocess allowance note
    (git log via spawn, shell:false, degrades silently).
11. **AGENTS.md** — Live state entry for Etapa 2c + "Where to touch"
    line (risk ranking → `risk.ts`, consumed by `status.ts`/`update.ts`).
12. **Plan archival** — copy this plan to
    `docs/plans/2026-07-25-etapa-2c-risk-prioritization.md` and annotate
    as-built deviations there (Etapa 2a precedent).

## Alternative considered (not recommended)

**Schema v7 persisted `imports` table** — the indexer would persist
per-file imports at index time, and `status` would read edges from the
DB instead of reparsing. Pros: faster `status` on huge repos; a base
for future signals (CALLS-edge lots). Cons: schema bump + migration +
indexer changes + reindex semantics for a presentation-order feature;
and it breaks with today's architecture where imports are deliberately
never persisted (batch/init recompute per run). If a later lot needs
persisted edges, it can introduce the table then, with its own
contract. Recommendation: option A (compute-on-the-fly, this plan).

## Explicit non-goals

- No schema migration (imports stay computed-on-the-fly).
- No debt identity/dedup/severity changes; risk is presentation order
  plus additive metadata only.
- No caching of churn (rule 3: disk is the truth; one spawn per status
  call with debt > 0 is cheap).
- No CALLS edges, no new languages, no paid LLM calls.
- No CLI flag surface changes (`status`/`update` gain ordering only).

## Test/perf notes

- Import recomputation happens only when open debt exists; status on a
  clean repo never parses files.
- Windows: `git` spawned by name on PATH; degradation path is the
  tested behavior when absent. Git `--name-only` output is already
  forward-slash; still normalized via `normalizeRepoPath`.

## Validation gate (before reporting back)

```bash
pnpm -r build
pnpm -r test
```

Target: core suite stays ≥ prior green (1194 passed / 12 skipped) plus
the new tests; no paid LLM run; tree handed back for maintainer review
before any commit.

## As-built deviations (recorded during implementation, 2026-07-25)

1. **Ranking site**: the plan phrased the change as "status.collect ... builds
   the signals and sorts". As built, ranking runs in `status.run()` via a new
   `applyRiskRanking(db, absRoot, report)` helper, not inside `collect()` —
   `collect` is synchronous and the signals require async work (tree-sitter
   import recompute, git spawn). Same net effect: one ranking point feeding
   both `status` and `update` (which consumes `status.debt.items` verbatim).
2. **`computeTestCoverageAndFanIn` signature**: the plan sketched
   `(files, importsByFile, knownFiles)`; as built it takes
   `{ importsByFile, knownFiles }` only. The files list was unused — tier
   classification stays in `status.ts` (which owns the private
   `anchoredLangs()` helper) and enters the pure risk layer as the `tier`
   parameter of `scoreDebtItem`. This keeps `risk.ts` free of walker/parser
   imports beyond the import-resolution machinery.
3. **Import recompute scope**: only anchored-tier files are parsed (prose
   files yield no edges and would only cost parser init); `knownFiles` still
   includes all active paths so resolution targets are complete.
4. **Disabled-config test placement**: the "disabled config ⇒ no `risk`
   field, original chronological order" case listed under `risk.test.ts`
   (item 6) lives in `status.test.ts` instead — it is a status-level
   integration behavior, and item 7 already specified the same case there.
5. **Sort comparator exported**: `compareByRisk` is exported from `risk.ts`
   so the tie-break determinism tests (score desc → detected_at asc → id asc;
   identical order across shuffles) are pure unit tests without a DB.

Everything else follows the plan as written: rubric weights, additive
`DebtItem.risk`, `[risk N]` human marker, config keys `riskAnalysis` /
`riskChurnCommits` (4 touch points), `git log --no-merges --max-count=<N>
--name-only --format=` spawn with `shell: false` and null-on-any-failure,
injectable spawn, `collectImportsForFiles` hoisted into `imports.ts` with
`batch.ts` refactored to use it (private `collectAllImports` deleted),
`./risk` subpath export, SPEC/AGENTS amendments.
