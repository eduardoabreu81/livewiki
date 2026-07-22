---
title: CLI source — command surface, output formatters, and end-to-end test harness
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

# CLI source — command surface, output formatters, and end-to-end test harness

This page is the reference for the `packages/cli/src` module: the commander program that registers the livewiki subcommands, the output helpers that keep human and JSON formatting consistent, and the in-process and end-to-end test harnesses that exercise the built CLI binary.

## When to use this page

- **Run or extend** the livewiki CLI by adding a subcommand to `createProgram` or by extending `output.ts`.
- **Diagnose** an end-to-end batch / index / export failure by reading the stub-server helpers used in the e2e tests.
- **Add a new e2e scenario** by copying one of the four e2e test files (flat, subdirs, stage 5 flows, export).
- **Verify** the CLI scaffold smoke test (program name, registered commands, global flags, repo-root resolution).

## How it fits

`packages/cli/src` is the implementation module behind the published `livewiki` binary. `index.ts` is the script entry: it forwards `process.argv` into `run`, which builds a `Command` via `createProgram` and registers every phase's subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`). All subcommands share `--json` and `--repo` global flags and write through `output.ts`, which guarantees a single-line JSON-with-newline or multi-line human output.

The bulk of this module is tests, not product code: four e2e suites drive the compiled `dist/index.js` against a temporary fixture repo, plus the in-process `startStubServer` HTTP helper that stands in for the LLM provider. `cli.test.ts` is a unit-level scaffold test, and `templates.test.ts` verifies the Phase 5 hook templates shipped next to the CLI. These test files are deliberately verbose because the corrective prompts that motivated them enumerate specific behaviours that must remain locked in.

## Command surface and output formatters
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`cli.ts` builds the commander `Command` and binds every subcommand module from `./commands/*.js`. The exported surface:

```ts
export function createProgram(): Command
export async function run(argv: readonly string[]): Promise<void>
export function resolveRepoRoot(repoOpt: string | undefined): string
```

The internal version reader is `function readVersion(): string` — it synchronously reads `../../package.json` relative to `import.meta.url`, returns `"0.0.0"` when the file is missing or unparseable, and is called once by `createProgram` to populate `.version(...)`. The excerpt does not establish exhaustive behaviour for malformed `package.json` contents beyond the documented fallback.

`resolveRepoRoot` resolves the `--repo` option against `process.cwd()`: `undefined` and `"."` both yield `cwd`; absolute paths are preserved verbatim. `createProgram` declares two global options: `--json` (parseable output for every command) and `--repo <path>` (default `"."`), then registers `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, and `pointer` in that fixed order. `run` simply constructs the program and calls `parseAsync`; it does not catch errors itself — `index.ts` attaches the `.catch` that sets `process.exitCode = 1` after writing the fatal-error line.

`output.ts` exposes three helpers:

```ts
export function emitHuman(text: string): void
export function emitJson(data: unknown): void
export function emit(json: boolean, data: unknown, human: string): void
```

`emitHuman` writes `text` followed by `\n` if not already present. `emitJson` writes `JSON.stringify(data) + "\n"` — a single trailing newline so line-oriented parsers stay safe. `emit` is the single helper that all subcommands are expected to use: pass `true` for `json` and `data` is serialised; pass `false` and `human` is printed. The comment on `emit` is explicit — "use um ou outro — nunca os dois" — meaning callers must never invoke `emitJson` and `emitHuman` back to back for the same logical response.

## Subdirs batch e2e — scenario H through M
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

The subdirs scenario exercises the batch pipeline against a repo where modules live in `src/auth/`, `src/billing/`, and `src/utils/` with cross-directory NodeNext imports. The shared helpers are:

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(req: { system: string; user: string }): StubResponse | null
function isStage2RefinePrompt(user: string): boolean
function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>)
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void>
```

`startStubServer` listens on `127.0.0.1` port `0`, accepts both Anthropic-shape (`{ system, messages: [...] }`) and OpenAI-shape (`{ messages: [{role:"system",...}, ...] }`) request bodies, and routes parsed `{ system, user }` into a swappable handler. If the body is not valid JSON it responds `400 invalid json`; if no handler is installed it responds `500 no handler configured`. The returned `StubServer` exposes `close`, `setHandler`, `callCount`, and `received` (the buffered prompt log used for fine-grained assertions).

`closedKeysFromPrompt` scans each line of the user prompt for `- key#name` entries (the canonical anchor format) and returns them; if none are found it falls back to `["${fallbackModuleId}.ts#placeholder"]`. `defaultHandler` synthesises a valid stage-4 module page that mirrors the production frontmatter shape (`title`, `owner: generated`, `anchors:` block derived from `closedKeysFromPrompt`). `isStage2RefinePrompt` detects the user prompt for the stage-2 refine step, and `makeRefineHandler` produces a handler that returns a fixed refinement payload — used to drive scenario I (an LLM refinement of `{"modules":[]}` must be rejected by the heuristic). `writeOpenAiConfig` writes the OpenAI-compat config file pointing the CLI at the stub; `writeCode` writes a source file under `repoRoot`. The excerpt does not establish the full behaviour of `makeRefineHandler` beyond its constructor signature.

