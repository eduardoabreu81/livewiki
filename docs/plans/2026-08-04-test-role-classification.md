# Test-role classification (#24) — design

> Status: REVIEWED 2026-08-04 — maintainer answers incorporated (defaults,
> page depth, extra language patterns) plus the migration question the first
> draft missed. Implementation authorized on approval of this revision.
> Origin: external re-review 2026-08-03, finding P2 (confirmed with live
> measurements against this repo's own index).

## Problem

`PathRole = "product" | "fixture" | "tooling" | "docs"` (modules.ts:817) has
no concept of a test file. No pattern in `DEFAULT_PATH_ROLE_PATTERNS` matches
`*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, or `*Test.java`, so tests
co-located with product code classify as **product**.

Measured on this repo (2026-08-03, reviewer numbers):

- 94 of 217 anchored files (43%) are tests.
- `packages/core/src` overflows `maxFiles: 12` and splits into
  `core-src-01 … core-src-13` — meaningless names, meaningless titles
  ("Core module identification, manifest I/O, and Markdown mask helpers").
- 321 test-symbol anchors across 17 generated pages (`modules.test.ts#idFor`
  documented as if it were public API).
- `architecture/overview.md` lists `risk.test.ts` as a "representative path"
  next to `risk.ts`.
- Quickstart's top-6 reader digest is all `core-src-*` — no CLI, MCP, or
  batch-pipeline mention.
- The batch pays LLM tokens for ~40% content nobody wants to read.

This is the largest quality-per-token gain available; it also lands Go,
Rust, Java, and Python correctly, where co-located tests are the norm.

## Goal

1. Test files get a first-class `"test"` path role with configurable
   patterns and precise defaults.
2. Test modules are documented through the existing **deterministic
   auxiliary channel** (zero LLM tokens) — they do NOT leave the index, so
   anchors and `verify` keep working unchanged.
3. Product modules stop containing test files: partition by role **per
   file** before directory grouping.

## Non-goals

- No LLM contract/prompt changes (the whole point is zero-token routing).
- No index schema change; staleness/debt behavior for test files unchanged.
- No change to `isTestPath` consumers in flow-candidate detection.
- Inline test blocks (Rust `#[cfg(test)] mod tests`, Python in-file
  `if __name__ == "__main__"`): out of scope — role is per file.

## Current machinery (HEAD, post-P1)

- `classifyPathRole` / `classifyModuleRole` (majority vote) +
  `DEFAULT_PATH_ROLE_PATTERNS`, config key `pathRoles` with per-category
  replacement semantics (modules.ts:817–911, config.ts:131,827–834).
- Non-product modules never call the LLM: batch.ts:922 routes them to
  `generateAuxiliaryModulePage` (auxiliary-page.ts) — a fully mechanical
  contract (fixed H2 set, one H3 + marker + short paragraph per symbol),
  validated by the same `validateStage4Artifact` auxiliary checks.
  `AuxiliaryRole = Exclude<PathRole, "product">` with `ROLE_LABEL` /
  `ROLE_BULLETS` maps per role.
- `isTestPath` (flows.ts:685): filename-convention detector
  (`.test.`/`.spec.` infix, `__tests__` segment, `test_*.py`, `*_test.py`,
  `*_test.go`). Deliberately does NOT match bare `test`/`tests` directory
  segments — too many real product paths use those names. Already consumed
  by flow-candidate exclusion and the risk rubric's test-gap signal.
- `identifyModulesHeuristic` groups by directory with no role awareness →
  mixed product+test modules (the core-src-01..13 split).

## Design

### 1. Role and defaults

Extend `PathRole` with `"test"` and `PathRoleConfig` with `testPatterns?`
(same per-category replacement semantics; empty array disables).

Default patterns (gitignore-style, mirroring the `isTestPath` conventions
plus the language-defined layouts — maintainer decisions 2026-08-04):

- `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`
- `**/test_*.py`, `**/*_test.py`, `**/*_test.go`
- `**/*Test.java`, `**/*Tests.java`
- `**/src/test/java/**`, `**/src/test/kotlin/**` — Maven/Gradle standard
  layout; convention-defined, not guessed. Covers test helper classes that
  do not end in `Test.java` (the suffix patterns miss those). Gain of
  recall with zero precision loss.
- `**/*Test.kt`, `**/*Spec.kt`, `**/*Spec.scala`, `**/*Suite.scala`,
  `**/*Tests.cs` — role classification is orthogonal to grammar tier, so
  these work even on prose-tier files and partition the module correctly.

Bare `tests/` directory segments stay OUT of the defaults (precision over
recall, same call `isTestPath` already made); repos that want them opt in
via `pathRoles.testPatterns`. The Rust Cargo `tests/` integration-test
layout is likewise OUT of v1 — matching it safely requires detecting the
sibling `Cargo.toml`, which is a resolver concern, not a pattern.

### 2. One detector, two surfaces

`classifyPathRole` gains a `test` branch: match config `testPatterns` when
supplied; otherwise delegate to `isTestPath` + the Java pattern — so the
defaults cannot drift from the flow-layer detector. Precedence:
**fixture > test > tooling > docs > product** (`tests/fixtures/**` stays
fixture; `isTestPath` already returns false for those paths in practice
because the fixture branch runs first).

### 3. Per-file role split at module construction (the core change)

The per-module majority vote cannot fix co-located tests — a `src/` dir
with 43% test files still votes product and keeps every test anchor.
`identifyModulesHeuristic` must partition candidate files by
`classifyPathRole` FIRST:

