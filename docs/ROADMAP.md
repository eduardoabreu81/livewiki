# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Execution queue (priority order)

> Source of truth for WHAT COMES NEXT. Phase status lives in `AGENTS.md`
> §Status; the numbered item bodies further down hold the evidence.
> **Reordered 2026-08-07** — this section had accreted reconciliation notes
> from three separate dates and no longer told a reader what to do next.
> The provenance was not discarded; it moved to "Decision history" below.

### P0 — pre-beta (blocks launch)

1. **#29 real repository page units** — P0–P4 IMPLEMENTED (2026-08-09,
   working tree, uncommitted): deterministic file+folder planner, file
   pages with narrative contract, folder pages (skeleton + bounded purpose
   paragraph), plan-then-write for oversized files, zero test pages (D3),
   keep-set stale cleanup (item 2 below landed with it), full deterministic
   gate green (core 1828 / CLI 126 / MCP 56), zero paid calls. Open:
   **P5 paid rehearsal on the EXTERNAL MoneyPrinterTurbo-Plus clone**
   (never the dogfood repo) + maintainer diff review before commit/push.
   Supersedes #25. Design:
   `docs/plans/2026-08-07-real-repository-page-units.md`.
2. **`syncStaleModulePages` keep-set** — DONE with #29 P0 (2026-08-09):
   the keep-set is built from the planner's resolved page paths
   (`livewiki/<folder>/index.md` + `livewiki/<folder>/<file>.md`), the
   walk is recursive, reserved hubs and deterministic root pages are
   skipped, and empty folder shells are removed.
3. **`purpose_too_long` live validation** — the deterministic hardening
   landed in `755bd2a`; the failure class has not been re-observed under a
   real understanding rerun. Validation only, no code planned.

### P1 — beta launch

4. Green matrix repetition (3+ consecutive runs), the maintainer's
   `npm pack` pass, then `pnpm publish -r`. Naming and metadata were
   decided 2026-08-04 and have been ready since `ef403aa`: keep
   `@livewiki`, MIT, 0.1.0, engines >=24, grammars in the tarball.

### P2 — post-beta (decided, written, unscheduled)

5. **#6 v2** — pay-variant: `update --llm` + draft PR on detected debt.
6. **#26** — metadata-boosted ranking for `livewiki_search`: product tier
   over auxiliary, fresh over stale. Deterministic, zero LLM.
7. **#28** — validation severity lifecycle: new codes enter report-only
   and become blocking later, so tightening a contract never
   retroactively breaks an existing user wiki.
8. **`orchestrate()` split** — P4 code health. `batch.ts` is 6,432 lines;
   the reviewer called it "next cycle's parking brake".
9. Housekeeping: `filesDeleted` recount guard (cosmetic), dependency
   modernization (commander/vitest/better-sqlite3/typescript), vitest
   parallelism cap + linter, PT-BR comment normalization,
   `understanding.md` stale cleanup.

### P3 — candidates and watch-list (need evidence before promotion)

10. **#27** — trigram / partial-match identifier search. Candidate ONLY:
    FTS5 has no native trigram tokenizer, so this is real work (custom
    token table or external tokenizer). Evaluate demand first.
11. Per-section diagrams — only if users ask.
12. Tier-1 language expansion beyond Go/Rust/Java — usage-driven; the
    pattern is already proven ×3.
13. Git-pinned evidence verification.
14. Optional: voice/subtitle false-claim frontier (`app-services-03`
    hotspot).
15. **Unfiled, surfaced by the #29 rehearsal (2026-08-07)**: 35 of 90
    product files have no test at all. The tool discovers this
    deterministically at zero token cost and currently says nothing about
    it. Product feature (report coverage gaps) or noise — undecided, and
    deliberately not filed as an item until someone decides.

### Decision history (provenance; do not re-litigate)

- **2026-08-07** — #25 superseded by #29 without implementation. Renaming
  chunk buckets treated a symptom; the page unit itself is fabricated.
- **2026-08-04** — pre-beta queue reconciled: #24 test-role classification
  DONE (zero test anchors in product pages, migration batch `96b2008`);
  #25 promoted PRE-BETA (later superseded). Beta naming decided: keep
  `@livewiki`, MIT, 0.1.0, `pnpm publish -r`.
- **2026-08-03** — the previous pre-beta queue (#17 viewer stamp + links,
  #18 `view --ref`, #19 Go / #20 Rust / #21 Java tier-1, #23
  understanding, #22 CodeWiki-grade format) closed DONE. The P1
  grammar-relabel bug from the external re-review was fixed in `ef403aa`
  (grammar-state tracking via `meta.grammar_state`: grammar added,
  removed, remapped, or version-bumped all force a one-run re-parse).
- **Earlier** — Phases 6 (export targets) and 7 (local viewer) closed, as
  did cross-platform CI. Delivered beyond the original plan: tier-2
  universal prose floor, closed repair contract, rationale evidence,
  risk-weighted debt ordering, MCP workflow hints, the recovery tier
  (surgical repair + relaxed completion round), product-first quickstart
  orientation, concept-topic coverage, nav/clarity hardening, and the
  concern-topic refine pin. The acceptance E2E passed with exit 0 and the
  blind dual-eval A/B cycle closed the gap to OpenWiki to Δ0.40–0.45
  weighted at ~6% of its token cost.

The independent quality review vs frozen OpenWiki
(`docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`) is **complete**.
Its navigation findings were implemented in Lots M (`0746860`, deterministic
quickstart/tasks/navigate) and N (`59b1112`, page-opening contract + semantic
titles + `missing_page_opening` / `title_equals_module_id` validations). The
clean-v18 benchmark run (13/13 modules, verify clean, exact accounting) is the
final state of the public comparison evidence; no further benchmark or harness
run is planned unless a product defect requires a focused reproduction. The
maintainer decides when (and whether) to publish a `docs/BENCHMARK.md` note.

## Required product-flow visibility (agent first, human next)

This is an original product requirement, not a benchmark-only optimization.
`VISION.md` defines two content layers: a structural wiki for agents and a later
human/product narrative generated from that structure — "map first, then a
story." The current deterministic Mermaid artifacts (`structure.mmd`,
`modules.mmd`, and per-module class diagrams) provide useful inventory and
traceability, but they do not by themselves explain how a product, application,
or repository works. A directory tree says what exists; a product-flow view must
show how responsibilities communicate to produce behavior.

The bounded semantic flow layer is implemented in the uncommitted R10/R10.1
body. R11-NAV now exposes those existing flows directly from Quickstart and
Tasks and moves auxiliary inventory out of primary navigation. R11-A
concept-topic synthesis is implemented in the working tree and remains
unvalidated, uncommitted, and outside the beta-launch gate until review.
Phase 7 must render the same canonical artifacts for humans instead of
inventing a separate, competing narrative.

Required content:

- a concise "How it works" entry from Quickstart to the repository's principal
  end-to-end flows;
- component/data-flow diagrams that show entry points, responsibility
  boundaries, state or persistence, external systems, outputs, and the arrows
  between them;
- sequence or state views for a small number of critical workflows when order,
  retry, rollback, recovery, or ownership transitions materially affect the
  behavior;
- companion prose for every diagram: purpose, ordered flow, invariants, failure
  paths, and links to the relevant topic and module pages; and
- topic-oriented synthesis across modules, so a reader does not have to assemble
  one workflow manually from many per-module pages.

Generation constraints:

- infer flow candidates generically from repository entry points, module/import
  relationships, commands/routes, configuration, persistence, and external
  boundaries; never hardcode livewiki-specific guide names into the product;
- retain the existing deterministic structure/import/class diagrams as the
  source map, but do not count them as satisfying the semantic-flow requirement;
- keep diagrams bounded and readable; prefer several focused flows over a
  mega-diagram or an edge-dense call graph;
- LLM-assisted semantic diagrams are allowed only as batch artifacts, clearly
  identified as synthesized documentation, source-cited/anchored, Mermaid-
  parsed, link-validated, and subject to the existing artifact/repair gates;
- preserve a textual fallback so agents and humans can understand the flow
  without rendering Mermaid; and
- generate one canonical flow artifact that CLI, MCP, export, and the Phase 7
  viewer all consume. Do not maintain separate agent and human truths.

Acceptance evidence must demonstrate that, on a real repository, both an agent
reading the low-token entry path and a human using the Phase 7 viewer can answer:

1. What starts the principal workflow?
2. Which components participate, and how do they communicate?
3. Where does state move or persist?
4. What is produced at the end?
5. What happens on the critical failure/recovery path?

The answer must come from a short topic path plus a readable diagram, not from a
directory tree or manual reconstruction of module pages. `SPEC.md` is aligned
for bounded semantic flows and R11-NAV's deterministic intent routes. The
R11-A amendment is implemented under maintainer authorization but still needs
review and validation; it preserves the
distinction between rejected automatic mega-call-graphs and approved, bounded
semantic synthesis.

