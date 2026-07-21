# R10.1 — Acceptance-closure contract (no expansion)

Date: 2026-07-19

Status: **implemented; deterministic suites green; paid acceptance remains
open — revision 6 (evidence reconciliation only).** Revision 1
incorporated three external-review rounds; revision 2 applied eleven
corrections (tier-starvation guard, internal-vs-external import
accounting, centrality aligned to the approved design, H2-ancestor marker
membership, skipped-hub visibility scope, tsconfig.paths deferral,
exports-form scoping, undeclared-lookalike test, G2 config contract,
mechanical acceptance condition, rollback terminality in both trigger
paths). Revision 3 closes the anchor/tier mathematics (D2 needs ≥3
distinct anchors), carries anchor roles into prompt and validator,
defines T1 and the test/auxiliary fallback mechanically, scopes the
internal/external decision per occurrence, and renames Phase 1.
Revision 4 resolves two external-review blockers: item J's
rootDir/outDir resolution is strictly per package (each package's own
tsconfig direct compilerOptions; a package without readable values keeps
literal targets only — no shared or inferred src/dist defaults), and
item K's K-b top-up draws from the remaining pool in the same T1→T5
priority order as pass 2 (not strictly T4/T5), with the five groups
capped to the closed list so their union always equals the seed keys.
Revision 5 hardens acceptance after the R10.1 E2E produced a false
positive: "≥1 valid flow" was too permissive. Acceptance now requires a
**complete run** — `completed` (exit 0), every stage-4 task done, and
**every selected flow candidate materialized** (no `repair_exhausted`,
no `--only` recovery, no manual edits). The 2026-07-19 run (default
`maxRepairAttempts: 2`, 3 of 4 flows exhausted) stands as recorded
evidence that default 2 is insufficient for long walks; any raised value
used in the comparable rerun is recorded explicitly, and that rerun
compares corpus quality without proving default reliability.
Revision 6 does not change that acceptance bar. It records the executed
state accurately: E2E #3 materialized all four selected flow pages, but one
stage-4 task failed and was recovered by a separately authorized `--only`
run. The resulting corpus is complete and suitable for corpus-quality
inspection, but the run is not autonomous and therefore does **not** satisfy
item 2 under Acceptance. Revision 6 also records the scoped prompt corrections
made after E2E #2 exposed a systematic path ambiguity: the flow hub target is
the bare `index.md`, long walks use module-granularity diagram guidance, and
`verify_failed` repair feedback names the exact link action. These are
empirical clarifications of the existing link-validated contract, not a new
feature lot.

Implementation is complete and the deterministic suites are green. Commit,
push, another paid call, and presentation-lot implementation remain suspended
pending maintainer review. Any further paid E2E still requires separate
at-the-moment authorization with provider, model, command, target, and the
absence or presence of an external spend ceiling made explicit (AGENTS.md
paid-call rule).

This lot closes the acceptance gaps found in the R10 semantic-flow
implementation. It is deliberately not the presentation lot (topic pages,
role depth, intent navigation, absolutes hardening): those come later,
each with its own design review.

## Background (verified findings this contract must close)

1. The single R10 flow is anchored on E2E test helpers, not production
   entry/boundary symbols (`flows.ts:416` — alphabetical fill up to the
   cap; test files sort first).
2. Stage 5 accepted a broken internal link (warning passes the write
   gate, `batch.ts:3199`); the corpus reached zero issues only after a
   manual edit.
3. The page+diagram write is not transactional under exceptions
   (`batch.ts:3186-3195`).
