# Semantic page slugs (#25) — design

> Status: SUPERSEDED 2026-08-07 by #29
> (`2026-08-07-real-repository-page-units.md`). Closed without shipping:
> the deterministic foundation (`page-slug.ts` + 35 green tests) was built
> and deleted the same day, never wired into a caller. Renaming chunk
> buckets treats a symptom — the defect is
> that the page unit is invented, not that its name is mechanical. A
> semantic name over an arbitrary bucket is worse than `core-src-03.md`,
> which at least announces the slice.
>
> Kept as the record of HOW that was established. Decisions 1–4 (2026-08-04)
> and 5–6 (2026-08-07) are historical. The dry-run below is what made the
> unit defect visible and remains useful evidence; the hazard section
> survives the supersession and is carried into #29.
> Origin: P2 residual (external re-review 2026-08-03), promoted PRE-BETA by
> maintainer decision 2026-08-04. External measurement 2026-08-04 killed
> two of the three original levers and added the rename-first candidate.

## Problem (re-scoped by evidence)

The 2026-08-03 diagnosis ("test files force the split") was wrong; the
binding axis is `maxSymbols: 80` over giant files, so `packages/core/src`
splits into ~11 chunks regardless of tests (#24 closed the test half).
The residual confusion the maintainer named — "core-source particionado
não faz o menor sentido" — decomposes into four concrete surfaces:

1. **IDs and filenames**: `core-src-07.md`, `Module ID: core-src-06`.
2. **Navigation fallback labels**: "Core source — part N of 11" in hubs
   when no page title is used.
3. **Test pages**: "Core Src Tests 01..07" from the deterministic
   auxiliary channel — these never get an LLM title.
4. **Titles leaking the ID**: e.g. "Core Source 03: …" —
   `title_equals_module_id` (Lot N) catches only exact equality.

What is NOT broken: the stage-4 page TITLES are already semantic and
good ("Batch orchestration, status reporting, and graph analysis core").
The content is fine; the NAMES are mechanical.

## Dead levers (measured, do not re-litigate)

- **Import-community chunking** (#9 data): `detectFileCommunities` on
  `packages/core/src` yields ONE 56-file blob (250 internal edges) — the
  "giant component" the `community.ts:15-20` header predicts, and that
  header explicitly PROHIBITS feeding communities back as modules.
- **Raising `maxSymbols`**: larger modules make stage 4 and the module
  diagram contract harder — exactly the failure class fixed with
  `moduleMaxDiagramNodes` on 2026-08-04.
- **LLM refine re-partition**: non-deterministic boundaries break the
  rehearsal/dry-run discipline that caught three defects this week.

## Candidate: deterministic semantic slugs (rename-first)

Page PATHS derive from the page's own semantic title; `Module.id` stays
the internal pipeline identity (tasks, checkpoints, `--only`, edges).
Renaming is a deterministic transformation over content that already
exists — zero paid tokens.

### Two shapes

**A. Slug at write time (forward path).** The stage-4 orchestrator
derives the page path from the accepted artifact's title
(`slugifyTitle`) instead of `livewiki/<module.id>.md`. All deterministic
surfaces regenerate AFTER stage 4 (quickstart, tasks, overview,
Navigate, hubs, class/model diagrams) and stage 5 pages are written
against the final paths, so nothing ever links to the old name.

**B. Migration pass (existing wikis).** A deterministic pass over an
already-generated wiki: for each generated module page, compute the new
slug from its frontmatter title, move the file, and rewrite every link
target across the wiki — including inside LLM-written flow/topic pages
(`owner: generated`, so rewriting is rule-#6-clean). The anchor ledger
treats the move as remove+add (step 7 drops the old page's doc_pages and
anchors; the next ledger run re-upserts them from the new path).
`-tests` pages (deterministic auxiliary channel, no LLM title) derive
from the mirrored product page: `<product-slug>-tests.md` (hyphen —
never a `.tests.md` dot infix, which invites path/extension divergence
across walker, viewer, and export), title "Tests for <product title>" —
keeping pair adjacency in listings.

Recommendation: A for the pipeline + B as a one-time migration. B is the
risk surface and most of the open questions below.

### Open questions the implementation must answer

1. ~~**Slug collisions**~~ → DECIDED (decision 3): lowest `Module.id`
   wins, loser keeps `<id>.md`, collision surfaced as a validation item.
2. ~~**Title drift churn**~~ → DECIDED (decision 2): sticky `slug:` in
   frontmatter; rename only by explicit operator action.
3. **Link rewriting inside LLM-written pages** (flows/topics/understan-
   ding): bounded, exact-target rewrite only (known old paths), never
   fuzzy. Ownership: only `owner: generated` pages; human/mixed links
   are preserved and reported (rule #6).
4. **Internal references beyond links**: flow frontmatter `modules:`
   lists module IDs (not paths) — unaffected. `## Navigate` blocks and
   quickstart/tasks/overview regenerate deterministically — unaffected
   after A. The viewer sidebar, export targets, and MCP search reindex
   consume paths — must re-verify each.
5. **Checkpoints and `--only`**: tasks target `Module.id`, and the page
   path becomes derived state. `--only core-src-07` must keep working —
   the task knows its module; the current slug comes from the pinned
   frontmatter of the existing page (falling back to deriving it from
   the accepted title for a first write).
6. **What renames first**: pilot on the dogfood wiki (this repo) with a
   dry-run listing (same discipline as the stale-cleanup dry-run that
   caught the refine/CLI/budget defects: preview before executing).

## Decisions taken (maintainer + external review, 2026-08-04)

1. **Migration scope: MOVE, never regenerate.** The decisive argument:
   the prose was bought today for 731k tokens and passed verify at 58
   pages / zero issues — regenerating would throw the entire run away
   for equivalent content. The migration moves pages and rewrites links;
   it never calls an LLM.
2. **Slug stability: sticky `slug:` PIN IN THE PAGE FRONTMATTER**, not a
   manifest map. A map is a second source of truth that can desync from
   disk — the exact P1 class (persisted state drifting from reality).
   In frontmatter the pin travels with the file in git, is visible to
   editors, and frees itself when the page is deleted. Unstable paths
   are not just link churn — #17 (source deep-links) and #18
   (`view --ref`) put page paths into published sites and shared links;
   a page that moves because the model rephrased a title breaks
   third-party links.
3. **Collisions: no ordinal suffixes.** The lowest `Module.id`
   (deterministic order) wins the slug; the loser KEEPS `<id>.md` (the
   known-safe behavior of today), and the collision is surfaced as a
   validation item so the title gets improved — instead of silently
   accumulating `-2`, `-3` (ordinals depend on processing order and
   re-introduce instability when the winner is deleted). The acceptance
   criterion is reconciled accordingly: a `core-src-NN.md` filename may
   legitimately SURVIVE as a reported collision loser.
4. **Test pages: `<product-slug>-tests.md` (hyphen, never a dot infix)**
   — a `.tests.md` infix invites path/extension logic in the walker,
   viewer, and export to diverge. Coupling rule: the test page's slug is
   derived from its mirrored product page at generation time and then
   pinned by the same sticky frontmatter rule — if the pairing later
   breaks, the slug STAYS (stability over freshness; the name may age,
   it never churns).

## Hazard found while landing the foundation (2026-08-07)

`syncStaleModulePages` (`init.ts`) builds its keep-set as
`${module.id}.md` and DELETES every other `owner: generated` root page —
that is the #24 migration path for partition changes. Once pages live at
semantic slugs, every renamed page looks stale to it: the first full batch
after shape A would delete the entire wiki, and the pages are `owner:
generated`, so the ownership guard does not save them.

The shared path resolver is therefore a PREREQUISITE of shape A, not a
follow-up refactor: the keep-set must be built from resolved page paths,
not from ids. The same applies to every surface that reconstructs
`livewiki/<id>.md` today — `navigation.ts` (5 sites), `topics.ts`,
`init.ts` artifact links, and the stage-4/repair prompt headers in
`prompts.ts`.

## Decisions taken (maintainer, 2026-08-07 — design met the repo)

Both surfaced while landing the deterministic foundation; both change what
the migration actually renames, so neither was decided in code.

5. **ID-leaking titles: strip the label prefix deterministically.** Chunked
   modules carry the ordinal INTO the title, in two forms present in this
   repo's own wiki: `"Core Source 03: Config, Index, …"` (colon) and
   `"core-src-06 — module identification, …"` (spaced dash). Slugifying
   verbatim would publish the mechanical name the item exists to remove, so
   `stripModuleIdPrefix` drops the leading label. The rule is deliberately
   narrow and fails closed: the module id must END in an ordinal, the label
   must END in the same number (numeric compare, `3` == `03`), and every
   remaining label word must align positionally with the id's word — equal,
   a prefix, or an abbreviation (`src` → `Source`). A bare hyphen is never a
   separator; only a SPACED dash counts, or `core-src-06` would decapitate
   itself. "Auth: login and session" (id `auth`, no ordinal) is untouched.
6. **Chunked test modules keep `<id>.md` and are reported.** Decision 4
   assumes a 1:1 product↔test pair, but chunking splits the two sides
   INDEPENDENTLY — 11 `core-src-NN` against 7 `core-src-tests-NN` — so there
   is no single product page to mirror. Pairing by ordinal was rejected: the
   file sets do not correspond, so `<core-src-03-slug>-tests.md` would
   assert a coverage relationship that does not exist. These keep the
   known-safe `<id>.md` and are surfaced as validation items, exactly like a
   collision loser (decision 3). Non-chunked pairs (`mcp-src-tests`,
   `cli-src-tests`, `llm-tests`) mirror normally.

## Dry-run over this repo (2026-08-07, read-only, zero tokens)

Foundation output on the 50 module pages currently on disk — the "preview
before executing" gate from open question 6:

- **27 renamed** (24 `title`, 3 `mirror`), **23 keep `<id>.md`**.
- **Zero product `core-src-NN.md` survive** — all 11 resolve to semantic
  slugs, so the acceptance criterion's collision-loser escape hatch is not
  needed on this repo.
- The 23 kept split into two populations: the 7 chunked test pages
  (`no-mirror`, decision 6) and 16 pages whose title ALREADY slugifies to
  their id (`cmd`, `lib`, `docs`, `scripts`, the `sample-*-repo*` fixtures)
  — nothing to rename, not a fallback.
- **50 pages → 50 distinct paths**: no collision on this repo.
- **Zero non-generated owners**: the migration is rule-#6 clean here; no
  human or mixed page is touched.
- Longest slug 70 chars, inside the 72-char bound. One title truncates on a
  word boundary (`core-src-08` loses a trailing "debt ranking"); readable,
  and the bound stays until a real case argues otherwise.

## Acceptance criteria

- Every product module page on this repo is reachable at a semantic
  path, EXCEPT reported collision losers, which keep their `<id>.md`
  path and are listed as validation items (no silent `core-src-NN.md`
  remains unaccounted for).
- Navigation hubs never show "part N of M" for named pages.
- Test pages mirror their product page as `<product-slug>-tests.md`
  with "Tests for …" titles.
- `verify` zero issues after migration; zero broken links in
  LLM-written pages; ledger re-upserts anchors under new paths; MCP
  search reindexes.
- Re-running the batch renames NOTHING (frontmatter-pinned slugs) —
  idempotence proven by a byte-identical second migration dry-run.
- Human/mixed pages: zero modifications, skips reported.
- Zero paid tokens for the whole item (implementation, migration, and
  validation are all deterministic).

## Estimate

Design review → A (pipeline) + B (migration) ~1–2 days deterministic
work, zero paid calls for implementation; one paid batch only if the
maintainer wants fresh prose under the new slugs (optional — the
migration moves existing pages, it does not regenerate them).
