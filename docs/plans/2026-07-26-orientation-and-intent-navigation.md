# Product orientation + intent navigation (post-A/B lot)

Date: 2026-07-26
Base: `main` @ `dff180c` (pushed; tree clean)
Evidence: blind dual eval (`/c/tmp/livewiki-e2e/eval-mptp/COMPARISON.md`) —
OpenWiki 7.50/8.20 vs LiveWiki 6.50/6.60 weighted; decisive gap navigation
(+4 both evaluators) + clarity; root cause named identically by both:
directory-mirror pages, 3+ hops, and "the corpus never states the product's
purpose". Traceability (9×8), cost (14.4×), and verified anchors are ours.

## Diagnosis (verified in code + artifacts)

1. **Our quickstart is tool-meta, not product-first**
   (`navigation.ts:264-307`): it opens with "Use this wiki to choose a
   task…" and documents the livewiki workflow. It NEVER says what the
   documented product is. OpenWiki's quickstart opens with a product-purpose
   paragraph + intent links + fastest local path. This is the single
   biggest, cheapest gap.
2. **Concept coverage too sparse**: the topic planner
   (`clusterModulesByImportGraph`, topics.ts:487-542) builds components of
   the PRODUCT-only import graph and drops isolated singletons. Hub-and-
   spoke repos (MPTP: siblings services, shared utils) produce one viable
   cluster → 1 topic page vs OpenWiki's concept set (architecture,
   integrations, operations, testing, workflows). The named absences
   (deployment/Docker, orientation) map to concern GROUPS, not import
   clusters.

## Scope of this lot

Two bounded deliverables, deterministic-first, zero new LLM calls:

### D1 — Product-orientation block in the quickstart

- New `packages/core/src/orientation.ts`:
  `extractRepoOrientation(absRoot)` →
  `{ purpose: string | null, surfaces: string[], readmePath: string | null }`.
  - `purpose`: first meaningful prose paragraph of the primary README
    (`README.md`, then `README.en.md`, then any `README*.{md,markdown}`),
    skipping HTML blocks, badge/image lines, headings, and language
    switchers; bounded to ~600 chars, sentence-clipped.
  - `surfaces`: deterministic entry-point evidence — `main.py`, `manage.py`,
    `package.json` `bin`/`main`, `Dockerfile*`, `pyproject.toml`,
    `go.mod`, `Cargo.toml` (presence → one-line hints), ordered.
  - No README → `purpose: null` (block degrades to surfaces only; never
    invents text).
- `generateQuickstart` (navigation.ts) gains the block as the FIRST
  section after H1:
  `## What this repository is` — purpose paragraph (marked "from the
  repository README" for provenance), surfaces bullets, and a pointer to
  the fastest local path section of the README when one exists. The
  tool-meta sections (`Document a repo`, `Query the wiki`, `Pay debt`)
  move AFTER the product sections.
- Regenerated both in `init` (base flow) and at batch end (same call
  sites that already regenerate the quickstart).

### D2 — Concept coverage: planner fallback + concern-grouped topics

- **Spoke-merge fallback** in `clusterModulesByImportGraph`: isolated
  product singletons currently dropped (topics.ts:523-527) are instead
  grouped by shared auxiliary import-neighbors (spoke-sharing); any
  remainder forms ONE "Product overview" cluster. Bounded by `maxTopics`;
  ordering stays deterministic (sorted ids).
- **Concern-grouped topic candidates** (new, deterministic, high
  precision only), each producing at most one candidate through the SAME
  topic-task machinery (closed key list, validation, transactional write):
  - `deployment` — `Dockerfile*`, `docker-compose*`, `*.bat`, `*.ps1`,
    `scripts/`, `deploy/`;
  - `testing` — fixture-role modules (existing `PathRole` classification).
  A concern group with zero anchors produces no candidate (never a stub).
  Config: `concernTopics` (boolean, default true) — 4+1 touch points.
- No change to import-cluster topics themselves.

### Explicit non-goals

No LLM orientation synthesis (README prose is human-written and free;
revisit only if real repos show READMEs are unusable); no rewrite of
module pages or their titles (Lot N/R11-NAV already cover semantic titles
and intent routes); no new validation codes; no changes to verify,
anchors, or the recovery tier; no re-run of the paid E2E inside this lot
(the blind re-eval is a separate, later authorization).

## Files to touch

1. `packages/core/src/orientation.ts` (new) + `orientation.test.ts` (new):
   README shapes (badges+HTML div like MPTP, plain prose, zh-only,
   missing), surface detection, bounds.
2. `packages/core/src/navigation.ts`: quickstart block ordering +
   `generateQuickstart` opts; call sites in `init.ts` / batch regen pass
   the orientation. Tests: existing navigation suite + new cases (block
   present/absent, tool-meta after product sections).
3. `packages/core/src/topics.ts`: spoke-merge fallback + concern-grouped
   candidates (planner-level, deterministic); tests in `topics.test.ts`
   (hub-and-spoke fixture → overview topic; deployment group → candidate;
   empty group → none; `maxTopics` cap respected; determinism).
4. `packages/core/src/config.ts`: `concernTopics` (bool, default true),
   4+1 touch points + `config.test.ts`.
5. Stub-E2E coverage: quickstart contains the orientation block after
   `init --batch` (extend a cli-batch E2E suite), topic count on a
   hub-and-spoke fixture ≥ 2.
6. SPEC.md: quickstart contract (orientation block, section order) +
   topic-planner fallback + concern topics + `concernTopics` key.
   AGENTS.md: live-state entry + where-to-touch bullets.

## Validation gate

`pnpm -r build && pnpm -r test` fully green; zero paid calls; tree back
for maintainer review before commit. Effect measurement: afterwards, ONE
authorized re-run on the MPTP clone + blind re-eval on the same harness
(the only honest way to score navigation/clarity movement).
