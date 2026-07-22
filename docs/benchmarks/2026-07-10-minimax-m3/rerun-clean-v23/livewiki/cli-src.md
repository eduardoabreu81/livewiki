---
title: livewiki CLI source and end-to-end tests
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

# livewiki CLI source and end-to-end tests

This page documents the source code and end-to-end test fixtures that compose the `@livewiki/cli` package: the commander program, output helpers, and the stub-HTTP e2e harnesses that exercise `init --batch`, indexing, status, and `export`.

## When to use this page

- **Read** the `createProgram` / `run` / `resolveRepoRoot` surface when wiring a new subcommand or the bin entry.
- **Trace** how `emit`, `emitHuman`, and `emitJson` shape `--json` vs human output for every CLI command.
- **Run** the e2e fixtures (`cli-e2e`, `cli-batch-e2e`, `cli-batch-e2e-subdirs`, `cli-batch-stage5-e2e`, `cli-export-e2e`) when changing CLI command behavior, the stub LLM contract, or the export preflight.
- **Extend** the batch e2e harnesses (their `startStubServer`, `closedKeysFromPrompt`, and stub handlers) when adding new batch stages or output contracts.

## How it fits

The CLI package lives at `packages/cli/src/`. `index.ts` is the bin entry that delegates to `cli.ts`; `cli.ts` builds a single `commander` `Command` via `createProgram`, registers every phase's subcommand, and exposes `run` as the async entry consumed by `index.ts`. `output.ts` centralizes the human/JSON serialization rule enforced by the SPEC (`--json` everywhere; humans never see JSON and vice versa). Around those three production files sit the e2e suites in `packages/cli/src/*-e2e.test.ts` plus `batch-format.test.ts` and `templates.test.ts` — together they pin the scaffold (Phase 0), the human formatters (batch result/status), the templates (`post-commit`, `settings.local.json`, README), and the real-binary e2e flows for index/status/update/verify and export. The truncated excerpts below describe what is visible in the supplied source.

## CLI scaffold (`cli.ts`, `index.ts`, `output.ts`)
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`cli.ts` builds the program once per process. The signatures shown are the literal ones from the symbol table.

```ts
export function createProgram(): Command
export async function run(argv: readonly string[]): Promise<void>
export function resolveRepoRoot(repoOpt: string | undefined): string
function readVersion(): string
```

```ts
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void
export function emitHuman(text: string): void
export function emitJson(data: unknown): void
```

`createProgram` names the program `livewiki`, sets the description, and calls `readVersion` to populate `.version()`. `readVersion` reads `../../package.json` relative to the current module URL and falls back to `"0.0.0"` when the file cannot be read or `version` is absent — that `try/catch` is the visible failure branch, so callers should not assume the package version is present. After declaring the two global flags `--json` and `--repo <path>` (default `.`), `createProgram` registers every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) via the per-command `register*` modules; the names come from SPEC §"CLI commands". `run` instantiates the program and forwards `argv` to `parseAsync`. `resolveRepoRoot` is `path.resolve(process.cwd(), repoOpt ?? ".")`, so `undefined`, `"."`, and absolute paths all collapse to cwd or to the resolved absolute path. The smoke test in `cli.test.ts` asserts the exact command name, the list of ten registered command names, the presence of `--json` and `--repo`, that `--help` mentions every command, and the `resolveRepoRoot` behavior above.

`index.ts` is a thin bin entry: it calls `run(process.argv)` and on rejection writes `livewiki: fatal error — <message>` to stderr with `process.exitCode = 1`; commander-level usage errors are handled inside commander and do not reach this catch.

`output.ts` enforces the dual-format SPEC rule. `emitHuman` writes the text plus a trailing newline if missing; `emitJson` writes `JSON.stringify(data)` plus `\n`. `emit` chooses between them by the `json` flag — if the flag is true, the `human` argument is ignored and vice versa, so callers must pass exactly one of the two payloads. The shape `{ json: boolean }` of `EmitOptions` is exported alongside these helpers; the truncated excerpt does not show the `emit` body using `EmitOptions`, but the interface is visible.

## Batch stub server and helpers (`cli-batch-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

