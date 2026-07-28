# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Current execution order (see AGENTS.md)

> **Reconciled 2026-07-26** (after the Etapa 3 + A/B measurement cycle):
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

### 6. GitHub Actions template — "docs-debt on merge"

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
