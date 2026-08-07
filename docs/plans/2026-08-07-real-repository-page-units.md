# Real repository page units (#29) — design

> Status: DESIGN. No implementation authorized. Supersedes #25.
> Origin: maintainer review 2026-08-07. #25 was scoped as "rename the
> mechanical page names"; the review established that the names were a
> symptom and the defect is the page UNIT itself. The measurements below are
> deterministic reads of `.livewiki/index.db` — zero paid tokens.

## The defect

`core-src-03` does not exist in the repository. It is not a module, a
package, or a directory — it is bucket 3 of an algorithm that cuts every 80
symbols. The wiki presents eleven units that exist nowhere in the code as if
they were the code's organization.

No sentence inside those pages is false. Every anchor resolves to a real
file and `verify` reports zero issues. But the STRUCTURE is fabricated, and
the tool's contract — present only what is real — governs structure just as
much as prose.

Measured on this repo's own wiki:

```
921 product symbols across 123 files
→ grouped into pages averaging 4.4 files each
→ grouping chosen by a symbol budget, by no relationship whatsoever
```

`core-src-03` is `config.ts`, `db.ts`, `diagrams.ts`, `diff-preview.ts`,
`export.ts`, and `flow-diagram.ts` stapled together. Those six files share
nothing except having landed in the same 80-symbol tally.

## Why #25 (rename) was the wrong fix

#25 would have derived semantic slugs from the page titles, turning
`core-src-03.md` into `config-index-export-diagrams-diff-preview.md`.

That makes it worse. `core-src-03.md` is ugly but honest — the `03`
announces "I am an arbitrary slice". A semantic name presents an invented
bucket as a coherent module of the system. A plausible name over a
fabricated unit is precisely the failure mode the tool exists to prevent,
moved from the prose layer to the architecture layer.

The naming problem also disappears on its own once the unit is fixed: module
ids are ALREADY path-derived and already read well (`core-src`, `mcp-src`,
`cli-src`, `commands`, `root`). The ugliness was only ever the `-01..-11`
suffix — the chunk leaking onto disk. Remove the leak and there is nothing
left to rename: no slug derivation, no ID-prefix stripping, no collision
rule.

## The principle

**Chunking is a generation concern. A page is a presentation concern.**
Today they are the same object — one chunk, one page — and that is the bug.

Chunking stays. It is what keeps stage 4 inside its budget, what gives retry
granularity, and what makes `--only` work. It simply stops reaching disk. A
page's unit becomes something that exists in the repository: a file, or a
folder.

## What the content already does (measured)

The rehearsal's most important finding: **the content is already complete.**
`core-src-03`'s six files hold 80 symbols, and the page documents 80 of 80 —
stage 4's closed-key-list contract already forces every symbol to be
covered.

So "what the function does, what the file does" is already produced. Nothing
about the generated prose is missing. Only its filing is wrong. This is a
reorganization, not a content expansion.

## Rehearsal (2026-08-07, read-only, zero tokens)

Deterministic projection over `.livewiki/index.db`:

```
product files ............ 123
  with symbols (a page) .. 90
  inert (no symbols) ..... 33   → listed on the folder page, no page of their own
folders with product ..... 31

PAGES: 90 file + 31 folder = 121        (today: 50, averaging 4.4 stapled files)
```

121 against 50 is 2.4x more pages of the same order of magnitude — not the
200+ that would have made per-file pages absurd. The size distribution is
friendly: 39 files hold 1–5 symbols, 39 hold 6–20, 11 hold 21–50, and one
holds more than 50.

### The generation budget stops binding

```
files above maxModuleSymbols (80): 0
largest file by symbols:           55  (batch.ts)
```

No single file exceeds the symbol budget that produced the eleven-way split.
The budget was never blown by a file — it was blown by GROUPING files. At
file granularity the chunker has nothing to cut.

What does still bind is source bytes, which is the real context pressure:

```
262KB   55 sym  packages/core/src/batch.ts
110KB   38 sym  packages/core/src/prompts.ts
 92KB   39 sym  packages/core/src/artifact.ts
 65KB   48 sym  packages/core/src/view.ts
```

`batch.ts` is the one file likely to need internal splitting during
generation — and that split stays internal, invisible on disk.

### The test pairing becomes real