4. `syncFlowsIndexHub` rewrites the hub unconditionally when flows exist
   (`navigation.ts:322-324`) — a human/mixed hub would be overwritten
   (rule #6).
5. Adherence deviations from the approved design: ranking by path length
   instead of centrality; persistence signal implemented only as path
   patterns (no import-based branch); gitignore negations broken in
   `flowSignals` booleans (per-pattern isolation in `flows.ts:315` —
   combined matcher exists only in `classifyPathRole`); `tasks.md` emits a
   `Module ID:` line while SPEC requires "linked display title and nothing
   more"; the validator does not restrict `lw:anchors` markers to the
   three allowed flow sections.
6. Cross-package edges are invisible: `resolveModuleEdges` drops every
   non-relative import (`modules.ts:702`), so `@livewiki/core/*` imports
   never become edges — the root cause of the shallow R10 flow.
7. Evidence wording: totals are 1,190,779 tokens and 17 flow attempts
   (checkpoint DB is authoritative); "empate descritivo / split decision",
   not "empate estatístico"; the ~700–800k steady-state figure is a
   counterfactual projection, not observed evidence.

## Work items

### Phase 1 — acceptance fixes (before workspace-resolution work)

**A. Transactional pair write (`batch.ts:tryWriteFlowAndVerify`).**
Wrap both safe-io writes and the verify call in one try/catch. On ANY
exception (second write, verifier crash) → best-effort rollback of BOTH
artifacts (restore snapshots / remove newly created). Rollback failure →
`rollback_failed`, terminal for the run (no further LLM calls or writes)
— terminal BOTH when the rollback was triggered by an exception AND when
it was triggered by issues returned normally by verify. Audit stage-4
`tryWriteAndVerify` (`batch.ts:2096`) under the same contract; align it
if the same exception gap exists — same contract, no broad refactor.
Tests (exact set): second write throws after the first; verifier throws;
snapshot restore of an existing artifact; removal of a newly created
artifact; rollback failure → `rollback_failed`, run stops.

**B. Stage-5 write gate.** Reject on ANY verify issue — error **or
warning** — whose `wikiPath` is the written page or diagram. Pre-existing
issues elsewhere never block the gate; final acceptance stays zero issues
repo-wide. Warnings feed the repair loop like errors do. Deliberate
asymmetry, documented in SPEC: stage 4 keeps the error-only filter (R9
contract); stage 5 is the roadmap's "link-validated" layer. Test: a
`broken_internal_link` warning on the flow page → repair/failure, no
artifact persists.

**C. Hub ownership (`syncFlowsIndexHub`).** Before writing, read the
existing hub's owner. `owner: human` and `owner: mixed` are **skipped**
(byte-for-byte intact), and the result is a new `"skipped-owner"` outcome
carrying path + owner. This is a hub-specific conservative exception to
the general `owner: mixed` semantics (SPEC §"Manual-block preservation"
normally allows regeneration preserving `lw:manual`) — justified because
the hub is a flat list without anchored sections, so slug-mapped
manual-block reinsertion is unreliable. Visibility contract (scoped to
keep the lot small): the skip is **never silent** — `skipped-owner`
appears in the current operation's result and in init/batch human and
JSON outputs; it is **not persisted** for future status queries (a
durable record would require debt/DB state and a bigger lot); the hub is
never declared updated; `verify` still detects broken links but cannot
detect semantic omissions. Tests: human hub + ≥1 flow → untouched, skip
reported in outputs; mixed hub → same; generated hub → rewritten; zero
flows + generated hub → removed (current behavior kept).

**D. Validator placement and tier coverage (flow pages).** Section
membership is defined by the **ancestor-H2 interval**: a marker binds to
the nearest preceding H2 (`Purpose` / `Ordered flow` / `Failure and
recovery` / any other), and markers in H3–H6 descending from an allowed
H2 count as inside that section; the next H2 closes the interval. Three
rules, all repairable:
(D1) an `lw:anchors` marker whose ancestor H2 is not one of the three
allowed sections is rejected (new code, e.g.
`anchor_in_disallowed_section`);
(D2) each of the three allowed sections must contain ≥1 marker anywhere
in its interval, descendants included (new code, e.g.
`anchor_missing_in_required_section`);
(D3) every available semantic group (entryKeys, boundaryKeys, sinkKeys —
see K) must be covered by ≥1 cited key (new repairable code
`anchor_missing_required_tier`) — a flat closed list can no longer let
the model cite only T4 and pass; the R10 failure shape dies here.
The stage-5 prompt presents the groups explicitly and requires ≥1
available key from each semantic group; the validator context receives
the same groups. The stage-5 repair prompt gains the matching ACTION
directives. Mechanical repair stays fail-closed on the new codes.
Per-step anchoring remains prompt guidance, explicitly not validated.
Tests: marker in Diagram/Invariants/Related pages → rejected; required
section without any marker → rejected; **positive case — a marker in an
H3 inside `## Ordered flow` counts for D2 and is allowed by D1**; an
available boundary/sink group left uncited → `anchor_missing_required_tier`;
a group that is empty in the candidate is not required.

**E. `tasks.md` identity line.** Remove the `Module ID:` line (SPEC:
"linked display title and nothing more"); the module id stays in the
architecture overview, where stable technical identity is useful. Update
`batch-review.test.ts` review #11 to assert ids via link targets instead
of the removed line.

**F. `flowSignals` negations.** The entry/persistence booleans must use
the combined gitignore matcher (`matchesAnyPathPattern`), exactly like
`classifyPathRole`; per-pattern matching remains evidence-only. Test:
`["**/cli.*", "!tests/**"]` — `tests/cli.ts` produces NO entry signal;
overrides keep per-category replacement semantics.

**G. Persistence signal — concrete mechanism.** Two evidence channels,
either is sufficient: (G1) file path matches `persistencePatterns`
(current); (G2) any still-external import specifier of the module's files
matches `flowSignals.persistenceImportPatterns` (gitignore-style patterns
over specifier strings, combined semantics, matched patterns recorded as
candidate evidence). Default for G2: **empty list** — no built-in
package-name guessing (that would be name-based hardcoding). The
"storage-dominated imports" wording in DESIGN.md is amended to this
explicit pattern mechanism; the concept of "dominated" is removed.
**Config contract:** `flowSignals` currently validates only
`entryPatterns`/`persistencePatterns` (`config.ts:542`) — extend the
loader/shape validation to accept `persistenceImportPatterns` (string
array, per-category replacement semantics), with tests: valid load,
non-array rejected, non-string item rejected, empty default, replacement
(not merge) semantics.

**H. Ranking per the approved design.** (H1) Enumeration fairness:
enumerate simple paths **per entry root** (per-root budget, default 64),
then union + dedupe; a memory guard, if needed, is round-robin across
roots — a global cap is never consumed during enumeration, so a root
with more than 64 paths does not prevent other roots' participation
(within a root the budget deliberately truncates). (H2) Centrality =
number of qualified walks that share ≥1 **module** with the candidate,
computed over that union — aligned to the approved DESIGN's
module-sharing definition. (H3) Ranking: product-role count desc →
centrality desc → slug asc; the final `maxFlows` limit applies only after
ranking. Tests: late-root candidate beats an early longer path;
determinism under input reordering; a root with >64 paths does not
prevent other roots' participation.

**I. Evidence reconciliation (docs only).** RESULTS.md and AGENTS.md:
1,190,779 tokens; 17 flow attempts (the "12 failed + 5 winning"
decomposition is asserted only if the checkpoint `diagnosticHistory`
outcomes support it — otherwise "17 attempts, 12 of them in exhausted
runs"); "empate descritivo / split decision" replaces "empate
estatístico"; the ~700–800k steady-state figure is labeled a
counterfactual projection. DESIGN.md: surgical coherence fixes only —
status line, the superseded responsibility-sentence text, the
decision log marked resolved/amended — no broad rewrite.

### Phase 2 — internal workspace imports (generic resolution)

**J. One resolver, one edge type.** A single internal operation resolves
an import specifier to a repo file, producing
`ResolvedImportEdge { fromFile, toFile, source }`. `resolveModuleEdges`
keeps its public contract and projects these file edges to
`fromModule → toModule`; the flow detector receives the same file edges
as seed provenance (see K). Tier-2 seeds and the graph can never
disagree about where an import resolved.

Resolution contract (strict, no guessing):

- The workspace package map comes from declared sources only: workspace
  globs (`pnpm-workspace.yaml`, or `workspaces` in the root package.json)
  → each package's directory + `name`. Unknown specifiers stay external —
  never infer a package by folder name.
- A specifier equal to a workspace package `name`, or `name` + subpath,
  resolves through the package's `exports` map (or `main`/`index`
  fallback). **Supported exports forms for this lot: explicit subpath
  keys plus a single chosen condition (`import`, falling back to
  `default`); wildcard/conditional-tree/directory forms are unsupported
  and fail as external** — no accidental full Node resolver.
- Compiled targets are mapped back to source using declared info:
  package root, effective `rootDir`/`outDir` from the package's tsconfig
  (here: `src`/`dist`, tsconfig.base.json:20-21), NodeNext extension
  normalization (`.js`/`.jsx`/`.mjs`/`.cjs` → `.ts`/`.tsx`/… candidates).
  Accept exactly one exact candidate present in `knownFiles`; zero
  candidates or ambiguity → the specifier stays external.
- **`tsconfig.paths` is explicitly DEFERRED from this lot** (the
  acceptance E2E needs only workspace names + export maps + rootDir/outDir);
  when it lands later it needs the full contract (extends, wildcards,
  multiple targets, per-subdirectory configs). Precedence in this lot:
  workspace package > external.
- `node:*` builtins and third-party packages are always external.
- **External accounting is per occurrence:** a specifier is an
  external-boundary signal or G2 candidate for a given `fromFile` ONLY
  when that occurrence `(fromFile, source)` produced NO
  `ResolvedImportEdge` to `knownFiles`. The same specifier may be
  internal in one file and external in another. Internally resolved
  occurrences are removed from external evidence and from the G2
  channel — an `@livewiki/core/*` import can never be simultaneously an
  internal edge and an external boundary.

Tests: a neutral two-package fixture (not livewiki-shaped) proves
`@acme/cli → @acme/core` and a second neutral consumer package → core
edges; a similarly-named package/folder **not declared** in the workspace
map does NOT become an internal edge; exports-map subpath → src mapping;
ambiguous candidate → external; NodeNext `.js` specifier → TS source;
resolved-internal occurrences absent from external evidence.

### Phase 3 — seeds and ranking on the complete graph

**K. Seed tiers with explicit groups (deterministic, two-pass,
starvation-guarded).** Each key carries its **semantic roles** (which of
T1/T2/T3 it qualifies for) and its **path role** (product vs auxiliary,
via `classifyPathRole`) separately; a key may hold several semantic roles
and is reported in each group it belongs to.

Tier definitions:
- **T1 (entry)** — by pattern: symbols of files that actually matched the
  combined entry matcher. By indegree only (no pattern match): symbols of
  the root module's non-auxiliary files that originate the first
  `ResolvedImportEdge` of the walk; deterministic fallback: symbols of
  the root's non-auxiliary files (path order).
- **T2 (crossing)** — symbols of files that are source/target of a
  crossing `ResolvedImportEdge` on the walk (provenance from the SAME
  file edges as the graph — no second resolver).
- **T3 (boundary/sink)** — symbols of files with the persistence signal
  or at the sink module.
- **T4** — remaining non-test product symbols. **T5** — test / auxiliary
  symbols (fallback role, see below).

The candidate carries explicit groups: `entryKeys`, `boundaryKeys`,
`sinkKeys`, `otherProductKeys`, `auxiliaryKeys`. Their union is the
closed list (upper bound, unchanged). Within T1/T2/T3, **product-role
keys precede auxiliary keys**; auxiliary may fill a semantic group only
when no product key exists for that role — this is the mechanical
definition that replaces "test-flow": a candidate whose entry/boundary
evidence is legitimately test-shaped keeps its auxiliary keys, while a
product flow can never present test helpers as its primary evidence.

Filling is two-pass: **pass 1 reserves ≥1 key for each non-empty
semantic group T1/T2/T3** (product first, auxiliary fallback; round-robin
across the group's modules); **pass 2 fills in priority T1→T5**
(round-robin across the walk's modules, one key per module per pass,
keys sorted within a module) until `flowMaxAnchors`. Two deterministic
skips, decided before any LLM call, each recorded with an explicit
reason: (K-a) the cap cannot fit the mandatory group reservation; (K-b)
**fewer than 3 distinct seed keys total** (D2 needs one distinct anchor
per required section, and the validator forbids reusing a key across
markers) — after pass 1, the K-b top-up draws from the remaining pool in
the same T1→T5 priority order as pass 2 (not strictly T4/T5 — strictly
T4/T5 would wrongly skip real 3-key flows whose third key sits in an
already-reserved group); still short → skip with
`insufficient_section_anchor_coverage`. The no-starvation guarantee
is scoped to the mandatory semantic groups — when the cap is smaller
than the module count, per-module coverage is not promised.
Tests: on an R10-shaped fixture, `cli.ts#run`/`createProgram`-style entry
keys precede any test helper; T1/T2/T3 each represented with a small cap;
skip-with-reason when the cap cannot cover mandatory groups;
`flowMaxAnchors: 2` → skip `insufficient_section_anchor_coverage`; a key
holding two roles counts once toward the 3-distinct minimum; stability
under shuffled inputs; auxiliary keys fill a semantic group only when no
product key exists for it.

## Acceptance

1. `pnpm -r build` clean; full suites green with the exact regression
   tests above (core, CLI, MCP) — no unrelated test changes.
2. **Single paid E2E** (separate at-the-moment authorization): MiniMax-M3
   subscription, frozen `895d49e` source, current build. Acceptance is a
   **complete run** — `completed` (exit 0), every stage-4 task done,
   every selected flow candidate materialized, no `repair_exhausted`,
   no `--only` recovery, **zero manual edits** — and for each produced
   flow:
   - anchors are >50% non-test, with ≥1 anchor each of entry, boundary,
     and sink groups when those groups exist (the same condition the
     validator enforces as `anchor_missing_required_tier`);
   - the `Purpose` / `Ordered flow` / `Failure and recovery` markers
     point to non-test anchors (product flow);
   - the candidate has `modules.length >= 3` **and** ≥1 internal
     workspace edge (mechanical condition);
   - `verify` zero issues; token accounting persisted in the checkpoint.
3. Docs (RESULTS.md, AGENTS.md live state, DESIGN.md coherence marks)
   updated with the outcome; this contract marked executed.
4. Stop for maintainer + external review before any commit/push, topic
   pages, or presentation-lot work.

## Non-goals (explicit)

No topic pages or new page kinds; no role-depth/page-length change; no
quickstart-by-intent; no absolutes-language prompt rule (deferred to the
presentation lot); no `flowMaxAnchors`/`maxRepairAttempts` default
changes (observed overrides only); no `tsconfig.paths` resolution
(deferred, needs its full contract); no commit/push; no CI/GitHub work;
no refactors beyond the items above.

## Decision log (maintainer + external review, converged)

- Fix-first sequencing approved (this lot before any presentation work).
- `Module ID:` removed from `tasks.md`; kept in overview.
- Test symbols: last tier with mechanical fallback — auxiliary fills a
  semantic group only when no product key exists for that role.
- Mixed hub: skip (hub-specific conservative exception; human/mixed
  byte-for-byte intact; skip reported with path+owner in current outputs,
  not persisted; never declared updated).
- Closed list as upper bound: retained, conditioned on explicit anchor
  groups (entry/boundary/sink), marker placement (D1/D2), and group
  coverage (D3).
- Paid E2E: authorized only at the moment, after all deterministic tests
  are green, with provider/model/command/target/spend limit explicit.
- Projections ("8.2", "700–800k") are hypotheses/counterfactuals, never
  acceptance criteria.
