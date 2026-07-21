# Semantic product-flow layer — implementation and E2E evidence

Date: 2026-07-18

Status: implemented with deterministic suites green in the working tree;
**uncommitted and unpushed**, on top of the uncommitted R2–R9 hardening patch.
The final comparison corpus is complete after a disclosed `--only` recovery;
the stricter autonomous paid-E2E acceptance remains open. Awaiting maintainer
review before any commit.

Design contract: `DESIGN.md` (same directory, approved 2026-07-18 with the
recommended options: separate stage 5, `flows/` directory, responsibility
sentence for `tasks.md`, defaults 4/25/12/20).

## What was built (lots S1–S4)

- **S1 — spec + validator + config.** `SPEC.md` amendments A–F applied
  verbatim from the design (5-stage pipeline, "Semantic product-flow layer"
  section, gated quickstart link, `tasks.md` dedup, `flows/` layout).
  `validateStage4Artifact` gained page kinds (`module` default unchanged;
  `flow` contract: H1 → responsibility sentence → Purpose → Ordered flow →
  Diagram → Invariants → Failure and recovery → Related pages; `modules:`
  frontmatter checked against the candidate). New codes
  `invalid_flow_diagram` / `flow_diagram_too_large`. Config keys
  `maxFlows` (4), `flowMaxAnchors` (25), `flowMaxDiagramNodes` (12),
  `flowMaxDiagramEdges` (20), `flowSignals` (pattern overrides, same
  precedent as `pathRoles`).
- **S2 — deterministic detector.** `packages/core/src/flows.ts`: pure,
  deterministic candidate detection from module-graph walks
  (entry → … → sink crossing a persistence/external boundary), ranked
  (product-role count, path length, slug), capped by `maxFlows`, with
  seed key sets capped by `flowMaxAnchors`. Zero repository-specific
  names; `node:` and relative imports never count as external.
- **S3 — stage 5 orchestration.** One task per candidate
  (`flow:<slug>`), reusing the stage-4 attempt loop (budgets, stop-reason
  gate, incomplete retries, diagnostics, checkpoint). The model emits one
  page with the diagram **inline**; the orchestrator extracts it to
  `livewiki/diagrams/flow-<slug>.mmd` and writes the page with the
  `%% livewiki/...` placeholder (single call, on-disk shape per design).
  Diagram parsed pre-write and bounded; both artifacts written
  transactionally with dual rollback; `owner: human` refused, `mixed`
  preserved; stale generated flows removed (`syncStaleFlowArtifacts`);
  `--only flow:<slug>` reruns one flow with monotonic usage. No
  mechanical fallback (artifact-repair stays fail-closed).
- **S4 — navigation + dedup.** `flows/index.md` hub (deterministic,
  existence-gated), gated quickstart/overview links, one `Flow:` line in
  participating module pages' `## Navigate` blocks (from the flow page's
  `modules:` frontmatter), `tasks.md` switched to the responsibility
  sentence for product modules and compact link lists for auxiliary
  roles (removes the 36 duplicate prose groups at the source).

## Internal validation (all green)

| Suite | Result |
|---|---|
| `pnpm --filter @livewiki/core test -- --run` | 40 files, **875 passed**, 12 skipped (expected Windows symlink skips) |
| `pnpm --filter @livewiki/cli test -- --run` | 8 files, **81 passed** (~143s) |
| `pnpm --filter @livewiki/mcp test -- --run` | 2 files, **21 passed** |
| `pnpm -r build` | clean (core, cli, mcp) |

New test coverage: `flows.test.ts` (16), `batch-stage5.test.ts` (21),
`cli-batch-stage5-e2e.test.ts` (3: happy path with full navigation surface
and zero-issue verify, `maxFlows: 0`, diagram-budget repair), plus
validator/config/frontmatter regression cases.

## Real-CLI E2E (kc-quillrift copy, 27 indexed files / 81 symbols)

