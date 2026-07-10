# Testing and validation

> livewiki has a layered test strategy: tight unit tests on the deterministic core (indexer, anchor-ledger, verify, safe-io) plus end-to-end tests that exercise the CLI binary against ephemeral repos and the MCP server against `InMemoryTransport`. Coverage is high where it matters most; subprocess-driven flows are covered via E2E rather than unit because unit tests would bypass the soft-delete and symlink-defense paths that are the actual product contract.

## Layout

- `packages/core/src/*.test.ts` — unit tests for core modules. Coverage targets: **80%+ statements / 80%+ branches / 90%+ funcs** in core. `init.ts` and `batch.ts` are explicitly out of the unit suite; they are covered via `cli-batch-e2e*.test.ts`.
- `packages/cli/src/*.test.ts` — CLI unit + subprocess E2E.
- `packages/mcp/src/*.test.ts` — MCP server E2E.
- `packages/core/test/fixtures/` — small repos used by E2E (`fase2-repo`, `sample-ts-repo`).

`pnpm-workspace.yaml` allows native builds for `better-sqlite3`, `tree-sitter-cli`, and the tree-sitter grammar packages. On Windows, `pnpm install` may need extra time for `better-sqlite3` compilation.

## Validation workflow (per AGENTS.md §"Validation workflow")

Before committing any change in Phases 2, 3, 4, or 5:

```bash
pnpm -r build                                    # core + cli + mcp
pnpm -r test                                     # vitest in all packages
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e.test.ts
                                                 # init --batch end-to-end with stub anthropic server
pnpm --filter @livewiki/cli test -- src/cli-batch-e2e-subdirs.test.ts
                                                 # rev2: subdirectories + NodeNext + openai-compat
pnpm --filter @livewiki/core test -- src/key-leak.test.ts
                                                 # CRITICAL regression: API key NEVER in output
pnpm --filter @livewiki/mcp test                 # Phase 4: 6 tools E2E (InMemoryTransport)
pnpm --filter @livewiki/mcp test -- src/phase5-e2e.test.ts
                                                 # Phase 5: end-to-end + [R] gitignore
```

Last reported state (AGENTS.md §"Live state"): **430 passed + 8 skipped** across core + cli + mcp.

## What each test set proves

### Core unit tests

| File | What it proves |
|---|---|
| `safe-io.test.ts` | Allowlist enforcement + symlink-escape defense + 0/1/2-level symlink depth |
| `indexer.test.ts` | Walk respects `.gitignore`; files added/updated/deleted/unchanged counters |
| `parser.test.ts` | WASM grammars load + Language cache |
| `symbols.test.ts` | Symbol extraction for TS/TSX/JS/Python — keys are `path#Name` / `path#Class.method` |
| `hashes.test.ts` | sha256 hex shape |
| `gitignore.test.ts` | `.gitignore` parser uses the `ignore` lib |
| `imports.test.ts` | Tree-sitter import extraction (TS, Python) |
| `modules.test.ts` | Heuristic grouping + NodeNext import resolution (`.js` → `.ts`) |
| `db.test.ts` | Schema v4 + migrations + `idx_symbols_active_key` partial unique |
| `frontmatter.test.ts` | YAML subset parser (lines, lists, comments) |
| `anchors.test.ts` | Frontmatter + `lw:anchors` + `lw:manual` extraction |
| `anchor-ledger.test.ts` | `changed/moved/deleted` event generation, move rewriting, debt dedup |
| `verify.test.ts` | `broken_anchor`, `manual_block_altered`, `broken_internal_link`, `missing_wiki_path` |
| `status.test.ts` | `StatusReport` shape; debt breakdown by event + assignee |
| `manifest.test.ts` | `snapshotHash` determinism; `manifestsEqual` ignores `updatedAt` |
| `presets.test.ts` | `PRESET_TABLE` shape; unknown preset error |
| `pricing.test.ts` | `lookupPricing` returns `tokensOnly: true` when model missing |
| `prompts.test.ts` | Prompt templates + closed key list instruction |
| `update.test.ts` | `loadWorkPackage` — debt + snippets + validAnchors + token estimate |
| `update-metrics.test.ts` | Append-only `update_metrics.json` |
| `pointer.test.ts` | Insert / remove / idempotency / file selection |
| `gitignore.test.ts` | Idempotent block writer (start/end markers, no dupes) |
| `key-leak.test.ts` | **CRITICAL** — API key never appears in any output channel |
| `llm/adapters.test.ts` | Anthropic + openai-compat normalize input/output tokens |

### CLI tests

