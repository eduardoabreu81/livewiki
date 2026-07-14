# Lot L — navigation & onboarding investigation (READ-ONLY)

**Date:** 2026-07-14
**Base commit:** `c30258c` (HEAD = origin/main)
**Type:** investigation — NO code changes. The deliverable is a written
specification that will become the frozen contract for the implementation
lot(s).

## Why

The independent v18 quality review verdict: livewiki won on completeness,
factual accuracy, traceability, side effects, and cost — but **OpenWiki
won on human navigation and editorial focus** ("substantially more useful
quickstart"; livewiki's corpus is "implementation-shaped" and weak on
onboarding). The maintainer's bar is a genuinely good product, not a
passing benchmark. This lot defines what "good navigation" means for
livewiki, grounded in the two preserved corpora.

## Inputs (all read-only)

- livewiki corpus: `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/livewiki/`
- OpenWiki corpus: `docs/benchmarks/2026-07-10-minimax-m3/raw/openwiki/`
- The review: `docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`
  (§3 structure/navigability, §6 weaknesses)
- Generation machinery (to classify findings as prompt-work vs
  deterministic-work):
  - `packages/core/src/prompts.ts` (stage-4 page structure instructions)
  - `packages/core/src/init.ts` (deterministic quickstart +
    architecture/overview generation)
  - `packages/core/src/modules.ts` (module→page mapping — pages are
    module-shaped because modules are directory-shaped)
- Constraints that any proposal MUST respect: SPEC.md (anchors, closed
  list, verify, exactly-once markers), VISION.md (agent-first; out of
  designed scope), AGENTS.md.

## Questions the specification must answer

1. **Reader model.** Who navigates a livewiki wiki and with what intents?
   At minimum: (a) an agent answering "how does X work" (today's primary
   consumer — already well served by anchors/search), (b) a human
   onboarding to the repo, (c) a human doing a task ("add a provider",
   "run the batch", "fix a failing verify"). For each: entry point and
   path through the corpus today vs ideal.
2. **Quickstart.** Concretely, what makes OpenWiki's quickstart more
   useful? Quote both. Specify the target quickstart: task-oriented
   sections ("Document a repo", "Query the wiki from an agent", "Pay
   documentation debt"), not a module list. Decide what is deterministic
   (init.ts template over indexed facts) vs LLM-generated — bias toward
   deterministic wherever facts suffice (cheaper, never hallucinates,
   never ages).
3. **Page internal structure.** What should a module page open with?
   (Today: implementation sections. Candidate: a "when do you touch this"
   / task-context opening.) What cross-links should every page carry?
   Any change must keep the closed-list/marker rules intact.
4. **Corpus-level navigation.** Is architecture/overview.md doing its job
   as a hub? What is missing between quickstart (top) and module pages
   (bottom) — e.g., a task-index page? If a new deterministic page type is
   proposed, specify its SPEC path, owner, and how verify treats it.
5. **Module naming/shape.** Are page identities like `core-src-03`
   acceptable for humans? Propose naming improvements achievable in
   stage-2/heuristics WITHOUT weakening the exact-partition rules (e.g.,
   human-meaningful module titles in frontmatter while keeping stable
   ids). Note: NO changes to key/anchor formats.
6. **Prompt vs deterministic split.** For every recommendation, label:
   PROMPT (stage-4 text), DETERMINISTIC (init.ts/modules.ts code), or
   POST-MVP (viewer/Phase 7 territory — park it). Recommendations must be
   provider-agnostic and benchmark-agnostic.
7. **Factual-precision rider.** The review found signature-level
   misdescriptions (finding L3) and an omitted exception branch (L6).
   Evaluate: should stage-4 prompts REQUIRE that any function-behavior
   claim quote the literal signature from the symbols table? Specify the
   exact rule and its validator implications (if any — prefer none).
8. **Acceptance criteria.** For the implementation lot: how will we know
   navigation improved? Define concrete, checkable criteria (e.g.,
   quickstart answers the 3 reader-model tasks each within one link; every
   module page opens with task context; zero regression on verify/anchor
   gates), NOT vibes.

## Output

Write IN ENGLISH to:
  `docs/tasks/2026-07-14-navigation-investigation/NAVIGATION-SPEC.md`
Leave it untracked; the lead reviews it and freezes the implementation
contract from it.

Structure: reader model → evidence (quoted, with file paths, both
corpora) → per-question findings → recommendations table (each row:
recommendation, PROMPT/DETERMINISTIC/POST-MVP, effort S/M/L, risk to
existing gates) → acceptance criteria → open questions for the
maintainer.

## Hard rules

READ-ONLY: no product code changes, no test changes, no SPEC/VISION/
AGENTS edits, nothing under `docs/benchmarks/` modified. No paid API
calls. No commit, no push. English. The only file you create is
NAVIGATION-SPEC.md.
