# Roadmap — post-MVP backlog

> Phase status lives in `AGENTS.md` §Status (source of truth). This file
> tracks evaluated, approved backlog items that come AFTER the committed
> phases (Phase 6 export, Phase 7 viewer) and records why rejected ideas
> were rejected, so they are not re-litigated.

## Committed next (see AGENTS.md)

1. MiniMax benchmark: repair-recovery fix → clean v12 → quality review vs
   frozen OpenWiki (no public winner claim before that).
2. Phase 6 — export to github-wiki / gitlab-wiki / generic.
3. Phase 7 — local viewer + templates.

## Approved backlog (post Phase 7, in priority order)

Source: maintainer-approved evaluation (2026-07-13) of
[DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp),
a structural code-intelligence MCP. livewiki does not compete with it
(prose/why vs graph/what); these items adopt its DX lessons only.

### 1. Identifier-aware FTS5 tokenizer for `livewiki_search`

`packages/mcp/src/search.ts` uses the porter tokenizer, so camelCase /
snake_case identifiers are single opaque tokens: searching "resolve debt"
does not match `resolveDebt`. Add identifier splitting (camelCase,
snake_case, kebab-case) at index and query time. `search.db` is rebuilt on
MCP startup, so no schema/migration cost. Acceptance: a search for a
sub-word of any anchored symbol name returns the page that anchors it.

### 2. `livewiki install` — agent auto-detection

One command that detects installed coding agents (Claude Code, Codex,
Cursor, Zed, ... — start with the agents already covered by the Phase 5
presets/templates) and offers to configure, per agent: the MCP server
entry, hook templates (`packages/cli/templates/`), and the AGENTS.md /
CLAUDE.md pointer. Constraints: pointer stays opt-in per rule #2 (explicit
flag or interactive confirmation, never silent); every write outside the
repo allowlist is shown before it happens; idempotent re-run.

### 3. `livewiki status --diff` — pre-commit debt preview

The anchor ledger detects debt AFTER a commit/index. Add a mode that maps
the UNCOMMITTED working-tree diff to the wiki pages whose anchors it would
invalidate ("this diff will invalidate anchors in pages X, Y"), closing
the document-as-you-go loop at pre-commit time instead of post-commit.
Read-only: no ledger mutation, no debt creation — preview only.

### 4. GitHub Actions template — "docs-debt on merge"

Source: maintainer-approved evaluation (2026-07-14) of GitHub Agentic
Workflows for cross-repo documentation
(github.blog, Aspire team: docs draft-PRs on product merge, SME
auto-review, 82 merged doc PRs at a 44.8h median). Their pattern validates
livewiki's document-as-you-go thesis; livewiki's structural advantages to
preserve: mechanical verification gates hallucination BEFORE human review
(their only gate is the SME), and the anchor-ledger answers "does this
merge need docs?" deterministically with ZERO tokens (78% of their runs
spent a model call to conclude "no docs needed").

The template: on PR merge, run `livewiki index` + debt check
(deterministic, no LLM); when debt exists, an agent job pays it via MCP
`livewiki_write_doc` (verify gating as always) and opens a DRAFT PR with
the original PR author as reviewer. No-debt case costs zero tokens.
Depends on Phase 6 (export) for the separate-docs-repo variant; the
same-repo variant could ship earlier. Also adopt their operational-metrics
discipline (median hours from feature merge to merged docs —
`update-metrics.ts` is the base).

## Evaluated and rejected (do not re-litigate without new evidence)

- **Committed graph/cache artifact in the repo** (their
  `.codebase-memory/graph.db.zst` pattern): violates rule #3 — `.livewiki/`
  is a derived cache and never travels in git (`init` enforces this via
  `.gitignore`). livewiki's shared artifact is the wiki itself: reviewable
  text, not a binary database.
- **Semantic search with bundled embeddings**: adds a model, weight, and
  nondeterminism to a product whose promise is deterministic validation.
  FTS5 + anchors covers the agent use case.
- **Call graph / dead code / cross-service linking / Cypher queries**:
  structural-intelligence territory already served by dedicated MCP tools
  (CodeGraph, codebase-memory-mcp). Integrate alongside, never replicate.
- **Built-in ADR management**: `owner: human` pages already provide the
  mechanism; at most a page template someday, not a feature.
