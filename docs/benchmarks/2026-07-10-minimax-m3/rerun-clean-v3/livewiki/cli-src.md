---
title: cli-src
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
---

# cli-src

CLI entry point, output helpers, and end-to-end test harness for the `livewiki` package.

## CLI entry (`packages/cli/src/cli.ts`)
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot -->

The CLI is built on Commander. `createProgram` returns the configured `Command` instance with all subcommands wired in. `run` is the exported entry that takes `argv` and drives program execution. `readVersion` resolves the package version surfaced through `--version`. `resolveRepoRoot` resolves the `--repo` option (or its absence) into an absolute repository root path.

Exact argument shapes and behavior:

- TODO: `createProgram` Command construction details (subcommand list, flags, defaults).
- TODO: `run` argv handling, error propagation, and process exit semantics.
- TODO: `readVersion` lookup mechanism (package.json vs. injected build constant).
- TODO: `resolveRepoRoot` resolution rules (cwd fallback, error on missing dir).

## Output helpers (`packages/cli/src/output.ts`)
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`emit` is the top-level dispatcher. `emitHuman` writes human-readable text to stdout. `emitJson` serializes a value as JSON to stdout. The dispatcher routes based on whether `--json` was passed.

Exact serialization and exit-code coupling:

- TODO: `emit` dispatch logic (how it picks between human and JSON sinks).
- TODO: `emitHuman` formatting (whether it streams, whether it appends trailing newline).
- TODO: `emitJson` shape guarantees (pretty-print vs. compact, null handling, BigInt).

## CLI E2E harness (`packages/cli/src/cli-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

End-to-end coverage driven by spawning the real `packages/cli/dist/index.js` binary against a temporary repo. The header comment explicitly motivates E2E over unit tests: a prior finding (achado A) showed that calling `runLedger` directly bypassed the soft-delete path applied by `livewiki index`, so unit tests were insufficient.

Helpers:

- `cliBin` resolves the compiled binary path (`packages/cli/dist/index.js`).
- `runCli` runs the binary synchronously via `spawnSync`, returning `{ status, stdout, stderr }`.
- `statusDebt` runs `status --json` and returns the aggregate `{ changed, moved, deleted }` counts from `debt.byEvent` (used to validate dedup invariants).
- `writeCode` writes source files into the temp repo (mkdir + writeFile).
- `writeWiki` writes wiki markdown files into the temp repo (mkdir + writeFile).

Covered scenarios map to review findings 1–6:

