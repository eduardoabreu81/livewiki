# livewiki

livewiki is an agent-first living documentation tool: a Markdown wiki that
lives inside your repository, is written by an LLM, and is kept honest by
deterministic machinery that never calls a model — every page anchors to
real code symbols, staleness is computed from tree-sitter hashes with zero
tokens, and `verify` rejects any claim that does not resolve to the code.

[![npm](https://img.shields.io/npm/v/@livewiki/cli)](https://www.npmjs.com/package/@livewiki/cli)
[![CI](https://github.com/eduardoabreu81/livewiki/actions/workflows/cross-platform-ci.yml/badge.svg)](https://github.com/eduardoabreu81/livewiki/actions/workflows/cross-platform-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why

Documentation rots because nothing checks it. livewiki's promise is the
opposite economics of most AI doc tools: **detecting** what went stale
costs nothing (no LLM call, ever), and **writing** is the only thing that
costs tokens — done by your own agent in-session, or by a resumable batch
pipeline with exact per-task accounting. Human content (`owner: human`
pages, `lw:manual` blocks) is preserved byte-for-byte, always.

## Quick start

### 1. Install

Requires **Node.js 24 or newer**.

```bash
npm install -g @livewiki/cli
```

(or prefix every command with `npx @livewiki/cli` instead of installing)

### 2. Initialize your repository

From the root of the repo you want documented:

```bash
livewiki init
```

This indexes the code (tree-sitter, fully offline) and creates the
deterministic wiki layout under `livewiki/` plus the derived cache under
`.livewiki/` (automatically added to your `.gitignore` — the cache never
travels in git).

### 3. Point it at an LLM

Create `.livewiki/config.json` naming a provider preset and a model:

```json
{
  "preset": "anthropic",
  "model": "claude-sonnet-5",
  "language": "en"
}
```

The API key comes from the environment — **never** from the config file:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Available presets: `anthropic`, `openai`, `openrouter`, `deepseek`,
`kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio` (the last two
run local models and need no key). Any preset field (`baseUrl`, pricing)
can be overridden in the config. `language` is any BCP-47 tag — the wiki
is written in it.

### 4. Generate the wiki

```bash
livewiki init --batch
```

A resumable 5-stage pipeline (scan → page units → prioritize → document →
flows/topics) writes one page per source file and folder, plus product
flows, concept topics, and an `understanding.md` synthesis — every claim
anchored to a real symbol. Interrupt it anytime; `livewiki batch resume`
continues from the exact task, and `livewiki batch status` reports tokens
first, dollars second.

### 5. Check the result

```bash
livewiki verify   # anti-hallucination gate: every anchor re-read from disk
livewiki view     # self-contained offline site: search, Mermaid, dark mode
```

Then browse `livewiki/quickstart.md` — or open the site that `view`
builds.

## Day two and beyond: the incremental loop

The wiki is alive. When the code changes, livewiki notices for free:

```bash
livewiki index    # re-hash symbols, emit changed|moved|deleted debt
livewiki status   # open debt, risk-ranked (test gap, fan-in, churn)
```

Pay the debt with your own agent (recommended) or directly:

- **Agent-native:** `livewiki install` detects your agent (Claude Code,
  Cursor, Codex, Kimi, and 9 more) and wires the MCP server, hooks, and
  the document-as-you-go skill — debt gets paid as you work.
- **Manual:** edit the page, keep the anchors honest, run
  `livewiki verify` (exit ≠ 0 on any issue — CI-friendly).

MCP server, standalone (any MCP client):

```json
{
  "mcpServers": {
    "livewiki": {
      "command": "npx",
      "args": ["-y", "@livewiki/mcp", "--repo", "/path/to/repo"]
    }
  }
}
```

Tools: full-text search, page read, validated write (post-write `verify`
with rollback), open debt, debt resolution, and per-symbol blast radius.

## How it works

- **Incremental (the heart):** edit code → `livewiki index` re-hashes
  symbols → the anchor ledger emits `changed|moved|deleted` debt → your
  agent (or you) pays it → `livewiki verify` re-checks every anchor fresh
  from disk.
- **Batch:** `livewiki init --batch` runs the 5-stage pipeline with
  checkpoints, bounded repair, transactional writes, and token-first
  reporting.
- **Surfaces:** the same wiki serves the CLI, the MCP server,
  deterministic exports (`livewiki export`), and the offline viewer —
  including builds from any git ref (`livewiki view --ref <tag>`).

## Results so far

- Blind dual-evaluator comparison against OpenWiki (frozen corpus):
  weighted quality gap closed to **Δ0.40–0.45 at ~6–8% of the token
  cost** (≈0.9M vs 13.9M tokens per full-repo run).
- Self-hosting dogfood: this repository documents itself — batch run of
  138 tasks, **0 failures, verify zero issues, 742,693 tokens** with
  checkpoint-exact accounting.
- Cross-platform CI green on ubuntu / windows / macOS (Node 24).
- Debt detection on every merge costs **zero tokens** — see
  `packages/cli/templates/github-actions/docs-debt.yml`.

## Packages

| Package | Purpose |
| --- | --- |
| [`@livewiki/cli`](https://www.npmjs.com/package/@livewiki/cli) | The `livewiki` command |
| [`@livewiki/mcp`](https://www.npmjs.com/package/@livewiki/mcp) | MCP server for any MCP client |
| [`@livewiki/core`](https://www.npmjs.com/package/@livewiki/core) | Library: indexer, anchors, ledger, pipeline |

## Documentation

- `SPEC.md` — behavioral source of truth
- `VISION.md` — rationale and non-goals
- `docs/ROADMAP.md` — approved backlog and execution order
- `livewiki/quickstart.md` — this repository's own livewiki

## License

MIT — see [LICENSE](LICENSE).
