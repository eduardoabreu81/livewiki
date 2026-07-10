# Architecture overview

> Three layers, one engine, four faces. livewiki's design is dominated by a small set of inviolable rules. The architecture is the simplest shape that makes those rules possible.

## Three layers

When `livewiki init` runs in a target repository, three directories appear with strict roles:

| Layer | Path | Versioned? | Role |
|---|---|---|---|
| **Wiki** | `livewiki/` | yes (commits travel with the code) | The source of truth. Markdown + frontmatter + `lw:anchors` markers. |
| **Index** | `.livewiki/` | no (gitignored by `init`) | Derived cache: SQLite `index.db`, SQLite FTS5 `search.db`, `config.json`, `update_metrics.json`. Rebuildable from the wiki + repo. |
| **Pointer** | `AGENTS.md` / `CLAUDE.md` | yes | 1-paragraph block telling humans/agents "a wiki exists at `./livewiki/quickstart.md`". Opt-in only (rule #2). |

```
target-repo/
├── livewiki/                  # 1. WIKI — markdown, versioned. THE TRUTH.
│   ├── .manifest.json         #    last documented commit + snapshot hash
│   ├── quickstart.md          #    low-token entry point for agents
│   ├── architecture/          #    overview, modules, diagrams
│   ├── files/                 #    per-file/module docs (with anchors)
│   └── decisions/             #    narrative changelog (handoff between sessions)
├── .livewiki/                 # 2. INDEX — SQLite, gitignored. DERIVED.
│   ├── index.db               #    symbols, hashes, anchors, debt, pipeline
│   ├── search.db              #    FTS5 (MCP server, Phase 4)
│   ├── config.json            #    local repo config
│   └── update_metrics.json    #    incremental token accounting (Phase 5)
└── AGENTS.md / CLAUDE.md      # 3. POINTER — 1 paragraph pointing to the wiki
                               #    (added ONLY with explicit consent)
```

This three-way split is the spine of every other design choice. See [`architecture/data-model.md`](data-model.md) for the shape of each layer's contents.

## Why this split

- **Wiki is markdown, versioned.** Any LLM reads it, any editor opens it, `grep` works. Survives the tool that made it. Tool-agnostic.
- **Index is gitignored SQLite, derived.** Queryable and fast (debt detection in milliseconds), but never travels in git. A fresh clone plus `livewiki index` rebuilds it. The DB never holds information that isn't in the wiki (rule #3).
- **Pointer is opt-in.** Writing to `AGENTS.md` / `CLAUDE.md` requires an explicit `--write-pointer` flag (rule #2). The block is delimited `<!-- livewiki:start --> ... <!-- livewiki:end -->` so it's idempotent and removable.

## Four faces of one core

`@livewiki/core` exposes its logic via subpath exports (see `packages/core/package.json`). The CLI, MCP server, and any future integration import what they need:

| Surface | Package | Entry | What it does |
|---|---|---|---|
| CLI | `@livewiki/cli` | `packages/cli/src/index.ts` → `bin: livewiki` | commander wrapper. All commands in `packages/cli/src/commands/*.ts`. |
| MCP server | `@livewiki/mcp` | `packages/mcp/src/index.ts` → `bin: livewiki-mcp` | Stdio MCP server, 6 tools, FTS5 in a separate DB. |
| Skills | `@livewiki/cli/skills/` | `document-as-you-go/SKILL.md` | Markdown skill for Claude Code / Codex / OpenCode. |
| Hooks | `@livewiki/cli/templates/` | `git/post-commit`, `claude-code/settings.local.json` | Opt-in templates that run `livewiki index --quiet` after commits / agent stops. |

The split is intentional: the CLI is the human-facing surface; the MCP server is the agent-facing surface; skills/hooks are the in-session glue; and `@livewiki/core` is the single source of truth. Any future surface (HTTP API for tier 4 integration, IDE plugin) is a thin wrapper over the core.

## Package layout (`packages/core/src/`)

Each module has a single responsibility and is exported from `index.ts`:

| Module | Responsibility |
|---|---|
| `safe-io.ts` | **Single I/O gatekeeper.** Validates every write against `livewiki/` + `.livewiki/` allowlist, defends against symlink attacks. |
| `hashes.ts` | `sha256(content)` and `sha256Slice(source, start, end)` for content fingerprints. |
| `walker.ts` | Repo walk respecting `.gitignore` + defaults (`node_modules/`, `.git/`, `.livewiki/`, `dist/`, `coverage/`). |
| `parser.ts` | web-tree-sitter wrapper; loads WASM grammars from `packages/core/grammars/`. |
| `symbols.ts` | AST → `SymbolRecord[]` for TS/TSX/JS/Python (function / class / method / export). |
| `db.ts` | SQLite schema v4, migrations, `openIndex()`. |
| `indexer.ts` | walk → read → hash → parse → upsert. Idempotent. |
| `anchors.ts` | Extract page anchors (frontmatter) and section anchors (`<!-- lw:anchors -->`). |
| `frontmatter.ts` | YAML-subset parser (sufficient for SPEC §"Frontmatter"). |
| `anchor-ledger.ts` | Diff anchor state vs previous; emit `changed` / `moved` / `deleted` debt; rewrite anchors in markdown (except manual blocks / human pages). |
| `verify.ts` | Walks wiki from disk, emits `broken_anchor` / `broken_internal_link` / `manual_block_altered` / `missing_wiki_path`. |
| `status.ts` | Aggregates index + debt + undocumented + token metrics. |
| `pricing.ts` | Embedded best-effort pricing table + override lookup. |
| `config.ts` | `.livewiki/config.json` load/save/validate. `validateConfigForBatch()` throws `MissingProviderConfigError` if `preset`/`provider` or `model` absent. |
| `llm/` | `LlmClient` interface; Anthropic + OpenAI-compat adapters; factory. |
| `imports.ts` | AST → `ExtractedImport[]` for TS and Python. |
| `modules.ts` | Heuristic grouping by top-level directory; `resolveModuleEdges`; `prioritizeModules`. NodeNext extension stripping (Fix K). |
| `diagrams.ts` | Deterministic Mermaid generators for `structure.mmd`, `modules.mmd`, `diagrams/<slug>.classes.mmd`. No LLM. |
| `prompts.ts` | Prompt templates for stage 2 (module refine) and stage 4 (per-module doc). English-only; `${language}` controls generated-doc language. |
| `manifest.ts` | `.livewiki/.manifest.json` + `snapshotHash`. Anti-loop CI. |
| `batch.ts` | 4-stage orchestrator with circuit breaker. Entry points: `runBatch`, `resumeBatch`, `runOnly`. |
| `batch-status.ts` | Aggregates `batch_runs` + `batch_tasks` into `BatchStatusReport`. |
| `init.ts` | `livewiki init` core: layout, deterministic diagrams, manifest, optional batch kickoff. |
| `update.ts` | `livewiki update` work-package generator. |
| `update-metrics.ts` | Append-only JSON metrics for incremental mode economy. |
| `pointer.ts` | `insertPointer` / `removePointer` for AGENTS.md/CLAUDE.md blocks. |
| `presets.ts` | 10-entry preset table (data, not code). |
| `gitignore.ts` | Idempotent `.livewiki/` entry writer with managed block. |

## Design decisions traceable to SPEC

| Decision | Source | Why |
|---|---|---|
| Markdown as source of truth | SPEC §"Inviolable rules" + VISION | Tool-agnostic, git-diff friendly, survives any tool. |
| SQLite gitignored + derived | SPEC §"Inviolable rules" #3 | Queryable, fast, rebuildable; never travels in git. |
| `web-tree-sitter` (WASM) | SPEC §"Stack" | Multi-language without native compilation; Windows/Mac/Linux parity. |
| Restricted writes via `safe-io` | SPEC §"Inviolable rules" #1 | Code-enforced allowlist, not a prompt promise. |
| Pointer opt-in | SPEC §"Inviolable rules" #2 | AGENTS.md/CLAUDE.md only with explicit consent. |
| Human content untouchable | SPEC §"Inviolable rules" #6 | `owner: human` and `lw:manual` blocks are byte-stable; `verify` rejects alterations. |
| No hardcoded default model | SPEC §"Stack" + commit 3894f6e | Clear `MissingProviderConfigError` instead of silent fallback to OpenRouter. |
| API key only via env var | SPEC §"Stack" + Phase 3 | Never in `config.json`, `checkpoint_json`, logs, or errors. Regression test: `key-leak.test.ts`. |
| Token-first reporting | SPEC §"Token accounting (Phase 3)" | Tokens are measured facts; USD is an interpretation that varies by route. |
| Snapshot hash on `livewiki/` | SPEC §".manifest.json" | Only rewrites if content changed — keeps CI clean. |
| FTS5 in a separate DB | Phase 4 | Keeps schema v4 untouched; search.db is rebuildable on startup. |
| Deterministic diagrams | SPEC §"Phase 3" | Mermaid org-chart + dependency graph + per-module classDiagram, regenerated on every `index` / `init`. Never ages. |
| Anti-hallucination verify | SPEC §"MCP tools" + VISION | Walks the wiki from disk; an anchor in a never-indexed page is still caught. |

## Inviolable rules, summarized

1. **Restricted writes.** All disk writes go through `safe-io`. Allowlist: `livewiki/` + `.livewiki/` (+ `AGENTS.md`/`CLAUDE.md` only with `allowPointer: true`). Symlink-safe via `resolveAndValidate`.
2. **Pointer opt-in.** `AGENTS.md` / `CLAUDE.md` only with `--write-pointer` flag or interactive confirmation. Idempotent delimited block.
3. **DB is derived.** No information lives only in SQLite. The wiki + manifest hold everything that matters for handoff.
4. **No telemetry, no network** beyond LLM calls in batch mode (opt-in, env-var key) and one-time WASM grammar download.
5. **Tests.** Vitest; 80%+ minimum coverage in core (indexer, anchors, debt, safe-io).
6. **Human content is untouchable.** `owner: human` pages and `lw:manual` blocks are never modified by automated writes; `verify` compares manual blocks byte-for-byte.

Full operational implications and gotchas live in [`operations/inviolable-rules.md`](../operations/inviolable-rules.md).

## Where to go next

- [Data model — SQLite schema v4, manifest, debt, manual blocks](data-model.md)
- [Indexing and anchor-ledger workflow](../workflows/indexing-and-debt.md)
- [Inviolable rules in practice](../operations/inviolable-rules.md)