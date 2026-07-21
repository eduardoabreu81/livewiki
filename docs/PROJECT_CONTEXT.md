# Project Context — livewiki

> Stable orientation: what the product is, how it is shaped, which decisions
> are settled, and where the sharp edges are. This file intentionally avoids
> live state. Phase progress, the current task, and operational rules live in
> `AGENTS.md` (§Status and §"Product-first execution discipline"); the active
> assignment lives in the newest `docs/tasks/<date>-*/HANDOFF.md`.

## What it is

livewiki is an open-source, agent-first **living documentation** tool: a
Markdown wiki versioned inside the target repository, kept consistent with
the code by a deterministic structural index, and verifiable against
hallucination. The LLM only *writes* docs; it never *discovers* what is
stale — staleness is computed from tree-sitter symbols and content hashes.

Elevator pitch: *documentation anchored to code, verifiable and always
current — written by whoever made the change, at the moment they made it.*

Competitive reference: OpenWiki (LangChain). livewiki's differentiators are
section-level staleness detection with zero tokens, mechanical anti-
hallucination verification, and exact token accounting.

## Document map (which file holds which truth)

| File | Holds | Update cadence |
|---|---|---|
| `SPEC.md` | Behavioral source of truth, phase by phase | On reviewed design change |
| `VISION.md` | Purpose, principles, settled decisions, out-of-scope | Rarely |
| `AGENTS.md` | Live state, operational rules, conventions, gotchas | Every meaningful state change |
| `docs/ROADMAP.md` | Approved post-MVP backlog + rejected ideas | On maintainer decision |
| `docs/PROJECT_CONTEXT.md` | This file — stable architecture and decisions | When architecture/decisions change |
| `docs/tasks/*/HANDOFF.md` | The active bounded assignment | Per task |
| `docs/benchmarks/` | Frozen comparison evidence | Never edited after freeze |

When these disagree, `SPEC.md` wins on behavior, `VISION.md` wins on
direction, and the newest handoff wins on what to do next.

## Architecture snapshot

### Three layers inside a target repo

- `livewiki/` — the wiki: Markdown + `.manifest.json`. **The truth.**
  Versioned in git; this is what travels across machines and sessions.
  Includes the deterministic navigation layer (intent-first quickstart,
  product/flow-focused `tasks.md`, the auxiliary inventory, architecture
  overview, `## Navigate` blocks) and, after batch stage 5,
  the semantic product-flow layer (`flows/<slug>.md` pages with companion
  `diagrams/flow-<slug>.mmd` diagrams and the `flows/index.md` hub).
- `.livewiki/` — SQLite index (`index.db`, `search.db`) + `config.json`.
  **Derived.** Gitignored; rebuilt from repo + wiki at any time.
- `AGENTS.md`/`CLAUDE.md` pointer — one opt-in delimited block pointing
  agents to the wiki. Never written without explicit consent (rule 2).

### Monorepo packages

- `packages/core` (`@livewiki/core`) — all logic: safe-io, walker, parser,
  symbols, indexer, anchors, anchor-ledger (debt), verify, modules, diagrams,
  prompts, batch orchestrator (5 stages: scan → modules → prioritize →
  document → flows), flows (deterministic flow-candidate detection), init,
  update, export, presets, config.
- `packages/cli` (`@livewiki/cli`) — thin commander wrapper; JSON + human
  output on every command; hook/skill templates.
- `packages/mcp` (`@livewiki/mcp`) — MCP stdio server with 6 tools
  (quickstart, read, search/FTS5, debt, validated write, resolve debt).
  Note: the CLI `livewiki serve` command is a stub; the real server entry
  point is `@livewiki/mcp`. Docs must say so until the command is implemented.

### Core data flows

- **Incremental (the heart):** edit code → `index` re-hashes and diffs
  symbols → anchor ledger emits `changed|moved|deleted|new` debt →
  `status`/`livewiki_debt` expose it → the in-session agent pays the debt via
  `livewiki_write_doc` or direct edit → `verify` re-checks the whole wiki
  fresh from disk. No LLM token is spent to detect staleness.
