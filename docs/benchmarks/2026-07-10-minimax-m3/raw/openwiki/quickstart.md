# livewiki — Quickstart

> **living repository documentation** — markdown wiki, versioned inside the repo, anchored to code symbols, detectable-as-stale without spending an LLM token, and consumable by humans or any agent.

This page is the entrypoint for agents and humans working on the **livewiki** codebase. Start here, then follow the section links to learn the architecture, workflows, integrations, and operational rules.

## What livewiki is

livewiki solves a category of problems that other doc tools do not:

- **Documentation that rots.** Existing wikis are out of date three months after generation. livewiki detects drift **deterministically** — by hashing code symbols — without spending tokens to discover what changed.
- **LLM-to-LLM handoff.** One agent's session ends; the next starts from the wiki + manifest, not from a 200KB context dump.
- **Anti-hallucination.** Every wiki page declares which code symbols it cites. A separate verifier rejects references that don't exist or whose signatures don't match.
- **Token economy.** The LLM is invoked only to *write*, never to *discover* staleness. Incremental mode (`livewiki update`) emits a focused work-package so a sub-1k-token exchange can pay off an entire commit's debt.

See `../VISION.md` for the rationale, the "empty quadrant" positioning, and explicit non-goals (function call-graphs, sequence diagrams, multilingual wikis). See `../SPEC.md` for the executable spec, phase by phase, with acceptance criteria.

## Repository layout (this codebase)

```
livewiki/
├── VISION.md                # product vision + decisions (PT-BR conversation; this doc is EN)
├── SPEC.md                  # phase-by-phase executable spec
├── AGENTS.md                # live state, conventions, gotchas (read before changing code)
├── docs/BENCHMARK.md        # sealed protocol: livewiki vs OpenWiki benchmark
├── docs/market-research.md  # OpenWiki issue mining + competitor notes
├── .github/workflows/openwiki-update.yml  # scheduled OpenWiki refresh
├── packages/
│   ├── core/                # @livewiki/core — all logic (subpath exports per module)
│   ├── cli/                 # @livewiki/cli — commander wrapper; bin "livewiki"
│   └── mcp/                 # @livewiki/mcp — stdio MCP server; bin "livewiki-mcp"
└── .livewiki/               # generated cache (gitignored in target repos)
```

Three packages, one set of inviolable rules, four faces of the same engine.

## Phase status (snapshot from AGENTS.md)

- **Phase 0** (scaffold + safe-io) ✅
- **Phase 1** (indexer with web-tree-sitter) ✅
- **Phase 2** (anchors + debt + verify) ✅
- **Phase 3** (init + batch + LLM client + diagrams + accounting) ✅
- **Phase 3 rev2** (empirical fixes H–M) ✅
- **Phase 4** (MCP server: 6 tools + FTS5 + stdio) ✅
- **Phase 5** (skills + hooks + incremental update + pointer) — closed; review accepted
- **Phase 6** (export to github-wiki/gitlab-wiki/generic) — post-MVP (stubs)
- **Phase 7** (local viewer + templates) — post-MVP (stubs)

Total test count at last green run: **430 passed + 8 skipped** across core, cli, mcp.

## CLI surface at a glance

| Command | Purpose | Phase |
|---|---|---|
| `livewiki init` | creates `livewiki/` + `.livewiki/`, indexes, generates layout; `--batch` triggers full LLM pipeline; `--plan` shows module plan without writing; `--no-refine` skips LLM module refinement | 3 |
| `livewiki index` | (re)indexes repo + syncs anchor ledger; idempotent; `--quiet` for hooks | 1+2 |
| `livewiki status` | index report + open debt + undocumented symbols + token metrics | 1+2 |
| `livewiki verify` | parses wiki from disk, validates anchors / manual blocks / internal links; exit ≠ 0 on error | 2 |
| `livewiki update` | incremental mode: emits a focused work-package for an in-session agent; `--record-write N` records doc written back; `--llm` (stub) | 5 |
| `livewiki batch` | full-documentation run: `status [runId]` (default), `resume <runId>`, `--only <target>`, `list` | 3 |
| `livewiki serve` | starts MCP server on stdio (alias for `npx @livewiki/mcp --repo <path>`) | 4 |
| `livewiki pointer` | opt-in append of a livewiki pointer block to AGENTS.md/CLAUDE.md | 5 |
| `livewiki export <target>` | post-MVP — export wiki to github-wiki / gitlab-wiki / generic | 6 (stub) |
| `livewiki view` | post-MVP — generate self-contained static site with search + Mermaid | 7 (stub) |

Global flags: `--json` for parseable output; `--repo <path>` to target a directory (default `cwd`).

## MCP server tools

The `@livewiki/mcp` package exposes 6 tools. See [`integrations/mcp-server.md`](integrations/mcp-server.md) for full schemas and the write_doc two-phase verify+rollback contract:

- `livewiki_quickstart`
- `livewiki_read`
- `livewiki_search` (FTS5 on `.livewiki/search.db`)
- `livewiki_debt` (= `livewiki status --json`)
- `livewiki_write_doc` (allowlist + post-write verify; rollback on failure)
- `livewiki_resolve_debt`

## Where to go next

### Architecture
- [Three-layer architecture and package map](architecture/overview.md)
- [Data model: SQLite schema v4, manifest, debt, manual blocks](architecture/data-model.md)

### Workflows
- [Indexing and anchor-ledger (debt detection)](workflows/indexing-and-debt.md)
- [Batch pipeline (4-stage, resumable, with circuit breaker)](workflows/batch-pipeline.md)
- [Incremental update, hooks, skills](workflows/incremental-update.md)

### Integrations
- [LLM providers and presets](integrations/llm-providers.md)
- [MCP server](integrations/mcp-server.md)

### Operations
- [Inviolable rules (safe-io, pointer opt-in, DB-derived, human content)](operations/inviolable-rules.md)
- [Testing and validation workflow](operations/testing-and-validation.md)
- [Development workflow, conventions, gotchas](operations/development-workflow.md)

## Pointers to durable authoritative sources

These live alongside the code and are the canonical references. When this wiki and the source conflict, prefer the source; when this wiki and `VISION.md` / `SPEC.md` / `AGENTS.md` conflict, prefer those docs.

- `VISION.md` — product vision, positioning, decisions and rationale.
- `SPEC.md` — phase-by-phase spec, acceptance criteria, schema definitions.
- `AGENTS.md` — live state of the project, per-change-type edit map, gotchas, language policy, coverage baseline.
- `docs/BENCHMARK.md` — sealed protocol for the livewiki vs OpenWiki benchmark.
- `docs/market-research.md` — competitive intelligence and roadmap provenance.