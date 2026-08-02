# PROJECT_LOG — livewiki

> Chronological work log. Scope: durable product work on the livewiki
> monorepo. Live state: `AGENTS.md` §"Live state". Architecture:
> `docs/PROJECT_CONTEXT.md`. Behavior: `SPEC.md`.

---

### 2026-08-01 — Market-scan roadmap lots 7–14, first real incremental loop, and cost accounting

**Scope (1 day, 2 commits, both pushed):**

- **Market research round** (`docs/market-research.md`, 5 dated sections):
  speed-focused scan (DeepWiki 5–10 min/repo, Mintlify plan-first + parallel
  writers 70→45 min, DocBot per-PR on a cheap model, RepoAgent multi-thread),
  Wiki.js (adjacent platform, possible export target, AGPL caution),
  Graphify+CodeGraph (graph-speed analysis; runtime dependency stays
  rejected), and the Codec8 correction (r/SideProject one-shot generator;
  thread insights: sync is the real pain, OG previews, README as output).
  Headline: our batch was the only fully-sequential pipeline — wall-clock,
  not quality or cost, was the weakest axis.
- **Lot 7–11** (`dac874d`): 7 `batchConcurrency` (stage-4 worker pool,
  breaker/rollback stop-new-dispatch + drain, Retry-After); 8 `calls.confidence`
  schema v7 (extraction-tagged, resolution never changes it — a coordinator
  fix removed the downgrade that killed the cross-module tie-break);
  9 community cross-check (deterministic label propagation, diagnostic-only
  stage-2 report); 10 viewer `new`/`updated` badges from one bounded git log
  (never mtime/index.db; byte-stable vs newest commit) + static OG meta;
  11 `export readme` (deterministic, rule-#6 create/replace-block/REFUSE,
  safe-io `allowReadme` mirroring `allowPointer`).
- **First real incremental loop (field test on the maintainer's upgraded
  MPTP repo)**: detection worked end-to-end with zero tokens, but ~50% of
  the initial 956 `changed` debt was PHANTOM — CRLF→LF checkout conversion
  (`core.autocrlf=true`; git index is LF-canonical) — and 73 `moved` pairs
  were false rewrites onto provider twins that kept the OLD implementation
  (an anti-hallucination hole verify cannot see). Fixes shipped in the same
  commit as items **12** (EOL-insensitive hashing + one-run silent migration
  window, per-file dual-direction + per-symbol re-expanded slice) and **13**
  (twin-move guard: a move requires zero same-name survivors). A/B on the
  real corpus: changed 956→84 (the genuine drift), moved 73→0, second run
  zero debt, verify clean.
- **Update paid in-session (zero provider cost)**: 84/84 changed resolved,
  114 undocumented → 0, 13 pages updated (material_cache, presets,
  task_artifacts, elevenlabs hardening, config-save atomicity, webui
  presets panel), verify OK. Truth audit (in-session, claim-by-claim vs
  code): **77/77 code-verifiable claims TRUE**, 0 false, 3 trivial
  imprecisions. Key clarity for positioning: writing ALWAYS needs an LLM —
  the product's line is "zero tokens to DETECT, minimal tokens to WRITE".
- **Item 14** (`a7da50e`): in-session cost accounting — `debt_resolved` +
  `batch_run` event kinds in `update_metrics.json` (v1-compatible), every
  path records (CLI update, MCP write_doc/resolve_debt, batch finalizeRun
  with drain-before-return), `livewiki status` Activity block (totals +
  last 5 timestamped events). Live demo on the corpus showed the packages
  AND honestly exposed that the manual payment went unmeasured — the gap
  the item closes. Item **15** (viewer activity dashboard: history, tokens
  per period, debt burndown, time-to-document) registered for later.

**Sensitive points for future agents:**

- `pnpm --filter X test -- src/file.test.ts` passes a literal `--` to vitest
  and runs the WHOLE suite; use `npx vitest run <files>` for targeted runs.