## Flat repo batch e2e — happy path, resume, --only, circuit breaker
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

This suite validates `init --batch` end-to-end against a flat (non-subdir) fixture repo. Its helpers are smaller than the subdirs variant:

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function defaultHandler(req: { system: string; user: string }, opts: { failNTimes?: number } = {}): StubResponse | null
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void>
```

`defaultHandler` here takes a `failNTimes` option: when greater than zero, it decrements the counter and returns `500 simulated failure` to drive the circuit-breaker scenario before falling back to a successful response. The synthesised page picks a task verb from the moduleId (`provider` → "Add or configure a provider.", `verify` → "Diagnose a failed verify.", `batch` → "Document a repository with the batch pipeline.", default → "Review <moduleId> behavior."). `writeConfig` writes the provider-shaped config that the CLI consumes; the four scenarios the suite covers are listed in its header — happy path, resume after interruption, `--only` rerun that accumulates usage history, and circuit-breaker abort after three failures.

## Stage 5 flows e2e — semantic product flows
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo -->

The stage-5 suite covers the flow-detection stage of the batch pipeline. Its fixture is a three-module TS project (`src/cli/cli.ts`, `src/core/engine.ts`, `src/db/db.ts`) with one detectable candidate flow `cli-to-db`. Helpers:

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

`closedKeysFromPrompt` here differs from the earlier suites — it does not take a fallback moduleId and returns an empty array when no keys are found. `modulePageHandler` is the always-succeeding stage-4 module page; `parseFlowPrompt` and `makeFlowPage` together turn the LLM's stage-5 response into a flow page whose diagram is sourced from the companion `.mmd` file (the test asserts that the page itself contains the on-disk placeholder, never the inline diagram). `writeFlowRepo` lays down the three-module fixture; `writeConfig(extra)` writes the livewiki config with optional overrides (e.g. `maxFlows: 0` for scenario 2). `readWiki`, `pathExists`, `readStatus`, and `expectVerifyClean` are read-side helpers: `expectVerifyClean` runs the CLI and asserts the verify report has zero issues, and `readStatus` parses `batch status --json`. The three scenarios asserted by the suite header are happy-path flow generation, the `maxFlows: 0` no-flow path, and the diagram-budget repair round.

## Index and status e2e — debt deduplication (Fase 2 findings)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#readIndexCounts packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#writeWiki -->

The CLI-level index/verify e2e suite was added because calling `runLedger` directly bypassed the soft-delete that `livewiki index` applies on update paths. Helpers:

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
function statusDebt(): { changed: number; moved: number; deleted: number }
function readIndexCounts(): { scanned: number; added: number }
async function writeIgnoresConfig(ignores: string[]): Promise<void>
```

`cliBin` resolves `dist/index.js` relative to `process.cwd()` — the test therefore assumes the suite runs from the package directory. `runCli` uses `spawnSync` with `process.execPath`, returning `{ status, stdout, stderr }`; a `null` status is coerced to `-1`. `statusDebt` runs `livewiki --json --repo <tmp> status` and parses `debt.byEvent`; the assertion is that `r.status === 0` and `j.ok === true` before returning the counter. `writeIgnoresConfig` writes the ignore list for the broken-anchor scenarios. The header enumerates the six scenarios — change dedup, move (anchor + detail), single deletion across multiple index runs, ghost-anchor verify failure, moved-anchor markdown update with clean verify, and moved-anchor inside an `lw:manual` block leaving markdown untouched with `assignee=human` debt.

## Export e2e — targets, rewriting, idempotency
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#readDestAt packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#writeWikiAt -->

The export suite drives `livewiki export <target>` against a temp repo and inspects `.livewiki/export/<target>/`:

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeWiki(rel: string, content: string): Promise<void>
async function readDest(target: string, name: string): Promise<string | null>
async function listDest(target: string): Promise<string[]>
async function writeWikiAt(root: string, rel: string, content: string): Promise<void>
async function readDestAt(root: string, target: string, name: string): Promise<string | null>
```

`readDest` returns `null` on `ENOENT` rather than throwing; `listDest` returns `[]` when the target directory does not exist. The `*At` variants take an explicit root so the spaces-and-Unicode scenario (which builds its own `repoRoot`) can reuse the same helpers. The header enumerates the behaviours locked in: every target and home filename (github-wiki → `Home.md`, gitlab-wiki → `home.md`, generic → `quickstart.md`), deterministic flattening with collision failure, anchor metadata removal, link/fragment rewriting, code-span/fence exclusion, Mermaid conversion with missing-diagram failure, broken-link failure, the exact generated marker, overwrite refusal and `--force`, stale generated-file removal, idempotent second export, preflight failure leaving the destination unchanged, `--push` failing before writing with JSON exit 1, and paths containing spaces or Unicode.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [livewiki commands](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
