# Capability backlog — native engine evolution

Date: 2026-07-23
Status: consolidated directions, nothing committed. Each item needs its own
task contract before implementation.

> Vision alignment (2026-07-23): the human-readable wiki (layer B) is the
> product destination; the agent-facing engine is phase 1. Consequently
> `livewiki view` (Phase 7) and the `livewiki export` git-host targets
> (Phase 6) are the next lots after MVP validation closes, and every item
> below should be checked against "does this improve the wiki a human
> reads?" — not only the agent loop.

This backlog collects design directions for the livewiki engine, ranked by
value/effort. All items are implemented natively (rule 8). None of them
changes the core architecture: deterministic index → bounded LLM generation
→ verified anchors → debt-driven maintenance.

## Active candidates

### 1. Closed repair contract (`supportedFixes` per failure code)

Problem: repair rounds are spent on failures the model cannot act on, and
`repair_exhausted` outcomes (observed in R10.1 flow tasks) mix actionable
and non-actionable diagnostics.

Design: every verify/artifact failure code carries an enumerated,
machine-checkable list of supported fixes. The repair prompt only offers
the fixes valid for the codes it is fed. A failure with no supported fix
is classified `unclassified`: it is reported, never repaired by guessing.
Expected effect: fewer wasted attempts, clearer aborts.

Effort: small (diagnostics in `artifact.ts`/`verify.ts` + repair prompt
templates in `prompts.ts`).

### 2. Rationale / intent extraction into the index

Problem: blind evaluations keep naming the same gap — pages describe
structure but not intent. The rationale already exists in source
(`WHY:`/`NOTE:`/`HACK:`/`TODO:`/`FIXME:` comments, docstrings), but the
indexer discards it.

Design: extend symbol extraction to capture tagged comments and docstrings
above a minimal length, stored as symbol-adjacent evidence in the index,
skipping auto-generated files (migrations, protobuf stubs) whose
docstrings are revision noise. Feed this evidence to stage-4 and topic
prompts. Deterministic, no LLM cost at index time.

Effort: days.

### 3. Test-gap signal + risk-weighted debt prioritization

Problem: the debt ledger is unordered; `update` regenerates in a flat
order, and `status` cannot tell the maintainer which stale page matters
most.

Design: derive test-coverage edges from the existing import graph (a test
file importing a module ⇒ coverage edge; no call graph needed). Combine
with importer count (module graph) and git churn into a deterministic
risk score. Use it to rank debts in `status` and to order regeneration in
`update`. No LLM involved.

Effort: medium.

### 4. MCP workflow-adjacency hints

Problem: arbitrary MCP clients do not discover the livewiki loop
(quickstart → search → read → write_doc → verify) on their own.

Design: append a static `_hints` block to each tool response suggesting
the next most useful tool calls. Pure presentation-layer table.

Effort: trivial.

### 5. CALLS edges + edge confidence tiers

Problem: stage-5 flow candidates currently rest on import edges and
heuristics. Call edges would materially strengthen flow evidence and
enable deterministic call-chain tracing as candidate input.

Design: extract intra-module call edges per language where a grammar
exists (tier 1 of the language ladder below). Resolution is deliberately
conservative: emit an edge only for a unique candidate; skip ambiguous
targets. Every edge is tagged with a confidence tier —
`EXTRACTED` (explicit in source) / `INFERRED` (resolver-derived, with a
discrete rubric score) / `AMBIGUOUS` (flagged, never consumed silently).
`verify` and flow-candidate ranking may treat tiers differently.
Import edges are `EXTRACTED` by construction; tiers only become
meaningful once call resolution exists, so the two land together.

Effort: one lot per language family; requires its own design contract.

## Language coverage ladder

The tool must document any repository, not only TS/JS/Python. Coverage is
a declared degradation ladder, not a silent allowlist:

- **Tier 1 — full AST** (grammar integrated): symbols, symbol anchors,
  imports, and (with item 5) call edges. Grammar adoption is adaptation
  work, never parser authorship: community WASM grammars + a node-type →
  symbol mapping in `symbols.ts` + walker extension map.