- `cli.test.ts` — commander wiring; global `--json` / `--repo` flags.
- `templates.test.ts` — hook templates exist and have the expected structure.
- **`cli-e2e.test.ts`** — subprocess E2E of the compiled CLI binary against an ephemeral repo (6 scenarios, covering the Phase 2 acceptance criterion):
  1. Edit anchored function → `changed` (exactly once, no accumulation).
  2. Move function between files → `moved` + anchor updated + detail from/to.
  3. Delete function → `deleted` once, even after 3 `index` runs.
  4. Phantom anchor in a never-indexed page → `verify` catches `broken_anchor`.
  5. Move anchored function → markdown contains the new key + `verify` clean.
  6. Move anchored function inside `lw:manual` → markdown intact + debt `assignee=human`.
- **`cli-batch-e2e.test.ts`** — full `init --batch` E2E with stub Anthropic server. Covers 4 batch exit-code propagation scenarios (aborted, completed_with_failures, completed, `--json`).
- **`cli-batch-e2e-subdirs.test.ts`** — rev2 empirical fixes H–M: subdirectories, NodeNext imports (`.js` → `.ts`), openai-compat adapter scenarios.

### MCP tests

- **`server.test.ts`** — 12 E2E scenarios using `InMemoryTransport`. Covers all 6 tools + 6 error paths (allowlist rejection, verify failure → rollback, invalid params).
- **`phase5-e2e.test.ts`** — 7 scenarios for the Phase 5 acceptance criterion: 2 end-to-end (hook → debt → write_doc → verify clean → manifest updated) + 5 covering `[R]` `livewiki init` writes `.livewiki/` to `.gitignore`. **Asserts issue count, not just exit code** — exit 0 is necessary but not sufficient.

## Acceptance criteria (mapped to tests)

| SPEC criterion | Where proved |
|---|---|
| Phase 1 — Indexer (50k LOC < 30s first, < 2s incremental) | `indexer.test.ts` + manual benchmark |
| Phase 2 — Anchors + debt + verify (edit=changed, move=moved, verify catches phantom) | `cli-e2e.test.ts` (all 6 scenarios) |
| Phase 3 — Init + batch (interrupt + resume, fail-handling, `--no-refine`, `architecture/overview.md`) | `cli-batch-e2e.test.ts` + `cli-batch-e2e-subdirs.test.ts` |
| Phase 4 — MCP 6 tools + verify rejection | `server.test.ts` (12 scenarios) |
| Phase 5 — End-to-end (hook → debt → write → verify clean → manifest) | `phase5-e2e.test.ts` (7 scenarios) |

## Benchmark vs OpenWiki (post-validation)

`docs/BENCHMARK.md` describes the public multi-LLM benchmark the project will run before open-sourcing. Four scenarios:

- **C1** — full repo documentation.
- **C2** — 1 function edited (the killer scenario for livewiki: 0 tokens for discovery).
- **C3** — function moved across files.
- **C4** — no changes (fixed-cost guard).

Primary metric: **tokens** (input/output separated). USD is a secondary line marked "estimated, table as of `<date>`". Until the benchmark runs, treat `livewiki batch <run>` token counts as the empirical signal.

## Validation checklist before any commit

1. `pnpm -r build` — green.
2. `pnpm -r test` — all green.
3. If you touched Phase 2/3/4/5 code, run the matching E2E (see workflow above).
4. If you touched LLM adapters or config: `key-leak.test.ts` must pass.
5. If you touched `safe-io` or `pointer`: `safe-io.test.ts` + `pointer.test.ts`.
6. If you touched `verify` or `anchor-ledger`: `cli-e2e.test.ts`.

## Known gotchas (test infra)

- **Windows + WAL.** `better-sqlite3` keeps `*.db-shm` / `*.db-wal`. E2E that opens `search.db` must call `server.close()` **before** `afterEach` runs `rm -rf` or Windows raises EBUSY. See `server.ts` `close` augmentation.
- **`TMPDIR` on Windows.** `cli-e2e.test.ts` uses `process.env.TMPDIR ?? "C:\\Users\\…"` so it works on both POSIX and Windows without bash.
- **`git clean -fdx` would destroy reviewer's WIP.** Do not use it; delete build artifacts explicitly with PowerShell (`Remove-Item -Recurse -Force packages/*/dist`). See AGENTS.md.
- **Snapshot hash + `updatedAt`.** `manifestsEqual` ignores `updatedAt` (it's a timestamp, not content). Without this, every `new Date()` would generate a new `updatedAt` and always rewrite the manifest, breaking anti-loop CI.

## Where to go next

- [Inviolable rules](inviolable-rules.md) — what tests are defending.
- [Incremental update workflow](../workflows/incremental-update.md) — the acceptance criterion for Phase 5.
- [MCP server](../integrations/mcp-server.md) — the E2E for Phase 4.