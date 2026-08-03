# livewiki

livewiki is an agent-first living documentation tool: a Markdown wiki that
lives inside your repository, is written by an LLM, and is kept honest by
deterministic machinery that never calls a model — every page anchors to
real code symbols, staleness is computed from tree-sitter hashes with zero
tokens, and `verify` rejects any claim that does not resolve to the code.

## Why

Documentation rots because nothing checks it. livewiki's promise is the
opposite economics of most AI doc tools: **detecting** what went stale
costs nothing (no LLM call, ever), and **writing** is the only thing that
costs tokens — done by your own agent in-session, or by a resumable batch
pipeline with exact per-task accounting. Human content (`owner: human`
pages, `lw:manual` blocks) is preserved byte-for-byte, always.

## How it works

- **Incremental (the heart):** edit code → `livewiki index` re-hashes
  symbols → the anchor ledger emits `changed|moved|deleted` debt → your
  agent (or you) pays it → `livewiki verify` re-checks every anchor fresh
  from disk.
- **Batch:** `livewiki init --batch` runs a 5-stage pipeline (scan →
  modules → prioritize → document → flows/topics) with checkpoints,
  bounded repair, transactional writes, and token-first reporting.
- **Surfaces:** the same wiki serves the CLI, an MCP server (search,
  read, validated write, debt), deterministic exports, and `livewiki
  view` — a self-contained offline site with search, Mermaid, version
  stamp, and builds from any git ref (`view --ref <tag>`).

## Quick start

```bash
npm install -g @livewiki/cli   # once published — see Releases until then
livewiki init                  # index + deterministic wiki layout
livewiki init --batch          # full documentation run (needs a provider key in env)
livewiki status                # open debt, risk-ranked
livewiki verify                # anti-hallucination gate — zero issues required
```

Then point your agent at it: `npx @livewiki/mcp --repo /path/to/repo`,
or install hooks/skills with `livewiki install`.

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

## Documentation

- `SPEC.md` — behavioral source of truth
- `VISION.md` — rationale and non-goals
- `docs/ROADMAP.md` — approved backlog and execution order
- `livewiki/quickstart.md` — this repository's own livewiki

## License

TBD — chosen before the npm beta publish.