The relation "`X.test.ts` covers `X.ts`" is verifiable on disk, unlike the
chunk pairing, which had to be invented:

```
test files .......................... 86
  paired 1:1 by name ................ 55
  no same-name product file ......... 31
      of those, matched by prefix ... 20   (batch-repair.test.ts → batch.ts)
      matched by nothing ............ 11   (e2e and cross-cutting suites)
product files with a test ........... 55 of 90
```

This also surfaces a true fact the current wiki hides: 35 product files have
no test at all. That is information about the repository, and the tool
should say it rather than bury it.

### The hard case, page by page

`packages/core/src` — today eleven `core-src-NN` pages plus seven
`core-src-tests-NN` — becomes one folder page and 56 file pages:

```
 sym   size   page                      paired test
  55  262KB   batch.ts                  ✔ batch.test.ts
  48   65KB   view.ts                   ✔ view.test.ts
  40   42KB   modules.ts                ✔ modules.test.ts
  39   92KB   artifact.ts               ✔ artifact.test.ts
  38  110KB   prompts.ts                ✔ prompts.test.ts
  37   52KB   navigation.ts             ✔ navigation.test.ts
  …
inert (no page, listed on the folder page): index.ts
```

Every line is a unit that exists on disk, and every pairing is checkable.

## Open questions the implementation must answer

1. **What the folder page holds.** It is the entry point for "what does this
   directory do" — a real synthesis over its files, not a concatenation of
   them. Concatenating `packages/core/src` would produce ~275KB nobody
   reads. Note the cost: a synthesis is a NEW LLM call per folder, on top of
   the file pages. Cheap next to stage 4, but not free.
2. **The 31 unpaired test files.** 20 match a product file by prefix
   (`batch-repair.test.ts` → `batch.ts`); 11 match nothing (e2e, format, and
   cross-cutting suites). Prefix matching is a convention, not a fact — it
   needs an explicit decision, and the 11 leftovers need a home that does
   not assert a false relationship.
3. **How tests are presented at all.** #24 gave tests their own pages as a
   side effect of getting them out of product pages, not because a reader
   asked for test documentation. With a real product↔test pairing available,
   a "tests" section on the product file's page may serve the actual reader
   need ("where are this file's tests?") better than a separate page.
4. **`batch.ts` at 262KB.** The one file whose source alone may exceed a
   comfortable context. Internal generation split, invisible on disk.
5. **The 33 inert files.** Config, JSON, and Markdown with no extracted
   symbols. Listed on the folder page — but they still deserve a sentence
   saying what they are.
6. **Cost.** Content per symbol is unchanged; per-page overhead multiplies
   across 121 pages instead of 58. Rough estimate 1.5x the 731k-token full
   batch — an ESTIMATE, not a measurement. Measure it with a paid rehearsal
   on one folder before committing to a full run.

## Consequences for existing items

- **#25 is superseded.** Its migration half (move-only, link rewriting,
  sticky slug pins) died with the maintainer's 2026-08-07 ruling that the
  previously generated wiki is not a source of truth: the product is
  pre-beta, nothing is published, and the tool is still being shaped. The
  sticky-pin argument (#17 source deep-links, #18 `view --ref` put paths
  into published sites) remains correct AFTER launch, but constrains
  nothing now.
- **The #25 foundation was written and discarded the same day.**
  `packages/core/src/page-slug.ts` plus 35 green tests (deterministic slug
  derivation, sticky pins, collision rule) were built 2026-08-07, never
  wired into any caller, and deleted at the wrap once #25 was superseded —
  dead code in the package is a trap for the next session. Its actual
  value was the dry-run it powered, which is what made the unit defect
  visible; that output is preserved in the #25 design doc.
- **`syncStaleModulePages` hazard survives any scheme.** It builds its
  keep-set as `${module.id}.md` and deletes every other `owner: generated`
  root page. The moment page paths stop being module ids, the first full
  batch deletes the wiki — and the ownership guard does not save it, because
  the pages are `generated`. Whatever the new unit is, the keep-set must be
  built from resolved page paths.

## Not decided

The page unit (file + folder) is the recommendation, not a ruling. The
folder page's contents, the test presentation, and the cost ceiling are all
open. No code changes are authorized by this document.
