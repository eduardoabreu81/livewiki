# Real repository page units (#29) — design + implementation plan

> Status: DESIGN rev3 (2026-08-08), decisions locked, ready for estimation
> review. No implementation authorized yet. Supersedes #25.
> Origin: maintainer review 2026-08-07 established that the page UNIT is the
> defect, not the page name. Rev2 (2026-08-08) added the human-reader
> organizing principle and the CodeWiki content pattern. Rev3 (2026-08-08)
> locks the three structural decisions and the product rule "no special
> machinery per file type".

## The organizing principle (maintainer ruling 2026-08-08)

**The page unit is the unit of human curiosity.**

A human opens the wiki with a question about something they can SEE in the
repository: "what does `packages/core/src` do?", "what is `batch.ts` for?".
Those are the units the file explorer shows, so those are the units the
reader asks about. Nobody asks "what is `core-src-03`" — it exists nowhere
in the repo, so the reader cannot connect the wiki to the code they are
looking at.

Two concrete failures follow, both reported from actually opening the
generated wiki:

1. **"I see the folder's pages and still don't know what the folder does."**
   The most natural browsing question — what is this directory for — is the
   one the current structure cannot answer. Eleven 80-symbol slices do not
   add up to an answer; each is a random cut the reader must read in full
   and assemble in their head.
2. **"If the folder holds more than one concern, how does a human see
   that?"** They don't. The boundary between buckets is invisible and
   arbitrary: `config.ts` and `db.ts` share `core-src-03` not because they
   relate, but because they fit. A reader looking for "where do I change
   the config" cannot know whether it lives in `-01` or `-07` without
   opening all of them.

Human reading runs from the whole to the detail: what is this project →
what does this folder do → what does this file do → where is the symbol.
The bucket cut breaks exactly the middle link. The wiki must mirror the
REPOSITORY, not the generation process. Chunking is a machine constraint
(context budget); the reader has no obligation to know a context window
exists — like a book whose chapters break mid-sentence because of printing
limits.

## The product rule (maintainer ruling 2026-08-08)

**No special machinery per file type. The tool documents ANY real
repository.**

The dogfood repo's reality (43% of anchored files are co-located tests)
must NOT shape product code. The contract is uniform:

1. **Every file on disk is a real unit and gets an honest account** — its
   own page when it bears symbols, one line on the folder page when inert.
   No special page type for tests, no tests hub, no separate channel.
2. **The account states the file's ROLE** — what it is doing there. A
   `batch.test.ts` explains itself as "the test suite for `batch.ts`":
   that is the truth of the disk, and it serves the reader. The 1:1 pairing
   is a verifiable fact and becomes a pointer ("Tests: `batch.test.ts`"),
   not a special section.
3. **When no role can be established, the tool REGISTERS the anomaly
   instead of hiding it or force-fitting it**: a test with no product
   counterpart, a loose file with no discernible purpose → declared an
   **orphan file** on the folder page. This is intelligence about the
   repository — the tool tells the truth even when the truth is "this
   should not be here".
4. **Excluding tests from OUR OWN dogfood wiki is a config choice of OUR
   repo** (index-level via `pathRoles`/ignore patterns), not a product code
   path. The product carries no workaround for our reality.

### Provenance: why the `-tests` pages existed and why they die

#24 (2026-08-04) fixed a real defect: directory-grouped chunks stapled
co-located test files into product pages, so product pages cited test
anchors as if they were product surface. But the fix's SHAPE was dictated
by an architectural invariant, not by a reader need: the module partition
had to cover exactly 100% of the indexed inventory, so ejected tests had
to land somewhere, and the only place the architecture offered was their
own pages (zero-token deterministic auxiliary channel — cheap enough that
nobody asked whether they should exist). With real page units, the
question "does a human ask for test documentation?" can finally be asked,
and the answer is: a test page serves no reader question that a pointer
plus the real test file does not serve better. The `-tests` pages die with
no specialized replacement; the general role/orphan rule covers tests as
just another file. `classifyPathRole` STAYS — it is what makes pairing and
orphan detection verifiable. Do not "fix" their absence in a future
session.

