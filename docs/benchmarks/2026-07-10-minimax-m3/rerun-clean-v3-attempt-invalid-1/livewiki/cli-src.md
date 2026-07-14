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
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli-e2e.test.ts#statusDebt
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

CLI module: command surface, output formatting, and end-to-end integration tests.

## Command surface (packages/cli/src/cli.ts)
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot -->

The CLI binary is built around a Commander program and a top-level `run` entrypoint that receives the raw `argv`.

- `createProgram()` constructs the `Command` instance, registers subcommands, and returns it for both programmatic and CLI entry use.
- `run(argv)` is the async entrypoint invoked from `dist/index.js`; it parses args, dispatches the selected subcommand, and surfaces exit codes.
- `readVersion()` resolves the package version from the embedded manifest for `--version` reporting.
- `resolveRepoRoot(repoOpt)` picks the working repo: an explicit `--repo` argument when provided, otherwise the current working directory.

Exit-code convention (per `commands/batch.ts` referenced in tests): `--json` always exits `0` and embeds `batchExitCode` in the payload; without `--json`, the exit code reflects run status (`0` completed, `1` completed_with_failures, `2` aborted).

## Output formatting (packages/cli/src/output.ts)
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

A thin emitter layer keeps JSON and human output paths independent so the same call site can serve both `--json` and interactive shells.

- `emit(data)` is the dispatcher that chooses JSON or human output based on the current command flags.
- `emitHuman(text)` writes a plain string to stdout (used for progress lines, run summaries, and exit-code banners such as `run #N: completed` / `exit code: N`).
- `emitJson(data)` serializes a value as JSON and writes it to stdout with a trailing newline.

## E2E harness (packages/cli/src/cli-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

End-to-end tests spawn the real compiled binary (`packages/cli/dist/index.js`) against an isolated temporary repository. Each test creates a fresh `repoRoot` under `TMPDIR` and tears it down in `afterEach`.

- `cliBin()` resolves the path to `dist/index.js` relative to the current working directory.
- `runCli(args)` uses `spawnSync` to execute the binary synchronously, returning `{ status, stdout, stderr }`.
- `writeCode(rel, content)` writes a source file under `repoRoot`, creating intermediate directories.
- `writeWiki(rel, content)` writes a wiki Markdown file (including manual blocks) under `repoRoot`.
- `statusDebt()` shells out to `status --json` and returns the aggregate `{ changed, moved, deleted }` totals used to assert dedup across consecutive runs.

Scenarios exercised here cover the Phase 2 review fixes: edit-dedup (changed stays at `1`), move detection via `content_hash`, soft-delete dedup across repeated `index` runs, broken-anchor detection on phantom pages, and the Fix G markdown-rewrite rules (rewriting keys outside manual blocks; leaving manual blocks untouched with `assignee=human`).

## Batch pipeline E2E — flat repo (packages/cli/src/cli-batch-e2e.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

Phase 3 E2E suite: a full `init --batch` pipeline against an in-process HTTP stub that mimics the Anthropic API. No real network calls occur; everything binds to `127.0.0.1` on an ephemeral port.

- `startStubServer()` boots a Node `http` server, returns a handle exposing `setHandler`, `callCount`, and `close`. It accepts both Anthropic-shape (`{ system, messages }`) and OpenAI-shape (`{ messages: [{role:"system"}] }`) payloads and normalizes them to `{ system, user }`.
- `defaultHandler(req, opts?)` generates a valid Markdown page for any `# Module: <id>` prompt, returning an Anthropic-shape response (`content: [{type:"text",text}]`) with usage metadata. Supports a `failNTimes` option for circuit-breaker scenarios.
- `runCli(args, env)` spawns the compiled CLI asynchronously with merged `process.env + env`, returning `{ status, stdout, stderr }`.
- `writeCode(rel, content)` writes a source file under the per-test `repoRoot`.
- `writeConfig(provider, model, baseUrl)` writes `.livewiki/config.json` for the test repo.

Coverage: full `init --batch` happy path (quickstart, diagrams, manifest, pages, status report, key-leak), `--only` re-runs that accumulate `attempts`, circuit-breaker abort, exit-code semantics (`0/1/2` mapping to completed / completed_with_failures / aborted, with `--json` always returning `0`), overview generation linking back to module pages, `--plan` working without LLM config, and verify-clean invariant (`issues.length === 0`).

## Batch pipeline E2E — subdirs + NodeNext (packages/cli/src/cli-batch-e2e-subdirs.test.ts)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

Phase 3 rev2 E2E suite: reviewer-driven coverage of subdirectory layouts, cross-directory NodeNext imports, and the `openai-compat` provider. Findings H–M from the empirical review are pinned here.

- `startStubServer()` extends the Phase 3 stub with a `received()` log of parsed bodies for fine-grained assertions.
- `defaultHandler(req)` emits OpenAI-shape responses (`choices: [{message:{content}}]`) with usage tokens.
- `isStage2RefinePrompt(user)` detects the stage-2 refine-modules prompt via the unique marker `"Heuristic module grouping"` (avoids the previous cross-newline regex bug).
- `makeRefineHandler(refinedModules)` builds a handler that returns the supplied module list on stage-2 prompts and falls back to `defaultHandler` elsewhere.
- `runCli(args, env)` async spawns the compiled CLI; identical shape to the flat-repo variant.
- `writeCode(rel, content)` writes a source file (creating parents).
- `writeOpenAiConfig(model, baseUrl)` writes `.livewiki/config.json` configured for the `openai-compat` provider with explicit pricing.

Coverage:
- H — `init --batch` over `src/auth/`, `src/billing/`, `src/utils/` with NodeNext `../utils/crypto.js` imports emits all three pages and three `done` stage-4 tasks (no zero-page regression).
- I — LLM stage-2 returning `{"modules": []}` is rejected (`refine_rejected_empty`); heuristic grouping wins and the summary retains three modules.
- J — Stage-2 checkpoint exposes `inputTokens`/`outputTokens > 0` in the status report.
- K — `architecture/modules.mmd` contains `auth → utils` edges from NodeNext import resolution.
- L — Missing LLM config yields `exit 1` with a clear stderr message (`Cannot run LLM batch`, `missing provider`, `claude-sonnet-5 example only`) instead of a libuv crash.
- M — Manifest write dedup: a second `init` without repo changes leaves `.manifest.json` byte-identical and excludes it from `filesWritten`.

## Notes

- TODO: behavior for additional `commands/batch.ts` flags beyond `--only`, `--json`, and `--repo` is not enumerated in this excerpt.
- TODO: internal structure of `run(argv)` (subcommand dispatch table, error mapping) is not visible in the provided excerpt.