The Phase 3 batch e2e harness spins up an in-process HTTP server bound to `127.0.0.1` on an ephemeral port and returns the `url` plus control hooks (`setHandler`, `callCount`, `close`). The helpers below are the ones the symbol table gives signatures for:

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void>
```

`startStubServer` accepts JSON bodies in both Anthropic shape (`{ system, messages: [...] }`) and OpenAI shape (`{ messages: [{role,content}, ...] }`); it concatenates user messages into one string and forwards `{ system, user }` to the registered handler. If parsing the body fails it returns HTTP 400 with `{"error":"invalid json"}`; if no handler is set it returns HTTP 500 with `{"error":"no handler configured"}` — those are the visible failure branches, so a test that has not yet called `setHandler` will see 500, not a successful empty response. The returned `StubServer` keeps a request log keyed on the response body via the handler. `closedKeysFromPrompt` scans user-prompt lines for the canonical anchor shape `- <path>#<symbol>` via `/^- (\S+#\S+)$/`, returning the matched keys, or `[<fallbackModuleId>.ts#placeholder]` when none are found — the placeholder is the visible fallback when the prompt lacks the closed-list header. `defaultHandler` then composes a valid Markdown document from the extracted module id and closed keys, picking a per-module task verb (`provider` → "Add or configure a provider", `verify` → "Diagnose a failed verify", `batch` → "Document a repository with the batch pipeline", otherwise "Review <module> behavior"); it also accepts `{ failNTimes }` so circuit-breaker scenarios can simulate consecutive 500 responses before yielding valid Markdown. `runCli` and `writeCode`/`writeConfig` are the standard subprocess and fixture writers used by the scenarios described in the file header.

## Subdirectories refinement e2e (`cli-batch-e2e-subdirs.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

This sibling harness exists specifically for the "reviewer empirical findings H–M" that the flat fixture in `cli-batch-e2e.test.ts` does not cover: subdirectory module layouts (`src/auth/`, `src/billing/`, `src/utils/`), NodeNext cross-imports (`../utils/crypto.js` → `crypto.ts`), an OpenAI-compat stub config, the empty-modules refinement rejection, the valid checkpoint JSON, and the `init`/`batch` failure-with-exit-1 paths. The helpers specific to it:

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

`startStubServer` reuses the same Anthropic/OpenAI dual-shape parsing and 400/500 failure branches as the flat harness. `closedKeysFromPrompt` applies the same `- <path>#<symbol>` regex and returns `<fallbackModuleId>.ts#placeholder` when no keys are present — the placeholder is the visible fallback for prompts that omit the closed-list header. `defaultHandler` extracts the module id via `# Module: (\S+)`, regenerates the anchor list, and emits the canonical Markdown template (title `<module> responsibilities`, `owner: generated`, anchors, opening H1, task bullets, "How it fits" paragraph). `isStage2RefinePrompt` returns true when the user prompt indicates a stage-2 refinement so the harness can swap in `makeRefineHandler` for that request; `makeRefineHandler` returns a stub handler that emits the supplied `refinedModules` shape in its response body — when the LLM replies `{"modules":[]}`, the harness expects the CLI to reject that via the heuristic rather than silently accept an empty refinement. `writeOpenAiConfig` is the OpenAI-compat fixture writer that pins the model name and `baseUrl` to the stub server. `runCli` and `writeCode` are the same subprocess / fixture writers used across the batch e2e files.

## Batch stage 5 (flows) e2e (`cli-batch-stage5-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo -->

Stage 5 introduces product-flow detection (`cli → core → db`) and exercises it end-to-end. The signatures:

```ts
async function startStubServer(): Promise<StubServer>
function closedKeysFromPrompt(user: string): string[]
function modulePageHandler(req: { system: string; user: string }): StubResponse
function parseFlowPrompt(user: string): FlowPromptCtx
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string
function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>
async function writeCode(rel: string, content: string): Promise<void>
async function writeConfig(extra: Record<string, unknown> = {}): Promise<void>
async function writeFlowRepo(): Promise<void>
async function readWiki(rel: string): Promise<string>
async function pathExists(rel: string): Promise<boolean>
async function expectVerifyClean(): Promise<void>
async function readStatus(): Promise<StatusReport>
```

`modulePageHandler` is the stage-4 (per-module) response: it pulls the module id from the user prompt, pulls closed keys via `closedKeysFromPrompt` (note this overload takes only `user` — no `fallbackModuleId`, so an empty list stays empty), and emits a valid Markdown document with the required frontmatter. `parseFlowPrompt` extracts the flow context (`FlowPromptCtx`) from a stage-5 user prompt and `makeFlowPage` builds a flow page string from that context plus a `diagramSource` — together they let the stub emit the on-disk placeholder response while the companion `.mmd` carries the real diagram. `writeFlowRepo` lays down the three-module fixture (`src/cli/cli.ts` → `src/core/engine.ts` → `src/db/db.ts`) so the heuristic detects exactly one candidate flow `cli-to-db`. `runCli` invokes the real CLI; `readWiki`, `pathExists`, `readStatus`, and `expectVerifyClean` are the assertion-side readers that validate the flow page exists, the `.mmd` companion exists, the navigation surface (hub, gated quickstart link, overview `## Flows`, `Flow:` lines in module `Navigate` blocks) is intact, and `livewiki verify` stays clean. The three documented scenarios are the happy path with rerun via `batch --only flow:cli-to-db`, `maxFlows: 0` which produces no flows directory, and the diagram-budget repair round when the inline diagram exceeds the configured node budget. The truncated excerpt does not show full bodies of `parseFlowPrompt` / `makeFlowPage`, so behavior beyond their signatures is not asserted here.

