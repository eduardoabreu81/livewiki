# PROJECT_LOG — livewiki

> Chronological work log. Scope: durable product work on the livewiki
> monorepo. Live state: `AGENTS.md` §"Live state". Architecture:
> `docs/PROJECT_CONTEXT.md`. Behavior: `SPEC.md`.

---

### 2026-07-20 — R11-NAV intent-first deterministic navigation

**Decision and scope:**

- The maintainer approved the bounded R11-NAV subset for implementation.
  Concept-topic synthesis remains deferred under the R11-A proposal.
- No LLM task, page kind, configuration key, database table, dependency, MCP
  tool, provider call, benchmark run, commit, or push was added.

**Implementation:**

- Quickstart now starts with `## Work by intent` and links directly to every
  accepted flow page, the complete flow hub, product work, architecture, and
  the auxiliary hub when applicable.
- Tasks now lists end-to-end flows and product modules; fixture, tooling,
  benchmark, and repository-doc modules are represented by one auxiliary route.
- Added deterministic `livewiki/auxiliary/index.md`, grouped by auxiliary role,
  with existence-gated page links and conservative human/mixed/unknown-owner
  preservation.
- Architecture overview retains detailed product cards and replaces auxiliary
  cards with a count plus one inventory link.
- Protected auxiliary-hub skips are visible in init/batch human and JSON
  results and remain non-persistent.

**Validation:**

- `pnpm -r build` passed.
- `pnpm -r test` passed: core 966, CLI 86, MCP 21; core reported 12 expected
  Windows symlink skips.
- Existing identity coverage was adapted to assert that product Tasks plus the
  auxiliary hub still cover all five stable module IDs in the collision E2E.
- The body remains uncommitted and unpushed. Paid autonomous acceptance still
  requires explicit at-the-moment authorization.

---

### 2026-07-20 — R10.1 evidence reconciliation and R11-A planning

**Evidence corrections:**

- The R10.1 implementation is complete and the deterministic suites are green,
  but the strict paid-E2E acceptance remains open. E2E #3 generated all four
  selected flow pages, then required one disclosed `--only` recovery for a
  failed stage-4 auxiliary module. The resulting corpus is complete; the run
  was not autonomous and did not meet the revision-5/6 requirement of a full
  exit-0 run with no recovery.
- The final Claude score is OpenWiki **8.65** versus R10.1 **6.70**, following
  the evaluator's explicit recomputation. The earlier consolidated 6.65 score
  and reversed traceability row were transcription errors. Codex remains
  OpenWiki **7.15** versus R10.1 **6.80**.
- The byte-identical control moved materially between evaluation rounds. This
  is enough to prevent regression/improvement claims from one run per
  evaluator, but it does not exceed every corpus movement or every current
  pairwise gap. The durable conclusion is instrument instability at the scale
  of the measured margins, not a universal numeric inequality.
- Adversarial false-claim counts are not pooled across evaluators: Claude used
  several deliberately inverted negative-control claims and explicitly stated
  that they were not false assertions found in either corpus.
- Raw final corpus: 43 Markdown pages + 15 Mermaid files, 344/344 resolved
  Markdown links, zero exact duplicate-paragraph groups. Masked evaluation
  corpus: 43 Markdown + 15 Mermaid, 341/341 resolved links, one duplicate
  Navigate group.
- Checkpoint totals: E2E #1 1,353,161 tokens including later retries; E2E #2
  1,222,185; E2E #3/final corpus 1,027,383 including recovery. Full engineering
  series: **3,602,729 tokens**. The final corpus is 9.8% of OpenWiki R1's token
  total.

**Planning decision:**

- Stop blind-pair benchmark iteration until the instrument records evaluator
  identity/version/settings and uses repeated measurements or a more
  mechanical rubric.
- The next proposed product lot is R11-A: concept-level topic pages,
  intent-first routes, and auxiliary-content de-emphasis. Its plan is at
  `docs/tasks/2026-07-20-r11-a-concept-navigation/PLAN.md`.
- R11-A is a proposal only. It does not authorize implementation, paid calls,
  commit, or push.

---

### 2026-07-19 — Semantic product-flow implementation and R10/R10.1 evidence

**Features:**