## The content pattern: CodeWiki (maintainer ruling 2026-08-08)

**"One sentence to explain a function is not always the expected answer."**
The reference for what clear documentation reads like is Google CodeWiki:
<https://codewiki.google/github.com/golang/go> and
<https://codewiki.google/github.com/openclaw/openclaw> (videos explicitly
out of scope). The frozen OpenWiki control corpus
(`eval-mptp/claude/corpus-b`, e.g. `workflows/video-generation.md`) shows
the same pattern and explains our blind-eval navigation/clarity gaps:
OpenWiki has the narrative quality over INVENTED concept units; nobody has
narrative quality over REAL, verified units. That intersection is #29.

What #29 adopts:

- **Narrative mechanism explanation, step by step.** Their leaf sections
  read as: "the agentic loop processes a turn from intake to persistence;
  the X RPC validates parameters, resolves session metadata, and returns Y;
  the Z orchestrates the run..." — the FLOW, each stage's role, naming the
  real code entities inline. Not an inventory where every function gets one
  sentence.
- **Progressive drill-down with real synthesis at every level.** Overview →
  folder → file: each level is a genuine condensed reading with links down,
  never a concatenation of the level below.
- **A diagram per section**, inline, next to the narrative.

What #29 does NOT adopt:

- **Invented concept hierarchies.** CodeWiki's H2 areas ("Core Platform
  Vision and Architectural Principles") are LLM-invented units — the same
  fabrication failure as `core-src-03`, one level up. livewiki's contract —
  present only what is real — forbids that at the folder/file level. Our
  concept layer exists and stays: `topics/` and `flows/` are the bounded,
  evidence-validated place for cross-cutting concepts.
- Videos (maintainer, explicitly).

## Locked decisions (maintainer, 2026-08-08)

### D1 — Validation contract: full dual coverage AT FILE GRANULARITY

The root cause of the sentence-per-function inventory was located at
`artifact.ts:24-29`: module pages require dual COMPLETE coverage — every
closed-list key in the frontmatter `anchors:` AND in the section markers
(`missing_closed_key`). Forcing 80 symbols from 4–5 unrelated files into
one page leaves the model no shape but a list.

Decision: the coverage requirement stays EXACTLY as-is — closed list, dual
citation, full coverage, `missing_closed_key` — but applies per FILE. No
new validation codes, no relaxation, verify/debt anchor machinery
untouched. What changes is the PROMPT contract (`prompts.ts`): from
"document every symbol" to "explain what this file's code does as a
mechanism — the flow, the steps, each step's role — citing every symbol of
the file where the narrative touches it". Citations ride invisibly in
frontmatter and `lw:anchors` comments; the prose is narrative. This is
viable BECAUSE the unit changed: 77% of symbol-bearing files have ≤20
symbols, cohesive by construction, so full coverage no longer forces
inventory prose. The cite-what-you-use alternative (flow-style upper
bound + deterministic symbol table) was REJECTED: uncited symbols would
leave the debt radar and it adds an artifact to maintain.

### D2 — Oversized single files: plan-then-write, two passes

`batch.ts` (262KB) does not fit one full-source call. Decision: the
topic-planner pattern, file-internal:

- **Pass 1 (plan):** the model sees the file fair-truncated
  (`buildFairTruncatedSource` already exists) and produces the narrative
  ARC: the page's sections and which symbols each section covers. One mind
  designs the arc — no visible seams.
- **Pass 2 (write):** one call per planned section with the COMPLETE
  source slice of that section's symbol range (contiguous ranges at symbol
  boundaries, never mid-symbol).
- **Assembly:** deterministic concatenation in the plan's order under the
  page skeleton. No LLM merge pass.
- **Trigger:** only above a source-bytes threshold (new config,
  e.g. `fileSplitSourceBytes`); 2 files in this repo (`batch.ts` 262KB,
  `prompts.ts` 110KB). Below the threshold, one full-source call.
- Retry/budget granularity stays at the section call — the chunk survives
  as a generation concern, exactly the principle.

Rejected: independent concatenated chunks (recreates in prose the break
#29 removes from structure) and single-call-with-excerpts (documents code
the model never saw — hallucination risk on the repo's most important
file).

