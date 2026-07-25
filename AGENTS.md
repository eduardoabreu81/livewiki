# AGENTS.md — livewiki

> For LLMs/agents working in this repo. **Live state below in §"Status"**:
> Phases 0–5 on main. Batch Resilience U–X approved after independent
> review (unique module IDs + taken set, owner:mixed retention, multi
> manual blocks, rollback_failed aborts run, monotonic usage attempts,
> stage-4 artifact normalize/repair, English-only new U–X text).
> Benchmark: clean v18 (commit 572b8a3) **PASSED** — 13/13 modules,
> verify 0 issues, 427/427 symbols, exact accounting; evidence under
> `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/`. The
> independent quality review vs frozen OpenWiki is written at
> `docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`; no
> public winner claim until the maintainer decides the
> `docs/BENCHMARK.md` note. Post-review navigation work is on main:
> deterministic navigation layer (Lot M, 0746860) and the stage-4
> page-opening contract + semantic titles (Lot N, 59b1112). Phase 6
> Lot 6A is on main (75cd004): deterministic local export is implemented,
> and the `generic` target passed a manual Windows happy-path and
> idempotence check on 2026-07-15. The uncommitted R10/R10.1 semantic-flow
> body is implemented with deterministic suites green; its comparison corpus
> is complete after recovery, while strict autonomous paid-E2E acceptance
> remains open. R11-NAV intent-first deterministic navigation is implemented
> and green in the same uncommitted body. R11-A concept topics, topic-first
> navigation, and compact auxiliary-page depth are implemented in the working
> tree but intentionally not built, tested, or benchmarked yet. GitHub and
> cross-platform work remain deliberately deferred.

## Language policy

**All durable artifacts of this repo (livewiki product) are written in
English** — docs, code comments, CLI strings and messages, error
messages, commit messages. PT-BR only in conversation with the
maintainer (Eduardo). See SPEC.md and VISION.md for the authoritative
product statement.

**User wiki language (orthogonal):** generated documentation for a
*user's* repo defaults to `en` (en-US) via `.livewiki/config.json`
`language`. The user may set another BCP-47 language when documenting.
Pages remain in the language they were written in (sticky); do not
silently retranslate on later batch/update runs. Future multi-language
support is optional only, with an explicit cost warning (more concurrent
languages ⇒ more debt work and token use). See VISION.md §"Out of
designed scope".

Existing PT-BR source text, comments, tests, CLI/UI messages, or product/user
documentation are migration debt for a dedicated final normalization pass. Do
not expand that debt during unrelated work, and do not mix a repository-wide
translation into a focused feature or bug-fix change.

**External references are not product dependencies:** ideas evaluated from
GitHub Agentic Workflows, codebase-memory-mcp, CodeGraph, or similar products
must be implemented natively when adopted. The livewiki core workflow may not
require any of them to be installed, running, or configured. Git hosts, editors,
MCP clients, and LLM providers remain optional user-selected surfaces.

**Working tree hygiene:** do NOT revert uncommitted `.md` files that
appear in the working tree — they may be reviewer's work. If in doubt,
ask.

## Product-first execution discipline

Maintainer decision (2026-07-15): develop and validate livewiki one user
flow at a time. The repository must not use GitHub Actions, benchmark
harnesses, or publication infrastructure as an iterative debugger.

- Start with the smallest real local product flow and one simple user-facing
  command. Record the observed result before expanding scope.
- GitHub integration, remote CI, release automation, and broad platform
  matrices are final validation steps, not prerequisites for local product
  work.
- Benchmark/proxy/orchestrator harnesses are reserved for explicit benchmark
  or publication evidence. They are not part of the normal fix-and-retest
  loop.
- Paid/provider calls require explicit maintainer approval. Prefer the active
  development LLM through livewiki's CLI, MCP, or packaged skill when testing
  an existing repository.
- An external executor receives one bounded task. It leaves changes
  uncommitted and unpushed. The coordinator reviews the result before a
  separate commit/push authorization.
- Do not add durable tests for exploratory work or a passing manual check.
  For a confirmed product defect, keep at most the smallest regression test
  that prevents that exact defect from silently returning; delete temporary
  fixtures and debugging scripts before reporting.
- Do not combine unrelated cleanup, documentation migration, CI repair, or
  platform work with the active product flow.
- After one flow passes, stop, document the result, and let the maintainer
  choose the next flow.

The current handoff and next E2E contract are in
`docs/tasks/2026-07-15-local-product-e2e/HANDOFF.md`.

**NEVER run `git clean -fdx` in this working tree.** The tree is
shared with the reviewer, and that command destroys uncommitted work
from both sides (we lost an entire new module that way during the
Fase 5 close-out). To clean build artifacts, delete explicitly:
```bash
Remove-Item -Recurse -Force packages/core/dist, packages/cli/dist, packages/mcp/dist
Remove-Item -Force packages/*/*.tsbuildinfo, packages/*/dist/*.tsbuildinfo
```
(or the PowerShell-equivalent). Never `-fdx`.

## TL;DR

livewiki is an agent-first technical documentation tool. The core is the
**5-stage batch pipeline** (scan → modules → prioritize → document →
flows) that calls an LLM to generate Markdown pages anchored to code
symbols, post-validating via `verify` (broken_anchor = key outside the
index). Stage 5 synthesizes a bounded set of semantic product-flow
artifacts (`livewiki/flows/<slug>.md` + `livewiki/diagrams/flow-<slug>.mmd`
+ deterministic `flows/index.md` hub) from deterministically detected
candidates (`packages/core/src/flows.ts`), reusing the stage-4
artifact/repair/transactional-write machinery. The R11-A working tree adds a
closed-inventory semantic topic planner and bounded topic pages under
`livewiki/topics/`; implementation is uncommitted and validation has not run.
The **MCP server (Phase 4)** exposes the wiki via 7 tools to any MCP
client (Claude Code, Cursor, Codex, etc.) — FTS5 search, read,
validated write, debt management.

Project status:
- **Phase 0** (scaffold + safe-io) ✅
- **Phase 1** (indexer with web-tree-sitter) ✅
- **Phase 2** (anchors + debt + verify) ✅
- **Phase 3** (init + batch + LLM client + diagrams + accounting) ✅
- **Phase 3 rev2** (empirical fixes H–M) ✅
- **Phase 4** (MCP server: 6 tools + FTS5 + stdio) ✅
- **Phase 5** (skills + hooks + incremental update + pointer) — in review
  - **step 3** (hooks templates — git post-commit + Claude Code Stop) ✅
  - **step 4** (opt-in pointer in AGENTS.md/CLAUDE.md) ✅
  - **step 5** (provider presets — 10 entries as data) ✅
  - **step E2E** (end-to-end flow: hook → MCP write_doc → verify zero
    issues → manifest updated) ✅
  - **[R]** `livewiki init` adds `.livewiki/` to `.gitignore` ✅
  - **[S]** translation to English of CLI strings + messages ✅
  - **[U–X]** batch resilience (unique IDs, artifact validation, bounded
    repair, transactional write, ownership) ✅ approved (pending push)