## Item register (numbered; evidence and status per item)

> Numeric order, NOT priority — priority lives in the execution queue at
> the top of this file. These bodies are the record: what each item was,
> why it was approved, and the evidence it closed on. Items 1–24 are DONE,
> #25 is SUPERSEDED, and #26–#29 are open.


Source: maintainer-approved evaluation (2026-07-13) of
[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp),
a structural code-intelligence MCP, and the 2026-07-14 evaluation of GitHub's
cross-repository agentic documentation workflow. They are design references,
not dependencies or required integrations. Useful patterns are reproduced
natively through livewiki's own core, CLI, MCP server, and skills.

### Native patterns to preserve

- persistent, incremental, rebuildable local structural memory;
- compact and bounded context packages for agents;
- deterministic change/debt detection before optional LLM work;
- parity across CLI, MCP, skills, and automation surfaces;
- a narrow validated action boundary between generated intent and disk/host
  changes; and
- draft-first Git-host automation with human review and operational metrics.

### 1. Identifier-aware FTS5 tokenizer for `livewiki_search` ✅ DONE 2026-07-28

`packages/mcp/src/search.ts` uses the porter tokenizer, so camelCase /
snake_case identifiers are single opaque tokens: searching "resolve debt"
does not match `resolveDebt`. Add identifier splitting (camelCase,
snake_case, kebab-case) at index and query time. `search.db` is rebuilt on
MCP startup, so no schema/migration cost. Acceptance: a search for a
sub-word of any anchored symbol name returns the page that anchors it.

### 2. Native compact change-impact context ✅ DONE 2026-07-28

Extend the existing `livewiki update` work package and MCP responses with a
bounded, documentation-focused impact view: changed symbols, affected anchors,
pages, modules, dependencies, and only the relevant source snippets. Reuse the
local livewiki index; do not call or require another graph/MCP product. The same
structured payload must be available through CLI JSON and MCP so an active agent
or standalone provider receives equivalent context.

### 3. Index freshness and automatic local synchronization ✅ DONE 2026-07-28

Make index freshness explicit and cheap. Long-running livewiki surfaces should
detect repository changes, debounce local re-indexing, and expose snapshot age
and stale/ready state. Startup and recovery remain rebuildable from the repo and
wiki. No daemon, cloud service, or external watcher may be required for normal
CLI use.

### 4. `livewiki install` — agent auto-detection ✅ DONE 2026-07-28

One command that detects installed coding agents (Claude Code, Codex,
Cursor, Zed, ... — start with the agents already covered by the Phase 5
presets/templates) and offers to configure, per agent: the MCP server
entry, hook templates (`packages/cli/templates/`), and the AGENTS.md /
CLAUDE.md pointer. Constraints: pointer stays opt-in per rule #2 (explicit
flag or interactive confirmation, never silent); every write outside the
repo allowlist is shown before it happens; idempotent re-run.

### 5. `livewiki status --diff` — pre-commit debt preview ✅ DONE 2026-07-28

The anchor ledger detects debt AFTER a commit/index. Add a mode that maps
the UNCOMMITTED working-tree diff to the wiki pages whose anchors it would
invalidate ("this diff will invalidate anchors in pages X, Y"), closing
the document-as-you-go loop at pre-commit time instead of post-commit.
Read-only: no ledger mutation, no debt creation — preview only.

### 6. GitHub Actions template — "docs-debt on merge" ✅ v1 DONE 2026-08-02

Source: maintainer-approved evaluation (2026-07-14) of GitHub Agentic
Workflows for cross-repo documentation
(github.blog, Aspire team: docs draft-PRs on product merge, SME
auto-review, 82 merged doc PRs at a 44.8h median). Their pattern validates
livewiki's document-as-you-go thesis; livewiki's structural advantages to
preserve: mechanical verification gates hallucination BEFORE human review
(their only gate is the SME), and the anchor-ledger answers "does this
merge need docs?" deterministically with ZERO tokens (78% of their runs
spent a model call to conclude "no docs needed").

The template: on PR merge, run livewiki's own `index` + debt check
(deterministic, no LLM). When debt exists, livewiki may use the configured
standalone provider to pay it, validates every write, and opens a DRAFT PR with
the original PR author as reviewer. The no-debt case costs zero tokens. The
workflow uses ordinary repository permissions and narrowly allowlisted outputs;
it does not require GitHub Agentic Workflows, a custom GitHub App, or an external
agent/memory service. Protected-path changes are refused, and failure to create
a safe draft leaves a visible actionable result rather than silently writing.
Depends on Phase 6 (export) for the separate-docs-repo variant; the same-repo
variant could ship earlier. Also adopt their operational-metrics discipline
(median hours from feature merge to merged docs — `update-metrics.ts` is the
base).

**v1 shipped 2026-08-02 (detect + report, zero tokens):**
`packages/cli/templates/github-actions/docs-debt.yml` — push-triggered
`index --quiet` + `status --json`, debt table in the step summary,
`LIVEWIKI_DEBT_MODE=enforce|report` (fail vs informational),
`contents: read`, no secrets/GitHub App. Dogfooded by
`.github/workflows/docs-debt.yml` (local build pre-publish, report mode
for the first window). **Still open (v2):** the pay-variant — provider
pays the debt via `update --llm`, then `gh pr create --draft` with the
merge author as reviewer; needs provider secrets and
`pull-requests: write`.

### 7. Bounded parallel stage-4 execution (`batchConcurrency`) ✅ DONE 2026-08-01

Source: 2026-08-01 market scan (`docs/market-research.md`): Mintlify cut a
large-repo run 70→45 min with parallel section writers; RepoAgent ships
multi-threaded generation; Graphify ships concurrent LLM extraction
(`--max-concurrency`) with 429/Retry-After discipline. livewiki's stage 4
runs tasks sequentially (`packages/core/src/batch.ts:726`), and with
quality/cost already solved (Etapa 3: exit 0, verify zero, ~6–8% of
OpenWiki tokens) wall-clock is now the weakest axis. Add a
`batchConcurrency` config key (default 1 = current behavior; 3–5 typical).
Tasks are already atomic (transactional write, per-task checkpoint,
monotonic usage accounting), so they parallelize cleanly. Design care:
circuit-breaker semantics under interleaved failures, shared rate-limit
backoff honoring `Retry-After`, monotonic per-task usage history, and a
deterministic barrier before stage 5 (flows/topics consume stage-4
results).

**Result (2026-08-01, shipped in `dac874d`):** the sequential loop is
gone — stage 4 runs a bounded worker pool over the shared task cursor
(`batchConcurrency` config, integer 1..16, default 1; `--concurrency`
on `batch` and `init --batch`). Breaker/rollback stop NEW dispatch and
drain in-flight tasks; the pool is awaited before stage 5; reports
stay sorted by stage-3 priority; `Retry-After` is honored in
`llm/base.ts:parseRetryAfterMs`. Stage 5 stays sequential (shared hub
files inside transactions). Tests: `batch-concurrency.test.ts`.
The "runs tasks sequentially" premise above is historical — kept as
the source rationale.

### 8. Native CALLS edges with confidence tags ✅ DONE 2026-08-01

