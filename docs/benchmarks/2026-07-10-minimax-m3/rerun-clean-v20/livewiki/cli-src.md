---
title: CLI source and end-to-end test scaffolding
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

# CLI source and end-to-end test scaffolding

This page documents the program entry, output helpers, and the in-process HTTP stubs that drive the CLI's end-to-end test fixtures.

## When to use this page

- **Run** the compiled `livewiki` binary against a temporary repo fixture.
- **Add** a new end-to-end scenario that needs a stubbed LLM endpoint.
- **Switch** command output between JSON and human-readable forms via `output.ts`.
- **Inspect** how the `livewiki` commander program is assembled in `cli.ts`.

## How it fits

The `packages/cli/src` directory holds the user-facing command-line surface for livewiki. `cli.ts` builds a single `commander` program, wires in ten subcommand modules (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`), and exposes it through `createProgram` and `run`. `output.ts` is the shared sink every command uses to keep stdout parseable under `--json` and legible without it. The three `*.test.ts` files in the same folder are integration tests: they spin up a local HTTP server (no real LLM calls), spawn the built `dist/index.js` against a temp repo, and assert on the resulting files and JSON reports.

## CLI program assembly
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

`createProgram` builds the root `Command`:

```ts
export function createProgram(): Command {
```

It sets the binary name `livewiki`, attaches the description, and pulls the version string from `@livewiki/cli`'s `package.json` via `readVersion`. `readVersion` is synchronous and tolerant of a missing/unparseable file — on failure it returns `"0.0.0"` rather than throwing. The function does not catch every error path visibly; the excerpt shows the `catch` returning `"0.0.0"`, which means a missing package.json will silently fall back.

Two global flags are registered before any subcommand: `--json` (parseable output, a SPEC rule) and `--repo <path>` (target repo, defaults to `"."`). The subcommand set is then registered in order — `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`. The visible source stops at registration; each subcommand's behavior lives in its own module.

`run` is the thin async wrapper:

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

It calls `createProgram()` and forwards `argv` to `program.parseAsync`. The excerpt does not establish exhaustive behavior (no error trapping, no exit-code mapping) — only that argv flows through.

`resolveRepoRoot` is a one-liner helper:

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

It resolves `--repo` against `process.cwd()`, defaulting to `"."` when the option is omitted. The function does not validate that the path exists.

## Output formatting
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`emitHuman` and `emitJson` are the two primitive sinks:

```ts
export function emitHuman(text: string): void {
export function emitJson(data: unknown): void {
```

`emitHuman` writes `text` to stdout and guarantees a trailing newline. `emitJson` writes `JSON.stringify(data)` plus a single newline; the documented contract is one-line JSON so downstream agents can parse the stream line-by-line.

`emit` is the single chokepoint every command should use:

```ts
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void {
```

When `json` is true it delegates to `emitJson(data)`; otherwise it delegates to `emitHuman(human)`. The source comment warns "Use um ou outro — nunca os dois", which means each call site picks one branch; the function does not itself enforce that callers pass meaningful arguments for the unused branch.

## E2E test scaffolding — shared helpers
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki -->

`cli-e2e.test.ts` is the integration suite that spawns the real built binary against a temporary repo. It does not mock the program internals — it shells out to `node` and inspects the resulting JSON. `cliBin` resolves the binary path:

```ts
function cliBin(): string {
```

In dev it points at `packages/cli/dist/index.js`. `runCli` wraps `spawnSync` and captures status/stdout/stderr:

```ts
function runCli(args: string[]): CliRun {
```

`writeCode` and `writeWiki` materialize source and documentation files under a `beforeEach`-created temp directory and clean it up in `afterEach`. `statusDebt` is the dedicated assertion helper for the debt-tracking scenarios: it shells out to `status --json` and returns `{ changed, moved, deleted }` totals, expecting the run to succeed and `ok: true` in the response. The excerpt does not establish what happens when `status` fails — `statusDebt` will propagate the failed assertion through `expect`.

## E2E test scaffolding — batch pipeline stubs (flat repo)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`cli-batch-e2e.test.ts` covers the full `init --batch` pipeline against a flat (non-subdir) fixture. It stands up an in-process HTTP server that speaks both Anthropic- and OpenAI-shaped request bodies:

```ts
async function startStubServer(): Promise<StubServer> {
```

The server binds to a random local port, exposes `url`/`close`/`setHandler`/`callCount`, and routes every request through a swappable handler. When the inbound body fails to parse as JSON the server replies with HTTP 400 and `{"error":"invalid json"}` rather than throwing. With no handler installed, it responds HTTP 500 and `{"error":"no handler configured"}`. The fixture does not validate request shape beyond parsing JSON; behavior for malformed-but-JSON bodies is governed entirely by the installed handler.

`closedKeysFromPrompt` scrapes closed-list anchor keys from a stage-4/repair user prompt:

```ts
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[] {
```

It matches lines of the form `- <key>#<symbol>`; if nothing matches it returns a single placeholder key. `defaultHandler` synthesizes a complete Markdown page (frontmatter with `owner: generated`, a `## When to use this page` section, etc.) and wraps it in an Anthropic-shaped response body. It supports a `failNTimes` option that decrements a counter on each call and returns HTTP 500 with `{"error":"simulated failure"}` until the budget is exhausted, after which it serves the success body.

`runCli` here is async and uses `spawn` rather than `spawnSync`, capturing stdout/stderr via `'data'` listeners:

```ts
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
```

`writeCode` writes a source file under the temp repo root, and `writeConfig` materializes a `.livewiki/config.json` with `{ provider, model, baseUrl }` plus optional pricing keys in the subdirs variant.

## E2E test scaffolding — batch pipeline stubs (subdirectories + NodeNext)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`cli-batch-e2e-subdirs.test.ts` is the rev2 suite that targets subdirectory repos, NodeNext `../utils/crypto.js` style imports, and an `openai-compat` config. It carries a near-identical stub server, handler factory, and `closedKeysFromPrompt` to the flat suite. Two symbols are unique to this file:

```ts
function isStage2RefinePrompt(user: string): boolean {
```

This is a substring check for `"Heuristic module grouping"` — a marker the fixture asserts is exclusive to stage-2 prompts and absent from stage-4 prompts. The function returns `boolean`; it does not throw on unusual input.

```ts
function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>) {
```

This returns a request handler that recognizes the stage-2 prompt via `isStage2RefinePrompt`, replies with `{"modules": refinedModules}` so the pipeline can accept or reject the LLM's refinement, and falls through to the generic `defaultHandler` for any other prompt. The handler does not validate that `refinedModules` is non-empty — if a test installs it with an empty list, the stage-2 endpoint will still respond 200 with `{"modules":[]}`, and the scenario "I" in the suite header asserts the pipeline then falls back to the heuristic rather than crashing.

`runCli` here mirrors the flat suite (async, `spawn`-based, with optional `env` overlay on `process.env`). `writeOpenAiConfig` writes an `openai-compat` config block that adds `pricing: { inputUsdPerMtok, outputUsdPerMtok }` on top of the flat suite's schema. The temp directory cleanup runs unconditionally in `afterEach`; tests set `process.env.OPENAI_API_KEY` inside `try`/`finally` blocks so the canary key never leaks past the test.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [CLI command surface (livewiki/commands)](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