Setup: four independent copies of the real TypeScript repo
`kc-quillrift` under `C:\tmp\livewiki-e2e\` (no shared state). Built CLI
from the current tree. No commits anywhere.

### Prong A — external agents author the wiki (in-session mode)

Each agent received the same bounded task: document the four spine
modules (hooks, services, lib, types), write the principal flow page +
diagram, and iterate until `verify` reports zero issues.

- **claude** (Claude Code, headless): completed in one session.
  4 module pages + flow page + diagram; `verify` **zero issues** on the
  first check. Notable: it refused to force an invalid whole-file anchor
  on `types/index.ts` ("would make verify pass falsely") — the
  anti-hallucination incentive works through the CLI alone.
- **codex** (`codex exec`): completed; 59 symbols anchored exactly once;
  `verify` **zero issues**; self-reported 214k tokens. Both agents
  independently created `flows/index.md` themselves to satisfy the
  hub link — the flow structure is discoverable from the task text alone.
- **mmx** (MiniMax-M3, single-shot per artifact via `mmx text chat`):
  first pass produced good prose but invalid anchors (bare symbol names
  instead of full `path#symbol` keys; markers inline in headings) —
  `verify` caught **every** invalid anchor (anti-hallucination gate held).
  One repair round feeding the exact verify errors + the complete valid
  key list back to the model fixed all pages: `verify` zero errors.
  This mirrors the product's repair design and shows MiniMax-M3 corrects
  anchors reliably from structured error feedback.

After each agent finished, `livewiki init` was re-run on its copy: the
navigation layer synced the hub, quickstart/overview links, and `Flow:`
navigate lines onto the agent-written pages. Final state per copy:
`verify` **OK (9 pages), zero issues**; `export generic` wrote 14 files
with 0 issues and a second run wrote **0 files** (byte-identical
idempotence).

### Prong B — real batch run with a local model (ollama)

`init --batch` with preset `ollama`, model `granite4.1:3b` (zero-cost
local provider, subscription-free): stage 4 tasks `lib`/`services`/`hooks`
all ended `repair_exhausted` (the 3B model cannot satisfy the strict
contract — `no_frontmatter`, `missing_page_opening`, dozens of
`missing_closed_key`); circuit breaker aborted the run at 3 consecutive
failures. Observed guarantees, all working as designed: no invalid
artifact left on disk (transactional), honest failure reporting with
per-attempt diagnostics, exact token accounting (37,415 in / 12,216 out,
`usageIncomplete: false`), and the wiki left `verify`-clean (3 pages).
A direct probe confirmed the model responds well-formed content but
below contract fidelity. **Finding: small local models (3–4B) are below
the reliability floor of the stage-4/5 contracts** — use mid-tier hosted
models for batch; the failure path degrades gracefully.

## Defects found during validation and fixed (with regression tests)

1. **`validateConfigForBatch` rejected preset-only configs** — SPEC says
   `config.json` references the preset by name, but validation required
   `provider` literally. Any preset-only batch failed before starting.
   Minimal fix + 2 tests (`config.test.ts`). Found by Prong B.
2. **Frontmatter parser treated inline flow-style lists as one string** —
   `modules: [hooks, services, lib]` (the form LLMs most often emit)
   became an opaque string, silently dropping `Flow:` navigate links and
   mis-parsing inline `anchors:`. Minimal fix + 2 tests
   (`frontmatter.test.ts`). Found by Prong A.
3. **Two literal NUL bytes in `flows.ts`** (dedup sentinels written as
   raw bytes instead of `\0` escapes) made the file unreadable as UTF-8.
   Fixed + source-hygiene regression test.

## Notes and observations