- **Phase 6 Lot 6A** (deterministic export) ✅ implemented; `generic` local
  happy path manually validated, Git-host targets not yet manually validated
- **Phase 7** (local viewer + templates) — post-MVP

Phase 3 acceptance criterion (SPEC): `livewiki init --batch` in a medium
repo generates a complete wiki; interrupting in the middle + `batch
resume` continues from the correct task; verify catches at least one
real case of hallucinated doc. Rev2 empirical (commit ad87319) adds
subdirectory + NodeNext + openai-compat scenarios (covered by
`cli-batch-e2e-subdirs.test.ts` in the CLI).

Phase 4 acceptance criterion (SPEC): connected to a real MCP client;
the 6 tools work; `livewiki_write_doc` rejects paths outside `livewiki/`
and content that doesn't pass `verify`. Covered by
`packages/mcp/src/server.test.ts` (12 E2E scenarios with
InMemoryTransport — no real stdio needed).

Phase 5 acceptance criterion (SPEC): end-to-end flow — agent edits
code, hook detects, agent pays debt via MCP, verify passes clean
(exit 0 AND zero issues of any severity), manifest updated. E2E must
assert issue count, not just exit code. Covered by
`packages/mcp/src/phase5-e2e.test.ts` (7 scenarios: 2 end-to-end + 5
covering [R] `init` adds `.livewiki/` to `.gitignore`).

## Repo layout

```
livewiki/
├── SPEC.md                    # source of truth for behavior
├── VISION.md                  # rationale and out-of-scope
├── AGENTS.md                  # THIS FILE (conventions + live state)
├── packages/
│   ├── core/                  # @livewiki/core — all logic
│   │   ├── src/
│   │   │   ├── index.ts        # public surface
│   │   │   ├── safe-io.ts      # rule #1: writes only via allowlist
│   │   │   ├── hashes.ts       # sha256 helper
│   │   │   ├── walker.ts       # denylist walk (all text files; skips binaries/lockfiles/livewiki/)
│   │   │   ├── parser.ts       # tree-sitter init + parse source
│   │   │   ├── symbols.ts      # extract symbols from AST (TS/JS/Python) + rationale extraction (Etapa 2b)
│   │   │   ├── db.ts           # SQLite schema v3→v6 + migrations
│   │   │   ├── indexer.ts      # walk → read → hash → (parse if grammar) → upsert; NUL/1 MiB skips; rationale capture
│   │   │   ├── anchors.ts      # extracts anchors from markdown
│   │   │   ├── frontmatter.ts  # YAML subset parser
│   │   │   ├── anchor-ledger.ts# Phase 2: diff vs previous state → debt
│   │   │   ├── verify.ts       # Phase 2: walk disk, broken_anchor check
│   │   │   ├── status.ts       # status --json report
│   │   │   ├── pricing.ts      # embedded table + lookup
│   │   │   ├── config.ts       # .livewiki/config.json load/save
│   │   │   ├── llm/            # client + adapters Anthropic/openai-compat
│   │   │   ├── imports.ts      # extracts imports via tree-sitter
│   │   │   ├── modules.ts      # heuristic + edges + prioritization
│   │   │   ├── diagrams.ts     # deterministic Mermaid
│   │   │   ├── prompts.ts      # templates (English), ${language} in user
│   │   │   ├── manifest.ts     # .manifest.json + snapshotHash
│   │   │   ├── batch.ts        # 5-stage orchestrator + circuit breaker
│   │   │   ├── flows.ts        # stage 5: deterministic flow-candidate detector
│   │   │   ├── repair-contract.ts# Etapa 2a: closed repair contract (SUPPORTED_FIXES/UNCLASSIFIED per page kind)
│   │   │   ├── init.ts         # livewiki init (deterministic layout + batch)
│   │   │   ├── update.ts       # Phase 5: incremental mode
│   │   │   ├── update-metrics.ts# Phase 5: token accounting
│   │   │   ├── pointer.ts      # Phase 5: opt-in AGENTS.md/CLAUDE.md block
│   │   │   ├── presets.ts      # Phase 5: 10 provider presets (data)
│   │   │   └── gitignore.ts    # Phase 5 [R]: idempotent .gitignore writer
│   │   └── package.json        # subpath exports per module
│   ├── cli/                   # @livewiki/cli — thin wrapper
│   │   └── src/
│   │       ├── cli.ts          # commander setup + global flags
│   │       ├── output.ts       # JSON / human emitter
│   │       └── commands/
│   │           ├── init.ts     # livewiki init [--batch | --plan | --no-refine]
│   │           ├── index-cmd.ts# livewiki index
│   │           ├── status.ts   # livewiki status
│   │           ├── update.ts   # livewiki update (stub Phase 5, implemented)
│   │           ├── verify.ts   # livewiki verify
│   │           ├── batch.ts    # livewiki batch [status|resume|--only|list]
│   │           ├── pointer.ts  # livewiki pointer (Phase 5 step 4)
│   │           ├── serve.ts    # livewiki serve (Phase 4)
│   │           ├── export.ts   # livewiki export (Phase 6 Lot 6A)
│   │           └── view.ts     # livewiki view (stub Phase 7)
│   │       ├── templates/      # Phase 5 step 3: hook templates
│   │       │   ├── git/post-commit        # bash hook
│   │       │   ├── claude-code/settings.local.json
│   │       │   └── README.md             # install instructions
│   │       └── skills/         # Phase 5 step 2: document-as-you-go
│   │           └── document-as-you-go/SKILL.md
│   └── mcp/                   # @livewiki/mcp — Phase 4: MCP server
│       └── src/
│           ├── server.ts       # McpServer + 7 tools
│           ├── search.ts       # FTS5 (.livewiki/search.db)
│           ├── index.ts        # stdio entry point (npx livewiki-mcp --repo)
│           ├── server.test.ts  # Phase 4 E2E (12 tests, InMemoryTransport)
│           └── phase5-e2e.test.ts# Phase 5 E2E (7 scenarios)
└── .livewiki/                 # derived cache of the repo (allowlist)
    ├── index.db               # SQLite schema v6
    ├── search.db              # SQLite FTS5 (MCP, Phase 4)
    └── config.json            # local repo config
```

## Entry points (what an external agent will touch)