- **Batch (full documentation):** `init --batch` runs 5 resumable stages:
  scan → module identification (deterministic heuristic; optional bounded
  LLM refine that must keep an exact path partition) → prioritization
  (product roles before auxiliary) → coordinated documentation (per-module
  LLM page with closed-key anchors, artifact validation, bounded repair,
  transactional write, verify, checkpoint) → flows (a bounded set of
  semantic product-flow artifacts synthesized from deterministically
  detected candidates — entry/boundary/sink signals over the module
  import graph — with the same validation/repair/transactional gates;
  the model emits the diagram inline and the orchestrator splits it into
  `diagrams/flow-<slug>.mmd`, leaving a placeholder in the page). Circuit
  breaker aborts on systemic failure; every LLM call is token-accounted.
- **Consumption:** quickstart (low-token entry) → `tasks.md` / architecture
  overview / module pages / `## Navigate` blocks — all regenerated
  deterministically after stage 4. The same pages serve CLI, MCP, export
  (Phase 6), and the Phase 7 viewer; there is one truth, four faces.

## Settled decisions (do not revisit without new evidence)

- Source of truth is versioned Markdown; the DB is a derived cache (rule 3).
- Staleness detection is deterministic (tree-sitter + hashes), never LLM.
- Docs are written by the in-session agent (incremental) or a configurable
  provider API (batch); no agent framework, no external product dependency
  (rule 8, "native capability boundary" in VISION).
- API keys come from environment variables only — never config, checkpoints,
  logs, or errors (`key-leak.test.ts` guards this; do not commit if red).
- No hardcoded default model; batch without provider config fails with a
  clear message.
- Human content is untouchable: `owner: human` pages and `lw:manual` blocks
  are preserved byte-for-byte; debt on them becomes a human-review item.
- Durable product artifacts are English; PT-BR is conversation-only.
  A target repo's wiki prose language is a separate per-repo setting.
- Tokens are the primary metric; USD is a secondary, dated estimate.
- CLI sets `process.exitCode` and returns; it never calls `process.exit()`.

## Invariants (SPEC "Inviolable rules", abbreviated)

1. All writes through `safe-io` allowlist (`livewiki/`, `.livewiki/`).
2. Pointer block only with explicit flag or interactive confirmation.
3. Nothing important exists only in SQLite.
4. No telemetry/network except opt-in LLM calls and one-time WASM download.
5. vitest; ≥80% coverage in core; main flows have integration tests.
6. Human content is never rewritten by automation; verify enforces it.
7. Product artifacts in English.
8. Capabilities are implemented natively; external tools are optional surfaces.

## Sensitive points (stable gotchas)

- **Never `git clean -fdx` in this working tree** — it is shared with the
  reviewer; uncommitted work from both sides lives here. Delete build
  artifacts explicitly instead.
- `safe-io.resolveAndValidate` is async-only; always `await` it.
- Post-v3 DB migrations are JS functions that check `PRAGMA table_info`
  before `ADD COLUMN`; keep them idempotent.
- `manifestsEqual` ignores `updatedAt` — otherwise the manifest rewrites on
  every run and breaks the anti-loop contract.
- Circuit-breaker ratio only applies with `totalAttempted >= 3`.
- `verify` parses the wiki fresh from disk; anchors in never-indexed pages
  must still be caught (the anti-hallucination promise).
- `batch_tasks.checkpoint_json` is pure JSON; refined modules live in
  `batch_runs.summary_json.modulesRefined`.
- On Windows, `search.db` runs WAL: close the MCP server before recursive
  deletes in tests, or expect EBUSY.
- Uncommitted `.md` files in the tree may be reviewer work — never revert
  them; ask when in doubt.
- `validateConfigForBatch` accepts `preset` + `model` without `provider`
  (SPEC: config references the preset by name) — don't "fix" it back.
- The frontmatter subset parser accepts inline flow-style lists
  (`key: [a, b]`) — the form LLMs most often emit. Removing that silently
  breaks anchor checks and flow `modules:` consumption.
- Small local models (3–4B) are below the reliability floor of the
  stage-4/5 artifact contracts; expect `repair_exhausted` and let the
  circuit breaker do its job. Don't weaken the contract to accommodate
  them.

## Working agreements (summary — full text in AGENTS.md)

- One product flow at a time; record the observed result before expanding.
- GitHub/CI/platform matrices are final validation, not a debug loop.
- Benchmark/proxy harnesses are for benchmark evidence only.
- Paid provider calls require explicit maintainer approval.
- An external executor leaves changes uncommitted and unpushed; the
  coordinator reviews before any separate commit/push authorization.
