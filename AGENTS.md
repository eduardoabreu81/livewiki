# AGENTS.md — livewiki

> For LLMs/agents working in this repo. **Live state below in §"Status"**:
> Phases 0–4 approved and on the remote (08a1c0e included). Phase 5 in
> progress with 3 local commits without push (70e643a step 1, 48197dc
> step 2, 13dd441 packaging). Working tree clean.
>
> Previous session: Phase 5 mechanic was approved by the reviewer after
> testing the full incremental flow as an in-session agent (hook
> detects on commit without blocking → debt → paid via MCP `write_doc`
> → verify clean → manifest updated). Two findings before closing, plus
> a new policy (see below). Phase 5 finalization continues in this
> session: [R] livewiki init adds `.livewiki/` to `.gitignore`, [S]
> translation to English for all CLI strings and messages, language
> policy recorded here.

## Language policy

**All durable artifacts of this repo are written in English** — docs,
code comments, CLI strings and messages, error messages, commit
messages. PT-BR only in conversation with the maintainer (Eduardo).
This is a working convention effective immediately, not just for
release. See SPEC.md §"Stack" and VISION.md §"Out of scope" for the
authoritative statement.

If you're reading older commits you may see PT-BR mixed in — those are
pre-policy. New code and edits must follow English.

**Working tree hygiene:** do NOT revert uncommitted `.md` files that
appear in the working tree — they may be reviewer's work. If in doubt,
ask.

## TL;DR

livewiki is an agent-first technical documentation tool. The core is the
**4-stage batch pipeline** (scan → modules → prioritize → document)
that calls an LLM to generate Markdown pages anchored to code symbols,
post-validating via `verify` (broken_anchor = key outside the index).
The **MCP server (Phase 4)** exposes the wiki via 6 tools to any MCP
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
- **Phase 6** (export to github-wiki/gitlab-wiki/generic) — post-MVP
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
│   │   │   ├── walker.ts       # walks repo respecting .gitignore
│   │   │   ├── parser.ts       # tree-sitter init + parse source
│   │   │   ├── symbols.ts      # extract symbols from AST (TS/JS/Python)
│   │   │   ├── db.ts           # SQLite schema v3→v4 + migrations
│   │   │   ├── indexer.ts      # walk → read → hash → parse → upsert
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
│   │   │   ├── batch.ts        # 4-stage orchestrator + circuit breaker
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
│   │           ├── export.ts   # livewiki export (stub Phase 6)
│   │           └── view.ts     # livewiki view (stub Phase 7)
│   │       ├── templates/      # Phase 5 step 3: hook templates
│   │       │   ├── git/post-commit        # bash hook
│   │       │   ├── claude-code/settings.local.json
│   │       │   └── README.md             # install instructions
│   │       └── skills/         # Phase 5 step 2: document-as-you-go
│   │           └── document-as-you-go/SKILL.md
│   └── mcp/                   # @livewiki/mcp — Phase 4: MCP server
│       └── src/
│           ├── server.ts       # McpServer + 6 tools
│           ├── search.ts       # FTS5 (.livewiki/search.db)
│           ├── index.ts        # stdio entry point (npx livewiki-mcp --repo)
│           ├── server.test.ts  # Phase 4 E2E (12 tests, InMemoryTransport)
│           └── phase5-e2e.test.ts# Phase 5 E2E (7 scenarios)
└── .livewiki/                 # derived cache of the repo (allowlist)
    ├── index.db               # SQLite schema v4
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
  McpServer with 6 tools; `packages/mcp/src/index.ts` is the stdio
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
- **MCP E2E** — `packages/mcp/src/server.test.ts` covers all 6 tools +
  6 error/rejection scenarios (12 tests). Uses `InMemoryTransport`
  from the MCP SDK — no real stdio or subprocess needed.

## Validation workflow

Before committing any change in Phases 2, 3, 4, or 5:

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
                     # Phase 4: 6 tools E2E (InMemoryTransport)
pnpm --filter @livewiki/mcp test -- src/phase5-e2e.test.ts
                     # Phase 5: end-to-end + [R] gitignore
```

Current coverage: **80%+ statements / 80%+ branches / 90%+ funcs** (above
the 80% minimum of rule #5; the drop vs early phases is because
`init.ts` and `batch.ts` are covered via E2E/subprocess, not unit —
those files are explicitly out of the `vitest` unit suite).

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
  malformed JSON, duplicate/id-less modules, or coverage < 80% of
  heuristic files. On any rejection, heuristic wins and the error
  goes into the stage 2 checkpoint.
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
  `.livewiki/search.db` (NOT `index.db` — avoids touching schema v4
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

## Live state (next phase: 6 — export + 7 — viewer)

```bash
# Last validation (Phase 5 + [R] + [S] + language policy):
pnpm -r test  → 430 passed + 8 skipped (core 369 + cli 42 + mcp 19)
pnpm -r build → green (core + cli + mcp)
```

Next planned steps:
1. Phase 5 close-out: reviewer approves R + S + language policy →
   push the package (Fase 5 + reviewer's VISION/SPEC translation).
2. Phase 6: export to github-wiki/gitlab-wiki/generic.
3. Phase 7: local viewer + templates.

> **Reminder for the user**: validate doc/spec additions BEFORE coding.
> When Edu adds something to SPEC (via commit), compare with the current
> implementation before merging — don't implement directly, align first.