- **CLI `livewiki init`** — creates layout + indexes + (optional) runs
  batch. Always written in `packages/cli/src/commands/init.ts` + logic
  in `packages/core/src/init.ts`. Flags: `--batch`, `--plan`,
  `--no-refine`.
- **CLI `livewiki batch`** — manages full-documentation runs.
  `packages/cli/src/commands/batch.ts` + orchestrator in `batch.ts`.
  Subcommands: `status [<runId>]` (default), `resume <runId>`,
  `--only <task-id|module>` reruns 1 task (same interface the in-session
  mode uses to work the queue); regeneration preserves `lw:manual`
  blocks byte-for-byte, refuses `owner: human`, and sums the new
  `usage` into the checkpoint (retry costs token and shows in the
  report).
- **CLI `livewiki verify`** — Phase 2. Reads the wiki fresh from disk,
  validates anchors. Always exits non-zero on failure (CI-friendly).
  **Parses the wiki fresh from disk** — an anchor in a never-indexed
  page MUST be caught (the anti-hallucination promise: LLM-written docs
  are validatable without running `index` first).
- **MCP server (Phase 4)** — `packages/mcp/src/server.ts` defines the
  McpServer with 7 tools; `packages/mcp/src/index.ts` is the stdio
  entry point (`npx livewiki-mcp --repo <path>`). Typical
  configuration in Claude Code:
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
  Tools (all documented in `server.ts` docstring):
  - `livewiki_quickstart` — returns `livewiki/quickstart.md`
  - `livewiki_read` — reads a wiki page by path (allowlist `livewiki/`)
  - `livewiki_search` — full-text search FTS5 (rebuilt on startup)
  - `livewiki_debt` — open debt (= `livewiki status --json`)
  - `livewiki_write_doc` — writes a page (allowlist + post-write verify)
  - `livewiki_resolve_debt` — closes debts by ID
- **MCP E2E** — `packages/mcp/src/server.test.ts` covers all 7 tools +
  error scenarios + Etapa 2d hint assertions (24 tests). Uses `InMemoryTransport`
  from the MCP SDK — no real stdio or subprocess needed.

## Validation workflow

Before committing any change in Phases 2, 3, 4, 5, or 6:

```bash
pnpm -r build         # core + cli + mcp
pnpm -r test          # vitest in all
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
                     # critical E2E: init --batch end-to-end with stub server (anthropic)
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e-subdirs.test.ts
                     # E2E rev2: subdirectories + NodeNext + openai-compat (findings H–M)
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
                     # CRITICAL regression: key can NEVER appear in output
pnpm --filter @livewiki/mcp test
                     # Phase 4/2d: 7 tools + hints E2E (InMemoryTransport)
pnpm --filter @livewiki/mcp test -- src/phase5-e2e.test.ts
                     # Phase 5: end-to-end + [R] gitignore
pnpm --filter @livewiki/core test -- src/export.test.ts
                     # Phase 6 Lot 6A: deterministic export, safe-io allowlist
pnpm --filter @livewiki/cli test -- src/cli-export-e2e.test.ts
                     # Phase 6 Lot 6A: CLI E2E
pnpm --filter @livewiki/core test -- src/flows.test.ts
                     # stage 5: deterministic flow-candidate detector
pnpm --filter @livewiki/core test -- src/batch-stage5.test.ts
                     # stage 5: orchestration contracts (owner, rollback, budgets)
pnpm --filter @livewiki/cli test -- src/cli-batch-stage5-e2e.test.ts
                     # stage 5: CLI E2E (flows + hub + verify zero issues)
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e-prose-tier.test.ts
                     # Etapa 1: tier-2 prose floor CLI E2E (mixed .ts/.go/.rs + prose-only repo)
```

Current coverage: **80%+ statements / 80%+ branches / 90%+ funcs** (above
the 80% minimum of rule #5; the drop vs early phases is because
`init.ts` and `batch.ts` are covered via E2E/subprocess, not unit —
those files are explicitly out of the `vitest` unit suite).

### Cross-platform validation

The matrix CI lives at `.github/workflows/cross-platform-ci.yml`. It
runs on `ubuntu-latest`, `windows-latest`, and `macos-latest` (Node 20),
plus `ubuntu-latest` (Node 24) for a current-runtime sanity check.
Windows may skip the export symlink tests when the runner cannot
create symlinks (no Developer Mode, no admin); the same tests run
(without skipping) on the Ubuntu and macOS jobs. A test-file guard
in `packages/core/src/export.test.ts` makes any Unix-host skip
enforceable as a CI failure.

This workflow is not currently green. Runs `29438763571`, `29441166630`,
and `29445115951` exposed workflow/runtime and macOS path-canonicalization
issues. They are recorded for later work, but MUST NOT be repaired or retried
until the local product E2E sequence in the current handoff is complete.

Until the remote matrix has been observed green on all three OS hosts,
this repo must NOT claim "cross-platform validated", "matrix green",
or equivalent in any commit, PR description, release note, or
external message. Local Windows runs are necessary but not sufficient
for closing the lot.

## Where to touch for each change type

- **New CLI command** → `packages/cli/src/commands/<name>.ts` +
  register in `cli.ts`. If the logic is reusable, put it in
  `packages/core/src/<name>.ts` and expose via `index.ts` + `package.json`
  subpath exports.
- **New SQLite table** → bump `CURRENT_SCHEMA_VERSION` in `db.ts`,
  update `SCHEMA_SQL` (fresh installs) and add a migration function in
  `postV3Migrations()` (idempotent — checks columns before ADD).
- **New LLM provider** → adapter in `packages/core/src/llm/<provider>.ts`,
  implement `LlmClient`, register in the factory at `llm/index.ts`.
- **New preset** → entry in `PRESET_TABLE` in `presets.ts`. No new code.
- **New prompt** → function in `prompts.ts`, system in English,
  `${language}` in the user prompt as an explicit instruction.
- **New deterministic diagram** → add a function in `diagrams.ts`,
  write to the SPEC path (`livewiki/architecture/...` or
  `livewiki/diagrams/...`).
- **Bug in circuit breaker / orchestrator** → `packages/core/src/batch.ts`,
  with tests in `batch.test.ts`. Update
  `packages/cli/src/commands/batch.ts` for the new exit code.
- **Stage 5 (flows)** → detection in `packages/core/src/flows.ts` (pure,
  deterministic; tests in `flows.test.ts`); orchestration in `batch.ts`
  (tests in `batch-stage5.test.ts`); prompt builders
  `buildStage5Prompt`/`buildStage5RepairPrompt` + `FLOW_PAGE_PROMPT_RULES`
  in `prompts.ts`; flow page-kind validation in `artifact.ts`
  (`Stage4ValidationContext.pageKind`); hub/gated links in
  `navigation.ts` (`loadFlowPresentations`, `generateFlowsIndex`,
  `syncFlowsIndexHub`); stale cleanup `syncStaleFlowArtifacts` in
  `init.ts`; CLI E2E in `cli-batch-stage5-e2e.test.ts`. Config keys
  (defaults): `maxFlows` (4; 0 disables), `flowMaxAnchors` (25),
  `flowMaxDiagramNodes` (12), `flowMaxDiagramEdges` (20), `flowSignals`
  (gitignore-style entry/persistence pattern overrides).
