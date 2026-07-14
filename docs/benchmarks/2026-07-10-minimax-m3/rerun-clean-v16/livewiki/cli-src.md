---
title: cli-src
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
  - packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

## Subdirs E2E harness

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler -->

The `cli-batch-e2e-subdirs.test.ts` file targets a repo whose source lives in nested subdirectories (`src/auth/`, `src/billing/`, `src/utils/`) with NodeNext cross-imports such as `../utils/crypto.js` resolving to `crypto.ts`. It uses an in-process HTTP stub so no real provider is contacted.

`startStubServer` binds a `node:http` listener on `127.0.0.1:0`, accepts POST bodies in either Anthropic or OpenAI shape, normalizes `system` and `user` text, dispatches to a swappable handler, and exposes `url`, `close`, `setHandler`, `callCount`, and `received`. The fixture captures every request body so tests can assert on the prompts the CLI actually sent.

`defaultHandler` produces a valid Markdown response for stage-4 / repair prompts. It reads the module id from the user prompt with `# Module: (\S+)`, asks `closedKeysFromPrompt` for the frontmatter anchors, and emits a doc page with matching frontmatter plus a stubbed OpenAI-compat body (`prompt_tokens: 1000`, `completion_tokens: 200`).

`closedKeysFromPrompt` scans the user prompt line-by-line for lines that match `^- (\S+#\S+)$` and returns those closed-list keys. When no anchor lines are present it falls back to a single `${fallbackModuleId}.ts#placeholder` entry so the frontmatter is never empty.

Stage 2 detection uses `isStage2RefinePrompt`, which looks for the literal substring `Heuristic module grouping` in the user prompt. That string is unique to `buildStage2RefinePrompt` and absent from stage-4 prompts, replacing a prior regex (`refine.*modules`) that failed because `.` did not cross newlines. `makeRefineHandler` wraps that detector: if the prompt is a refine-modules request it returns `{ modules: refinedModules }`, otherwise it delegates to `defaultHandler` so a single stub can answer both stage 2 and stage 4 in one run.

## Subdirs run + filesystem helpers

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`runCli` spawns `process.execPath` with `dist/index.js` plus the supplied args, inherits `process.env` merged with the caller's `env` overrides, captures stdout/stderr as utf-8, and resolves with `{ status, stdout, stderr }` once the child exits. Each test gets its own `repoRoot` from `nodeFs.mkdtemp`, cleaned up in `afterEach`.

`writeCode` is the generic file writer: it joins `repoRoot` with the relative path, mkdir-p's the parent, and writes the file.

`writeOpenAiConfig` writes the `.livewiki/config.json` for the openai-compat provider, including `model`, `baseUrl`, and the per-million-token pricing that the batch runner expects. The stub URL is passed in, and `OPENAI_API_KEY` is set via env (then deleted in `finally`) so the test can assert both stage-2 and stage-4 call counts without a real key.

## Flat-batch E2E harness

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`cli-batch-e2e.test.ts` covers the flat-repo `init --batch` flow (Fase 3) using the same stub-server pattern. `startStubServer` mirrors the subdirs variant but exposes a slimmer surface — `setHandler` and `callCount` only, no request log — because flat-batch assertions are coarser.

`closedKeysFromPrompt` is shared verbatim with the subdirs file. `defaultHandler` extends the same Markdown generator with an `opts.failNTimes` knob: when set, the first N invocations return `500 { error: "simulated failure" }` so the circuit-breaker scenario can exhaust retries deterministically. On the successful path it emits Anthropic-shape content blocks plus `usage: { input_tokens: 100, output_tokens: 50 }`.

`runCli` is identical to the subdirs variant: spawn `node dist/index.js`, merge env, return `{ status, stdout, stderr }`. `writeCode` matches too. `writeConfig` is the openai-compat counterpart of `writeOpenAiConfig` but parameterized — `writeConfig(provider, model, baseUrl)` writes `.livewiki/config.json` with exactly those three fields, no pricing block, and is used both for anthropic and openai-compat fixtures.

## Index/verify E2E harness

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

`cli-e2e.test.ts` exercises the Phase-2 review findings: ledger dedup on `index`, `moved` detection via content-hash, and `verify` reporting broken anchors. Unlike the batch suites, it uses `spawnSync` rather than spawning a child and awaiting it, so each invocation blocks until the CLI exits.

`cliBin` resolves the compiled entry point at `dist/index.js` relative to `process.cwd()`, which is the layout used in `packages/cli` during dev.

`runCli` wraps `spawnSync(process.execPath, [cliBin(), ...args], { encoding: "utf8" })` and returns `{ status, stdout, stderr }`, defaulting `status` to `-1` when the process was killed by a signal. `writeCode` and `writeWiki` are identical file-writers; both mkdir-p the parent and write the relative path under `repoRoot`.

`statusDebt` is the test-local helper for reading the dedup-validated debt totals: it runs `--json status`, asserts `ok: true`, and returns `debt.byEvent.{changed, moved, deleted}` from the aggregated SQL query. This is the source of truth for "how many open debts exist?" — `index --json` only returns per-run `debtByEvent`, so the suite cannot rely on it to assert dedup across multiple `index` invocations.

## CLI program wiring

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

`cli.ts` is the entry point assembled by Commander. `readVersion` synchronously reads `../../package.json` relative to the module URL and returns `version` (or `"0.0.0"` on any parse/read failure). It is sync because the file is static at build time and the caller (`run`) is already async.

`createProgram` instantiates the Commander `Command`, sets the `livewiki` name and the long description, attaches `--version` from `readVersion`, and registers the global `--json` and `--repo <path>` flags. It then wires every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) by importing each registrar module and calling its register function with the `program` instance.

`run(argv)` is the exported entry point consumed by the compiled `dist/index.js`. It calls `createProgram()` and awaits `program.parseAsync(argv)`, so the returned promise resolves only after every async command hook has settled.

`resolveRepoRoot(repoOpt)` is the shared helper used by commands to convert the `--repo` flag value into an absolute path. It defaults to `"."` when `repoOpt` is `undefined`, then resolves against `process.cwd()` via `node:path`.

## Output formatting

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`output.ts` centralizes every write that reaches `process.stdout` from CLI commands. It enforces the SPEC rule that every command must emit either parseable JSON (`--json`) or human text — never both.

`emitHuman(text)` writes the supplied text to stdout and guarantees a trailing newline, appending one only if the input did not already end in `\n`. Multi-line strings pass through unchanged.

`emitJson(data)` writes `JSON.stringify(data)` followed by `\n`. The single trailing newline keeps the output safe to parse line-by-line with `JSON.parse` even when commands print multiple JSON documents.

`emit(json, data, human)` is the single helper commands should use: when `json` is true it forwards to `emitJson(data)`; otherwise it forwards to `emitHuman(human)`. Callers must pick one branch and supply matching `data` / `human` payloads — the helper does not synthesize one from the other.