- product files: group by directory exactly as today;
- test files: group into their own modules keyed by the same directory
  (`<dir>-tests` id), subject to the same `maxFiles` splitting;
- fixture/tooling/docs: unchanged (already whole-directory roles in
  practice).

`classifyModuleRole` remains as the classifier for LLM-refined merges and
for downstream consumers that ask "what role is this module".

### 4. Documentation path (zero tokens)

Test modules flow through the existing auxiliary channel:

- `auxiliary-page.ts`: add `test` entries to `ROLE_LABEL`
  ("automated tests for <area>") and `ROLE_BULLETS` (debug-a-failure /
  see-what-is-covered / add-a-test-here). `AuxiliaryRole` picks the role up
  automatically via `Exclude<PathRole, "product">`.
- batch.ts:922 routes them with zero LLM calls; symbols stay anchored, so
  `verify` and anchor debt are untouched.
- `init.ts` `hasAuxiliary` and `auxiliary/index.md` gain a "test" group;
  viewer sidebar and export inherit for free.

### 5. Interactions to audit during implementation

- `risk.ts`: the test-gap rubric ("anchored file with no importing test
  file") reads the import graph, not roles — unchanged; verify with a
  fixture where the only importer of a module is its test file (must still
  count as covered).
- Topic planner / stage-5 flows: already exclude test paths via
  `isTestPath`; confirm the new test modules don't enter topic evidence
  through the auxiliary channel.
- Checkpoint/resume: a partition change must only take effect on a NEW
  batch run — a resumed run keeps its checkpointed module list (confirm
  where modules are persisted in `batch_runs.summary_json`).
- `update.ts` incremental loop: debt-driven, module-agnostic — unchanged.
- SPEC §"Coverage ladder"/modules section and AGENTS.md "Where to touch"
  get the new role documented.

### 6. Migration: what happens to an existing wiki (the question the first
   draft missed)

When the partition changes, module IDs change (`core-src-01…13` stops
existing), and the pages generated under the old partition stay on disk —
with their old `anchors:` frontmatter. Nothing in init/batch currently
treats a module page whose module disappeared (the orphan comment in
anchor-ledger.ts:1224 is about something else). This is the same class as
P1: a classification change the persisted state does not catch on its own.

Upgrade path (maintainer decision 2026-08-04):

- Batch gains a **generated-only stale-module cleanup**, mirroring the
  flow/topic precedent (`syncStaleFlowArtifacts`, ownership-safe topic
  cleanup): after module identification, a `livewiki/<module-id>.md` page
  with `owner: generated` whose module is not in the current partition is
  REMOVED; `human`/`mixed`/untrusted pages are preserved and their skip is
  surfaced in init/batch results (rule #6 stays inviolable).
- The cleanup runs on every batch/init regen, so upgrading livewiki and
  running one batch migrates the wiki completely: old-partition pages
  disappear, test pages appear through the auxiliary channel, and the
  navigation hubs regenerate deterministically.
- No `--rebuild` flag, no manual step; the operator-visible report lists
  removed stale pages by path.

### 7. Acceptance criteria

On THIS repo (the reviewer's evidence base):

- **No product page contains a test-file anchor** (the old criterion —
  "the 321 anchors still resolve" — passed precisely because the stale
  pages stayed on disk; it measured nothing).
- Zero LLM calls for test modules; stage-4 token spend on this repo's
  partition drops ~40% (the test share).
- **No orphan page from the old partition remains on disk** after one
  batch run (generated-owner only; a planted `owner: human` old-ID page is
  preserved and reported).
- Quickstart reader digest no longer 6/6 `core-src-*`.
- `verify` zero issues after migration.
- Deterministic gate green; regression tests: role classification per
  language convention (incl. Maven/Gradle layout and prose-tier Kotlin/
  Scala/C#), precedence vs fixture, per-file split, zero-token auxiliary
  routing, stale-page cleanup ownership contract, resume-keeps-partition.

> Correction (2026-08-04, maintainer): the original "48 → ~15 modules,
> `packages/core/src` fits one module again" criterion was based on a
> wrong diagnosis — the binding split axis is `maxSymbols: 80`, not test
> files (13→11 chunks). It is replaced by the no-test-anchor criterion
> above; the residual "meaningless names" half is now item #25.

## Decisions taken (maintainer, 2026-08-04)

1. Bare `**/tests/**` directory matching: OUT of the defaults (precision);
   config opt-in documented. Language-DEFINED layouts (`src/test/java`,
   `src/test/kotlin`) are IN. Rust Cargo `tests/` deferred (needs sibling
   `Cargo.toml` detection).
2. Test-page depth: reuse the compact auxiliary contract. Extra reason: the
   test page is the natural answer to "what does this test cover", which
   feeds the risk rubric's test-gap signal — an anchored symbol inventory
   pays for itself.
3. Kotlin/Scala/C# patterns IN (role is orthogonal to grammar tier).
4. Migration: generated-only stale-module cleanup on every batch/init
   regen (mirrors the flow/topic precedent) — no `--rebuild` flag, no
   manual step; human/mixed/untrusted pages preserved and reported.

## Estimate

~1 day including tests, all deterministic — no paid calls. Optional A/B
measurement (blind re-eval) is a separate authorization. Debt payment on
this repo (138 `changed` items on 2026-08-04) is sequenced AFTER #24
lands — repartition first, then pay, to avoid spending tokens on pages
that will stop existing.