- **Stage 5 (topics)** → closed inventory, proposal validation, and stable
  evidence identities in `packages/core/src/topics.ts`; planner/topic prompts
  in `prompts.ts`; `pageKind: topic` validation in `artifact.ts`; orchestration
  and checkpoint reuse in `batch.ts`; hubs and bounded topic cross-links in
  `navigation.ts`; generated-only stale cleanup in `init.ts`. Config defaults:
  `maxTopics` 4, `topicMaxAnchors` 18, `topicMaxSourceChars` 40,000, and
  `topicMaxOutputTokens` 4,096.
- **Rationale evidence (Etapa 2b)** → extraction (tagged comments
  WHY/NOTE/HACK/TODO/FIXME + Python/`/**` docstrings, positional
  attribution, generated-file header sniff) in `packages/core/src/symbols.ts`
  (`extractRationales`, `isLikelyGenerated`); schema v6 `rationales` table in
  `db.ts`; wholesale per-file persistence in `indexer.ts`; bounded rendering
  and budget carve in `batch.ts` (`buildModuleDocContext`,
  `buildTopicDocContext`); `# Rationale evidence` prompt block in
  `prompts.ts`. Config key: `rationaleMaxChars` (default 4,000; 0 disables;
  validated integer 0..200,000). Stage-5 flows and the topic planner receive
  no rationale block.
- **Risk-weighted debt ordering (Etapa 2c)** → rubric, coverage/fan-in maps,
  churn spawn, and sort comparator in `packages/core/src/risk.ts` (tests in
  `risk.test.ts`); consumed by `status.ts` (`applyRiskRanking`, additive
  `DebtItem.risk`, `[risk N]` human marker) and inherited by `update.ts`'s
  work package; config keys `riskAnalysis` / `riskChurnCommits` in `config.ts`.
- **MCP `_hints` table (Etapa 2d)** → single `TOOL_HINTS` constant in
  `packages/mcp/src/server.ts` (exported `ToolHint` type); per-tool
  assertions in `server.test.ts`.
- **New MCP tool** → add `server.tool(name, desc, schema, handler)` in
  `packages/mcp/src/server.ts`. Schema with `zod`. If it needs a new
  operation in core, add it there and import here (don't duplicate
  logic). Update `server.test.ts` with an E2E scenario.
- **Hook / skill change** → `packages/cli/templates/` or
  `packages/cli/skills/`. Update README/SKILL.md; tests in
  `packages/cli/src/templates.test.ts`.

## Phase 5 specific notes (in progress)