1. Edit anchored function → 1 changed opened (dedup non-accumulating).
2. Move function across files → moved detected + anchor rewritten + de/para detail.
3. Delete function → 1 deleted opened even after 3 consecutive `index` runs (Fix B dedup).
4. New page with phantom anchor (no code) → `verify` exits non-zero with `broken_anchor`.
5. Move anchored symbol → markdown rewritten to the new key, `verify` passes clean (Fix G).
6. Move anchored symbol inside `lw:manual` block → markdown untouched, moved debt with `assignee=human` (Fix G + rule #6).

Exact assertions and JSON shape per scenario:

- TODO: full per-test assertion strings and expected `ledger.debtByEvent` shapes.
- TODO: phantom-anchor `verify` output format and exit code.

## Batch E2E with stub Anthropic (`packages/cli/src/cli-batch-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Fase 3 pipeline coverage for `init --batch` against an in-process HTTP stub that mimics Anthropic's shape. Zero real network calls. Validates the full pipeline: quickstart, mermaid diagrams, manifest, module pages, status report.

Helpers:

- `startStubServer` boots a Node `http` server on a random port, accepts both Anthropic-shape (`{ system, messages: [...] }`) and OpenAI-shape (`{ messages: [{role:"system"...}, {role:"user"...}] }`) bodies, normalizes into `{ system, user }`, and dispatches to a swappable handler.
- `defaultHandler` generates valid livewiki Markdown (frontmatter + section marker + body) keyed off `# Module: <id>` in the user prompt. Supports `failNTimes` to simulate transient 500s.
- `runCli` spawns `process.execPath` with `dist/index.js`, captures stdout/stderr and exit code asynchronously via a `Promise` resolved on the `close` event.
- `writeCode` writes source files into the temp repo.
- `writeConfig` writes `.livewiki/config.json` with provider/model/baseUrl.

Test surface highlights:

- Exit-code matrix (finding O): `aborted` → 2, `completed_with_failures` → 1, `completed` → 0; `--json` always exits 0 and surfaces `batchExitCode` in the payload.
- `--no-refine` regression: stage-2 stub calls = 0; stage-2 token totals = 0.
- Refine-on regression: stage-2 is called and reports non-zero tokens.
- `--only <module>` re-runs one task, accumulating `attempts`.
- Circuit breaker: 3 consecutive 500s → `batchSummary.status = "aborted"`, `tasksFailed >= 3`.
- Idempotency: two `init` runs with no source change → manifest byte-identical / same `snapshotHash`.
- Overview generation (finding P): both `init` and `init --batch` produce `livewiki/architecture/overview.md` with section anchors (`<a id="auth">`) that match quickstart links.
- Verify-clean criterion (finding Q): after a completed batch, `verify --json` exits 0 with zero issues of any severity (including WARNs such as `broken_internal_link`).

Exact per-test assertion bodies and JSON path assertions:

- TODO: details of the exit-code matrix and the human stdout format (`run #N: <status>`, `exit code: N`).
- TODO: the `verify` issue filter (codes checked, expected count = 0).
- TODO: TODO: key-leak check (files enumerated, canary string search).

## Subdirs + NodeNext + openai-compat batch E2E (`packages/cli/src/cli-batch-e2e-subdirs.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Fase 3 rev2 — scenario with modules split across `src/auth/`, `src/billing/`, `src/utils/`, cross-directory imports using NodeNext (`../utils/crypto.js` resolving to `crypto.ts`), and `openai-compat` provider pointing at the local stub. Findings H–M coverage:

- H: `init --batch` with subdirs + NodeNext produces all module pages (not zero).
- I: an LLM stage-2 refinement that returns `{ "modules": [] }` is rejected; the heuristic grouping wins and is recorded as `refine_rejected` in the stage-2 task error, with `modulesRefined` populated from the heuristic.
- J: stage-2 checkpoint JSON is valid, and `report.tasks[stage=2].inputTokens/outputTokens` are exposed (non-zero), confirming that the status-report token aggregation no longer drops to zero due to corrupt checkpoint JSON.
- K: NodeNext `../utils/crypto.js` imports resolve to `crypto.ts`; the `modules.mmd` output contains edges (e.g. `auth -- … → utils`) and not "No module edges detected".
- L: `init --batch` without any LLM config (no `.livewiki/config.json`, no key env var) fails with exit 1 and a stderr message matching `Cannot run LLM batch`, `missing provider`, and citing `claude-sonnet-5` as "example only" (no silent default).
- M: `filesWritten` from `init` does not list the manifest when `writeManifestIfChanged` returned false; the second `init` produces a byte-identical `livewiki/.manifest.json` (same content + same `mtimeMs`) and does not include `livewiki/.manifest.json` in `filesWritten`.

Helpers:

- `startStubServer` extends the Fase 3 stub with a `received()` accessor returning every request's normalized `{ system, user }` for fine-grained assertions.
- `defaultHandler` returns an OpenAI-compatible body (`choices[0].message.content`, `usage.{prompt_tokens, completion_tokens}`); parses `# Module: <id>` and an `- <key>` marker from the user prompt to seed the generated doc's first anchor.
- `isStage2RefinePrompt` detects stage-2 (refine-modules) by the substring `"Heuristic module grouping"` in the user prompt — chosen to avoid the previous regex (`refine.*modules`) that failed across newlines.
- `makeRefineHandler` factory that returns a handler which answers stage-2 with `{ modules: refinedModules }` and delegates all other prompts to `defaultHandler`.
- `runCli` async spawn wrapper returning `{ status, stdout, stderr }` (same shape as `cli-batch-e2e.test.ts`'s variant).
- `writeCode` writes source files into the temp repo.
- `writeOpenAiConfig` writes `.livewiki/config.json` with `provider: "openai-compat"`, model, baseUrl, and embedded pricing (`inputUsdPerMtok: 3.0`, `outputUsdPerMtok: 15.0`).

Exact assertion strings and shape checks:

- TODO: exact `report.tasks` filtering for stage-2 / stage-4 aggregation.
- TODO: exact `modules.mmd` regex for `auth → utils` edge detection.
- TODO: TODO: exact expected values (`inputTokens > 0`, `outputTokens > 0`, `modulesRefined.length === 3`).