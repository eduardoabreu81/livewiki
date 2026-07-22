---
title: CLI source for livewiki — command scaffold, output formatting, and end-to-end tests
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
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
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig
  - packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#readIndexCounts
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli-export-e2e.test.ts#cliBin
  - packages/cli/src/cli-export-e2e.test.ts#listDest
  - packages/cli/src/cli-export-e2e.test.ts#readDest
  - packages/cli/src/cli-export-e2e.test.ts#readDestAt
  - packages/cli/src/cli-export-e2e.test.ts#runCli
  - packages/cli/src/cli-export-e2e.test.ts#writeWiki
  - packages/cli/src/cli-export-e2e.test.ts#writeWikiAt
---

# CLI source — scaffold, output formatting, and end-to-end tests

This page documents the source-level surface of the `packages/cli/src` module, including the commander scaffold (`cli.ts`), the shared output helpers (`output.ts`), and the in-process and end-to-end test fixtures that exercise the livewiki CLI binary against real temporary repositories.

## When to use this page

- **Extend** the command scaffold by registering new subcommands on the `livewiki` program.
- **Diagnose** output-format regressions by reading `output.ts` (`emit`, `emitHuman`, `emitJson`).
- **Adapt** the in-process stub server and CLI harness used by the batch / stage-5 / export end-to-end suites.
- **Verify** that real-binary E2E flows (`cli-e2e.test.ts`, `cli-export-e2e.test.ts`) cover anchor-ledger deltas and export target behavior.

## How it fits

The `packages/cli/src` module is the source-of-truth for the `livewiki` binary: `index.ts` is the executable entry, `cli.ts` builds the commander `Command`, `output.ts` standardizes stdout across human and `--json` modes, and the `*.test.ts` files exercise the real `livewiki` binary plus an in-process HTTP stub against freshly minted temp repositories. The command implementations live in sibling `commands/*.js` modules that are imported here but not part of this module's surface.

## CLI scaffold (cli.ts)

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

```ts
export function createProgram(): Command
function readVersion(): string
export function resolveRepoRoot(repoOpt: string | undefined): string
export async function run(argv: readonly string[]): Promise<void>
```

`createProgram` constructs a commander `Command` named `livewiki`, sets its version from `readVersion`, registers the global `--json` and `--repo <path>` flags, and wires ten subcommand registrars (`registerInit`, `registerIndex`, `registerStatus`, `registerUpdate`, `registerVerify`, `registerServe`, `registerBatch`, `registerExport`, `registerView`, `registerPointer`). The smoke test in `cli.test.ts` pins the program name to `"livewiki"`, expects exactly those ten command names, and asserts the two global flags are registered.

`readVersion` synchronously reads the `@livewiki/cli` package's `package.json` from `../../package.json` (the path is the same for both `src/cli.ts` and the built `dist/cli.js`). It returns `parsed.version` on success, but on a `readFileSync` or `JSON.parse` failure the `try/catch` swallows the error and returns the literal string `"0.0.0"` — the function never throws, so callers can use the result unconditionally.

`resolveRepoRoot` runs `nodePath.resolve(process.cwd(), repoOpt ?? ".")`. When `repoOpt` is `undefined`, the default `??` returns `"."` and the result equals `process.cwd()`; `cli.test.ts` pins both the `undefined` and `"."` cases to the current working directory and the absolute-path case to a path ending in `tmp/abc`. The excerpt does not establish behavior for paths that contain `..` or that escape the filesystem root.

`run` is a thin wrapper: it calls `createProgram` then `program.parseAsync(argv as string[])`. Errors are not caught here — `index.ts` attaches a `.catch` that writes `livewiki: fatal error — <message>` to stderr and sets `process.exitCode = 1`. The excerpt does not show `run` itself logging or normalizing any error path.

## Output formatting (output.ts)

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

```ts
export function emitHuman(text: string): void
export function emitJson(data: unknown): void
export function emit(json: boolean, data: unknown, human: string): void
```

`emitHuman` writes `text` to `process.stdout`, appending a single `"\n"` if `text` does not already end with one. It does no escaping and does not strip trailing whitespace.

`emitJson` writes `JSON.stringify(data) + "\n"` to `process.stdout`. It does not pretty-print and does not guard against `BigInt` or circular references — those would throw from inside `JSON.stringify` and bubble to the caller. The trailing newline lets line-oriented parsers consume the result safely.

`emit` is the single helper callers should use: when `json` is truthy it forwards `data` to `emitJson`; otherwise it forwards `human` to `emitHuman`. Only one of the two branches fires per call, so the contract that commands must never produce both formats in one call is enforced structurally.