Source: 2026-08-01 Graphify analysis (EXTRACTED/INFERRED edge tags) plus
the standing watch-list item. Extend the indexer beyond imports with call
edges tagged by extraction confidence, and consume them in flow/topic
candidate detection: fewer false candidates, fewer burned repair rounds
(the class of bug fixed in `733fc53` came from weak graph evidence).
Native only (rule #8); never a general-purpose call-graph database — the
rejection below stands; this is the documentation-focused edge set only.

### 9. Community-detection cross-check for stage-2 modules ✅ DONE 2026-08-01

Source: 2026-08-01 Graphify analysis (Leiden communities with LLM-free
labels) plus the standing watch-list item. Use deterministic graph
clustering as a cross-check or fallback for the directory heuristic in
module identification. The exact-partition contract (100% of the indexed
inventory, heuristic wins on any rejection) is preserved; the goal is
better partitions with less reliance on the LLM refine pass.

### 10. Viewer freshness badge + social previews (Phase 7 polish) ✅ DONE 2026-08-01

Source: maintainer request + the codec8 thread insight (2026-08-01
`docs/market-research.md`). (a) A deterministic "new/recently changed"
badge in the viewer (sidebar + page header), derived from anchor-ledger
`detected_at` and/or git history — zero LLM, consistent with the
staleness-is-deterministic principle. (b) Social/OG preview metadata
(title, description, generated card) in the exported/built site so shared
doc links render professionally on Slack/Discord.

### 11. `export readme` — README as an output, not just an input ✅ DONE 2026-08-01

Source: 2026-08-01 codec8 analysis (`docs/market-research.md`) — their
sharpest idea is generating the repo README itself, and it connects to
the no-README fallback question: today a repo without a README gets an
omitted block plus a synthesized digest fallback; with this target the
answer becomes "livewiki writes you a starter README from the wiki".
An opt-in `export readme` target (Phase 6 family) that synthesizes a
README from accepted wiki pages (quickstart purpose, module digests,
flows). Hard constraints: only for repos without a README, or explicitly
opt-in overwrite of a `owner: generated`-marked block — never touches
human-authored README content (rule #6); content anchored and verified
like any generated artifact; positions livewiki's top-of-funnel ("your
first artifact in minutes") against one-shot generators while the debt
ledger keeps the long-term moat.

### 12. EOL-insensitive content hashing (phantom-debt fix) ✅ DONE 2026-08-01

Source: 2026-08-01 incremental-loop test on the real MPTP repo
(`docs/market-research.md` session; corpus `/c/tmp/livewiki-e2e/incremental-mptp-2026-08-01/`).
A CRLF↔LF-only difference (which git produces silently on checkout via
`core.autocrlf`) changes every `content_hash` and floods the ledger with
phantom `changed` debt — ~50% of 956 items in the test were exactly this.
Normalize line endings to `\n` before all content hashing (file-level and
symbol-level). The upgrade must NOT emit a one-time phantom debt wave for
EOL-only files: silently migrate hashes when the stored hash still matches
the legacy raw-bytes hash.

### 13. Conservative twin-file `moved` detection ✅ DONE 2026-08-01

Source: same 2026-08-01 test. Provider twins (`elevenlabs_music.py` hardened,
`sonilo.py` unchanged, identical old bodies) produced `moved` rewrites
pointing page anchors at the twin that KEPT the old implementation — verify
passes (anchors exist) while prose and anchor describe different
implementations: an anti-hallucination hole. Policy (maintainer-approved):
accept a `moved` only when the symbol is gone from ALL active files (no
same-name twin survives anywhere); otherwise classify as `changed` (donor)
and let the new occurrence surface as new/undocumented.

### 14. In-session cost accounting ✅ DONE 2026-08-01

Source: maintainer review of the 2026-08-01 incremental MPTP update. The
in-session payment path (the agent already in the user's session writes
the prose) rides the host subscription instead of per-token billing — a
real cost in a different currency, and today it is UNMEASURED: batch has
exact checkpoint accounting, in-session has nothing. Make the loop
measurable: every payment session records estimated tokens written +
debt closed (wire `--record-write` / `update-metrics.ts` into the flow as
a required step, surfaced in `status`/metrics), so the in-session vs
batch economics per repo are decided on numbers, not guesses.

### 15. Activity dashboard (viewer) ✅ DONE 2026-08-02

Source: maintainer directive 2026-08-01 ("everything accounted and
expressed to the client"). Once item 14's accounting history exists
(`update_metrics.json` + batch checkpoints), the Phase 7 viewer gains an
Activity/dashboard page rendering the full documentation-activity history
of the repo: packages emitted, tokens consumed per period (estimated
in-session vs provider-billed batch), debt burndown over time, writes per
page, and time-to-document metrics (median hours from code change to paid
debt — the operational-metrics discipline of backlog #6). Static, offline,
deterministic — built at site-build time from the metrics file and
index.db, zero LLM. Implemented after item 14.

### 16. Dogfood batch on the livewiki repo itself ✅ DONE 2026-08-02

Source: maintainer directive 2026-08-02, after the deterministic `init`
regen of the repo's own stale wiki. The reindex surfaced the real debt
behind months of drift: 208 `changed` items across the dogfood module
pages (`core.md`, `cli.md`, `mcp.md`) — pages anchored to code written
long before the U–X/R10/R11/Etapa series. Run one approved `init --batch`
(paid, MiniMax-M3 or current reference provider) on this repository to
regenerate the module pages from current code, closing the 208 items and
leaving `verify` at zero issues. Side benefits: a live self-hosting
corpus for the Activity dashboard and a real-world acceptance pass over
the current pipeline (recovery tier, topics, concurrency). Requires
explicit paid-call approval at execution time.

**Result (2026-08-02, MiniMax-M3 via openai-compat + token proxy,
`--no-refine`):** run #1 `completed`, 138 tasks done / 0 failed, exit 0,
~30 min. Verify OK (141 pages, zero issues). Accounting exact:
checkpoint 583,202 in + 159,491 out = 742,693 tokens == proxy
(742,735 − 42 smoke ping). 29 anchored modules LLM-documented (stage 4,
561k tokens), 107 prose-tier auxiliary modules via the deterministic
compact zero-token contract, stage 5: 3 flows + 1 topic-plan (3 flow
candidates skipped on seed-key overlap, `flowMaxOverlap` working as
designed). Zero degraded pages. The 208 stale `changed` debt rows
dangled after the rewrite and were closed (`resolved_at`) with a
`debt_resolved` ×208 ledger entry; `status` now reports debt 0.

### 17. Viewer version stamp + source deep-links (PRE-BETA) ✅ DONE 2026-08-03

Source: CodeWiki review 2026-08-03 (Google's codewiki.google — hosted,
Gemini-generated; its strongest mechanic is pinning every code mention
to the generating commit). Maintainer decision 2026-08-03: pre-launch,
not post-beta. livewiki already versions the wiki in git; ship the
surface: the viewer stamps `Updated on / Commit <sha>` (one bounded git
call, freshness-badge discipline — no git ⇒ no stamp, never an error)
and renders per-anchor source links (local file offline; GitHub blob URL
when a remote is detected — optional surface, graceful degrade). Zero
LLM, no generation-contract change.

**Result (2026-08-03, implemented, uncommitted):** the chrome stamps
`Updated on <date> · Commit <short-sha>` under the brand from one bounded
`git log -1 --format=%H%n%cI -- livewiki/` probe (`probeWikiStamp` /
`parseWikiStamp`; git state only, any failure ⇒ no stamp). Source
deep-links are gated on BOTH a GitHub remote (`git remote get-url origin`
normalized by `normalizeGitHubRemote`, https/git@ forms) and the stamp
commit: a compact `Sources:` line after the page H1 (unique file paths
from the frontmatter `anchors:`, deduped and sorted, file-level blob
links) and each `<!-- lw:anchors ... -->` marker replaced with a
`source: <path>` blob link. All probes share the new `runGitCaptured`
bounded-spawn helper (shell:false, injectable); no remote ⇒ no links
(offline posture preserved). Shipped in `be9c8c4`; gate core 1631 /
CLI 125 / MCP 56; matrix green run 30784207402.

### 18. `livewiki view --ref <tag|sha>` (PRE-BETA) ✅ DONE 2026-08-03

Source: maintainer request 2026-08-03 — "version the wikis so the user
can compare 0.1 vs 0.2"; pre-launch per the same decision. Build the
site from `livewiki/` as it existed at any git ref via `git show`
(read-only, no checkout, working tree untouched). Two builds side by
side (e.g. `--out .livewiki/site-v0.1` vs current) give the real version
comparison; combined with item 17's stamp the user always knows which
version they are reading.

**Result (2026-08-03, implemented, uncommitted):** `livewiki view --ref
<tag|sha>` builds the site from the wiki as of the ref via a small
`WikiSource` abstraction (disk vs git-ref) inside `buildSite` — artifacts
enumerated with `git ls-tree -r --name-only <ref> -- livewiki/` (filtered
by the same canonical rules as the disk walker, exported as
`filterWikiArtifactPaths`) and read with `git show <ref>:<path>`; the
working tree is never touched. Freshness badges are off in ref mode (they
compare against the working-tree log); the item-17 stamp uses the ref's
own newest wiki commit and deep links use its sha. An unresolvable,
empty, or flag-like ref throws `ViewError("invalid_ref")` → CLI exit 1
with the git detail (human and JSON). Default output stays
`.livewiki/site/`; `--out` is the documented way to keep two versions
side by side. Shipped in `be9c8c4`; gate core 1631 / CLI 125 / MCP 56;
matrix green run 30784207402; smoke: `--ref HEAD~5` built 158 pages vs
62 current.

### 19. Tier-1 anchored support: Go (PRE-BETA) ✅ DONE 2026-08-03

Source: maintainer decision 2026-08-03 — tier-1 language expansion moves
from "usage-driven post-beta" to PRE-LAUNCH, starting with Go, Rust, and
Java (one item each). Per language: vendor/download the tree-sitter WASM
grammar (rule #4 one-time download exception), write the symbol extractor
in `symbols.ts` (function/class/method rules with the same anchor-quality
bar as TS/Python — this machinery is the anti-hallucination core, so
extraction fidelity is the acceptance bar), extend import resolution in
`modules.ts` (Go package paths), and add unit + stub-E2E coverage.
Pilot language: do Go FIRST to prove the extractor pattern before
replicating to Rust and Java. Validation: one `init --batch` acceptance
run on a real Go repo (paid, requires approval at execution time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews):
`tree-sitter-go.wasm` vendored in `packages/core/grammars/` (built with
tree-sitter-cli 0.26.10 + auto-downloaded wasi-sdk from tree-sitter-go
2346a3a; the `tree-sitter-wasms` npm build was rejected — legacy `dylink`
section, web-tree-sitter 0.26 requires `dylink.0`). `.go` mapped in
`parser.ts`/`walker.ts`. `symbols.ts`: `function_declaration` → function,
`method_declaration` → method keyed `path#Type.method` (pointer receivers
stripped: `*T` → `T`, value/pointer share the key), `type_declaration` →
`class` for `struct_type`, new `SymbolKind` `"interface"` for
`interface_type` (additive; class diagrams only match `class`; DB column
is free-text), local type declarations inside function bodies skipped
(same policy as local classes), grouped `type ( ... )` handled, aliases
to non-struct/iface types skipped. Calls: `call_expression` with bare
identifier → `extracted`, `selector_expression` field → `inferred`.
Rationales: tagged `comment` nodes work unchanged (Go has no docstrings).
Imports: `imports.ts` extracts `import_declaration`/`import_spec` (single,
grouped, aliased, blank, raw-string paths) as `go-import`;
`import-resolution.ts` gains `loadGoModulePath` (root `go.mod` module
directive) + `resolveGoSpecifier` — an import `<module>/<sub>` produces
one edge per direct `.go` file of directory `<sub>` (Go packages are
directories; nested dirs excluded, `_test.go` included); stdlib /
third-party / no-go.mod ⇒ external. Wired into batch.ts, init.ts,
status.ts (risk), change-impact.ts. Fixture `test/fixtures/sample-go-repo`
(go.mod + cmd/main.go + server/server.go). Tests: parser, walker,
symbols (10 Go), calls (6 Go), imports (3 Go), import-resolution (10 Go:
with/without go.mod, internal vs external, nested-dir exclusion, module
edges, loadGoModulePath), indexer fixture integration (tiers, key shapes,
calls, rationales). Existing prose-tier tests that used `.go` as the
grammar-less example switched to `.rb`/`.rs` (walker, indexer, CLI
prose-tier E2E). Gate: `pnpm -r build` clean; core 1668 / CLI 125 / MCP
56; live CLI smoke on the fixture: 7 symbols (3 functions, 1 class, 1
interface, 2 methods), `go: anchored` tier. **Acceptance run
(2026-08-03, approved paid):** `init --batch --no-refine` on
`spf13/cobra` (36 .go files) via MiniMax-M3 proxy — run #1 `completed`,
17 tasks done / 0 failed, exit 0, verify OK (21 pages, zero issues),
checkpoint 342,905 in + 98,129 out = 441,034 tokens == proxy
(441,076 − 42 smoke). Real Go anchors confirmed
(`command.go#Command.Execute`, `bash_completions.go#Command.GenBashCompletion`),
orientation pulls the real README purpose, 1 flow accepted / 3 skipped
on overlap. Clone preserved locally at `/c/tmp/cobra` (evidence, not
in the repo).

### 20. Tier-1 anchored support: Rust (PRE-BETA) ✅ DONE 2026-08-03

Same shape as item 19 (grammar + extractor + import resolution — Rust
`mod`/`use`/crate resolution) after the Go pilot proves the pattern.
Acceptance: batch run on a real Rust repo (paid, approved at the time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews):
`tree-sitter-rust.wasm` vendored in `packages/core/grammars/` (built with
tree-sitter-cli 0.26.10 + auto-downloaded wasi-sdk from tree-sitter-rust
77a3747; loads verified by parsing a probe file with web-tree-sitter
0.26.10 before vendoring). `.rs` mapped in `parser.ts`/`walker.ts`.
`symbols.ts`: `function_item` → function; inside an `impl_item` body →
method keyed `path#Type.name` for BOTH `impl T` and `impl Trait for T`
(decision: trait-impl members are callable on T, so they share the key
space; generic `impl<T> Vec<T>` keys under the base `Vec`, scoped
`impl a::B` under `B`); `struct_item` → `class`; `enum_item` → `class`
(least invasive — variants are not citable symbols); `trait_item` →
`interface` with member signatures NOT extracted (same policy as Go
interfaces); items inside function bodies skipped (local-class policy);
nested `fn` keeps the plain key (same as TS). Calls: `call_expression`
with bare identifier → `extracted`, `generic_function` (bare `foo::<T>()`)
→ `extracted`, `field_expression` (`x.m()`) and `scoped_identifier`
(`path::f()`, `Type::assoc()`) right-most name → `inferred`; macro
invocations (`println!`) are not call_expressions and are skipped.
Rationales: Rust comment nodes are `line_comment`/`block_comment` (added
alongside `comment`); `///` outer and `//!` inner doc comments (and `/**`
blocks) count as docstrings (≥20 normalized chars; `////` excluded);
tagged WHY/NOTE/HACK/TODO/FIXME comments work unchanged. One extractor
fix the Rust grammar forced: `line_comment` nodes INCLUDE the trailing
newline, so the positional attribution line range is clamped to a single
line. Imports: `imports.ts` extracts `use_declaration` as `rust-use`
(braces `use a::{b, c}` record the shared prefix `a`, aliases `as` record
the original path, wildcards drop `::*`, `pub use` identical) and
bodiless `mod foo;` as `rust-mod` (inline `mod { }` ignored).
`import-resolution.ts`: `loadRustCrateName` reads the root `Cargo.toml`
`[package] name` (comment-tolerant; null without it); resolution v1 —
`crate::` from the crate source root (`src/` when a known
`src/lib.rs`/`src/main.rs` exists, else repo root), `self::` relative to
the current file's module dir, one `super::` per module-dir climb, the
crate's own name (hyphens read as underscores — the integration-test
form) as a `crate::` alias; remaining segments resolve longest-prefix-
first against `<path>.rs` / `<path>/mod.rs`; `mod foo;` resolves under
the current file's module dir (stem dir for non-mod/main/lib files);
external crates (`std`, `core`, third-party) and unknown paths stay
external. Cargo workspaces (multi-crate) OUT OF SCOPE for v1. Wired into
batch.ts, init.ts, status.ts (risk), change-impact.ts. Fixture
`test/fixtures/sample-rust-repo` (Cargo.toml + src/{main,models,server}.rs).
Tests: parser (2), walker (1 new + grammar-less example moved .rs → .kt),
symbols (10 Rust extraction + 6 Rust rationales), calls (8 Rust), imports
(6 Rust), import-resolution (12 Rust + 4 loadRustCrateName), indexer
fixture integration (3: tiers/key shapes, calls+rationales). Prose-tier
tests that used `.rs` as the grammar-less example switched to `.rb`
(indexer) and `.kt` (walker, CLI prose-tier E2E). Also fixed a latent
defect exposed while validating: the committed Go fixture had picked up
a stale `.livewiki/` cache from the item-19 live smoke (gitignored,
invisible to git), which made its indexer test report `filesAdded: 0` —
cache deleted, Go test green again. Gate: `pnpm -r build` clean; core
1719 / CLI 125 / MCP 56; live CLI smoke on a fixture copy: 13 symbols
(4 functions, 3 classes, 5 methods, 1 interface), `rust: anchored`
tier. **Acceptance run (2026-08-03, approved paid):** `init --batch
--no-refine` on `ajeetdsouza/zoxide` (25 .rs files) via MiniMax-M3
proxy — run #1 `completed`, 15 tasks done / 0 failed, exit 0, verify
OK (19 pages, zero issues), checkpoint 148,633 tokens == proxy
EXACTLY (no smoke ping this run). Real Rust anchors confirmed
(`src/db/dir.rs#Dir`, `#Dir.score`, `#DirDisplay.fmt` — impl method
keys live). Clone preserved locally at `/c/tmp/zoxide` (evidence, not
in the repo).

### 21. Tier-1 anchored support: Java (PRE-BETA) ✅ DONE 2026-08-03

Same shape as item 19 (grammar + extractor + package/import resolution)
after the Go pilot. Acceptance: batch run on a real Java repo (paid,
approved at the time).

Result (implementation, 2026-08-03, uncommitted — coordinator reviews;
gate numbers filled: `pnpm -r build` clean, core 1758 / CLI 124+1
EBUSY load-flake (isolated 21/21 + 5/5 green) / MCP 56; smoke on a
fixture copy: 16 symbols — 4 class / 1 interface / 11 method,
`java (anchored)` tier): `tree-sitter-java.wasm`
vendored in `packages/core/grammars/` (built with tree-sitter-cli
0.26.10 + auto-downloaded wasi-sdk from tree-sitter-java e10607b; loads
verified by parsing a probe file with web-tree-sitter 0.26.10 before
vendoring). `.java` mapped in `parser.ts`/`walker.ts`. `symbols.ts`:
`class_declaration` → `class` via the EXISTING shared TS case (same node
type name); `interface_declaration` → `interface`; `enum_declaration` and
`record_declaration` → `class` (mirrors the Rust enum decision — named
data types; constants/components are not citable); `method_declaration` →
method keyed `path#Type.name` under the innermost enclosing type (one
shared case with Go: qualifier = `receiver ?? parentClassName` — Go's
node always has a receiver, Java's never does); interface member
signatures ARE extracted as `Interface.name` (documented delta from the
Go/Rust no-signatures policy — Java interfaces carry default/static
bodies and their members are the callable surface); the
interface/enum/record cases are GATED to `.java` — TypeScript shares the
`interface_declaration`/`enum_declaration` node type names and TS
interfaces/enums were never extracted before item 21 (a scope leak
caught in self-review, closed with a guard test);
`constructor_declaration` → method keyed `Type.Type`; local classes
inside method bodies skipped (existing local-class policy);
`annotation_type_declaration` not extracted v1. Calls: `method_invocation`
confidence from the PRESENCE of the `object` field — bare `m()` →
`extracted`, `x.m()`/`Type.m()`/`a.b.m()`/`this.m()` → `inferred`;
`object_creation_expression` (`new X()`, scoped `new a.b.C()`, generic
`new ArrayList<String>()`) → always `extracted` with the right-most
type_identifier as the callee (same policy as TS `new_expression`).
Rationales: Java uses the `line_comment`/`block_comment` nodes added for
Rust; Javadoc `/** */` counts as a docstring via the shared TS branch
(≥20 normalized chars); tagged comments unchanged. One behavior worth
noting: Javadoc above a method attributes to the ENCLOSING CLASS (rule 1
of the pinned positional-attribution contract — the comment sits inside
the class's line range; same as TS, regression-tested).
Imports: `imports.ts` extracts `import_declaration` as `java-import`
(shares the Go node type — disambiguated by child shapes:
`import_spec`/`import_spec_list` = Go, `scoped_identifier`/`identifier` =
Java); plain/static/wildcard forms all record the full dotted path (the
wildcard's `*` is a separate asterisk child; a static import's member
stays in the path). `import-resolution.ts`: NO loader — a Java package
IS a directory, so pom.xml/gradle parsing is out of scope v1 and the
five `resolveImportEdges` call sites stay untouched (Java differs from
Go/Rust precisely here: their manifests name modules by string, Java's
dotted path is already a repo-relative directory path). Resolution v1:
the FIRST candidate source root containing a known `.java` file wins
(`src/main/java`, then `src/`, then the repo root); under it the LONGEST
segment prefix naming a directory that directly holds `.java` files is
the target package (drops the plain import's type name, the static
import's member, matches the wildcard's package through one walk); the
edge targets that package's direct `.java` files (non-recursive);
`java.*`/`javax.*`/unknown packages stay external. Fixture
`test/fixtures/sample-java-repo` (Maven layout:
src/main/java/com/fixture/{Main,server/{Server,Handler,Mode},model/Item}.java).
Tests: parser (2), walker (1 new + grammar-less example dropped `.java`,
now `.kt`/`.rb`/`.zig`), symbols (8 Java extraction + 5 Java rationales),
calls (7 Java), imports (4 Java), import-resolution (9 Java), indexer
fixture integration (3: tiers/key shapes, calls+rationales). **Acceptance
run (2026-08-03, approved paid):** `init --batch --no-refine` on
`google/gson` main module (210 .java files) via MiniMax-M3 proxy — run
`completed_with_failures` (71 done / 1 flow repair_exhausted: the model
kept omitting the required lw:anchors marker in the "Ordered flow"
section, same model-residual class as Etapa 3) then ONE disclosed
`--only` retry on the failed flow → run #1 `completed`, 72/72 done, 0
failed, exit 0, verify OK (76 pages, zero issues). Accounting:
1,343,614 in + 533,034 out = 1,876,648 tokens == proxy EXACTLY
(1,852,822 + 23,826 retry). Java anchors live incl. constructor and
nested-type keys (`Gson.java#Gson.Gson`, `TypeAdapter.java#TypeAdapter.read`,
`#NullSafeTypeAdapter.read`, `TypeToken.java#TypeToken`). Clone
preserved locally at `/c/tmp/gson` (evidence, not in the repo). The
no-recovery autonomous bar was NOT met (one disclosed retry) — same
standing caveat as previous acceptances.

### 22. CodeWiki-grade output format (PRE-BETA) ✅ DONE 2026-08-03 (A/B passed, defaults ON)

Source: CodeWiki review 2026-08-03 — the maintainer's first reaction to
Google's codewiki.google was "o wiki final está muito bom; a formatação
está excelente". **Maintainer decision 2026-08-03: promoted from
post-beta to PRE-BETA (after #23, before publish).** Two gaps vs our
corpus, both generation-contract
changes (LLM prompts + artifact validation + repair contract, so NOT
free like #17): (a) **one Mermaid diagram per section** — CodeWiki
opens every H2/H3 section with a diagram; our pages have diagrams only
for flows and class inventories; (b) **deeper concept hierarchy** —
their pages run H2 sections with H3 subsections (e.g. "Building MCP
Servers" → "Advanced OAuth 2.0 Implementation"); our module pages are
flatter. Design questions before implementation: diagram budget per
page (stage-5 flow budgets are the precedent), diagram validity gate
(mermaid-validator already exists), and whether this ships as a page-
kind variant or a prompt-contract revision. Evaluate on the A/B harness
before adopting — CodeWiki's static text quality was impressive but
unmeasured against our corpus.

**Result (implementation, 2026-08-03 — gate: `pnpm -r build` clean,
core 1814 / CLI 125 / MCP 56):** implemented as a prompt-contract REVISION on the
existing module page kind behind two config flags, both default off (D3 —
flags off is byte-identical pre-#22 behavior, proven by the full
deterministic suite). `moduleDiagrams` (D1/D2 hard contract): ONE diagram
per module page (not per section) reusing the stage-5 flow machinery — the
model emits the diagram INLINE in a new `## Diagram` section after `How it
fits`, the orchestrator extracts it to `livewiki/diagrams/<slug>.mmd`, and
the page keeps only the exact `%% livewiki/diagrams/<slug>.mmd` placeholder;
page + diagram land in ONE transactional write (flow dual-artifact
pattern), gated by `validateMermaidSyntax` and the reused
`flowMaxDiagramNodes`/`flowMaxDiagramEdges` budgets. Naming: model-drawn
module diagram `<slug>.mmd`; deterministic class diagram stays
`<slug>.classes.mmd`; flow diagrams keep `flow-<slug>.mmd`. Validation: new
`Stage4ValidationContext.expectedModuleDiagram` placeholder check with the
new `module_diagram_placeholder` code; `invalid_flow_diagram` /
`flow_diagram_too_large` move from report-only to supported module fixes
(the module gate is LIVE — the model draws the diagram); every new/changed
code classified in `repair-contract.ts` (exhaustiveness test green).
`deepHierarchy` (D2 soft contract): prompt guidance only — ≥ 8 symbols ⇒
concept-named H2 sections with H3 symbol subsections; no new validation
code. Tests: `module-diagram-format.test.ts` (20 unit) +
`batch-module-diagrams.test.ts` (4 stub E2E: extraction, placeholder, valid
mermaid, verify zero, repair ACTION directive, monotonic `--only` rerun,
flags-off byte-identical) + config key validation. The A/B acceptance
evaluation comes later per D3 — not in this pass.

**Acceptance A/B + default flip (2026-08-03, maintainer decision):** the A/B
passed — 18/18 tasks completed, 14/14 diagrams valid, +11% tokens — so BOTH
flags now default to `true` in `CONFIG_DEFAULTS`. Batch fixtures exercising
the pre-#22 stage-4 contract pin `moduleDiagrams: false` /
`deepHierarchy: false` explicitly (config.json or BatchOptions) with a
pointer comment; the #22-on suites (`module-diagram-format.test.ts`,
`batch-module-diagrams.test.ts`) are unchanged and still test flags ON.
Gate after the flip: full core suite 1814 passed / 14 skipped, CLI 125,
build clean.

### 23. Repository understanding layer (PRE-BETA) ✅ DONE 2026-08-03

Source: maintainer 2026-08-03 — the quickstart orientation proved the
gap on this very repo: with no README, the deterministic fallback
synthesized a module enumeration, not a purpose ("organized around Core
Repair, Status…"). Broader than a no-README patch: **the README is one
evidence input, never the authority** — a bad README ("porcaria") must
not poison the orientation either. Design: batch stage 5 gains ONE
bounded task (same machinery as flows/topics) that synthesizes the
**repository understanding** — what the repo is, for whom, key surfaces
— from the closed evidence inventory (accepted module pages, flows,
topics, entry points, README when present). Everything it may claim is
already verify-gated, so the synthesis inherits the anti-hallucination
contract. Orientation rules: synthesis is the primary `## What this
repository is` content with provenance marking; README purpose becomes
provenance-marked evidence inside it. `export readme` uses the
synthesis as its purpose paragraph; the refuse-to-overwrite-human-README
contract (rule #6) is unchanged — the wiki is where the understanding
lives. Cost: one LLM call per batch, always — detection stays zero-token,
writing stays minimal. Acceptance: on a no-README repo AND on a
bad-README repo, the quickstart states the product's purpose correctly
without human edits.

Result (implementation, 2026-08-03 — uncommitted): implemented as stage
5c. ONE bounded `understanding:<evidenceHash>` task after topics
(`runUnderstandingStage` in `batch.ts`) synthesizes
`livewiki/understanding.md` from the closed inventory (accepted module
digests, flows, topics, entry surfaces, README purpose). Persistence form:
option (a) — a real wiki page, read back by the deterministic quickstart
regeneration exactly like module digests (rule #3 stays clean). The
artifact carries no anchors and follows a dedicated strict contract in the
new `packages/core/src/understanding.ts` (single 40–600-char purpose
paragraph, optional ≤10-bullet `Key surfaces`, no code spans/links/TODO);
deliberately NO new `ArtifactPageKind`/`ArtifactValidationCode` (the Etapa
2a exhaustiveness test pins both) and no surgical/relaxed round (the
artifact is one paragraph). Checkpoint reuse on unchanged evidence ⇒ zero
LLM calls; `--only understanding` reruns; ownership mirrors topics
(`refused_owned_understanding`); `understandingSynthesis` config (default
true). Quickstart priority: synthesis (provenance-marked, README quoted
as evidence) → README purpose → digest fallback, byte-exact without a
synthesis; `export readme` prefers the synthesis. Tests:
`understanding.test.ts` (12), `batch-understanding.test.ts` (7, stub
LLM), plus blocks in `navigation.test.ts` and `readme-export.test.ts`.
Gate: `pnpm -r build` clean; core 1783 / CLI 125 / MCP 56. **Acceptance
(2026-08-03, approved paid):** batch on a no-README zoxide copy — the
quickstart opened with a correct synthesized purpose (provenance:
"Synthesized from the verified wiki pages") with zero human edits;
then a sabotaged README (badges + lorem) was added and a free `init`
regen kept the synthesis primary, demoting the junk README to a quoted
evidence line ("one evidence input, not the authority"). Both design
cases PASS. Run: 16 tasks done / 0 failed, exit 0, verify OK (20
pages), checkpoint 116,975 + 35,855 = 152,830 tokens == proxy EXACTLY.

### 24. Test-role classification (PRE-BETA) ✅ DONE 2026-08-04

Source: external re-review 2026-08-03 (finding P2, confirmed with live
measurements on this repo's own index): `PathRole` has no "test" concept,
so tests co-located with product code classify as product — 94 of 217
anchored files (43%) here, splitting `packages/core/src` into
`core-src-01…13` under `maxFiles: 12`, anchoring 321 test symbols in 17
generated pages (`modules.test.ts#idFor` documented as public API), and
burning ~40% of stage-4 tokens on content nobody reads. Design
(maintainer-reviewed 2026-08-04):
`docs/plans/2026-08-04-test-role-classification.md` — add `"test"` to
`PathRole` + `pathRoles.testPatterns` with language-convention defaults
(`.test.`/`.spec.`/`__tests__`, `test_*.py`/`*_test.py`/`*_test.go`,
`*Test(s).java`, Maven/Gradle `src/test/{java,kotlin}/**`, prose-tier
Kotlin/Scala/C#; bare `tests/` dirs and Cargo `tests/` stay opt-in/out of
v1); per-file role split BEFORE directory grouping (the per-module
majority vote cannot fix co-located tests); test modules ride the
deterministic auxiliary channel (zero LLM tokens) WITHOUT leaving the
index — anchors and `verify` keep working; a generated-only
stale-module-page cleanup on every batch/init regen migrates existing
wikis (human/mixed/untrusted pages preserved and reported, mirroring the
flow/topic precedent). Acceptance: no product page contains a test-file
anchor; no old-partition orphan page remains on disk; `verify` zero
issues. Sequencing (2026-08-04):
the repo's `changed` doc debt is paid AFTER #24 lands — repartition
first, then pay, to avoid spending tokens on pages that will stop
existing.

### 25. Semantic partition of oversized modules (SUPERSEDED by #29, 2026-08-07)

> Closed without implementation. The maintainer review of 2026-08-07
> established that renaming chunk buckets treats a symptom: the defect is
> that the page unit is invented, not that its name is mechanical. See
> #29 and `docs/plans/2026-08-07-real-repository-page-units.md`. The
> deterministic foundation written for this item (`page-slug.ts` + 35
> green tests) was never wired into any caller and was deleted at the
> 2026-08-07 wrap; its value was the dry-run that made the unit defect
> visible, preserved in this item's design doc.


Source: the "names that say nothing" half of the 2026-08-03 P2 finding —
`core-src-07`, "core-src-06 stage-5 internals". The original diagnosis
(test files force the split) was WRONG, corrected 2026-08-04: removing
tests only moved `packages/core/src` from 13 to 11 chunks. The binding
axis is `maxSymbols: 80` over giant files (`batch.ts` alone holds 55
symbols), so the directory splits into ~11 chunks even with zero test
files. Levers: the `maxSymbols` default; smarter chunking along import
communities (item 9's diagnostic data); and stage-2 semantic
rename/re-boundary (the refine contract already lets the LLM RENAME
modules and ADJUST boundaries). Open questions: raise the symbol cap vs
community-aware chunk boundaries vs post-split LLM naming only. Not a
#24 acceptance gap — #24 delivered its measurable half (zero test
anchors in product pages, zero tokens on tests); this is the residual
half with a different cause.

### 26. Metadata-boosted ranking for `livewiki_search` (post-beta)

Source: Cloudflare Agents Week 2026 scan (2026-08-04,
[AI Search post](https://blog.cloudflare.com/ai-search-agent-primitive/)) —
query-time relevance boosting on document metadata (`boost_by`). Our
equivalent, fully deterministic and zero-LLM: boost product-tier pages
over auxiliary/test-role pages and fresh pages over stale ones in the
FTS5 result ranking. Small, testable, keeps the offline posture.
(Their RRF/vector hybrid is NOT adopted — embeddings conflict with the
deterministic/offline promise; see "Evaluated and rejected".)

### 27. Trigram / partial-match search for identifiers (post-beta)

Source: same scan — Cloudflare's guidance is porter for prose, trigram
for code ("conf" matches "configuration"). Our identifier-split FTS5
table covers camelCase/PascalCase/snake_case boundaries but not
arbitrary substrings. FTS5 has no native trigram tokenizer, so this is
real work (custom token table or external tokenizer); candidate only,
evaluate demand first.

### 28. Validation severity lifecycle: report-only → blocking (post-beta)

Source: Cloudflare Codex post
([engineering-standards-enforcement](https://blog.cloudflare.com/engineering-standards-enforcement/)) —
RFCs ship `approved` (non-blocking findings) and are promoted to
`enforced` (blocking) only after teams absorb them. Our analogue: new
artifact/verify validation codes enter as report-only and become
blocking in a later release, so tightening a contract never
retroactively breaks existing user wikis. Small; protects the exact
pain we hit every time a new validation code lands.

### 29. Real repository page units (PRE-BETA) — supersedes #25 ✅ P0–P5 DONE 2026-08-09 (commit 6e5efdb + paid rehearsal/full run on the external clone: exit 0, 63/0, verify OK 68 pages, 663k tokens, checkpoint == proxy exact; evidence in docs/handoffs/2026-08-09-29-p5-rehearsal-app-utils.md, local-only)

Source: maintainer review 2026-08-07. #25 was scoped as "rename the
mechanical page names"; the review established that the names were a
symptom and the defect is the page UNIT. `core-src-03` exists nowhere in
the repository — it is bucket 3 of an 80-symbol cut, and the wiki
presents eleven fabricated units as if they were the code's
organization. Every anchor resolves and `verify` reports zero, but the
STRUCTURE is invented, and "present only what is real" governs structure
as much as prose. Renaming would have made it worse: `core-src-03.md` is
ugly but honest (the `03` announces the slice), while
`config-index-export-diagrams-diff-preview.md` presents an arbitrary
bucket as a coherent module — a plausible name over a fabricated unit,
which is the exact failure the tool exists to prevent.

Principle: **chunking is a generation concern, a page is a presentation
concern**; today they are the same object. Chunking stays (budget, retry
granularity, `--only`) but stops reaching disk. A page's unit becomes a
file or a folder — things that exist.

Measured deterministically over this repo's index (zero tokens, design
doc `docs/plans/2026-08-07-real-repository-page-units.md`): content is
ALREADY complete (`core-src-03` documents 80 of its files' 80 symbols —
this is a reorganization, not a content expansion); 90 file pages + 31
folder pages = 121 against today's 50 averaging 4.4 stapled files; ZERO
files exceed `maxModuleSymbols: 80` (max 55 — the budget was blown by
grouping files, never by a file); source bytes are the real pressure
(`batch.ts` 262KB); and the product↔test pairing becomes verifiable —
55 of 86 test files pair 1:1 by name, 20 more by prefix, 11 match
nothing, and 35 product files have no test at all (a true fact the
current structure hides).

Open: what the folder page holds (a synthesis, not a concatenation — a
new LLM call per folder); whether tests keep their own pages at all
(#24 gave them pages as a side effect, not by reader demand); the 11
unmatched test suites; `batch.ts`'s internal split; the 33 inert files;
and cost (estimated 1.5x the 731k full batch — an estimate, to be
measured on one folder before committing). Carries the
`syncStaleModulePages` hazard, which survives ANY scheme: its keep-set is
`${module.id}.md`, so the first full batch after page paths stop being
module ids deletes the wiki (`owner: generated` pages, the ownership
guard does not save them).

### 30. Human-first wiki readability (product refinement phase)

Source: maintainer directive 2026-08-09, from reading the P5 full-run
corpus (`app-utils` folder page). The next product phase: **the wiki must
be readable and understandable by a lay human**, not just verifiable by
a machine. First findings, all on the folder page (`folder-page.ts`,
deterministic — zero tokens to change):

1. **The file guide shows machine metrics, not meaning.** `Files` lists
   `file_security.py — 1 symbol`; a human wants "what is this file for".
   The answer already exists — the accepted file page's H1 title
   ("File path containment for whitelisted directories"). Reuse the child
   page title in the guide instead of (or alongside) the symbol count.
2. **"Same-name test coverage: 0 of 3 documented files" is insider
   jargon.** A lay reader cannot parse it. Reword in plain language
   ("none of these files has a same-named test file") or drop the line.
3. Minor: purpose-paragraph redundancy ("lightweight, dependency-light")
   and inconsistent Navigate neighbor labels ("App services module" vs
   the folder-id style of the other entries).

Wider question for the phase: audit every deterministic surface
(quickstart, tasks, folder skeletons, Navigate blocks, hub pages) for
machine-first phrasing, and every LLM prompt for prose that assumes
reader context a lay human does not have.

**First pass implemented 2026-08-11 (uncommitted; deterministic gate
green — core 1833 / CLI 126 / MCP 56, zero paid calls):** (1) the file
guide leads with the accepted child page's title
(`titlesByPagePath` + `extractPageTitle` in `folder-page.ts`, titles
harvested in the existing `batch.ts` page-read loop; symbol count is
the fallback, failed generations still degrade to a plain name);
(2) the coverage line is plain language (`plainTestCoverageLine` —
none/partial/all/single-file sentence shapes); (3a) the folder-purpose
prompt rules ban near-synonym adjective pairs ("lightweight,
dependency-light"); (3b) `loadModulePresentations` accepts a folder
page's directory-path title even when it normalizes to the module id,
so Navigate labels are uniformly folder-id style.

**Audit run 2026-08-11 (three fronts, read-only; maintainer framing:
agent-facing surfaces STAY machine-precise — frontmatter, anchors,
ledger, validation contracts — reading surfaces and the viewer HTML go
human-first).** Findings, in the approved implementation sequence:

*Step 1 — contract fixes (not style):* `buildTopicRepairPrompt` drops
three shared rules the initial topic prompt has
(`EXCEPTION_BRANCH_PROMPT_RULE`, `INVENTORY_AUTHORITY_PROMPT_RULE`,
`BRANCH_PRECISION_PROMPT_RULE`) — a repaired topic page can silently
lose accuracy guarantees; `buildFileSectionPrompt` paraphrases the
literal-signature rule instead of using the shared
`LITERAL_SIGNATURE_PROMPT_RULE` constant.

*Step 2 — deterministic Markdown strings:* dead pre-#29 vocabulary
("modules", "symbols extracted", "Module ID:", "— part N of M") in the
quickstart stats, overview intro/cards, tasks "Other modules", fallback
display titles, and `modules.mmd` ("No module edges detected");
pipeline internals leaking to readers ("prompt budget / closed-list
symbols" in the coverage note, "generation failed", "name-prefix match,
not verified", "is classified as … so its symbols stay addressable from
anchors" in auxiliary pages); jargon labels ("Organogram",
"— dependency and dependent", "Auxiliary modules" hub). Vocabulary
decision: the lay-visible unit is the directory path / "folder".

*Step 3 — viewer HTML (the human-first surface):* Activity dashboard
renders raw event enums (`package_emitted …`, `debt_resolved … via
cli`), a "write/package token ratio" card, "median detection→payment",
and a "1 batch runs" plural bug; the home page leads humans into
agent-only MCP/CLI operating instructions; the degraded-page notice
("relaxed contract / strict attempts / anchors verified") renders
verbatim as a blockquote; diagram pages get raw filename-slug titles
with no caption; sidebar labels "Auxiliary"/"Wiki indexes"; hardcoded
`lang="en"`; "Commit \<sha\>" in the version stamp.

*Step 4 — prompt prose contracts:* no builder defines the reader
(anywhere); "this is reference documentation, not marketing" licenses
unexplained jargon (prompts.ts:425, :1058);
`buildSurgicalRepairPrompt` carries no prose contract at all; the
literal-signature rule dumps a raw signature with no plain-language
gloss; topic prose must never let a raw `path#symbol` key carry a
sentence alone. Keep-as-pattern: `FILE_NARRATIVE_PROMPT_RULES`,
`UNDERSTANDING_PAGE_PROMPT_RULES`, the shared-constants mechanism.
Cleanup candidates: dead `buildQuickstartPrompt`/`buildOverviewPrompt`
(only referenced by tests).

**Steps 1–4 implemented 2026-08-11 (uncommitted; zero paid calls).**
Step 1: topic repair inherits the three shared accuracy rules +
`buildFileSectionPrompt` uses the shared `LITERAL_SIGNATURE_PROMPT_RULE`.
Step 2: every deterministic Markdown surface moved to folder/file
vocabulary and plain language — quickstart stats and intro, tasks
intro/"Page not written yet"/"Other folders", overview intro, cards
("Module ID:" line dropped; "Pages:", "Depends on: / Used by:"),
auxiliary hub renamed "Auxiliary areas", auxiliary-page sentences no
longer describe livewiki machinery, Navigate labels "used here /
depends on this folder / used both ways", coverage note without
pipeline internals, folder guide fallbacks ("not documented (re-export,
configuration, or plain-text file)", "probably covers (guessed from the
file name)"), `modules.mmd` empty marker. Step 3 (viewer):
Activity dashboard in human sentences (event kinds rewritten, ratio
card dropped, plurals fixed, legends/intro reworded), degraded notice
is now "Draft page — checked against the code, wording may be rougher"
(legacy prefix still recognized), diagram pages get human titles +
captions, sidebar "Auxiliary areas" / "Indexes & overviews", `<html
lang>` follows the configured wiki language, stamp reads "Documentation
last changed on \<date\>" (sha in a tooltip), brand deduped for repos
named livewiki, search "No pages match your search.", diagram fallback
carries an explanatory note, quickstart agent sections labeled "(for
agents)". Step 4: `LAY_READER_PROMPT_RULE` shared by all prose
builders via the rule arrays (initial + repair inherit),
`WRITE_FOR_UNDERSTANDING_PROMPT_RULE` replaces "reference
documentation, not marketing", literal signatures get a mandatory
plain-language gloss, FILE_NARRATIVE gains why-before-how, flow Purpose
opens with the user-visible goal, topic prose leads with the human
role before the raw key, surgical repair gets a one-line prose
contract; dead `buildQuickstartPrompt`/`buildOverviewPrompt` deleted
with their tests. **Follow-ups implemented 2026-08-11 (later, same day;
uncommitted; zero paid calls):** (a) the understanding page's surfaces
section is plain language — `## Where to look in the code` replaces `##
Key surfaces` (strict validator requires the new heading for new
generations; the tolerant reader accepts BOTH, since pre-#30 pages are
sticky and keep the old heading forever; SPEC updated);
(b) inert Markdown files in the folder-page guide show their OWN title
(frontmatter/H1 harvested from the source file —
`proseTitlesByFilePath` in `folder-page.ts`, harvested in the same
`batch.ts` loop as `titlesByPagePath`) instead of a bare filename +
"not documented"; non-Markdown inert files keep the plain fallback;
(c) viewer chrome localization beyond `<html lang>` — new
`view-chrome.ts` string tables (`en` + `pt`, resolved by BCP-47 base
subtag, unknown → English byte-identical) cover the sidebar group
labels, search box/no-results, theme toggle, version stamp, freshness
badges, diagram titles/captions, and the mermaid fallback note;
`VIEW_APP_JS` became `renderViewAppJs(chrome)` with the strings baked
at build time. Still open: the Activity dashboard's body strings stay
English (content, not chrome); the auxiliary hub (`auxiliary/index.md`)
lands in the "Indexes & overviews" sidebar group instead of "Auxiliary
areas" (consistent with the flows/topics hubs today — revisit whether
the hub belongs with its pages).

**Measurement run 2026-08-11 (paid, MiniMax-M3 via the :8900 proxy
bridge, external MPTP clone — full `init --batch` at commit 0f1c86a):**
verify OK (65 pages, no issues); accounting EXACT (checkpoint 737,074 ==
proxy callog 737,074 after the 44-token smoke; 121 calls). Readability
read: the new contracts are visible in the corpus — the understanding
page carries `## Where to look in the code`, folder guides lead with
page titles + plain coverage lines + "used here / depends on this
folder" Navigate labels, file pages open sections with why-before-how
and gloss every literal signature in plain language. **Length-pressure
finding:** the two length-capped micro-artifacts suffered — folder
`app-services` exhausted 6 consecutive attempts on
`folder_purpose_too_long` (1019→834→803→… vs the 800 cap; page missing
from the corpus) and understanding needed a `--only` recovery
(purpose 769→673→726 vs 600). Pre-#30 the same model wrote both first
try, so the lay-reader/why-first rules plausibly lengthen capped prose —
candidate fix: carve the length-capped builders out of
LAY_READER_PROMPT_RULE or add a "brevity outranks completeness" clause
(maintainer decision). **Fix implemented + validated the same day
(uncommitted):** both capped builders gained an aim band with safety
margin (folder 400–700 of 800; understanding purpose 400–550 of 600,
bullets ≤120 of 160) plus an explicit "the cap outranks every other
rule — drop clauses until it fits" clause, and the repair directives
carry numeric targets (under 700 / under 520 / under 140).
Micro-validation (paid, 1 call): the 6/6 failure case
`folder:app-services` passed FIRST TRY with the new prompt (599-char
purpose, verify OK 66 pages). Two defects found and fixed with
regression tests (committed ecb5451): the prose-title harvest used
allowlist-restricted `safeIo.readText` and silently never fired (now
plain fs like every source read in batch.ts; the prose-tier CLI E2E
asserts the harvested title end-to-end), and `extractPageTitle`
accepted a mid-document H1 as a title (MPTP READMEs titled their pages
"Please set according to your actual path…") — now only a
title-position H1 (frontmatter body, HTML preamble allowed) qualifies.
The understanding synthesis named the product "livewiki" from the
clone's directory name (body text accurate) — name-resolution wobble
worth watching on the next run.
**Full measurement round (2026-08-12, uncommitted fixes):** clean
`init --batch` on the MPTP clone (MiniMax-M3 via the :8900 bridge).
First attempt was self-contaminated (a `livewiki-prev-r30/` backup left
inside the clone got indexed as source — corpus kept local-only at
`/c/tmp/moneyprinter-corpus-30r2-contaminated`); the clean rerun gave
62 done / 1 failed, exit 1, verify OK (67 pages), accounting EXACT
(proxy 813,321 == checkpoint 813,277 + 44 smoke). Findings and fixes,
each with regression tests:
(1) **folder length-pressure RESOLVED** — `app/services` passed FIRST
TRY at 754 chars (previous run: 3 failed repairs at 1078/983/977); the
aim bands work. A deterministic sentence-clip fallback
(`truncateFolderPurpose`, folder-page.ts) now covers the repair_exhausted
point for length-only failure sets anyway, and the folder repair
directive carries exact deletion arithmetic ("delete at least N chars").
(2) **name-wobble RESOLVED** — `extractReadmeTitle` (orientation.ts)
pins the product name from the README's own H1 into the understanding
evidence + a prompt rule that "livewiki" is the documentation TOOL,
never the product; the regenerated page is titled
"MoneyPrinterTurbo-Plus" (H1 + frontmatter).
(3) **understanding is the new length-pressure hotspot** — it failed
repair_exhausted TWICE (purpose 609/600, bullet 161/160 near-misses,
then persistent `code_span_forbidden`: MiniMax-M3 wraps file names in
inline code despite the ban). Fixed with `salvageUnderstandingCandidate`
(understanding.ts): when the last candidate fails ONLY on mechanically
fixable codes (purpose_too_long / surface_too_long /
code_span_forbidden), the tool deletes — backticks unwrapped, purpose
clipped at a sentence boundary, bullets at a clause boundary — and
re-validates the WHOLE contract before accepting; anything residual
keeps the failure. Live validation: `--only understanding` completed
via the salvage (583-char purpose, all bullets ≤160, verify OK 68
pages). Round totals: 827,799 tokens, accounting exact end-to-end.
Gate: focused suites green (folder-page/orientation/understanding/
batch-repair/batch-understanding), full `pnpm -r test` exit 0 after
each fix.

### 31. Untagged comment signals (post-beta)

Source: maintainer question 2026-08-12 + same-day investigation on the
MPTP clone. Finding: 697 untagged `#` comment lines vs 1 tagged
(rationale extraction keeps only WHY/NOTE/HACK/TODO/FIXME + docstrings),
~71% of them Chinese, quality mixed — real intent nuggets ("Errors where
retrying will never help") alongside pure paraphrase ("check file ext").
The decisive fact: stage-4 file pages already include the full source
(60k budget) or per-section source (plan-then-write), so those comments
ALREADY reach the model — a separate content channel would pay tokens
twice for the same text and steal source budget. **Rejected as prompt
content for stage 4.** What stays on the backlog:

1. **Comment density as a signal, not content** — per-symbol comment
   density as a proxy for "confusing spot in the code", feeding
   planner/prioritization. Zero prompt cost, deterministic.
2. **Content channel only under evidence** — reopen untagged comments
   as evidence for topic/folder/flow pages (the contexts where full
   source does NOT fit) only if a measurement shows those pages are
   weak for lack of intent context; then with a quality heuristic
   (length floor, intent verbs, non-paraphrase) and its own char cap.

### 32. npm Trusted Publishing (OIDC) for releases (post-beta)

Source: npm banner observed at publish time (2026-08-12) — tokens that
bypass 2FA are being restricted (account changes Aug 2026, direct
publishing Jan 2027). The 0.1.0 beta was published interactively
(maintainer session + OTP), which stays fine for manual releases. Before
any automated/CI release flow: configure Trusted Publishing (GitHub
Actions OIDC) for @livewiki/{core,cli,mcp} instead of a long-lived
npm access token, or the classic-token path will stop working under us.

## Evaluated and rejected (do not re-litigate without new evidence)

- **Committed graph/cache artifact in the repo** (their
  `.codebase-memory/graph.db.zst` pattern): violates rule #3 — `.livewiki/`
  is a derived cache and never travels in git (`init` enforces this via
  `.gitignore`). livewiki's shared artifact is the wiki itself: reviewable
  text, not a binary database.
- **Semantic search with bundled embeddings**: adds a model, weight, and
  nondeterminism to a product whose promise is deterministic validation.
  FTS5 + anchors covers the agent use case.
- **General-purpose call graph / dead code / cross-service graph database /
  Cypher queries**: broader than livewiki's documentation mission. Reproduce
  only the documentation-focused impact and context patterns natively; never
  require an external graph or MCP product to complete the livewiki workflow.
- **Runtime dependency on GitHub Agentic Workflows, codebase-memory-mcp,
  CodeGraph, or any equivalent product**: rejected. References may inform the
  design, but the shipped capability belongs to livewiki and works without the
  reference product installed or configured.
- **Built-in ADR management**: `owner: human` pages already provide the
  mechanism; at most a page template someday, not a feature.
