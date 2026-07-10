# Development workflow

> How to add a CLI command, a SQLite table, an LLM provider, a deterministic diagram, an MCP tool, or a hook — and which tests + reviews back each change. Plus the working-tree hygiene rules that keep the shared tree usable across sessions.

This page synthesizes AGENTS.md §"Where to touch for each change type" and the AGENTS.md §"Phase 5 specific notes" into a single decision tree. Use it as a checklist before opening a PR.

## Before you start

Read [VISION.md](../../VISION.md) for **why** and [SPEC.md](../../SPEC.md) for **what**. Then read AGENTS.md §"Language policy" — durable artifacts (docs, comments, CLI strings, error messages, commits) are **in English**. PT-BR is for the maintainer's working conversation only.

## Adding a CLI command

1. Create `packages/cli/src/commands/<name>.ts`. Export `register<Name>(program: Command)`.
2. Implement the action handler. Use `command.optsWithGlobals<Opts>()` so `--json` / `--repo` are inherited. JSON output via `emit(json, data, humanString)` from `cli/output.ts`. Exit code via `process.exitCode = N` (never `process.exit(N)`; see FIX L below).
3. Register in `packages/cli/src/cli.ts` (`createProgram`).
4. If the logic is reusable, move it to `packages/core/src/<area>.ts` and export via `packages/core/package.json` `exports` map. The CLI command imports it.
5. Tests: add unit tests under `packages/cli/src/<name>.test.ts`. If the command touches the full repo lifecycle, add a scenario to `cli-e2e.test.ts` (subprocess E2E) instead.

## Adding a SQLite table or column

1. Bump `CURRENT_SCHEMA_VERSION` in `db.ts`.
2. Update `SCHEMA_SQL` (fresh installs).
3. Add a migration function in `postV3Migrations()` (or whatever the active migration hook is). **Migrations are JS functions**, not SQL strings — SQLite has no `ADD COLUMN IF NOT EXISTS`. Each function checks `PRAGMA table_info(<table>)` before `ALTER TABLE ADD COLUMN`.
4. Add tests covering both fresh install and upgrade-from-v3 paths.

## Adding an LLM provider

1. New adapter? Add `packages/core/src/llm/<provider>.ts` implementing the `LlmClient` interface (`provider`, `model`, `generate(req)`).
2. Register it in the factory at `packages/core/src/llm/index.ts` (`createLlmClient` switch on `resolved.adapter`).
3. New **preset** without a new adapter? Add a row to `PRESET_TABLE` in `presets.ts` — **data only, no code**. Set `adapter` to one of the existing ones (`anthropic` or `openai-compat`).
4. Add to the `PresetName` literal union in `presets.ts` (for autocomplete).
5. Add tests in `llm/adapters.test.ts` for new adapters, or rely on the preset tests if you only added data.
6. **Verify `key-leak.test.ts` still passes.** It is the regression guard for API-key handling.

## Adding a deterministic diagram

1. Add a function to `packages/core/src/diagrams.ts`. Input is data (symbols / file paths); output is Mermaid text.
2. Write to the **SPEC paths**:
   - `livewiki/architecture/structure.mmd`
   - `livewiki/architecture/modules.mmd`
   - `livewiki/diagrams/<module-slug>.classes.mmd`
3. Mark the page `owner: generated` — these never age, never enter debt.
4. Wire into `init.ts` (regenerated on every `init`) and optionally `indexer.ts` (cheap enough to re-emit).

## Adding an MCP tool

1. Open `packages/mcp/src/server.ts`. Add:

```ts
server.tool(
  "livewiki_<name>",
  "description for the LLM",
  { /* zod schema */ },
  async (args) => { /* handler */ },
);
```

2. If the tool needs new core logic, add it under `packages/core/src/<area>.ts` and export via `package.json` subpath exports.
3. **Writes must go through `safe-io`.** Reads through `safe-io.readText`. Never call `node:fs/promises` directly.
4. **Mutating tools should run `verify` before accepting.** Reuse `core/verify.run`; on failure, return `errorResult` (or throw `McpError` for the standard codes).
5. Tests: add an E2E scenario to `server.test.ts` using `InMemoryTransport`. Cover success, allowlist rejection, and verify failure.

## Adding a deterministic layout

If you're generating markdown files as part of `init` / `batch`, write them via `safe-io.writeText` and place them under `livewiki/...` (the allowlist). Add HTML inline anchors `<a id="...">` if you reference them by fragment from elsewhere — Markdown renderers disagree on slugification; the raw anchor guarantees a match.

## Touching `batch.ts` (the orchestrator)

This is the highest-risk file. Update `core/batch.ts:statusToExitCode()` if you change exit semantics. Then:

1. CLI must use `process.exitCode = N; return` (not `process.exit(N)`) in catch handlers — see FIX L below.
2. Update `batch.ts:orchestrate` carefully; the resume/only/run modes share state.
3. Add unit tests in `batch.test.ts` for the new code path.
4. Update `cli-batch-e2e.test.ts` for end-to-end coverage — at minimum: aborted, completed_with_failures, completed, and `--json` exit code propagation.

## Touching the incremental update flow (`update.ts` / `update-metrics.ts`)

The thesis is **focused package vs re-reading the repo**. If you grow the package by adding new fields, document the impact on `tokensEstimated` (heuristic `chars / 4`) and keep an eye on the economy ratio reported to the user.

Add an E2E scenario that:

1. Edits an anchored function.
2. Runs `livewiki update --json`.
3. Asserts the package contains the new symbol snippet, the old symbol key is gone from `validAnchors` if it's been deleted, and `tokensEstimated` matches the actual package size within ±10%.

## Working tree hygiene

From AGENTS.md:

- **Do not run `git clean -fdx`.** It would destroy reviewer's WIP. To clean build artifacts, use PowerShell `Remove-Item -Recurse -Force packages/*/dist`, `packages/*/*.tsbuildinfo`. Or `find … -name "dist" -prune -exec rm -rf {} +` from bash.
- **Do not revert uncommitted `.md` files.** They may be reviewer's work. If in doubt, ask.
- **Git lock persistence.** If `git commit` complains about `index.lock`, wait 2s and retry (the previous process usually already released it). If it persists, use `mavis-trash .git/index.lock` (NOT `Remove-Item`).
- **PowerShell on Windows.** Do not use `&&`, `ls -la`, `head`, `tail`, `grep`. Use `;`, `Get-ChildItem`, `Select-Object`, `Select-String`. If `bash` produces garbled UTF-16 output or WSL prompts to install a distribution, switch to `node`/`python` immediately — max 2 retries.

## Code style

- TypeScript strict mode (see `tsconfig.base.json` — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.).
- ESM, `import.meta.url` for self-references (do not `require.resolve` self-package).
- All CLI strings and error messages in English.
- Comments explain **why**, not **what**. The code shows what; comments justify decisions.
- Avoid one-liners that hide control flow (`process.exit(N)` in async handlers — see FIX L).

## Known gotchas (FIX letters from the code reviews)

| Fix | Where | What |
|---|---|---|
| **A** | `db.ts` | `idx_symbols_active_key` is a **partial unique index** so soft-deletes don't block re-index of the same key |
| **B** | `anchor-ledger.ts` | Soft-delete row is kept (with `status='deleted'`) so the next `moved` detection can match content_hash |
| **C** | `verify.ts` | **Walks the wiki fresh from disk** — anchors in never-indexed pages are still caught (anti-hallucination promise) |
| **D / E / F** | `anchor-ledger.ts` | Debt dedup via partial unique index `(anchor_id, event) WHERE resolved_at IS NULL` |
| **G** | `anchor-ledger.ts` | `moved` rewrites the **markdown**, not just the DB (rule #3) |
| **H** | `batch.ts` | `EmptyPipelineError` — when heuristic finds modules but `tasksToRun` is empty → `completed_with_failures`, never `completed` |
| **I** | `batch.ts` | Stage-2 refined validation: rejects empty `modules`, coverage < 80%, malformed JSON, etc. |
| **J** | `batch.ts` | Refined modules live in `batch_runs.summary_json` (`modulesRefined`), never concatenated into `checkpoint_json` |
| **K** | `modules.ts` | NodeNext: `resolveRelativeImport` strips `.js`/`.jsx`/`.mjs`/`.cjs` before trying candidates |
| **L** | CLI commands | `process.exitCode = N; return` — never `process.exit(N)` — to avoid libuv `STATUS_STACK_BUFFER_OVERRUN` when async handles are open (fetch / WAL / watcher) |
| **M** | `init.ts` | `filesWritten` only contains files that were actually rewritten — no phantom manifest entry |
| **N / O** | `init.ts` | `livewiki init --batch` propagates `batchExitCode` (from `core/batch.ts:statusToExitCode`) via `InitResult` |
| **P** | `init.ts` | `architecture/overview.md` is generated in the base flow (heuristic modules); batch regenerates with pages linked. `[page]` links are only emitted when the page exists |
| **[R]** | `gitignore.ts` | `livewiki init` writes a managed block `# livewiki:start … # livewiki:end` to `.gitignore` (idempotent) |
| **[S]** | CLI strings | All CLI strings and error messages in English (Phase 5 close-out) |

## Where to go next

- [Testing and validation](testing-and-validation.md) — which tests back each of these changes.
- [Inviolable rules](inviolable-rules.md) — the contract every change must uphold.
- [LLM providers](../integrations/llm-providers.md) — preset / adapter workflow in detail.