- Subagent parallel editing works if file scopes are disjoint and mid-flight
  `git status` audits run; two agents blamed "the reviewer" for failures our
  own item 8 caused — always diff before believing a collision claim.
- The `batch-review.test.ts` 5s-timeout flake appeared twice under 3-suite
  parallel load; green isolated. Pre-existing class, now slightly slower
  after the item-9 hoist — watch it.
- The MPTP test corpus (`/c/tmp/livewiki-e2e/incremental-mptp-2026-08-01/`)
  is scratch with an updated wiki; the maintainer's real MPTP repo has no
  `livewiki/` of its own yet.

**Validation:** gate green at every commit (final: core 1598, CLI 118,
MCP 56; batch-review flake isolated-green). Zero paid provider calls all day.

---



### 2026-07-25/28 — Etapa 3 acceptance, A/B parity drive, Phase 7 viewer, and the onboarding backlog

**Scope (4 days, 31 commits, all pushed):**

- **Etapa 3 acceptance E2E** (MoneyPrinterTurbo-Plus clone, MiniMax-M3 via
  openai-compat + token proxy, OpenWiki-identical shape): run #1 aborted on a
  fatal topic-budget throw and run #2 completed_with_failures — the maintainer
  ruled `completed_with_failures` NOT acceptable, starting a fix-and-measure
  discipline: each run surfaces one failure class, each class gets one
  deterministic fix with individual tests. Run #5 passed: **40/40, exit 0,
  verify 45 pages zero issues**.
- **Fixes from the E2E loop**: context-build exception as task failure,
  dot-prefixed wiki pages visible to all three walkers, exact topic
  source-budget estimate (shared span helper), coverage-preserving flow dedup,
  section-level prose repair directive, TODO/TBD ban narrowed to the model's
  own placeholder forms.
- **Recovery tier** (maintainer directive "never fail to document; palliative
  beats hole"): surgical section-scoped repair with an anti-cascade splice
  guard, and one relaxed completion round (reduced presentation contract,
  anchors/verify strict) marking pages `quality: degraded` and keeping
  exit 0. Validated live in run #6 (root-02 degraded instead of failed).
- **A/B measurement cycle** (6 blind dual-eval rounds vs frozen OpenWiki,
  claude+codex, masked corpora, stable control): weighted gap
  Δ1.00/1.60 → **Δ0.40/0.45** at ~6–8% of OpenWiki's token cost (13.9M vs
  0.85–1.1M per run). Delivered in that loop: product-first quickstart
  (README orientation + reader digest), concept-topic coverage (spoke-merge,
  concern topics, prose evidence), nav+clarity hardening (page-specific
  footers, grouped tasks.md, deterministic coverage note), inventory-authority
  prompt rule, flow-candidate overlap cap, branch-precision rule, page-named
  degraded notices, and the concern-topic refine pin. Local-evidence rule
  recorded: internal test artifacts never travel to the remote.
- **Phase 6**: all three export targets validated on a real corpus
  (generic/github-wiki/gitlab-wiki — flat links, mermaid export, idempotent).
- **Phase 7 viewer** shipped and polished: self-contained static site
  (build-time marked, offline search-index.js, vendored mermaid), two
  data-only templates, then the maintainer-ordered UX pass (active sidebar,
  repo brand, light/dark, collapsible groups, natural diagram sizing, inline
  flow mermaid) and a design pass (offline font pairing, real type scale,
  tint blockquotes, verticalized edge-less class diagrams via transparent-stroke
  chains).
- **Onboarding backlog delivered**: identifier-aware FTS5 search (two-table),
  `status --diff` pre-commit preview (read-only), change-impact context
  (CLI+MCP), index freshness (`status` stale line) + MCP fs.watch debounce
  sync, and `livewiki install` — agent auto-detection with merge adapters for
  **13 agents** (registry v2), pointer still opt-in.

**Sensitive points for future agents:**