## Index / status / update / verify e2e (`cli-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#readIndexCounts packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#writeWiki -->

This suite executes the compiled `dist/index.js` against a fresh temp repository so it cannot bypass the soft-delete that `livewiki index` applies on the update path (the rationale is documented at the top of the file as the Phase 2 reviewer finding A). Signatures:

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
function readIndexCounts(): { scanned: number; added: number }
function statusDebt(): { changed: number; moved: number; deleted: number }
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function writeIgnoresConfig(ignores: string[]): Promise<void>
```

`cliBin` resolves `dist/index.js` relative to `process.cwd()`; `runCli` invokes it via `spawnSync(process.execPath, [cliBin(), ...args])` and returns `{ status, stdout, stderr }` — non-zero `status` is the visible failure branch when an assertion runs `expect(r.status).toBe(0)`. `statusDebt` parses the JSON output of `livewiki --json --repo <root> status` and returns `debt.byEvent`; `readIndexCounts` parses `livewiki index --json` for scanned/added counts. `writeCode` and `writeWiki` write to `<repoRoot>/<rel>`, creating parent directories, and the file's `beforeEach`/`afterEach` create and recursively remove the temp `repoRoot` under `os.tmpdir()`. The six scenarios named in the header map to: editing an anchored function (1 changed, dedup so the next edit leaves the total at 1); moving an anchored function (moved + updated anchor + de/to detail); deleting an anchored function once even after three `index` runs; a phantom-anchor page causing `verify` to fail with `broken_anchor`; moving an anchored function (rule #3) leaving the markdown with the new key and `verify` clean; and moving an anchored function inside an `lw:manual` block leaving the markdown untouched with `moved` debt + `assignee=human`.

## Export e2e (`cli-export-e2e.test.ts`)
<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#readDestAt packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#writeWikiAt -->

This Phase 6 Lot 6A harness validates `livewiki export <target>` (targets `github-wiki`, `gitlab-wiki`, `generic`, plus the invalid `svn-wiki`). Signatures:

```ts
function cliBin(): string
function runCli(args: string[]): CliRun
async function writeWiki(rel: string, content: string): Promise<void>
async function writeWikiAt(root: string, rel: string, content: string): Promise<void>
async function readDest(target: string, name: string): Promise<string | null
async function readDestAt(root: string, target: string, name: string): Promise<string | null
async function listDest(target: string): Promise<string[]>
```

`readDest` and `readDestAt` read `<root>/.livewiki/export/<target>/<name>` and return `null` (via `try/catch` around `readFile`) when the file is absent — that `null` is the visible absence branch used by the assertions that expect no file was written. `listDest` calls `readdir` on the target subdirectory and returns `[]` on missing-directory; `writeWiki` and `writeWikiAt` mirror each other (`writeWikiAt` takes an explicit root for the spaces+Unicode scenario). The documented scenarios cover all targets, deterministic flattening and collision failure, anchor metadata removal, link/fragment rewriting, code-span/fence exclusion, Mermaid conversion, missing-diagram failure, broken-link failure, the exact `generated` marker, overwrite refusal and `--force`, stale generated-file removal, idempotent re-export, preflight failure leaving the destination unchanged, `--push` rejected with exit 1 before any write, and a repository path with spaces and Unicode. The truncated excerpt does not show the bodies of `writeWikiAt` and `readDestAt` past their signatures; behavior described above is what the visible source establishes.

## Batch human formatters (`batch-format.test.ts`)

Although this file lives alongside the source, its assertions target the human output rules (incomplete-usage note + diagnostic-history surfacing) rather than `output.ts` directly. The unit it covers is the contract documented in the file header: when `usageIncomplete` is true the output contains the `USAGE_INCOMPLETE_NOTE` constant from `./commands/batch.js`, and when a failed stage-4 task carries `diagnosticHistory`, `formatStatusHuman` prints the compact per-attempt sequence after the failure details (token-first reporting is preserved by appending diagnostics rather than interleaving them). These rules are exercised against `formatStatusHuman` and `formatResultHuman`; the truncated excerpt only shows the first batch of `describe` blocks, so additional assertions may exist beyond what is visible here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [CLI command registrations for livewiki](commands.md) — dependency and dependent
<!-- livewiki:navigate:end -->
