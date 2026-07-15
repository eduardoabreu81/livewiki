# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Committed next (see AGENTS.md)

1. Quality review vs frozen OpenWiki (no public winner claim before it is
   written). Benchmark harness work is frozen unless a product defect requires
   a focused reproduction.
2. Phase 6 — export to github-wiki / gitlab-wiki / generic.
3. Phase 7 — local viewer + templates.

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

### 1. Identifier-aware FTS5 tokenizer for `livewiki_search`

`packages/mcp/src/search.ts` uses the porter tokenizer, so camelCase /
snake_case identifiers are single opaque tokens: searching "resolve debt"
does not match `resolveDebt`. Add identifier splitting (camelCase,
snake_case, kebab-case) at index and query time. `search.db` is rebuilt on
MCP startup, so no schema/migration cost. Acceptance: a search for a
sub-word of any anchored symbol name returns the page that anchors it.

### 2. Native compact change-impact context

Extend the existing `livewiki update` work package and MCP responses with a
bounded, documentation-focused impact view: changed symbols, affected anchors,
pages, modules, dependencies, and only the relevant source snippets. Reuse the
local livewiki index; do not call or require another graph/MCP product. The same
structured payload must be available through CLI JSON and MCP so an active agent
or standalone provider receives equivalent context.

### 3. Index freshness and automatic local synchronization

Make index freshness explicit and cheap. Long-running livewiki surfaces should
detect repository changes, debounce local re-indexing, and expose snapshot age
and stale/ready state. Startup and recovery remain rebuildable from the repo and
wiki. No daemon, cloud service, or external watcher may be required for normal
CLI use.

### 4. `livewiki install` — agent auto-detection

One command that detects installed coding agents (Claude Code, Codex,
Cursor, Zed, ... — start with the agents already covered by the Phase 5
presets/templates) and offers to configure, per agent: the MCP server
entry, hook templates (`packages/cli/templates/`), and the AGENTS.md /
CLAUDE.md pointer. Constraints: pointer stays opt-in per rule #2 (explicit
flag or interactive confirmation, never silent); every write outside the
repo allowlist is shown before it happens; idempotent re-run.

### 5. `livewiki status --diff` — pre-commit debt preview

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