- Implemented batch stage 5 end to end: deterministic flow-candidate
  detection, `flow:<slug>` tasks, inline-diagram extraction, the
  `flows/index.md` hub, gated links, and duplicate-free task indexes.
- Implemented the R10.1 acceptance fixes: transactional page+diagram writes,
  any-severity stage-5 artifact gating, human/mixed hub ownership protection,
  D1/D2/D3 flow validation, combined `flowSignals` negation handling,
  `persistenceImportPatterns`, internal workspace import resolution, tiered
  production-first seeds, deterministic skips, fair per-root enumeration, and
  module-sharing centrality.

**Defects fixed with regression coverage:**

- Preset-only batch configuration was incorrectly rejected.
- Inline frontmatter lists such as `[a, b]` were parsed as one opaque string.
- The stage-5 repair prompt contradicted the approved upper-bound anchor rule.
- Workspace `rootDir`/`outDir` values leaked across packages.
- Anchor groups could exceed the truncated closed list.
- The flow prompt allowed the hub link to become `../index.md`; it now requires
  the bare `index.md` target, gives module-granularity diagram guidance for long
  walks, and includes an exact `verify_failed` repair action.

**Validation state:**

- Core 963 passed / 12 Windows symlink skips; CLI 84; MCP 21; recursive build
  clean at the recorded implementation checkpoint.
- R10 on frozen source `895d49e`: complete corpus, verify zero, one duplicate
  group, and a descriptive split result in the first blind comparison.
- R10.1 E2E #1 completed with failures; E2E #2 exposed the systematic hub-link
  prompt defect and aborted; E2E #3 generated all four flows and produced the
  final comparison corpus after one disclosed stage-4 `--only` recovery.
- No public product-winner, regression, improvement, cross-platform, or
  autonomous-acceptance claim is supported by this evidence.

**Settled implementation decisions:**

- A flow closed list is an upper bound: cite only used keys, with every cited
  key present exactly once on each required surface.
- `tasks.md` and `flows/index.md` contain title+link entries, not copied prose.
- `maxRepairAttempts: 2` was insufficient for the observed long walks;
  `maxRepairAttempts: 5` was tested, but the product default does not change
  without a separate reviewed decision.
- A human or mixed flows hub is skipped conservatively and reported.
- The strict R10.1 acceptance bar remains a complete exit-0 run with every
  stage-4 task and selected flow done, no `repair_exhausted`, no `--only`, and
  no manual edit.

**Working-tree state:**

- The complete R10/R10.1 body remains uncommitted and unpushed pending
  maintainer review.
- Raw E2E and evaluation artifacts remain outside the repository under
  `C:\tmp\livewiki-src-r10-3` and `C:\tmp\livewiki-e2e\eval-r101-*`.
- Untracked benchmark-v21 evidence is protected and must not be reverted or
  swept into an unrelated commit.

---

## Next steps

1. Review the combined uncommitted R10/R10.1 + R11-NAV body.
2. Decide whether to authorize one fresh, full paid acceptance E2E. If
   authorized, it is one attempt with no `--only` recovery and no rerun-to-green
   loop; a failure is recorded as a reliability result.
3. Decide whether the implementation may be committed after strict
   acceptance, or with an explicit maintainer waiver that records the known
   autonomous-run gap.
4. Launch the beta after the accepted local gate; use real navigation feedback
   to decide whether the deferred R11-A topic layer is warranted.
5. Only after local product flows close: return to cross-platform CI and then
   Phase 7.

## Backlog

- [ ] Maintainer review of the R10.1 evidence reconciliation
- [ ] R10.1 autonomous paid-E2E acceptance, or explicit recorded waiver
- [ ] Post-launch decision on the deferred R11-A concept-topic proposal
- [x] R11-NAV intent-first routes and auxiliary-content de-emphasis
- [ ] Repeated/mechanical blind-evaluation instrument
- [ ] Commit/push of the R10/R10.1 body after review
- [ ] Cross-platform matrix green after local product flows
- [ ] Phase 7 local viewer and templates
- [x] Semantic product-flow layer S1–S5 implemented
- [x] R10.1 deterministic acceptance fixes implemented
- [x] Complete R10 and R10.1 comparison corpora produced
- [x] Structural gap identified: concept-level navigation and auxiliary noise