- `verify` human output strings are PT-BR — pre-existing migration debt
  (rule #7), untouched per the normalization-pass policy.
- The mmx flow diagram has ~26 edges, over the stage-5 budget of 20 —
  correct behavior: the budget is a batch artifact gate, not a rule on
  agent-authored files (verify only checks Mermaid syntax).
- `livewiki serve` remains a stub; docs state that accurately.
- The 8 legacy deleted-debt rows from the handoff remain untouched
  (separate issue, out of scope).
- MiniMax **API** batch (the ps1 harness path) was not run:
  `MINIMAX_API_KEY` is not present in the User/Machine environment on
  this host. The mmx CLI (OAuth subscription) covered MiniMax-M3 instead.
  A full real-provider stage-4+5 batch remains available once Eduardo
  provisions the key.

## Suggested next steps

1. Maintainer review of this tree; separate commit/push authorization.
2. Optional: MiniMax-M3 subscription batch on a real repo for a full
   real-provider stage-4+5 run (harness already exists in
   `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v21/`).
3. Then: remaining export targets, cross-platform CI, Phase 7 viewer
   (renders the same `flows/` artifacts).

---

# Addendum 2026-07-18 (late): R10 — comparison-grade corpus on the frozen source

The first E2E above validated mechanics on kc-quillrift, but the maintainer
correctly pointed out that only a corpus generated from the **same frozen
source and same model** as R9 is comparison-grade evidence. R10 is that run.

## Setup (parity with R9)

- Source: clean `git archive` of commit `895d49e` (verified: the R9 target
  repo at `C:\tmp\livewiki-official-ab-20260716\livewiki-c1-r9` had
  uncommitted changes only inside `livewiki/` itself — same documented
  source).
- Model: MiniMax-M3 (subscription, `bench-secrets.ps1`), openai-compat,
  `thinking: disabled`, stage 2 disabled (`--no-refine`).
- Generator: current build (R2–R9 hardening + semantic product-flow layer).

## Run history and what it surfaced

1. **First run**: 36 tasks done, 3 failed (`rerun-clean-v16`,
   `rerun-clean-v8`, `flow:cli-src-to-commands`); verify clean (36 pages).
   The stage-4 module failures show ordinary convergence failure under
   nondeterminism (R9 passed them; no new error codes, no flow codes).
2. **Flow-task failure analysis (17 attempts total: 12 across 3 exhausted
   `--only` reruns + 5 in the final successful run — per the checkpoint
   `diagnosticHistory` outcomes, which record attempts 1–16 as
   `artifact_validation_failed` and 17 as `success`)**:
   MiniMax-M3 oscillated — every attempt fixed one violation and introduced
   another (`missing_page_opening`, `duplicate_anchor`,
   `missing_closed_key`, `flow_diagram_too_large`). Root cause identified:
   the flow closed list was enforced with **module-page dual completeness**
   (all ~25 seed keys, each exactly once on both surfaces), while the
   design's stated intent was "may use fewer, never more". **Fix applied**:
   for flow pages the closed list is now an upper bound — cited keys must
   still come from the list and appear on both surfaces, unused keys are
   fine (`artifact.ts`, stage-5 prompts, tests; SPEC + DESIGN amended).
   Core 876 / CLI 81 green after the change.
3. **Recoveries**: `--only` reruns landed `rerun-clean-v8` and
   `rerun-clean-v16`. The flow task completed once its run used
   `maxRepairAttempts: 4` and `flowMaxAnchors: 15` in the target's
   config.json (user-tunable knobs; 92,187 input + 12,682 output tokens for
   that task). Navigation (hub, quickstart/overview links, `Flow:` navigate
   lines) regenerated correctly after the `--only` rerun.
4. **Second duplication sweep**: the first masked audit showed duplicates
   down from R9's 36 groups to 14 — but 12 of the 14 were the
   responsibility/purpose sentences copied into `tasks.md`/`flows/index.md`
   by the Lot S4 design itself. Evidence-driven follow-up: index pages are
   now title + link only (no copied prose), SPEC re-amended, suites green.
   One surgical fix to the generated flow page (`../index.md` → `index.md`;
   the model's own link error, reported as a verify warning that does not
   block writes).

## Final R10 corpus (vs R9)

| Metric | R9 | R10 |
|---|---:|---:|
| Markdown pages | 38 | 40 (+flow page +flows/index hub) |
| Mermaid files | 11 | 12 (+behavioral flow diagram) |
| Words | 43,941 | 38,543 |
| Internal links missing | 0 | 0 (261/261 resolved) |
| **Exact duplicate prose groups (≥120 chars)** | **36** | **1** (a shared `## Navigate` boilerplate line between two module pages) |
| verify | zero issues | zero issues |
| Tokens (in+out, exact accounting from checkpoint `usageHistory`) | 700,347 | 1,190,779 = 994,646 in + 196,133 out, 82 calls (the flow task alone consumed 361,891 tokens across 17 attempts; a steady-state ~700–800k is a **counterfactual projection**, not observed evidence) |

The R10 flow page is `flows/cli-src-to-commands.md` (CLI invocation →
commands → core → exit), cited by anchors and linked from both
participating module pages' `## Navigate` blocks, the hub, quickstart, and
the architecture overview.

## Blind evaluation (in progress at this writing)

Two independent evaluators (claude, codex) received separate immutable
evaluator directories (process lesson from the R9 comparison): fresh
Corpus A = OpenWiki R1 (the original masked corpus, reused verbatim as
control), fresh Corpus B = masked R10, the same frozen `source/` snapshot,
the same brief, tasks, scorecard, and masking rules. Each writes its own
result file (`EVALUATION-RESULT-CLAUDE.md` / `EVALUATION-RESULT-CODEX.md`).
Results will be consolidated here when they land.

## Blind evaluation results (2026-07-18)

Both evaluators completed all ten tasks and twelve adversarial claims per
corpus, locked scores before comparison, and stayed within their immutable
directories. Raw results: `C:\tmp\livewiki-e2e\eval-claude\EVALUATION-RESULT-CLAUDE.md`,
`C:\tmp\livewiki-e2e\eval-codex\EVALUATION-RESULT-CODEX.md`.

| Dimension (weight) | OpenWiki R1 (claude / codex) | LiveWiki R10 (claude / codex) | R9 baseline |
|---|---:|---:|---:|
| Factual accuracy (35%) | 7 / 6 | **9 / 9** | 8 |
| Useful coverage (25%) | **8 / 9** | 7 / 8 | 6 |
| Navigation (20%) | **8 / 9** | 5 / 6 | 7 |
| Clarity (10%) | **8 / 8** | 6 / 6 | 4 |
| Traceability (10%) | 8 / 8 | **9 / 10** | 9 |
| **Weighted total** | 7.65 / 7.8 | 7.40 / **8.0** | 7.00 (vs 7.75) |

- claude: OpenWiki 7.65 vs LiveWiki 7.40 (narrow OpenWiki preference).
- codex: OpenWiki 7.8 vs LiveWiki **8.0** (narrow LiveWiki preference,
  "accuracy and traceability slightly outweigh"; medium confidence).
- Mean of both: OpenWiki ≈ 7.73, LiveWiki ≈ 7.70 — **descriptive tie /
  split decision** (two ordinal scores without variance; no statistical
  test is claimed); the R9 gap of 0.75 closed to ≈0.03.

Convergent findings (both evaluators agree):

- **Won**: factual accuracy (9,9 vs 7,6 — OpenWiki produced 4–5 false
  claims in the 12-claim sample; LiveWiki 0–2) and traceability (9,10 vs
  8,8 — per-symbol signatures, tests, explicit excerpt limits).
- **Improved vs R9**: coverage (6 → 7/8), clarity (4 → 6/6), accuracy
  (8 → 9/9). The semantic-flow layer, the full index dedup, and the
  opening contracts did their jobs.
- **Residual gaps**: navigation (5/6 vs 8/9 — module-ID hubs are opaque
  for conceptual questions and one flow is thin coverage), auxiliary
  prominence (16 benchmark/tooling pages count as padding against
  coverage, navigation, AND clarity), and task-oriented synthesis
  (OpenWiki's per-topic pages still answer some tasks in one hop).

Caveats: different evaluators than the R9 round (comparisons across
evaluator teams are indicative, not precise); adversarial claim samples
differ per evaluator; Corpus A was the byte-identical frozen control;
one repository, one snapshot, one model configuration. No universal
product-winner claim is made.

### Reading of the result against the projection

The improvement plan projected 7.80 (coverage 8 + clarity 7) to 8.10
(+navigation 8). R10 landed at ≈7.7 mean: accuracy over-delivered (9 vs 8
assumed), clarity under-delivered (6 vs 7 — the repetitive template of the
auxiliary pages, not prose duplication, which is now 1 group), navigation
under-delivered (5/6 vs 7 — the hub lists 35 modules with equal visual
weight and only one flow exists). The remaining lever is exactly the one
both evaluators named: **auxiliary prominence and intent-based
navigation** — presentation-level work, not engine work.

---

# Addendum 2026-07-19: R10.1 acceptance E2E (single authorized run)

Contract: `docs/tasks/2026-07-19-r10-1-acceptance-fixes/CONTRACT.md`
(rev6; rev4 at the time of this run). Single `init --batch --no-refine`, MiniMax-M3 subscription, fresh
`git archive 895d49e` (`C:\tmp\livewiki-src-r10-1`), all knobs at
defaults (flowMaxAnchors 25, maxRepairAttempts 2, maxFlows 4), token
ceiling 1.35M monitored at 15s (never triggered), zero manual edits.

**Run outcome: `completed_with_failures` (exit 1), 39 done / 3 failed.**
Total tokens 1,117,150 (931,794 in + 185,356 out), within ceiling.

The internal-import resolution worked end-to-end: **4 flow candidates**
were detected (R10 found 1) over 265 workspace file edges, all top-ranked
walks cli-src → commands → core → … (8 modules). Outcomes:

- **`flow:cli-src-to-core-src-05`: done (3 attempts)** — the page
  "From CLI entry to navigation sinks" cites 24 production anchors
  (`cli.ts#createProgram/run/…`, `safe-io.ts#ALLOWED_DIRS`,
  `navigation.ts#…`), **zero test helpers** (R10's blocker is dead).
  Acceptance criteria, all met: >50% non-test anchors (100%);
  entry/boundary/sink groups each cited; Purpose/Ordered flow/Failure
  markers point to non-test anchors individually; `modules.length` 8 ≥ 3
  with ≥1 workspace edge; `verify` zero issues across 40 pages; zero
  manual edits; accounting persisted.
- 3 flow tasks failed `repair_exhausted` within the default 3-slot
  budget: v03 (missing_page_opening → diagram too large → last-slot
  broken_internal_link), v04 (duplicates → diagram too large →
  broken_internal_link), v06 (duplicates ×2 → missing required marker).
  The machinery rejected every invalid candidate — no invalid artifact
  persists; verify is clean. Failure shapes are model-quality residuals
  (diagram budget, duplicate anchors), not contract gaps.

Per the authorized scope the run stops here (no `--only` without separate
authorization). Evidence awaits external review before any commit/push.

## E2E #2 and #3 — completing the corpus (maintainer: no external ceiling; run to completion)

**E2E #2** (fresh copy, `maxRepairAttempts: 5` recorded, no token
ceiling): `aborted` — all 3 failed flows burned 6 slots, and the last 4
attempts on two of them were the SAME `verify_failed [broken_internal_link]`:
the model kept writing the hub link as `../index.md` (resolving to
nonexistent `livewiki/index.md`), generalizing from the `../<moduleId>.md`
module links. Diagnosis: prompt ambiguity in the Related-pages rule —
systematic, not model flakiness. Fix applied with regression tests:
`FLOW_PAGE_PROMPT_RULES` now pins the hub link to the bare `[How it
works](index.md)` target (NEVER `../index.md` et al.), the diagram rule
gained module-granularity guidance for walks >6 modules, and the repair
prompt gained a `verify_failed` ACTION with the bare-target directive
(core 963 passed).

**E2E #3** (fresh copy, `maxRepairAttempts: 5` recorded): **all 4 flow
tasks done** — the link fix converged. One stage-4 benchmark module
(`rerun-clean-v18`) failed with the known nondeterministic shapes
(`todo_marker_present`, `model_invented_manual`, `unclosed_markdown` —
same family as v16/v8 in R10, recovered by one `--only`, 31,461 tokens,
disclosed). The final **raw** corpus has 43 Markdown pages + 15 Mermaid
files, `verify` zero issues, 344/344 resolved Markdown links, and zero exact
duplicate-paragraph groups under the comparison audit. The **masked evaluation
corpus** has 43 Markdown + 15 Mermaid, 341/341 resolved links, and 1 duplicate
group (Navigate boilerplate). The full command used 995,922 tokens; recovery
added 31,461, for 1,027,383 tokens in the final corpus checkpoint.

This is a complete corpus after recovery, not a successful autonomous E2E.
Because the full command did not finish every stage-4 task and recovery used
`--only`, E2E #3 does not satisfy the revision-5/6 acceptance bar. The
defaults-vs-overrides caveat also stands (`maxRepairAttempts: 2` was
insufficient for 3 of 4 flows in E2E #1).

Checkpoint-authoritative accounting for the full engineering series:

| Run | Initial/full-command tokens | Later recovery | Checkpoint total |
|---|---:|---:|---:|
| E2E #1 (`maxRepairAttempts: 2`) | 1,117,150 | 236,011 | 1,353,161 |
| E2E #2 (`maxRepairAttempts: 5`) | 1,222,185 | 0 | 1,222,185 |
| E2E #3 (`maxRepairAttempts: 5`) | 995,922 | 31,461 | 1,027,383 |
| **Engineering series** |  |  | **3,602,729** |

**Blind evaluation R10.1 vs OpenWiki R1** (same frozen control, same
rubric, fresh immutable dirs, claude + codex): running at this writing;
results consolidated below when they land.

## Blind evaluation R10.1 results (2026-07-19)

Corpus B = the completed R10.1 corpus (43 pages, 15 Mermaid, 4 flows,
verify zero issues). Corpus A = the byte-identical frozen OpenWiki R1
control. Results: `C:\tmp\livewiki-e2e\eval-r101-{claude,codex}\`.

| Dimension (weight) | OpenWiki (claude / codex) | R10.1 (claude / codex) | R10 (claude / codex) |
|---|---:|---:|---:|
| Factual accuracy (35%) | 9 / 5 | 8 / 7 | 9 / 9 |
| Useful coverage (25%) | 8 / 8 | 6 / 7 | 7 / 8 |
| Navigation (20%) | 9 / 9 | 5 / 6 | 5 / 6 |
| Clarity (10%) | 8 / 8 | 6 / 5 | 6 / 6 |
| Traceability (10%) | 9 / 8 | 8 / 9 | 9 / 10 |
| **Weighted total** | 8.65 / 7.15 | 6.70 / 6.80 | 7.40 / 8.0 |

**Methodological caveat (the important finding):** Corpus A is
byte-identical across rounds, yet the same evaluators scored it 7.65 →
8.65 (claude) and 7.8 → 7.15 (codex) between the R10 and R10.1 rounds.
The control movement is large enough to confound differences of this order,
but it does not exceed every corpus-score movement or every current pairwise
gap. With one run per evaluator and no measured variance, these pairwise
numbers cannot establish regression or improvement of our corpus. The
blind-pair instrument, as currently run, has reached its resolution limit.

What is sufficiently consistent across the available evaluations to guide
product work:

1. **Accuracy and traceability are strengths, but no uniform lead is
   established.** R10 favored LiveWiki on both dimensions; R10.1 codex favored
   LiveWiki while R10.1 claude favored OpenWiki. The evaluators also used
   materially different adversarial-claim semantics: claude explicitly says
   several `false` rows were inverted negative controls, not false statements
   found in the corpus. Their raw false-claim counts must not be pooled.
2. **Navigation is the structural gap** (R10/R10.1 LiveWiki scores 5–6): the
   source-chunk module organization (`core-src-NN` pages + hub) loses to
   OpenWiki's concept-named pages on conceptual tasks, and evaluators
   call it structural, not incidental (claude R10.1: "tasks.md's own
   titles mirror the same source-chunk grouping").
3. **Clarity still trails** (6,6,6,5): repetitive page template, dense
   code-walkthrough prose, and the 16 benchmark-harness pages as
   low-differentiation volume (a content decision, not a duplication
   defect — exact-duplicate groups are 1).
4. Flow artifacts get used when they exist (codex R10: the flow page was
   the shortest successful path for the CLI task) — the semantic layer
   works; there are just too few concept-level destinations.

**Token reality**: the final R10.1 corpus checkpoint contains 995,922 + 31,461
= 1,027,383 tokens versus OpenWiki R1's 10,520,529 — **9.8%**. This is a
corpus-completion cost, not a first-pass autonomous-run cost. The three-run
engineering/debug series cost 3,602,729 tokens in total.

**Decision this evidence supports**: stop iterating the blind-pair
benchmark with this instrument and do the R11-A work it keeps naming —
concept-level topic pages (the batch pipeline, provider configuration,
safety, export contracts) so conceptual questions have a one-hop
destination, plus the auxiliary-prominence policy. That is the
presentation lot, with its own design contract, after maintainer review.
Proposed plan: `docs/tasks/2026-07-20-r11-a-concept-navigation/PLAN.md`.
