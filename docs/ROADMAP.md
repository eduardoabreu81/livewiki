# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Current execution order (see AGENTS.md)

> **Reconciled 2026-08-03** (maintainer decision; supersedes 2026-08-02):
> #16 dogfood batch DONE, cross-platform CI DONE (matrix green twice),
> #6 v1 DONE. The remaining pre-beta queue is **#17 viewer version
> stamp + source deep-links → #18 `view --ref` → #19 Go / #20 Rust /
> #21 Java tier-1 (Go pilot first) → beta launch (npm publish, with the
> naming/domain decision before it)**. #6 v2 (pay-variant) and the
> optional hardening list stay post-beta.
> items 1–5 below are DONE (acceptance E2E passed with exit 0; the blind
> dual-eval A/B cycle closed the gap to OpenWiki to Δ0.40–0.45 weighted at
> ~6% of its token cost; R11-A validated and kept; commit/push done).
> The active queue is now: **Phase 6 export-target validation (DONE
> 2026-07-26: generic/github-wiki/gitlab-wiki on a real corpus) → Phase 7
> local viewer → cross-platform CI (last) → post-Phase-7 backlog below.**
> Also delivered beyond this plan: tier-2 universal prose floor, closed
> repair contract, rationale evidence, risk-weighted debt ordering, MCP
> workflow hints, the recovery tier (surgical repair + relaxed completion
> round), product-first quickstart orientation, concept-topic coverage,
> nav/clarity hardening, and the concern-topic refine pin.


1. Review the uncommitted R10/R10.1 + R11-NAV body. R11-NAV's deterministic
   intent routes and auxiliary de-emphasis are implemented and green; strict
   autonomous paid-E2E acceptance remains open.
2. Run one fresh standalone-provider acceptance E2E only after explicit
   at-the-moment authorization. Do not use a rerun-to-green loop.
3. After review, decide separately whether to commit/push and launch the beta.
4. Review the R11-A concept-topic implementation now present in the working
   tree; validation and any launch-gate decision remain separate.
5. Revise the blind-evaluation instrument before using scores for another
   product decision.
6. Phase 6 Lot 6A follow-up — manually validate the remaining local export
   targets after `generic` (already implemented and locally validated).
7. Cross-platform/GitHub validation after the local product flows pass.
8. Phase 7 — local viewer + templates (self-contained static site, client-side
   search, rendered Mermaid, no executable template code).

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

## Approved backlog (post Phase 7, in priority order)

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

### 7. Bounded parallel stage-4 execution (`batchConcurrency`)

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

### 8. Native CALLS edges with confidence tags

Source: 2026-08-01 Graphify analysis (EXTRACTED/INFERRED edge tags) plus
the standing watch-list item. Extend the indexer beyond imports with call
edges tagged by extraction confidence, and consume them in flow/topic
candidate detection: fewer false candidates, fewer burned repair rounds
(the class of bug fixed in `733fc53` came from weak graph evidence).
Native only (rule #8); never a general-purpose call-graph database — the
rejection below stands; this is the documentation-focused edge set only.

### 9. Community-detection cross-check for stage-2 modules

Source: 2026-08-01 Graphify analysis (Leiden communities with LLM-free
labels) plus the standing watch-list item. Use deterministic graph
clustering as a cross-check or fallback for the directory heuristic in
module identification. The exact-partition contract (100% of the indexed
inventory, heuristic wins on any rejection) is preserved; the goal is
better partitions with less reliance on the LLM refine pass.

### 10. Viewer freshness badge + social previews (Phase 7 polish)

Source: maintainer request + the codec8 thread insight (2026-08-01
`docs/market-research.md`). (a) A deterministic "new/recently changed"
badge in the viewer (sidebar + page header), derived from anchor-ledger
`detected_at` and/or git history — zero LLM, consistent with the
staleness-is-deterministic principle. (b) Social/OG preview metadata
(title, description, generated card) in the exported/built site so shared
doc links render professionally on Slack/Discord.

### 11. `export readme` — README as an output, not just an input

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

### 12. EOL-insensitive content hashing (phantom-debt fix)

Source: 2026-08-01 incremental-loop test on the real MPTP repo
(`docs/market-research.md` session; corpus `/c/tmp/livewiki-e2e/incremental-mptp-2026-08-01/`).
A CRLF↔LF-only difference (which git produces silently on checkout via
`core.autocrlf`) changes every `content_hash` and floods the ledger with
phantom `changed` debt — ~50% of 956 items in the test were exactly this.
Normalize line endings to `\n` before all content hashing (file-level and
symbol-level). The upgrade must NOT emit a one-time phantom debt wave for
EOL-only files: silently migrate hashes when the stored hash still matches
the legacy raw-bytes hash.

### 13. Conservative twin-file `moved` detection

Source: same 2026-08-01 test. Provider twins (`elevenlabs_music.py` hardened,
`sonilo.py` unchanged, identical old bodies) produced `moved` rewrites
pointing page anchors at the twin that KEPT the old implementation — verify
passes (anchors exist) while prose and anchor describe different
implementations: an anti-hallucination hole. Policy (maintainer-approved):
accept a `moved` only when the symbol is gone from ALL active files (no
same-name twin survives anywhere); otherwise classify as `changed` (donor)
and let the new occurrence surface as new/undocumented.

### 14. In-session cost accounting

Source: maintainer review of the 2026-08-01 incremental MPTP update. The
in-session payment path (the agent already in the user's session writes
the prose) rides the host subscription instead of per-token billing — a
real cost in a different currency, and today it is UNMEASURED: batch has
exact checkpoint accounting, in-session has nothing. Make the loop
measurable: every payment session records estimated tokens written +
debt closed (wire `--record-write` / `update-metrics.ts` into the flow as
a required step, surfaced in `status`/metrics), so the in-session vs
batch economics per repo are decided on numbers, not guesses.

### 15. Activity dashboard (viewer)

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

### 17. Viewer version stamp + source deep-links (PRE-BETA)

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
(offline posture preserved). Final gate numbers: (coordinator to fill
after review).

### 18. `livewiki view --ref <tag|sha>` (PRE-BETA)

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
side by side. Final gate numbers: (coordinator to fill after review).

### 19. Tier-1 anchored support: Go (PRE-BETA)

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

### 20. Tier-1 anchored support: Rust (PRE-BETA)

Same shape as item 19 (grammar + extractor + import resolution — Rust
`mod`/`use`/crate resolution) after the Go pilot proves the pattern.
Acceptance: batch run on a real Rust repo (paid, approved at the time).

### 21. Tier-1 anchored support: Java (PRE-BETA)

Same shape as item 19 (grammar + extractor + package/import resolution)
after the Go pilot. Acceptance: batch run on a real Java repo (paid,
approved at the time).

### 22. CodeWiki-grade output format (post-beta, needs design)

Source: CodeWiki review 2026-08-03 — the maintainer's first reaction to
Google's codewiki.google was "o wiki final está muito bom; a formatação
está excelente". Two gaps vs our corpus, both generation-contract
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