- **`livewiki init` adds `.livewiki/` to `.gitignore`** [R] — the
  derived cache must NEVER travel in git (rule #3). `init` writes
  a managed block delimited by `# livewiki:start` / `# livewiki:end`
  (idempotent: re-init is a no-op if already present). User-added
  entries outside the block are preserved. See
  `packages/core/src/gitignore.ts`.
- **Hook templates** (Phase 5 step 3) live in
  `packages/cli/templates/`. Install via `core.hooksPath` (recommended,
  see `templates/README.md`). The `post-commit` hook NEVER blocks the
  commit (always exits 0) — it only prints a debt summary if any. The
  `--quiet` flag added to `livewiki index` suppresses human output so
  the hook doesn't spam the terminal.
- **Skill "document-as-you-go"** lives at
  `packages/cli/skills/document-as-you-go/SKILL.md` (Claude Code
  skills format). The agent runs `livewiki status --json` after each
  task and pays debt via `livewiki_write_doc` (MCP) or direct edit +
  `verify`.
- **Provider presets** (Phase 5 step 5) are pure data in
  `packages/core/src/presets.ts` — 10 entries (anthropic, openai,
  openrouter, deepseek, kimi, **minimax→anthropic adapter** per SPEC
  for prompt caching, gemini, nvidia, ollama, lmstudio). Config
  references a preset by name and may override any field
  (`baseUrl`, `pricing`). API keys NEVER in config — env var only.
  Key-leak regression test (`src/key-leak.test.ts`) still passes.

## Additional conventions (Phase 3+)

- **API key ONLY via env var** (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
  / `MINIMAX_API_KEY` / etc per preset). Never in `config.json`,
  `checkpoint_json`, logs, or errors. Covered by
  `key-leak.test.ts` — **if this test fails, DO NOT commit.**
- **No hardcoded default model** (commit 3894f6e). `batch` without
  config fails with `MissingProviderConfigError` pointing to
  `.livewiki/config.json` with `claude-sonnet-5` only as an EXAMPLE
  (not a silent fallback).
- **Prompt templates in ENGLISH** (plan revision fix). `${language}`
  controls ONLY the language of the generated doc.
- **Diagrams in SPEC paths** (fix #2): `livewiki/architecture/structure.mmd`,
  `livewiki/architecture/modules.mmd`, `livewiki/diagrams/<slug>.classes.mmd`.
  Pure `owner: generated` — they never age.
- **Manifest with snapshot hash** (fix #3): `livewiki/.manifest.json`,
  `snapshotHash = sha256(livewiki/ excluding the manifest itself)`.
  Only rewrites if content changed (anti-loop CI). `init.ts` NEVER
  lists the manifest in `filesWritten` when it wasn't actually
  rewritten (FIX M rev2).
- **Stage 2 LLM refinement is opt-in/degradable** (fix #5):
  `--no-refine` skips; LLM failure degrades to heuristic (not a task
  failure). Refined validation (FIX I rev2): rejects `{"modules": []}`,
  malformed JSON, duplicate/id-less modules, empty modules, unknown or
  duplicate paths, peer-directory fragmentation, or any incomplete
  partition of the indexed inventory (exact 100% required — not 80%).
  On any rejection, heuristic wins and the error goes into the stage 2
  checkpoint; the batch does not abort.
- **Checkpoint shape**: `usageHistory: [{ attempt, usage, costUsd, finishedAt }]`
  from attempt 1. Report aggregates; "current usage" = last item.
- **Failure policy** (commit d274dd9): failed task → marks + reason,
  CONTINUES. Circuit breaker: 3 consecutive failures OR (>50% with
  ≥3 tasks). Status: `completed` / `completed_with_failures` /
  `aborted`.
- **Exit codes**: 0 = `completed`, 1 = `completed_with_failures`,
  2 = `aborted`. Single source of truth:
  `core/batch.ts:statusToExitCode()`. CLI uses
  `process.exitCode = N` (never `process.exit(N)`) to preserve FIX L.
- **Token-first reporting** (ad87319): tokens are the primary metric
  in `livewiki batch status` (human and JSON); USD appears as a
  secondary line marked "estimated, table as of <date>", omitted
  without drama when no pricing exists. `formatStatusHuman` and
  `formatResultHuman` in `packages/cli/src/commands/batch.ts` lead
  with tokens; USD only appears when `costUsd !== null` somewhere.
- **Checkpoint shape** (FIX J rev2): `batch_tasks.checkpoint_json` is
  pure JSON. Refined modules live in `batch_runs.summary_json` (field
  `modulesRefined`), NEVER concatenated into the task JSON (that
  corrupted parse and zeroed stage 2 usage in `status`).
  `BatchRunSummary` gained `modulesRefined: Array<{id, paths}> | null`;
  `buildStatusReport` exposes it via `run.summary`.
- **Empty pipeline guard** (FIX H rev2): if `ordered.length > 0` AND
  `tasksToRun.length === 0` (heuristic found modules, batch has 0
  tasks), `runBatch` throws `EmptyPipelineError` → status becomes
  `completed_with_failures` (exit 1), never `completed` (exit 0).
  Also: a run with `cb.done === 0` AND `ordered.length > 0` is
  forced to `completed_with_failures`.
- **Stage 5 (flows)**: after stage 4 (and before the navigation regen),
  `detectFlowCandidates` (`flows.ts`, pure/deterministic) produces a
  bounded set of cross-module flow candidates; each becomes a task
  `flow:<slug>` reusing the stage-4 attempt/repair/budget machinery. The
  model emits ONE page with the diagram INLINE in `## Diagram`; the
  orchestrator extracts it to `livewiki/diagrams/flow-<slug>.mmd` and
  writes the page with the `%% livewiki/diagrams/flow-<slug>.mmd`
  placeholder. No mechanical fallback (artifact-repair stays
  fail-closed). `owner: human` flow pages are refused; stale generated
  flows are removed by `syncStaleFlowArtifacts`. The hub
  (`flows/index.md`), quickstart/overview gated links, and module
  `## Navigate` `Flow:` lines are regenerated by `init` /
  `regenerateArchitectureOverview`. `--only flow:<slug>` reruns one
  flow with monotonic usage. Zero candidates is a valid outcome (no
  `flows/`, no links), never an empty pipeline.
- **Closed repair contract** (Etapa 2a): every
  `ArtifactValidationCode` — including the five real `verify` issue
  codes, now preserved end-to-end instead of collapsed into
  `verify_failed` — maps, per page kind, to exactly one ACTION directive
  (`SUPPORTED_FIXES`) or an explicit `UNCLASSIFIED` reason in
  `packages/core/src/repair-contract.ts` (exhaustiveness-tested in
  `repair-contract.test.ts`; the mechanical code sets in
  `artifact-repair.ts` are shared constants — one list, no drift).
  Repair prompts render directives plus a report-only section for
  unclassified codes (never repaired by guessing;
  `manual_block_altered` is report-only by design, rule #6). An
  all-unclassified error set fails the task immediately with
  `unrepairable` (distinct from `repair_exhausted` in `batch status`,
  human and JSON) and zero repair calls. Topic write/verify
  exceptions short-circuit the task like stages 4/5
  (`write_verify_exception`, no repair slots burned).
- **Preset satisfies provider** (E2E fix): `validateConfigForBatch`
  accepts `preset` + `model` without `provider` (SPEC: config.json
  references the preset by name). A preset-only config previously threw
  `MissingProviderConfigError`; regression test in `config.test.ts`.
- **Inline flow-style frontmatter lists** (E2E fix): `key: [a, b, c]`
  parses as a string list (the form LLMs most often emit). Previously
  it became one opaque string, silently breaking `anchors:` checks and
  the flow `modules:` consumption in navigation. Regression tests in
  `frontmatter.test.ts`.
- **NodeNext imports** (FIX K rev2): `modules.ts:resolveRelativeImport`
  strips the `.js`/`.jsx`/`.mjs`/`.cjs` extension before trying
  candidates. `import x from "../utils/crypto.js"` now resolves to
  `crypto.ts` (or `.tsx`, `.js`, etc) and `index.js` is treated as
  a barrel.
- **Process cleanup** (FIX L rev2): CLI uses `process.exitCode = N;
  return` instead of `process.exit(N)` in init/batch catch handlers.
  Prevents libuv assert (STATUS_STACK_BUFFER_OVERRUN = exit
  -1073740791) when async handles are open (fetch, SQLite WAL,
  watcher). Node drains the event loop before exiting.
- **Exit code propagation in init --batch** (O): `livewiki init
  --batch` propagates the batch status via `InitResult.batchExitCode`
  (calculated by `core/batch.ts:statusToExitCode()`). Without this,
  abort/completed_with_failures exited 0 and masked systemic failure.
  `--json` always exits 0 (structured output, batch CLI convention).
  Tested in `cli-batch-e2e.test.ts` (4 new scenarios:
  aborted/completed_with_failures/completed/--json).
- **`architecture/overview.md` in init** (P): SPEC §"Batch pipeline"
  says "At the end: generate/update quickstart.md and
  architecture/overview.md". Before the fix, quickstart linked to
  `#<m.id>` but overview didn't exist — verify emitted WARNs in
  newly-completed runs. Now init generates
  `livewiki/architecture/overview.md` in the base flow (with heuristic
  modules) — batch regenerates with pages linked. HTML inline anchors
  (`<a id="...">`) guarantee exact match with the quickstart link,
  regardless of markdown renderer. Tested in `cli-batch-e2e.test.ts`
  (3 new scenarios: init base, init --batch, cross-check links↔anchors).
  **(R) follow-up:** the `[page]` link is only emitted when the page
  EXISTS — without this, init's overview had broken links (init runs
  before batch creates pages), and the Phase 5 criterion "verify
  zero issues" would always fail. Batch now calls
  `regenerateArchitectureOverview` after stage 4 to link the
  newly-created pages.
- **FTS5 in separate DB** (Phase 4): `livewiki_search` uses
  `.livewiki/search.db` (NOT `index.db` — avoids touching the index schema
  / migrations). Full rebuild on MCP server startup (fast, idempotent);
  incremental update via `indexPage()` in `write_doc`. Porter
  tokenizer (default FTS5). Decision in
  `packages/mcp/src/search.ts:doc`.
- **MCP write_doc = 2 phases** (Phase 4): (1) `safe-io.writeText`
  (allowlist) (2) `verify.run` on the repo. If verify reports an
  `error` issue on this page, rollback (deletes the file) + returns
  `isError=true` with details. `skipVerify` is a documented escape
  hatch for pages without anchors (e.g. quickstart). Same allowlist
  as rule #1 + same post-batch verify check.
- **Windows + search.db**: better-sqlite3 opens search.db with WAL
  (search.db-shm / search.db-wal). E2E tests must close the server
  (via `server.close()`) before `afterEach` runs recursive `rm` —
  otherwise EBUSY on Windows.
- **Pointer opt-in** (Phase 5 step 4): rule #2 — AGENTS.md/CLAUDE.md
  only modified with explicit `--write-pointer` flag or interactive
  confirmation. The block is delimited `<!-- livewiki:start --> ...
  <!-- livewiki:end -->`, idempotent. safe-io's `allowPointer` exists
  since Phase 0 for this. See `packages/cli/src/commands/pointer.ts`.

## Specific gotchas

- **Post-v3 migrations are JS functions**, not SQL strings. SQLite
  doesn't have `ADD COLUMN IF NOT EXISTS`. Function checks
  `PRAGMA table_info` before ADD.
- **`manifestsEqual` ignores `updatedAt`** — it's a timestamp, not
  content. Otherwise every `new Date()` would generate a new
  `updatedAt` and always rewrite, breaking the anti-loop CI (git
  diff would show a change on every commit).
- **Circuit breaker ratio check requires `totalAttempted >= 3`** —
  without this, `1 fail / 0 done = 100%` would abort any run with
  1 task.
- **`safeIo.resolveAndValidate` is async** (uses `realpath` async).
  There is no sync version — always `await`.
- **MCP write_doc rollback** — if verify rejects after write,
  deletes the file that was just written (best-effort). Ensures
  inconsistent state doesn't persist (rule #3: disk is the truth).
- **MCP FTS5 rebuild on startup** — `openAndIndex` reindexes all
  markdown pages. If you only added a page via `write_doc`, it already
  updates incrementally; no need to restart the server.
- **Edit tool sometimes fails** with "Could not safely match
  oldString" on large files. Workaround: Python one-off patch, run,
  delete with `mavis-trash`. Don't retry — wastes tokens.
- **PowerShell on Windows**: do NOT use `&&`, `ls -la`, `head`,
  `tail`, `grep`. Use `;`, `Get-ChildItem`, `Select-Object`,
  `Select-String`. If `bash` produces garbled/UTF-16 output or WSL
  prompts ("install a distribution"), switch to `node`/`python`
  immediately — max 2 retries before changing approach.
- **Lock from git sometimes persists** — if `git commit` complains
  about `index.lock`, wait 2s and retry (usually the process has
  already released it). If it persists,
  `mavis-trash .git/index.lock` (do NOT use `Remove-Item`).

## Live state (semantic product-flow layer implemented, awaiting review)

The semantic product-flow layer (design contract:
`docs/tasks/2026-07-18-semantic-product-flow/DESIGN.md`, approved
2026-07-18) is **implemented and validated in the working tree,
uncommitted and unpushed** on top of the R2–R9 hardening patch:

- SPEC amendments applied (5-stage pipeline, semantic-flow section,
  quickstart gated link, `tasks.md` responsibility-sentence dedup,
  `flows/` layout).
- Stage 5 (flows): deterministic candidate detection (`flows.ts`),
  per-candidate tasks `flow:<slug>`, inline-diagram extraction to
  `diagrams/flow-<slug>.mmd`, flow page-kind validation, bounded repair,
  transactional write, stale-flow cleanup, `--only flow:<slug>`.
- Navigation: `flows/index.md` hub, gated quickstart/overview links,
  module `## Navigate` `Flow:` lines, `tasks.md` dedup (responsibility
  sentence; auxiliary modules as compact link lists).
- Two defects found and fixed with regression tests during validation:
  `validateConfigForBatch` rejected preset-only configs; the frontmatter
  parser treated inline flow-style lists (`key: [a, b]`) as one opaque
  string.
- Test state: core 875 passed / 12 skipped (Windows symlink), CLI 81,
  MCP 21; `pnpm -r build` clean.
- Real E2E on a kc-quillrift copy (2026-07-18): `claude`, `codex`, and
  `mmx` (MiniMax-M3) each produced module pages + flow page + diagram
  reaching **verify zero issues** and idempotent `export generic`
  (mmx needed one error-feedback repair round). A local 3B ollama model
  hit `repair_exhausted` on stage 4 and the circuit breaker aborted
  cleanly with exact token accounting — small local models are below the
  contract's reliability floor. Evidence:
  `docs/tasks/2026-07-18-semantic-product-flow/RESULTS.md`.
- **R10 (comparison-grade, 2026-07-18)**: MiniMax-M3 `init --batch
  --no-refine` on the frozen `895d49e` source (same as R9). Final corpus:
  40 pages + 12 Mermaid, verify zero issues, 261/261 links, **duplicate
  prose groups 36 → 1** (only a shared `## Navigate` boilerplate line).
  The flow task exposed two design fixes, both applied with regression
  tests: flow closed list is an **upper bound** (cite-what-you-use, both
  surfaces consistent), and index pages (`tasks.md`, `flows/index.md`)
  are title + link only (no copied sentences). Two further defects fixed
  during validation: preset-only configs rejected by
  `validateConfigForBatch`; inline flow-style frontmatter lists parsed as
  one string. Blind dual evaluation (claude + codex, immutable dirs,
  frozen OpenWiki R1 control): **descriptive tie / split decision** —
  claude 7.65 vs 7.40 OpenWiki, codex 7.8 vs 8.0 LiveWiki; mean ≈7.73 vs
  ≈7.70 (two ordinal scores, no variance claimed), closing the R9 0.75
  gap to ≈0.03. R10 totals (checkpoint-authoritative): 1,190,779 tokens =
  994,646 in + 196,133 out, 82 calls; flow task 361,891 tokens / 17
  attempts. Convergent wins: factual accuracy (9,9) and
  traceability (9,10). Residual gaps both evaluators name: auxiliary
  prominence (16 benchmark/tooling pages) and intent-based navigation.
  Full evidence in the RESULTS addendum.
- **R10.1 acceptance fixes (2026-07-19, implemented, uncommitted;
  autonomous acceptance still open)**:
  contract `docs/tasks/2026-07-19-r10-1-acceptance-fixes/CONTRACT.md`
  (rev6, evidence reconciled after external review). Implemented:
  transactional stage-5
  pair writes (exception → dual rollback, `write_verify_exception`;
  stage-4 aligned), any-severity stage-5 write gate scoped to written
  artifacts (stage 4 keeps error-only), hub ownership skip for
  human/mixed (`skipped-owner`, never persisted), flow validator
  placement D1/D2 + tier coverage D3 (`anchor_missing_required_tier`)
  with H2-ancestor membership and explicit anchor groups
  (entry/boundary/sink) reaching prompt + validator, `Module ID:` removed
  from tasks.md, combined-matcher negations in `flowSignals`,
  `persistenceImportPatterns` config + channel, internal workspace import
  resolution (`import-resolution.ts`: declared workspace map, exports
  explicit keys, dist→src via rootDir/outDir, per-occurrence external
  accounting), seed tiers/groups with two-pass filling + deterministic
  skips (K-a/K-b, `skippedFlowCandidates`), fair per-root enumeration +
  module-sharing centrality. Final deterministic suite state: core 963
  passed / 12 skipped, CLI 84, MCP 21; build clean. The strict paid-E2E
  criterion remains a full exit-0 run with no `--only` recovery or manual
  edit; it has not yet been met.
- **R10.1 acceptance E2E (2026-07-19, single authorized run)**: MiniMax-M3
  defaults, frozen 895d49e fresh copy, 1.35M monitored ceiling, zero
  manual edits. Run: `completed_with_failures` (39 done / 3 failed),
  1,117,150 tokens. Internal-import resolution works: 4 flow candidates
  (R10 had 1) over 265 workspace edges. **`flow:cli-src-to-core-src-05`
  done and meets every acceptance criterion** (100% production anchors,
  groups cited, 8 modules, verify zero issues). 3 flows failed
  `repair_exhausted` (diagram budget/duplicates — model-quality
  residuals, correctly rejected, nothing invalid persisted). Stopped per
  scope; awaiting external review before commit/push.
- **R10.1 E2E completion + blind eval (2026-07-19)**: E2E #2 (repair 5,
  no ceiling) exposed a systematic prompt defect (hub link written
  `../index.md`) — fixed with regression tests (bare `index.md` rule +
  module-granularity diagram guidance + `verify_failed` ACTION; core 963
  passed). E2E #3: **all 4 flows done**, but one benchmark module required a
  disclosed `--only` recovery. Therefore the final corpus is complete while
  autonomous acceptance remains open. Raw corpus: 43 Markdown + 15 Mermaid,
  verify zero, 344/344 links, zero duplicate groups. Masked evaluation corpus:
  341/341 links and one Navigate-boilerplate duplicate group. Final checkpoint:
  1,027,383 tokens (9.8% of OpenWiki); all three R10.1 engineering runs total
  3,602,729 tokens. Corrected blind scores: OpenWiki/R10.1 claude 8.65/6.70,
  codex 7.15/6.80. The byte-identical control moved substantially between
  rounds, so one run per evaluator cannot establish regression or improvement;
  the movement does not exceed every observed corpus difference. Accuracy and
  traceability remain strengths but are not a uniform cross-evaluator win in
  R10.1. The stable actionable finding is navigation/clarity: source-chunk
  pages and auxiliary volume lose to concept-oriented routes. The bounded
  deterministic response is R11-NAV below; the broader concept-topic response
  is the unvalidated R11-A working-tree implementation that follows it.
- **R11-NAV (2026-07-20, implemented, uncommitted)**: deterministic
  presentation-only contract at `docs/tasks/2026-07-20-r11-nav/CONTRACT.md`.
  Quickstart routes by intent and links directly to accepted flows; Tasks
  contains flows + product work + one auxiliary route; the architecture
  overview keeps product cards and one auxiliary summary; and
  `livewiki/auxiliary/index.md` owns the complete non-product inventory.
  Human/mixed/unknown-owner auxiliary hubs are preserved and their skip is
  surfaced in init/batch results. Build clean; core 966 / CLI 86 / MCP 21,
  with 12 expected Windows symlink skips. No paid call, benchmark, commit, or
  push.
- **R11-A (2026-07-20, implemented, uncommitted, unvalidated)**: one bounded
  `topic-plan` task builds a closed concept inventory from accepted module and
  flow evidence; strict validation produces `topic:<evidence-hash>` tasks and
  bounded, anchored `livewiki/topics/<slug>.md` pages. Topics use transactional
  page-scoped any-severity verification, ownership-safe stale cleanup, exact
  accounting, deterministic topic-first Quickstart/Tasks/module/flow routes,
  and a title-link-only topics hub. Non-product stage-4 pages use the compact
  auxiliary reference contract without changing exact anchor coverage. This
  implementation pass ran static syntax/diff checks only; build, tests, MMX,
  paid E2E, benchmark comparison, commit, and push await separate alignment.
- **Etapa 1 (2026-07-23, implemented, uncommitted)**: tier-2 universal prose
  floor (SPEC §"Coverage ladder"). The walker uses a denylist (all text files
  walked; archives/binaries, media/fonts, maps/minified, and lockfiles
  skipped; `livewiki/` always ignored; extensionless files skipped). Grammar-
  less files are indexed with `symbolCount: 0` and `lang` = extension without
  the dot; files with a NUL byte in the first 8 KiB or over 1 MiB are skipped
  and counted (`filesSkippedBinary`, `filesSkippedTooLarge`). `status` reports
  `files.tiers` per language (`anchored` vs `prose`); stage 4 documents prose
  modules through the existing zero-key contract. Validation is unit + stub
  E2E only (`cli-batch-e2e-prose-tier.test.ts`): core 1135 passed / 12
  skipped, CLI suite green. No paid call, commit, or push.
- **Etapa 2a (2026-07-23, implemented, uncommitted)**: closed repair
  contract (`packages/core/src/repair-contract.ts`) — every
  `ArtifactValidationCode` (union widened with the five real `verify`
  codes) is classified per page kind into `SUPPORTED_FIXES` directives
  (ported verbatim from the three historical prompt if-chains) or
  explicit `UNCLASSIFIED` reasons, enforced by an exhaustiveness test
  (`repair-contract.test.ts`). `verifyIssuesToValidationErrors` no
  longer collapses codes into `verify_failed` (the legacy code stays
  in the union with a generic directive for old checkpoints). Early
  abort: an all-unclassified error set fails the task as
  `unrepairable` with zero repair calls; mixed sets render directives
  plus a report-only section. Topic write/verify exceptions
  short-circuit like stages 4/5. Validation: unit + stub suites only —
  no paid call, commit, or push.
- **Etapa 2b (2026-07-24, implemented, uncommitted)**: rationale extraction
  into the index (intent evidence; SPEC §"Phase 1 — Indexer" + §"Batch
  pipeline"). The indexer captures tagged comments (`WHY:`/`NOTE:`/`HACK:`/
  `TODO:`/`FIXME:`, case-insensitive) and docstrings (Python
  module/class/function first-statement strings; TS/JS/TSX `/**` blocks,
  ≥20 normalized chars) into the new schema-v6 `rationales` table
  (`migrateV5ToV6`, recomputed wholesale per file, no soft-delete).
  Attribution is positional: inside-symbol range → innermost symbol;
  contiguous comment block ending immediately above the declaration → that
  symbol; else file-level (`symbol_key` NULL). `content_hash` is the sha256
  of the normalized text (enables a future rationale-changed debt signal —
  out of scope). A generated-file header sniff (`isLikelyGenerated`, first
  8 lines: DO NOT EDIT/@generated/Code generated/AUTO-GENERATED/
  auto-generated) skips extraction for the whole file. Stage-4 (module,
  initial + repair) and topic (initial + repair) prompts gain a bounded
  `# Rationale evidence` block (neutralized + safe-fenced, system-prompt
  line pinning rationale text out of the anchor-key space), capped by the
  new `rationaleMaxChars` config key (default 4,000; 0 disables), carved
  inside the stage-4 char budget and accounted before the hard
  `topicMaxSourceChars` throw. Stage-5 flows and the topic planner are
  untouched. Validation: unit + stub E2E (the prose-tier stub suite asserts
  `# Rationale evidence` reached the model) — no paid call, commit, or push.
- **Etapa 2c (2026-07-25, implemented, uncommitted)**: risk-weighted debt
  prioritization (SPEC §"CLI commands"; plan
  `docs/plans/2026-07-25-etapa-2c-risk-prioritization.md`, option A,
  compute-on-the-fly — no schema bump). `status` (and, through the same array,
  `update`'s work package) ranks open debt by a deterministic rubric — event
  (changed/deleted +10, moved +5), test gap (anchored-tier file with no
  importing test file +40; prose-tier +10), fan-in bands (1–2/3–5/6–10/>10 ⇒
  +5/+10/+15/+20), and git churn bands (1–3/4–9/≥10 ⇒ +5/+10/+15) — computed
  in `packages/core/src/risk.ts` (pure; reuses `isTestPath` from `flows.ts`
  and `resolveImportEdges` with an empty workspace map). Sort: score desc,
  detected_at asc, id asc. Debt identity/dedup untouched; `DebtItem` gains the
  additive optional `risk` field and the human output prints `[risk N]`.
  Imports are recomputed on demand via the hoisted
  `imports.ts:collectImportsForFiles` (batch's former private
  `collectAllImports`); churn is ONE `git -c core.quotepath=false log
  --no-merges --max-count=<N> --name-only --format=` spawn with `shell: false`
  (quotepath off so non-ASCII paths are not C-quoted) that degrades to null
  (churn 0, never an error) when git or a repo is unavailable. Config keys:
  `riskAnalysis` (boolean, default true; false keeps chronological order and
  omits `risk`) and `riskChurnCommits` (integer 0..10000, default 500; 0
  disables the spawn). Validation: unit + integration suites only (risk.test,
  status.test, update.test, config.test) — no paid call, commit, or push.

- **Etapa 2d (2026-07-25, implemented, uncommitted)**: MCP
  workflow-adjacency hints (capability backlog item 4). Every SUCCESS tool
  response carries a static `_hints` block (one `TOOL_HINTS` constant +
  exported `ToolHint` type in `packages/mcp/src/server.ts`) suggesting the
  next most useful calls, so arbitrary MCP clients discover the livewiki
  loop on their own. JSON-payload tools (search/debt/impact/resolve_debt)
  gain a top-level `_hints` field; plain-text tools
  (quickstart/read/write_doc) gain a trailing text block with
  `{"_hints": [...]}` — the first block stays byte-identical. Error
  responses carry no hints. The server registers SEVEN tools —
  `livewiki_impact` (added in ec1b8d2) was missing from this file's tool
  counts; the current-state mentions were corrected in the same pass.
  Validation: mcp suite 31 passed (server.test.ts 24 = 16 pre-existing +
  8 hint assertions incl. error-carries-no-hints; phase5-e2e 7
  untouched) — no paid call, commit, or push.

Benchmark status: clean v18 **PASSED** (13/13, verify clean, exact
accounting) at commit 572b8a3 after the v9→v18 hardening series
(diagnostics, recoverable repair, symbol-key coalescing, anchor-placement
guidance, incomplete-retry budget, fence-aware markers — task briefs under
`docs/tasks/`). Failed runs v10–v17 are preserved byte-for-byte as
evidence.

The quality review vs frozen OpenWiki (`raw/openwiki/`) is written at
`docs/benchmarks/2026-07-10-minimax-m3/QUALITY-REVIEW-V18.md`. Its
navigation findings were implemented as Lot M (deterministic quickstart/
tasks/navigate, commit 0746860) and Lot N (page-opening contract,
semantic titles, `missing_page_opening` + `title_equals_module_id`
validations, commit 59b1112) per
`docs/tasks/2026-07-14-navigation-investigation/`. The dual-evaluator
blind comparison (LiveWiki R9 7.00 vs OpenWiki R1 7.75) is at
`docs/benchmarks/2026-07-10-minimax-m3/QUALITY-COMPARISON-R9-OPENWIKI-R1.md`;
its gaps motivated the semantic product-flow layer above.

Phase 6 Lot 6A is implemented on main at `75cd004`. A disposable local
repository confirmed that `export generic` preserves ordinary frontmatter
except `anchors`, preserves `lw:manual` content, rewrites internal links,
exports Mermaid, does not mutate `livewiki/`, and is idempotent. No product
defect or code change was required by that smoke.

Three follow-up CI commits (`ad5561c`, `20b4541`, `5633963`) remain on main,
but the remote matrix is not green. That is explicitly deferred. An abandoned
seven-file local CI correction was discarded on 2026-07-15 so the next window
starts from the committed tree. The untracked v21 benchmark evidence remains
protected and untouched.

Next planned steps:
1. Maintainer review of the combined uncommitted R10/R10.1 + R11-NAV body.
2. Decide whether to authorize one fresh full paid acceptance E2E, with no
   `--only` recovery or rerun-to-green loop, or explicitly record a waiver of
   the autonomous-run criterion before committing the current body.
3. After review, authorize commit/push separately and launch the beta; use real
   navigation failures to decide whether the deferred R11-A topic layer earns
   its complexity.
4. Only after local product flows pass, return to GitHub/cross-platform CI.
5. Phase 7: local viewer + templates rendering the same canonical artifacts.

> **Reminder for the user**: validate doc/spec additions BEFORE coding.
> When Edu adds something to SPEC (via commit), compare with the current
> implementation before merging — don't implement directly, align first.