- The `git add -A -- docs/` incident (2026-07-28): it staged the LOCAL
  benchmark evidence into a commit; caught before push, fixed with
  reset --soft + staged-restore. NEVER use `-A` on evidence-bearing paths —
  `docs/benchmarks/*rerun*`, `docs/tasks/2026-07-25-etapa-3-e2e/`,
  `docs/handoffs/2026-07-23-*` stay untracked forever.
- minimax/mmx CLI is a provider, not an MCP host (verified: its config holds
  oauth+region only).
- impeccable is a developer-side review tool only — never part of the
  livewiki flow/gate (zero tool dependencies rule).
- Remaining model-precision frontier: voice/subtitle false claims in
  app-services-03 pages (2-4 per eval round, mutating).

**Validation:** full gate green at every commit (final: core 1484, CLI 111,
MCP 54); all E2E acceptance runs and blind evals preserved LOCAL-ONLY.

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

1. Item 15 — viewer activity dashboard (history, tokens per period, debt
   burndown, time-to-document) on top of item 14's accounting base.
2. Cross-platform CI block (deferred by the maintainer to last): macOS
   realpath canonicalization and the workflow smoke step (`livewiki` bin not
   found); the matrix must be green on ubuntu/windows/macos before any
   "cross-platform validated" claim.
3. Backlog #6 — GitHub Actions "docs-debt on merge" template (depends on the
   CI block; same-repo variant can ship first).
4. Beta launch: packaging (npm publish), then real-user feedback decides the
   remaining items (watch-list: CALLS-edge confidence tiers → DONE item 8,
   community detection → DONE item 9, tier-1 language expansion by usage).
5. Optional hardening recorded: batch-review 5s-timeout and CLI E2E load
   flakes (pre-existing, pass isolated; slightly slower after the item-9
   hoist); voice/subtitle precision frontier in app-services-03 pages.

## Backlog

- [ ] #15 Viewer activity dashboard (tokens/history/burndown — item 14 base done)
- [ ] Cross-platform CI green (macOS realpath + smoke step) — deferred to last
- [ ] #6 GitHub Actions "docs-debt on merge" template
- [ ] Beta: npm packaging/publish + launch
- [ ] Watch-list: tier-1 language expansion (usage-driven), git-pinned evidence verification
- [ ] Optional: batch-review/CLI-E2E load-flake hardening
- [ ] Optional: voice/subtitle false-claim frontier (app-services-03 hotspot)
- [x] #14 In-session cost accounting (debt_resolved + batch_run + Activity block)
- [x] #13 Twin-move guard (field-tested: moved 73→0)
- [x] #12 EOL-insensitive hashing + silent migration (field-tested: changed 956→84)
- [x] #11 export readme (rule-#6 contract, allowReadme)
- [x] #10 Viewer freshness badges + OG meta
- [x] #9 Community cross-check (diagnostic-only stage 2)
- [x] #8 CALLS confidence tags (schema v7)
- [x] #7 batchConcurrency (stage-4 worker pool + Retry-After)
- [x] `livewiki install` — 13-agent registry + merge adapters
- [x] Index freshness (status stale) + MCP watcher debounce sync
- [x] Change-impact context (CLI + MCP)
- [x] `status --diff` pre-commit preview
- [x] Identifier-aware FTS5 search
- [x] Phase 7 viewer + UX/design pass
- [x] Phase 6 export targets validated (3/3)
- [x] A/B cycle vs OpenWiki — weighted gap Δ1.0/1.6 → Δ0.40/0.45 at ~6% cost
- [x] Recovery tier (surgical repair + relaxed completion round)
- [x] Etapa 3 acceptance E2E — run #5 exit 0, verify zero issues
- [x] Etapas 1/2a/2b/2c/2d (tier-2 floor, repair contract, rationale, risk, hints)
- [x] R11-A concept-topic layer validated (decision: keep)
- [x] R11-NAV intent-first routes and auxiliary-content de-emphasis
