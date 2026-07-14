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

# cli-src

## Batch E2E — subdirs & NodeNext fixtures
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

The `cli-batch-e2e-subdirs.test.ts` suite exercises `init --batch` against a fixture that lives in nested subdirectories with cross-module `import` statements using the NodeNext `.js` → `.ts` convention, paired with an `openai-compat` config that points at an in-process stub. It exists to surface the bugs the flat `cli-batch-e2e.test.ts` fixture does not expose (zero pages, empty LLM refine, broken NodeNext edge resolution, manifest dedup, etc.).

`startStubServer` brings up a `node:http` listener on `127.0.0.1` with a random port, exposing a settable handler, call counter, and received-body log. Each request is parsed in both Anthropic and OpenAI shapes (`system` field, or `messages[]` with a `system` role) so the same server can serve either provider stub. The URL it returns is fed into the config as `baseUrl`.

`defaultHandler` and the helpers it composes produce valid Markdown for any module id scraped from the user prompt's `# Module: <id>` line. The closed-list keys for the generated page are pulled directly from the prompt by `closedKeysFromPrompt` (regex over lines of the form `- <key>`), with a per-module placeholder fallback. The handler returns an OpenAI-shaped 200 response with a fixed `usage` payload and a `gpt-test-mock` model identifier.

`isStage2RefinePrompt` distinguishes the stage-2 user prompt (which contains the literal string `Heuristic module grouping`) from the stage-4 prompt (which contains `# Module: <id>`), avoiding the earlier `.`/newline regex bug. `makeRefineHandler` wraps that detector: when the request is a stage-2 call it returns the caller-supplied refined module list, otherwise it delegates to `defaultHandler`.

`runCli` spawns `node` against `dist/index.js` with the supplied args and a merged `process.env`, returning `{ status, stdout, stderr }` once the child closes. `writeCode` is a small `fs/promises` helper that creates parent directories and writes a file relative to the per-test temp `repoRoot`. `writeOpenAiConfig` writes a `.livewiki/config.json` with `provider: "openai-compat"`, a model name, the stub `baseUrl`, and fixed pricing rates.

## Batch E2E — flat fixtures
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

The `cli-batch-e2e.test.ts` suite is the same shape as the subdirs variant but uses a flat fixture (`src/auth/login.ts`, `src/utils/helper.ts`) and an `anthropic` provider, with no NodeNext cross-imports. The setup/teardown pattern, `runCli`/spawn helper, and per-test `mkdtemp` repo are the same; the only divergence is in the response shape and configuration.

`startStubServer` is the flat-fixture counterpart: same `node:http` server, same dual-shape parsing, but without the `received` body log (call-count is sufficient for these scenarios). `defaultHandler` takes an optional `failNTimes` knob to simulate transient LLM failures for the circuit-breaker case, and otherwise returns an Anthropic-shaped 200 with `content[]`, `model`, and a fixed `usage` block. `closedKeysFromPrompt` is identical to the subdirs variant: regex over `- <key>` lines, placeholder fallback.

`writeConfig` writes `.livewiki/config.json` with the supplied provider/model/baseUrl tuple (no pricing field in this fixture). `runCli` and `writeCode` are shared shape with the subdirs test, and `repoRoot` is a fresh `mkdtemp` directory per test.

## CLI E2E — index/verify roundtrip
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

The `cli-e2e.test.ts` suite runs the compiled `livewiki` binary itself (`packages/cli/dist/index.js`) against a throwaway repo to cover scenarios that calling `runLedger` directly bypasses — most notably the soft-delete path that `livewiki index` applies on update. Each test creates a fresh temp repo, seeds `src/` and `livewiki/` files, then runs `index`, `status`, or `verify` synchronously.

`cliBin` resolves the compiled entrypoint relative to `process.cwd()` (`dist/index.js`). `runCli` uses `spawnSync` to capture `status`, `stdout`, and `stderr` in one shot, encoding as UTF-8. `writeCode` and `writeWiki` are the same `mkdir -p` + `writeFile` pattern as the batch tests, parameterized by `repoRoot`. `statusDebt` runs `status --json` and unwraps `debt.byEvent` into a `{ changed, moved, deleted }` aggregate so tests can assert against the SQL-aggregated totals (rather than the per-run `ledger.debtByEvent`).

## CLI entrypoint
<!-- lw:anchors packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

`cli.ts` is the Commander-based program factory. `readVersion` synchronously parses `../../package.json` (relative to `import.meta.url`, which works in both `src/` and the bundled `dist/` layouts) and returns the `version` field, falling back to `"0.0.0"` on any read/parse error. `createProgram` constructs the `Command`, names it `livewiki`, attaches the version string, declares the global `--json` and `--repo <path>` flags, and registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) so `--help` shows the full surface even before each command is fully implemented. `run` builds the program and forwards `argv` to `parseAsync`. `resolveRepoRoot` resolves `--repo` against `process.cwd()`, defaulting to `"."`.

## Output formatting
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`output.ts` is the single formatting seam for every CLI command: per the SPEC, every command must produce output that is human-readable AND parseable (the `--json` toggle). `emitHuman` writes the supplied text to stdout, appending a newline if one is not already present. `emitJson` writes `JSON.stringify(data)` followed by a single trailing newline so line-by-line `JSON.parse` consumers stay safe. `emit` is the helper each command actually calls: when `json` is true it serializes `data` via `emitJson`, otherwise it emits the `human` string via `emitHuman` — exactly one of the two is ever written.