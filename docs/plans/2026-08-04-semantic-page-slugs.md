# Semantic page slugs (#25) — design

> Status: DRAFT for maintainer review. No implementation authorized.
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
from the mirrored product page: `<product-slug>.tests.md`, title
"Tests for <product title>" — keeping pair adjacency in listings.

Recommendation: A for the pipeline + B as a one-time migration. B is the
risk surface and most of the open questions below.

### Open questions the implementation must answer

1. **Slug collisions**: two modules can title alike ("Configuration
   core"). Resolution rule needed (first-come keeps, later gets `-2`? or
   fall back to `core-src-07`-style suffix for that page only?).
   Deterministic and stable across re-runs required.
2. **Title drift churn**: the model may rephrase a title next batch →
   the page MOVES again. Pin rule needed: once a page exists, its slug
   is sticky (frontmatter `slug:`? manifest map?) and only an explicit
   operator action renames. Without this, every batch is a link-churn
   generator and the ledger churns with it.
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
   the task knows its module, derives the current slug from config/title
   source of truth. Where does the id→slug map live? (Candidate: module
   frontmatter stays `Module ID: core-src-07` line in the page; the
   index recomputes on demand.)
6. **What renames first**: pilot on the dogfood wiki (this repo) with a
   dry-run listing (same discipline as the stale-cleanup dry-run that
   caught the refine/CLI/budget defects: preview before executing).

## Acceptance criteria

- Every product module page on this repo is reachable at a semantic
  path (no `core-src-NN.md` filename remains); navigation hubs never
  show "part N of M" for named pages.
- Test pages mirror their product page: `batch-orchestration.tests.md`
  style, "Tests for …" titles.
- `verify` zero issues after migration; zero broken links in
  LLM-written pages; ledger re-upserts anchors under new paths; MCP
  search reindexes.
- Re-running the batch renames NOTHING (slug stability) — idempotence
  proven by byte-identical second migration dry-run.
- Human/mixed pages: zero modifications, skips reported.

## Estimate

Design review → A (pipeline) + B (migration) ~1–2 days deterministic
work, zero paid calls for implementation; one paid batch only if the
maintainer wants fresh prose under the new slugs (optional — the
migration moves existing pages, it does not regenerate them).
