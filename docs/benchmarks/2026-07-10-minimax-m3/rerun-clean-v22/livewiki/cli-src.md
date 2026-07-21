---
title: CLI command surface, output formatting, and E2E fixtures
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
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

# CLI command surface, output formatting, and E2E fixtures

This module packages the `livewiki` command-line interface, its JSON/human output helpers, and the in-process fixtures used by end-to-end tests of the batch, index, and export pipelines.

## When to use this page

- **Register or modify** a `livewiki` subcommand and need to understand how `createProgram` wires it up alongside global `--json` and `--repo` flags.
- **Extend** the output helper layer in `output.ts` so a new command can emit parseable JSON and a human-readable form through one call site.
- **Run or repair** the end-to-end test suites that drive the real CLI binary against a fixture repository and a local stub LLM server.
- **Diagnose** an E2E failure by tracing which helper (`startStubServer`, `closedKeysFromPrompt`, `runCli`, `writeCode`, etc.) the scenario depends on.

## How it fits

`packages/cli/src/cli.ts` is the single bootstrap that registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) on a `commander` `Command`, reads its version from the package manifest, and resolves a target repo root from `--repo`. `packages/cli/src/index.ts` invokes `run` on `process.argv` and funnels unhandled errors to stderr with `process.exitCode = 1`. `packages/cli/src/output.ts` centralises stdout formatting so every subcommand satisfies the SPEC requirement of producing both human and JSON output. The remaining files under `packages/cli/src/` are vitest suites that exercise this surface: `cli.test.ts` smoke-tests the scaffold and `resolveRepoRoot`; `cli-e2e.test.ts` and `cli-export-e2e.test.ts` spawn the real binary against temporary repositories to validate `--json` output and exit codes; `cli-batch-e2e.test.ts`, `cli-batch-e2e-subdirs.test.ts`, and `cli-batch-stage5-e2e.test.ts` build on a shared in-process stub LLM server to test the full `init --batch` pipeline (including subdirectory layouts, cross-module imports, and stage-5 flow pages). `batch-format.test.ts` and `templates.test.ts` cover adjacent concerns (human output formatting of `batch` results and the Phase-5 hook templates).

## Program entry, version, and repo resolution
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`createProgram` builds the root `Command` named `livewiki`, attaches `--json` and `--repo <path>` global options, and registers every subcommand via the dedicated `register*` helpers under `./commands/`. The returned `Command` is the value under test in `cli.test.ts`, which asserts the exact list of subcommand names.

```ts
export function createProgram(): Command
export async function run(argv: readonly string[]): Promise<void>
export function resolveRepoRoot(repoOpt: string | undefined): string
function readVersion(): string
```

`readVersion` is the synchronous reader used by `createProgram`'s `.version(...)` call. It reads `../../package.json` relative to `import.meta.url`, parses it, and returns `parsed.version ?? "0.0.0"`. When the file cannot be read or parsed, the `try/catch` falls back to `"0.0.0"`; this is the only error path visible in the supplied excerpt.

`run` parses `argv` asynchronously through `program.parseAsync`. `index.ts` is the only caller and additionally sets `process.exitCode = 1` on rejection so that Node drains stderr before exiting. `resolveRepoRoot` is `nodePath.resolve(process.cwd(), repoOpt ?? ".")`, so undefined and `"."` both resolve to the current working directory; `cli.test.ts` exercises this with all three inputs.

`emitHuman` writes `text` followed by a single trailing newline; `emitJson` writes `JSON.stringify(data) + "\n"` so each invocation is line-parseable by an agent. `emit` selects between the two based on a boolean, and the contract documented above it is "use um ou outro — nunca os dois". The excerpt does not show what happens if `data` is `undefined` while `json` is `true` — the prose above is scoped to the visible call sites.