### D3 — Tests: no special machinery (the product rule above)

Zero test pages, zero test-specific sections or hubs. Tests are files:
role stated honestly, 1:1 pairing as a pointer, unpaired ones registered
as orphans on the folder page. Our dogfood repo excludes them at index
level via config. The deterministic coverage signal ("N of M files here
have no same-name test") remains available from walk-time role
classification and may be surfaced on the folder page — zero tokens.

### D4 — `syncStaleModulePages` keep-set (prerequisite)

The keep-set is literally `` `${module.id}.md` `` (`init.ts:584`); the
moment page paths stop being module ids, the first full batch DELETES THE
WIKI, and the pages are `owner: generated` so the ownership guard does not
save them. Must ship WITH #29: keep-set built from resolved page paths.

## Page units

- **File page** (one per symbol-bearing file): the narrative mechanism
  explanation — what this file's code does, the flow, the steps — citing
  the file's full symbol list (D1). One file = one reader question = one
  page.
- **Folder page** (one per folder holding files): THE FRONT DOOR for
  browsing. One honest paragraph answering "what is this directory for" —
  a real synthesis, never a concatenation — plus the file guide: every
  file listed with one line (symbol-bearing files link to their page;
  inert files get their one line here; orphans declared). A reader
  finishes it in 30 seconds and knows where to descend. Redundancy guard:
  `architecture/overview.md` already routes at repo level, so the folder
  page answers "what is this place", the file pages answer "what does
  this do".
- **Inert files** (no extracted symbols): no page; one honest line each on
  the folder page.
- **Orphan files** (no establishable role): declared as such on the folder
  page. The exact deterministic rule (e.g. test-role file with no same-name
  product counterpart, prefix match stated as "likely") is fixed at
  implementation.

## Rehearsal (2026-08-07; re-verified 2026-08-08 against the live DB)

Deterministic projection over `.livewiki/index.db`, using the real
`classifyPathRole` from the built package. Terminology fix vs rev1: the
"product" set below is everything whose path role is NOT `test` (it
includes 15 fixtures, 3 tooling, 4 docs files).

```
non-test files .............. 123
  with symbols (a page) ..... 89    (rev1 said 90 — one-file drift)
  inert (no symbols) ........ 34    → one line each on the folder page
folders with non-test files . 31

PAGES: 89 file + 31 folder ≈ 120   (today: 50, averaging 4.4 stapled files)
```

120 against 50 is 2.4x more pages of the same order of magnitude. Size
distribution: 39 files hold 1–5 symbols, 38 hold 6–20, 11 hold 21–50, one
holds 55.

### The generation budget stops binding

```
files above maxModuleSymbols (80): 0
largest file by symbols:           55  (batch.ts)
```

No single file exceeds the symbol budget that produced the eleven-way
split — the budget was blown by GROUPING, never by a file. What still
binds is source bytes (D2): `batch.ts` 262KB, `prompts.ts` 110KB,
`artifact.ts` 92KB, `view.ts` 65KB.

### Test pairing / orphan measurement (re-verified 2026-08-08)

```
test files (role === "test") ........ ~85
  paired 1:1 by name ................ 54    → "Tests: <file>" pointer
  matched only by prefix ............ 20–25 → "likely covers", never asserted
  matched by nothing ................ 11–28 → orphan candidates (e2e suites)
symbol-bearing files w/o 1:1 test ... 22    → coverage-signal input
```

The spread in the last two rows is exactly why prefix pairings must never
be asserted as fact. The no-test count is information about the repository
the current wiki hides; the folder page says it.

## Coupling surface (verified 2026-08-08)

The "page path == module id" assumption is concentrated, not diffuse:

- `batch.ts:902` — stage-4 write path `livewiki/${module.id}.md`
- `init.ts:584` — `syncStaleModulePages` keep-set (D4)
- `navigation.ts:145,308,667–686,825,1116` — page loading + link rendering
- `prompts.ts:496,709,973` — stage-4 output contract + planner module list
- `topics.ts:239` — **the deepest coupling**: the topic planner builds its
  closed evidence inventory from ACCEPTED MODULE PAGES. Per-file pages
  change the inventory's shape; real rework in `topics.ts` + `prompts.ts`,
  explicitly in scope.

Generic page walkers (`verify`, `view`, `export`, FTS5 search) do not know
page names — unchanged. Diagrams (`moduleDiagrams`, item 22) are keyed by
module and re-key to file/folder.

## Implementation plan (phases; zero paid tokens until P5)

- **P0 — prerequisites.** D4 keep-set fix with a deletion dry-run listing
  FIRST (the discipline that caught the #24 defects). Real-units planner:
  deterministic file+folder partition from the index, roles via
  `classifyPathRole`, pairing + orphan detection. The 100%-partition
  invariant is REPLACED by "every indexed file is accounted for on exactly
  one real page (file page or folder line)".
- **P1 — stage 4 rework.** `buildFileDocContext` (per-file; full source
  when under threshold; rationale block carved as today); file-page prompt
  with the narrative contract (D1); folder-page synthesis task (one LLM
  call per folder: paragraph + file guide, with the deterministic file
  inventory supplied so no file is invented or omitted); plan-then-write
  for oversized files (D2); `--only file:<path>` / `folder:<path>`.
- **P2 — validation contract.** Page kinds `file`/`folder` (or reuse
  `module` — decided at implementation); file-page opening contract;
  folder-page deterministic checks (file guide completeness against the
  disk inventory — every file accounted, no phantom files); repair-contract
  mappings; ownership/stale cleanup per resolved page paths.
- **P3 — navigation + concept layer.** quickstart/tasks/overview/Navigate
  links re-keyed to file/folder pages; topics evidence inventory rework
  (`topics.ts:239`); flow pages' `modules:` references re-keyed; diagrams
  re-keyed; `syncStale*` family aligned.
- **P4 — test churn + gate.** The largest deterministic workload: dozens
  of suites reference module pages (`navigation.test`, `batch*.test`, CLI
  E2Es). Full gate green before any paid call.
- **P5 — paid rehearsal on the EXTERNAL test repo** (the
  MoneyPrinterTurbo-Plus clone — never the dogfood repo; maintainer rule
  2026-08-08: paid validation does not run against our own tree). One
  folder first. Measures: total tokens, useful/overhead ratio (39 of 89
  files hold 1–5 symbols — fixed prompt overhead dominates tiny pages),
  narrative quality read by the maintainer. THEN the full run, also on the
  test repo.

## Estimates

- Deterministic work (P0–P4): **~2.5–4 dev-days**, comparable to the R11-A
  topics lot. Largest blocks: P4 test churn and P1 prompts/validation.
- Paid tokens: rehearsal ~50–100k; full run **~1.1M (estimate: 1.5x the
  731k full batch — NOT a measurement; P5 exists to replace it)**.
- Folder synthesis adds ~31 calls on top of file pages; per-page overhead
  multiplies across ~120 pages vs 50 — the reason the rehearsal measures
  the overhead ratio, not just the total.

## Consequences for existing items

- **#25 superseded** (2026-08-07): naming was the symptom. Its migration
  half died with the ruling that the pre-beta generated wiki is not a
  source of truth. The sticky-pin argument (#17/#18 deep links) remains
  correct AFTER launch, constrains nothing now. The `page-slug.ts`
  foundation (35 green tests) was built and discarded the same day —
  dead code is a trap; its dry-run output is preserved in the #25 doc.
- **#24 partially superseded** (see Provenance): the `-tests` pages die;
  `classifyPathRole` and the test-role index classification STAY (pairing,
  orphan detection, coverage signal).
- **Module diagrams (item 22)** re-key from module to file/folder; budgets
  (`moduleMaxDiagramNodes/Edges`) carry over.

## Remaining open questions

1. **Cost ceiling** — answered only by the P5 rehearsal.
2. **Orphan rule precision** — exact deterministic criteria fixed at P0
   (proposal: test-role file with no same-name product counterpart;
   prefix match reported as "likely", never asserted).
3. **Folder-page validation depth** — how much of the file guide is
   checked deterministically (inventory completeness yes; per-line prose
   no) — fixed at P2.