- **Tier 2 — prose with path anchors** (any text file): the walker no
  longer discards unknown extensions; the indexer treats "no grammar" as
  an expected path (`symbolCount: 0`); generation reuses the existing
  zero-key contract; `verify` validates that cited paths exist (no AST
  required).

Tier 2 makes the tool language-agnostic today, with zero new grammars.

**Tier 2 is a permanent floor, not a temporary workaround.** A repository
in any language always gets: full file inventory and hashing, file-level
staleness debt, directory-based module grouping, prose documentation with
path anchors, path-level `verify`, and Mermaid flows. The tool never
"does not know what to do" with an unmapped language. Even tier-1
languages keep tier 2 as the fallback for files that fail to parse.

**Tier 1 expansion is driven by real usage, not market top-tiers.** The
mapping queue starts from the maintainer's own repositories and then
from user-reported languages. Because the walker no longer discards
unknown extensions, `status`/`init` can report a language-composition
histogram (which extensions were seen, which tier each is on). That
histogram is both user-facing transparency and the data source for
choosing the next symbol mapping.

The repository's language composition (how many files/modules have
precise extraction vs. prose-only) is reported as information in
`status`/`init` output — never as a blocking error.

### Grammar bundling and update policy

- **Curated pre-built bundle.** Grammar `.wasm` files ship versioned in
  `packages/core/grammars/`. Loading is already lazy (a grammar is only
  loaded when a matching extension is indexed), so bundling costs only
  npm package size, never runtime. Only grammars with a symbol mapping
  (or explicitly queued next) are bundled — an unmapped `.wasm` is dead
  weight.
- **Reproducible regeneration.** A grammar manifest records each
  grammar's source, exact ref, and the tree-sitter CLI version used to
  build it. A regeneration script builds/validates every `.wasm` against
  the pinned `web-tree-sitter` runtime (ABI compatibility is the one
  hard constraint) and is the only way grammars enter or change.
- **Deliberate updates, not a calendar cadence.** Mature grammars
  change slowly; bulk monthly bumps buy nothing and risk ABI churn plus
  binary diff noise. A grammar is updated when (a) its language mapping
  lands, (b) a parsing defect is reported, or (c) an explicit periodic
  review decides so. Runtime and grammar bumps land together with the
  test suite green.
- **Adding a tier-1 language is one bounded lot:** obtain the `.wasm`
  via the manifest script, register extensions in the walker/parser
  maps, write the node-type → symbol mapping in `symbols.ts`, add a
  language fixture with tests. Estimated at hours to a day per language;
  never blocks the tier-2 floor.

## Watch-list (do not build yet)

- **User-registered grammars** (config-driven extension map + node-type
  lists, defensively validated, built-ins win). Only after the 4th/5th
  language lands and the per-language variation pattern is concrete.
- **Community detection over the module graph** (deterministic, seeded)
  as a cross-check on directory-derived modules and as evidence for the
  topic planner. Only if R11-A earns its complexity after validation.
- **Classified semantic delta between runs** (added/removed/semantic vs.
  reorder-only changes in the module/flow inventory), upgrading
  `batch status` reporting beyond `snapshotHash`.
- **Git-pinned evidence verification**: check file/line citations in
  generated pages against git objects at the run's HEAD, yielding an
  immutable "verified at commit X" receipt for prose claims that symbol
  anchors cannot reach. Complements the anchor ledger; medium effort.

## Explicitly rejected

- Vector embeddings / semantic search: FTS5 + the anchored symbol index
  cover the retrieval need deterministically.
- Committing any derived index/graph artifact to git: violates rule 3.
- Multi-media ingestion (PDFs, images, audio): out of designed scope
  (VISION.md).
- Dashboard / PR-gate / hosted-CI surfaces: deferred by the
  product-first discipline; GitHub integration is a final validation
  step, not a feature.
