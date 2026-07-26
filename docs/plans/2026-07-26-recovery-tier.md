# Recovery tier — surgical repair call + relaxed completion round

Date: 2026-07-26
Status: DRAFT for maintainer review. Not implemented. Trigger: Etapa 3 E2E
runs #1–#4 (MoneyPrinterTurbo-Plus, MiniMax-M3) and the maintainer directive
of 2026-07-26.

## Maintainer directive (the contract this design must satisfy)

- Like OpenWiki, we cannot accept failures. Everything must be documented.
- Failing to document is a grave failure, acceptable only with a palliative
  (e.g. reduced documentation at that point, clearly marked).
- A full strict sweep runs first; at the end, whatever failed gets a
  mini-round under a more relaxed contract. The tool must never "blame the
  LLM provider" and leave a hole.

## What the five runs taught us

Deterministic failure classes (all fixed and individually tested):

| Class | Run | Fix |
|---|---|---|
| Topic budget estimate ≠ generator (fatal throw) | #1 | `a64ad2c` (policy) + `0b5fb24` (exact estimate) |
| Mechanical dedup strips required-section coverage | #2, #3 | `ec8de58` |
| Repair directive off-target for section prose | #3 | `fc26de1` |
| Bare-word TODO/TBD ban flags legitimate prose | #4 | Fix D (2026-07-26) |

Residual class — **model flakiness under the strict contract**: the same
task fails 3× in one run and passes first-try in another
(`flow:root-01-to-models`, run #4 vs. its `--only` rerun). No deterministic
defect remained to fix; the evidence points at variance in model output
against a strict page contract. Today each such failure consumes 2 extra
FULL-context repair calls (20–25k tokens each) and can still end
`repair_exhausted` — and repair attempts sometimes break previously-valid
sections (observed in runs #3 and #4).

## Component 1 — surgical section-scoped repair call

Replace the full-context repair prompt for **prose-level** codes with a
small, focused second call:

- Prompt carries: the failed page, the exact validation errors (codes +
  neutralized offending excerpts), and ONLY the evidence slice for the
  named sections (not the whole module/flow context). Target ~5–10k tokens
  instead of 20–25k.
- Contract: "fix ONLY the named sections; every other byte of the page
  must be preserved."
- **Deterministic cascade guard**: after the call, the orchestrator diffs
  the returned page against the failed one section-by-section (we already
  parse sections). If any NON-target section changed, the attempt is
  rejected without touching the page (no LLM-caused regressions, ever).
- Applicable codes (initial set): `missing_page_opening` (section-level),
  `todo_marker_present`, `empty_section`, `broken_internal_link`,
  `anchor_missing_in_required_section`. Structural codes
  (`duplicate_anchor`, frontmatter sync) stay with the mechanical repair —
  it is free and exact.
- Full-context repair remains the fallback for codes that are inherently
  page-wide (e.g. `empty_body`, truncated/incomplete generation).

## Component 2 — relaxed completion round

After the strict sweep (stages 4–5 + repairs + surgical calls), any task
still failed gets ONE final attempt under a relaxed presentation contract:

- Relaxed (presentation only): bullet lists accepted where prose paragraphs
  were required; reduced required-section set for flow/topic pages.
- **Never relaxed**: anchors and the closed key list (the
  anti-hallucination promise), verify's anchor checks, ownership rules,
  transactional writes, exact token accounting.
- The resulting page is visibly marked as degraded: frontmatter flag (e.g.
  `quality: degraded`) + a reader-visible notice at the top of the page.
- Degraded pages are first-class debt: `status` reports them, and a later
  `update`/batch run retries them under the STRICT contract when their
  source changes (degraded is a floor, not a destination).

## Non-negotiables

- Zero unverified content: every page — strict, surgically repaired, or
  degraded — passes the same anchor verification before it is written.
- No retry storms: strict attempts + surgical calls + one relaxed attempt
  are a hard, bounded budget per task; the circuit breaker still applies.
- Accounting stays exact: every extra call lands in `usageHistory` and the
  report, marked by which tier consumed it.

## Open questions for the maintainer

1. Exact relaxed contract per page kind (which sections may collapse to
   bullets; minimum viable flow page).
2. Degraded-marker surface: frontmatter-only vs. also a `status` count and
   a hub badge.
3. Does a degraded page block `completed` (exit 0) or count as its own
   `completed_with_degraded` status? (Recommendation: exit 0 with an
   explicit degraded count in the report — the directive is "never fail to
   document", and degraded pages ARE documented.)
4. Surgical-repair eligibility by code: initial set above, or narrower?

## Out of scope

Provider switching/fallback chains, embedding-based retries, relaxing
anchor verification of any kind, changes to ownership/manual-block rules.