## Batch E2E shared fixture (flat repo)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(
  req: { system: string; user: string },
  opts: { failNTimes?: number } = {},
): StubResponse | null
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void>
```

`startStubServer` binds an in-process `node:http` server on `127.0.0.1` with an ephemeral port, parses the incoming JSON body, and dispatches it to a swappable handler. It tolerates both Anthropic-style payloads (`{ system, messages: [{ role, content }] }`) and OpenAI-style payloads (`{ messages: [{ role: "system", content }, ...] }`) by walking the `messages` array. If parsing fails, the stub responds with HTTP 400 and a JSON error body; if no handler is configured, the response is HTTP 500 with `{ error: "no handler configured" }`. Both branches are visible in the excerpt.

`closedKeysFromPrompt` scans user prompt lines for the regex `^- (\S+#\S+)$` and returns the captured keys. When no match is found it returns the placeholder `` `${fallbackModuleId}.ts#placeholder` `` rather than an empty array — the visible fallback string is what makes this fixture self-healing. `defaultHandler` consumes the prompt's `# Module: <id>` line, builds a closed-key frontmatter block via `closedKeysFromPrompt`, and returns a Markdown response with a `usage` block (`prompt_tokens: 1000, completion_tokens: 200`). The `opts.failNTimes` parameter decrements a mutable counter to simulate transient LLM failures, used by the circuit-breaker scenario in this suite's top-of-file comment. `runCli` is the async wrapper around `spawn` that returns a `CliRun` with `status`, `stdout`, `stderr`. `writeCode` and `writeConfig` write to the temp repo created by the suite's `beforeEach`.

## Batch E2E subdirectory fixture
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(req: { system: string; user: string }): StubResponse | null
function isStage2RefinePrompt(user: string): boolean
function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>) {
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void>
```

This variant of the stub fixture exists specifically to expose bugs that a flat layout hides (findings H–M listed in the suite's header comment): modules in nested directories such as `src/auth/`, `src/billing/`, `src/utils/`, cross-directory NodeNext imports (`../utils/crypto.js → crypto.ts`), OpenAI-compatible config, and missing-LLM-config failure modes. `startStubServer`, `closedKeysFromPrompt`, and `defaultHandler` mirror their counterparts in the flat fixture but the `StubServer` returned here additionally exposes `received: () => Array<{ system, user }>` so tests can assert on the parsed request bodies.

`isStage2RefinePrompt` and `makeRefineHandler` are the refinements specific to this scenario: `isStage2RefinePrompt` classifies a user prompt as a stage-2 refinement request, and `makeRefineHandler` closes over a `refinedModules` array so the test can stage several rounds of refinement responses. `writeOpenAiConfig` writes an OpenAI-shape provider configuration (model + base URL), as opposed to the Anthropic-shape `writeConfig` used by the flat fixture. The supplied excerpt does not include the full bodies of `isStage2RefinePrompt` or `makeRefineHandler` — only their declarations are visible — so the prose above is scoped to what the headers confirm.

## Batch stage-5 (product flow) fixture
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean -->

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string): string[]
function parseFlowPrompt(user: string): FlowPromptCtx
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string
function modulePageHandler(req: { system: string; user: string }): StubResponse
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(extra: Record<string, unknown> = {}): Promise<void>
async function writeFlowRepo(): Promise<void>
async function pathExists(rel: string): Promise<boolean>
async function readWiki(rel: string): Promise<string>
async function readStatus(): Promise<StatusReport>
async function expectVerifyClean(): Promise<void>
```

The stage-5 fixture builds a fixture TS project with three modules — `src/cli/cli.ts`, `src/core/engine.ts`, `src/db/db.ts` — whose heuristic detection yields exactly one flow candidate `cli-to-db`. `closedKeysFromPrompt` here has a single-argument signature (no `fallbackModuleId`), and unlike the flat and subdirectory variants it returns the empty array when nothing matches rather than a synthetic placeholder. `modulePageHandler` returns a `StubResponse` (no `| null`) because the helper is unconditional for module pages, and it emits a Markdown response that is structurally identical to the flat fixture's `defaultHandler`.

`parseFlowPrompt` extracts a `FlowPromptCtx` from a stage-5 user prompt and `makeFlowPage` turns that context plus a `diagramSource` string into a flow Markdown page — these two are the entry points that the suite's stub uses to validate diagram-budget repair rounds and the on-disk placeholder flow page described in scenario 1. `writeFlowRepo` materializes the three-module fixture tree (its body is truncated in the excerpt), `readWiki` and `readStatus` read back the produced artifacts and the structured status report, `pathExists` is a boolean predicate for follow-up assertions, and `expectVerifyClean` runs `livewiki verify` and asserts no issues are reported. `writeConfig` accepts a generic `extra` map rather than fixed provider/model/baseUrl fields, which is what allows the suite to layer stage-5 options on top of the base provider config.

## CLI index, verify, and status E2E
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#readIndexCounts -->

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function writeIgnoresConfig(ignores: string[]): Promise<void>
function statusDebt(): { changed: number; moved: number; deleted: number }
function readIndexCounts(): { scanned: number; added: number }
```

This suite spawns the compiled `dist/index.js` synchronously via `spawnSync` rather than the async `spawn` used by the batch fixtures, and the `runCli` here returns a `CliRun` populated from `SpawnSyncReturns`. `cliBin` resolves to `nodePath.resolve(process.cwd(), "dist/index.js")`, so the suite requires a prior build. `beforeEach` creates a unique temp repo under `nodeOs.tmpdir()`; `afterEach` removes it recursively.

`statusDebt` parses the JSON output of `livewiki status` to extract the aggregate `debt.byEvent` totals. The returned shape matches what the test asserts in the edit/move/delete scenarios (finding-driven scenarios 1–6). `readIndexCounts` parses `livewiki index --json` output to extract `{ scanned, added }`. `writeIgnoresConfig` writes an ignores list used by the verify scenarios that test whether ghost anchors or stale pages are correctly flagged. The bodies of `statusDebt` and `readIndexCounts` beyond their JSON parsing are visible in the excerpt.

## CLI export E2E
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#readDestAt packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#writeWikiAt -->

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeWiki(rel: string, content: string): Promise<void>
async function writeWikiAt(
  root: string,
  rel: string,
  content: string,
): Promise<void>
async function readDest(target: string, name: string): Promise<string | null>
async function readDestAt(
  root: string,
  target: string,
  name: string,
): Promise<string | null>
async function listDest(target: string): Promise<string[]>
```

Like `cli-e2e.test.ts`, this suite uses `spawnSync` against the compiled binary and shares the `cliBin`/`runCli` shape, but it adds `writeWikiAt` and `readDestAt` for the spaces-and-Unicode test case that builds its own `repoRoot` outside the suite's `beforeEach`. `readDest`, `readDestAt`, and `listDest` all read from `repoRoot/.livewiki/export/<target>/`; the `_At` variants accept an explicit root, and `listDest` returns `[]` when the destination directory is absent. The scenarios enumerated in the suite header comment — `github-wiki` renaming to `Home.md`, `gitlab-wiki` to `home.md`, `generic` keeping `quickstart.md`, invalid targets, `--push` rejection, overwrite, idempotency, preflight, and Unicode paths — are exercised by the test bodies beyond what the excerpt shows, so the prose above is scoped to the helpers themselves.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [CLI command registrations](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