## Batch E2E — flat repo (cli-batch-e2e.test.ts)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(req: { system: string; user: string }, opts: { failNTimes?: number } = {}): StubResponse | null
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void>
```

`startStubServer` boots an `http.createServer` bound to `127.0.0.1:0`, captures both Anthropic-style (`{ system, messages }`) and OpenAI-style (`{ messages: [{role:"system",...}, {role:"user",...}] }`) request shapes, and returns a `StubServer` with `url`, `close`, `setHandler`, and `callCount`. If `JSON.parse(body)` throws the server returns HTTP 400 with `{error: "invalid json"}`; if the registered handler returns `null` the server returns HTTP 500 with `{error: "no handler configured"}`. The address resolves via `server.address()`; if the bind fails or the address is a string (unusual for `listen(0)`) it throws `Error("failed to bind stub server")`.

`closedKeysFromPrompt` scans the `user` prompt line-by-line for entries of the shape `- <key>#<symbol>` and returns the matched key list. When no lines match, it returns a single-element fallback `[${fallbackModuleId}.ts#placeholder]` so the page generator always has at least one anchor. The `defaultHandler` extracts a `# Module: <id>` line, runs `closedKeysFromPrompt`, and synthesizes a Markdown page with `owner: generated` and `anchors:` frontmatter. It also supports an `opts.failNTimes` countdown that returns HTTP 500 `{error: "simulated failure"}` until the budget is exhausted, after which normal page synthesis resumes.

`runCli` is a `Promise<CliRun>`-returning wrapper around `child_process.spawn` that defaults `env` to `{}` and is awaited by the suite; the supplied excerpt does not include the body but its signature is fixed. `writeCode` and `writeConfig` create parent directories with `mkdir({recursive: true})` and write into the test's `repoRoot`. `writeConfig` takes the provider, model, and baseUrl, which together point the CLI at the in-process stub.

## Batch E2E — subdirectory repo (cli-batch-e2e-subdirs.test.ts)

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(req: { system: string; user: string }): StubResponse | null
function isStage2RefinePrompt(user: string): boolean
function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>): (req: { system: string; user: string }) => StubResponse | null
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void>
```

The suite's header documents eight findings (H–M) that this fixture exposes but the flat fixture does not: subdirectory layout with NodeNext cross-imports, refinement prompts returning empty modules, stage-2 checkpoint JSON, `../utils/crypto.js` resolution, batch failure with missing LLM config, and `writeManifestIfChanged` returning `false`.

`startStubServer` mirrors the flat-fixture version but additionally exposes a `received(): Array<{system, user}>` log so assertions can inspect every parsed request body in order. The `setHandler` and `close` lifecycle is the same: 400 on invalid JSON, 500 when the handler returns `null`. `closedKeysFromPrompt` and `defaultHandler` are the same regex-extract + synthesize-Markdown pair, but `defaultHandler` here has no `failNTimes` option — the harness focuses on deterministic success plus optional refinement handlers.

`isStage2RefinePrompt` and `makeRefineHandler` together let the suite simulate the stage-2 LLM refinement loop: `isStage2RefinePrompt(user)` recognizes the prompt shape that asks for a refined module list, and `makeRefineHandler(refinedModules)` returns a handler that emits the supplied module list, enabling assertions like "heuristic beats an LLM that returns `{modules: []}`." The `runCli` and `writeCode` signatures match the flat fixture, while `writeOpenAiConfig(model, baseUrl)` writes an OpenAI-compatible provider config that points at the stub URL with the API key sourced only from the process environment.

## Batch E2E — stage 5 flows (cli-batch-stage5-e2e.test.ts)

<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string): string[]
function modulePageHandler(req: { system: string; user: string }): StubResponse
function parseFlowPrompt(user: string): FlowPromptCtx
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeFlowRepo(): Promise<void>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(extra: Record<string, unknown> = {}): Promise<void>
async function readWiki(rel: string): Promise<string>
async function pathExists(rel: string): Promise<boolean>
async function expectVerifyClean(): Promise<void>
async function readStatus(): Promise<StatusReport>
```

This suite targets the stage-5 product-flow detection. The fixture repo has `src/cli/cli.ts`, `src/core/engine.ts`, and `src/db/db.ts` wired together with NodeNext specifiers, producing a candidate flow `cli-to-db` between three modules. `writeFlowRepo` materializes that layout; `writeConfig` accepts an `extra` overrides object so individual tests can flip flags like `maxFlows: 0` without rebuilding the config writer.

`closedKeysFromPrompt` here has a single-argument signature (no fallback module id) and returns an empty array when no `- <key>#<symbol>` lines match — unlike the flat and subdir fixtures, stage 5 has no fallback sentinel. `modulePageHandler` always returns a `StubResponse` (non-nullable), synthesizing the same page shape as `defaultHandler`. `parseFlowPrompt` extracts a `FlowPromptCtx` from the prompt body; `makeFlowPage(ctx, diagramSource)` builds the final Markdown from that context plus the diagram source string the suite will hand to the stub.

