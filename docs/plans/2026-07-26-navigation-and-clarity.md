# Navigation + clarity lot (post-A/B round 3)

Date: 2026-07-26
Base: `main` @ `dbb3f8f` (pushed; tree clean)
Evidence: blind dual eval round 3 (`/c/tmp/livewiki-e2e/eval-mptp-r8/COMPARISON.md`)
— remaining named gaps: navigation 5-6 vs 8-9, clarity 6 vs 8/9 with "3
duplicate Navigate-boilerplate groups", "several pages repeat 'the supplied
excerpt does not establish X' as a hedge", and tasks.md called a flat link
farm (2-hop paths work; the scannability does not).

## Diagnosis (verified in code)

1. **Navigate footer boilerplate** (`navigation.ts:1044-1064
   buildNavigateBlock`): every module page carries the identical universal
   triple `[Quickstart](quickstart.md) / [Tasks](tasks.md) /
   [Architecture](architecture/overview.md)` — that IS the duplicate-group
   source the audit flags. Page-specific links (Flow/Topics/dependencies)
   are the only ones earning their bytes.
2. **tasks.md flat farm** (`generateTasksPage`,
   navigation.ts:310+): ~30 title-link entries with no grouping. OpenWiki's
   index groups ~6 sections with descriptions; our titles are semantic but
   the page has no scannable structure. Constraint: index pages stay
   title-link-only per entry (R10 dedup finding — no copied sentences).
3. **The hedge is OUR prompt rule** (`prompts.ts:108`): "If the relevant
   source is truncated, say that the excerpt does not establish exhaustive
   behavior." The model obeys — repeatedly, per page, in prose. Honesty
   about coverage is the TOOL's job (the orchestrator knows exactly when a
   module exceeded the fair-share budget), not the model's prose.

## Deliverables (deterministic-first, zero new LLM calls)

### C1 — Navigate footer: page-specific only

Remove the universal triple from `buildNavigateBlock` (it lives in the
quickstart already); keep Flow/Topic/dependency lines. Regeneration flows
through the existing `updateModuleNavigateBlocks` markers
(`NAV_START`/`NAV_END`), so already-generated pages update idempotently on
the next regen. Expected effect: the audit's 3 duplicate-paragraph groups
disappear.

### C2 — tasks.md: deterministic concern grouping

In `generateTasksPage`, group `## Implementation reference` entries under
deterministic group headings derived from the modules' common directory
semantics (`commonDirectory` + `humanizeSegments` already exist in
navigation.ts): one heading per directory/role cluster (e.g. "Api
surface", "Services", "Webui", "Data and configuration", "Testing") with a
sorted, deterministic order; entries remain title-link-only (R10 dedup
intact). Singleton groups fold into the nearest sensible bucket rather
than fragmenting; grouping rule documented in code.

### C3 — Coverage honesty moves from model prose to a deterministic note

- `prompts.ts:108`: replace the hedge instruction with an anti-meta rule:
  "Document only what the visible evidence establishes; never narrate what
  the excerpt does or does not contain." (Module prompts; check flow/topic
  rule texts for the same hedge and align them.)
- Deterministic coverage note: when a module's source exceeds the fair-
  share budget (computed at navigate-update time as
  `sum(file sizes of module.paths) > charBudget` — no plumbing through the
  task), `updateModuleNavigateBlocks` appends ONE fixed line to the
  Navigate block, e.g.
  `> Coverage note: the module source exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.`
  Uniform phrasing, added by the tool, unaffected by validation (the
  Navigate block is already deterministic).

## Files to touch

1. `packages/core/src/navigation.ts`: `buildNavigateBlock` (C1),
   `generateTasksPage` grouping (C2), coverage note in
   `updateModuleNavigateBlocks` (C3) + `moduleSourceExceedsBudget` helper.
   Tests in `navigation.test.ts` (block without universal links, grouping
   order/singletons, note present iff over budget).
2. `packages/core/src/prompts.ts`: hedge rule replaced by anti-meta rule
   (module + any flow/topic twin). Tests in `prompts.test.ts` (hedge text
   absent, anti-meta present).
3. Stub-E2E: one existing CLI batch suite asserts the new Navigate block
   shape on generated pages.
4. SPEC.md: Navigate block contract, tasks.md grouping rule, coverage
   note, prompt rule change. AGENTS.md: live-state + where-to-touch.

## Non-goals

No copied responsibility sentences into tasks.md (R10 dedup); no changes
to anchors/verify/recovery tier; no false-claims investigation (separate
lot, next); no paid re-run inside this lot (measurement = run #9 +
re-eval round 4, separate authorization).

## Validation gate

`pnpm -r build && pnpm -r test` green; zero paid calls; tree for review
before commit.