The read-side helpers — `readWiki`, `pathExists`, `expectVerifyClean`, `readStatus` — let assertions inspect on-disk state after each run. `expectVerifyClean` is the single source of truth that "the verify command exits 0 and reports zero issues," and `readStatus` parses `batch status --json` into a typed `StatusReport`. The excerpt does not include the `CliRun` body for `runCli`, but its signature matches the other batch fixtures (Promise-returning, default-empty `env`).

## CLI real-binary E2E (cli-e2e.test.ts)

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#readIndexCounts packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#writeWiki -->

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function writeIgnoresConfig(ignores: string[]): Promise<void>
function statusDebt(): { changed: number; moved: number; deleted: number }
function readIndexCounts(): { scanned: number; added: number }
```

Unlike the batch suites, this file does not start an in-process stub server: it spawns the *real* compiled `livewiki` binary (`packages/cli/dist/index.js`) via `child_process.spawnSync` against a fresh temp repo per test. `cliBin` returns `path.resolve(process.cwd(), "dist/index.js")`; `runCli` captures `status`, `stdout`, and `stderr` and returns them as a synchronous `CliRun`. The suite's comment explains why E2E is required here: calling `runLedger` directly bypasses the soft-delete that `livewiki index` applies on the update path, so unit tests on `runLedger` would mask regressions in the CLI flow.

`writeCode` and `writeWiki` both mkdir-`recursive` then write UTF-8 into `repoRoot`. `writeIgnoresConfig(ignores)` writes the `livewiki.ignore` (or equivalent) file the indexer consumes, enabling tests that toggle which paths are scanned. `statusDebt()` runs `livewiki --json --repo <tmp> status`, asserts `status === 0` and parses the JSON envelope to return `debt.byEvent.changed`, `moved`, `deleted` — the test relies on the assertion that `r.status` be 0 and the JSON envelope expose `ok: true`, so a non-zero exit or unexpected shape fails the test. `readIndexCounts()` similarly parses `--json index` output to return `scanned` and `added` counts.

The header enumerates six mandatory scenarios: edit (1 changed, no accumulation), move (moved + updated anchor + de/à detail), delete (deleted exactly once across 3 indices), phantom anchor (verify fails with `broken_anchor`), anchored move across files (Fix G), and anchored move inside an `lw:manual` block (markdown untouched, human-assignee moved debt). The excerpt does not include each scenario's body, only `Cenário 1`.

## CLI export E2E (cli-export-e2e.test.ts)

<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#readDestAt packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#writeWikiAt -->

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeWiki(rel: string, content: string): Promise<void>
async function writeWikiAt(root: string, rel: string, content: string): Promise<void>
async function readDest(target: string, name: string): Promise<string | null>
async function listDest(target: string): Promise<string[]>
async function readDestAt(root: string, target: string, name: string): Promise<string | null>
```

The export suite runs the same real `dist/index.js` binary and exercises `livewiki export <target>` end to end. `cliBin` and `runCli` mirror `cli-e2e.test.ts`. `writeWiki`/`readDest`/`listDest` operate on `repoRoot` (a per-test `mkdtemp`), while `writeWikiAt`/`readDestAt` accept an explicit `root` for the spaces-and-Unicode test that builds its own repoRoot.

`readDest` resolves `<repoRoot>/.livewiki/export/<target>/<name>` and returns `null` on `readFile` rejection; `listDest` resolves the directory and returns `readdir`'s result, or `[]` on rejection. The header lists every behavior the suite must cover: all targets and home filenames, deterministic flattening, collision failure, anchor metadata removal, link and fragment rewriting, code-span/fence exclusion, Mermaid conversion, missing-diagram failure, broken-link failure, exact generated marker, overwrite refusal and `--force`, stale generated-file removal, idempotent re-export, preflight failure leaving destination unchanged, `--push` rejection before write, and repo paths with spaces plus Unicode.

The excerpt shows the first three target tests (`github-wiki` → `Home.md`, `gitlab-wiki` → `home.md`, `generic` → `quickstart.md`), an invalid-target test that asserts `exit 1` and `listDest("svn-wiki") === []`, and the `--push` rejection test that asserts `exit 1`, parses the JSON, and checks `parsed.export.issues.some(i => i.code === "invalid...")` (the literal suffix is truncated by the budget). The excerpt does not establish what happens if `writeWiki` is called before `repoRoot` is initialized by the per-test `beforeEach`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- [CLI command registrations](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
