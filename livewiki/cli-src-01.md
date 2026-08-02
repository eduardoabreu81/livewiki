---
title: CLI command module and its end-to-end test surface
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#closedKeysFromPrompt
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#expectVerifyClean
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#proseTierHandler
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeOpenAiConfig
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
  - packages/cli/src/cli-e2e.test.ts#git
  - packages/cli/src/cli-e2e.test.ts#gitInitCommit
  - packages/cli/src/cli-e2e.test.ts#readIndexCounts
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#setupAnchoredRepo
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
  - packages/cli/src/cli-view-e2e.test.ts#cliBin
  - packages/cli/src/cli-view-e2e.test.ts#fileExists
  - packages/cli/src/cli-view-e2e.test.ts#runCli
  - packages/cli/src/cli-view-e2e.test.ts#writeFixtureWiki
  - packages/cli/src/cli-view-e2e.test.ts#writeWiki
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/install.test.ts#runCli
---

# CLI command module and its end-to-end test surface

This module wires the `livewiki` command-line interface to every registered subcommand and provides the test files that exercise the resulting binary end-to-end through stubbed HTTP, temp repositories, and direct CLI subprocesses.

## When to use this page

- Run or extend the in-process stub HTTP server used by batch E2E suites to drive provider-shaped requests.
- Add or update E2E coverage that spawns the real `livewiki` binary (`index`, `verify`, `export`, `view`, `install`) against a temporary repo.
- Verify the Commander program scaffold (commands, global flags, `--help` text) that `cli.ts` produces via `createProgram`.
- Diagnose formatter regressions that surface usage-incomplete or per-attempt diagnostic sequences in `batch` human output.

## How it fits

The `livewiki` CLI is a thin Commander wrapper (`packages/cli/src/cli.ts`) that registers eleven subcommands (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`, `install`) plus the `--json` and `--repo` global flags. The binary entry point at `packages/cli/src/index.ts` parses argv through `run` and delegates to the registered handlers; `resolveRepoRoot` is shared by every command to materialise the target directory from `--repo`. The test files in this directory pair with that surface: scaffold-level smoke tests in `cli.test.ts` and `install.test.ts` validate the program shape in-process, while the `cli-*-e2e.test.ts` families spawn the built binary against an isolated temp repo to verify real behaviour. The batch E2E files additionally stand up an in-process HTTP stub that mimics the Anthropic or OpenAI chat-completions wire shape, so provider calls are intercepted before they leave the test process.

## Batch human formatters

The human-format fixtures exercise `formatStatusHuman` and `formatResultHuman`, the two human-readable renderers that emit a status report or run summary. The visible branches assert two contracts: the `USAGE_INCOMPLETE_NOTE` string is rendered when `usageIncomplete` is `true` on either the totals or the per-stage breakdown, and the compact per-attempt sequence (derived from `diagnosticHistory`) is appended after failure details rather than interleaved with token reporting.

The default handler shape at `function defaultHandler(req: { system: string; user: string }, opts: { failNTimes?: number } = {}): StubResponse | null` produces a syntactically valid stage-4 module page on the happy path and a 500 simulated failure for the first `failNTimes` calls, which is how the circuit-breaker scenario forces three retries before the breaker triggers. The fallback case in `defaultHandler` (no handler configured) returns HTTP 500 with `{ error: "no handler configured" }`, so any E2E test that forgets to install a handler will see the stub server surface that error verbatim.

## Phase-3 batch E2E (flat fixture)
<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

The flat-fixture Phase-3 suite drives `init --batch` end-to-end through the in-process stub and exercises resume, `--only`, and the circuit-breaker scenarios. The hermetic boundary is set up by `async function startStubServer(): Promise<StubServer>` (a localhost HTTP server with `setHandler` and `callCount()` accessor), `async function writeCode(rel: string, content: string): Promise<void>` to place fixture source under the temp repo, and `async function writeConfig(provider: string, model: string, baseUrl: string): Promise<void>` to write the provider config pointing at the stub. `function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>` spawns the real CLI binary for each step. The shared `function closedKeysFromPrompt(user: string, fallbackModuleId: string): string[]` parses the `- key#sym` lines from the stage-4 / repair user prompt so the stub can emit a matching frontmatter `anchors:` list, falling back to a single `fallbackModuleId.ts#placeholder` when the prompt carried no closed-list lines. The stub's failure counter (`failNTimes`) drives the circuit-breaker scenario: after three 500 responses the breaker trips and the run aborts rather than looping indefinitely.

## Stage-4 prose-tier contract
<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-prose-tier.test.ts#proseTierHandler packages/cli/src/cli-batch-e2e-prose-tier.test.ts#runCli packages/cli/src/cli-batch-e2e-prose-tier.test.ts#startStubServer packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeCode packages/cli/src/cli-batch-e2e-prose-tier.test.ts#writeOpenAiConfig -->

The prose-tier suite checks that `init --batch` on a mixed-language repository — grammar-mapped `.ts` (tier 1, anchored) alongside grammar-less `.go` or `.rs` (tier 2, prose) — emits a non-empty wiki with `anchors: []` and no `lw:anchors` markers for the prose modules. Its stub, `function proseTierHandler(req: { system: string; user: string }): StubResponse | null`, branches on whether the user prompt contains the literal phrase `Zero-key contract`: tier-2 modules get an unanchored page, and grammar-backed modules get a closed-list anchored page. The supporting helpers — `async function startStubServer(): Promise<StubServer>` to bind a localhost HTTP server, `async function writeCode(rel: string, content: string): Promise<void>` to place fixture source under the temp repo, `async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void>` to point the batch runner at the stub base URL, and `function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun>` to spawn the real binary — give the suite its hermetic setup. The D1 invariant (root README feeds the quickstart `## What this repository is` block, provenance-marked, with tool-meta sections placed after the product sections) is asserted against the resulting `livewiki/quickstart.md` rather than against any internal helper. The shared post-condition `async function expectVerifyClean(): Promise<void>` shells out to `livewiki verify` and asserts a zero-issues exit code for the prose-tier scenarios; this same helper is reused by the stage-5 flow suite to confirm that follow-up reruns do not introduce new debt.

## Subdirectory + cross-import batch scenario
<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

The subdirectory suite reproduces the empirical-reviewer findings H through M: a repo whose modules live under `src/auth/`, `src/billing/`, `src/utils/` and whose cross-imports use NodeNext specifiers (`../utils/crypto.js → crypto.ts`). The stub here is enhanced with a call counter and a captured request log (`callCount()`, `received()`) so tests can assert fine-grained prompt shape. The shared `function defaultHandler(req: { system: string; user: string }): StubResponse | null` produces a valid module Markdown page for any request by reading the module id from the user prompt and feeding it through `closedKeysFromPrompt` to build the frontmatter `anchors:` list. The two refine-prompt helpers, `function isStage2RefinePrompt(user: string): boolean` and `function makeRefineHandler(refinedModules: Array<{ id: string; paths: string[] }>)`, let a single test install a stage-2 handler that returns either the heuristic module list (finding I: `{"modules":[]}` is rejected) or a repair-shape list. The shared `closedKeysFromPrompt(user, fallbackModuleId)` helper again parses the closed-list lines for the frontmatter, and `async function writeOpenAiConfig(model: string, baseUrl: string): Promise<void>` points the runner at the stub. Finding L (no LLM config → clear failure, exit 1, no libuv crash) is verified by spawning `runCli` against a repo that has no provider config file present.

## Stage-5 flow pipeline
<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean -->

The stage-5 suite wires a stub `function modulePageHandler(req: { system: string; user: string }): StubResponse` for every stage-4 prompt and a flow-specific handler that parses the flow prompt through `function parseFlowPrompt(user: string): FlowPromptCtx`, then synthesises the on-disk `function makeFlowPage(ctx: FlowPromptCtx, _diagramSource: string): string`. The flow fixture is laid down by `async function writeFlowRepo(): Promise<void>` (a three-module TS project whose heuristic yields one detected flow `cli-to-db`) plus `async function writeConfig(extra: Record<string, unknown> = {}): Promise<void>` to set flow-detection options such as `maxFlows: 0`. Outcome assertions read back the produced wiki through `async function readWiki(rel: string): Promise<string>` and probe the filesystem through `async function pathExists(rel: string): Promise<boolean>`; the running batch is inspected through `async function readStatus(): Promise<StatusReport>`. `runCli` plus `startStubServer` provide the same hermetic boundary as the other batch suites. The diagram-budget scenario exercises a repair round: a stub flow response whose inline diagram exceeds the configured node budget is repaired down to size, and both the shrunken `.mmd` and the repaired page are confirmed on disk. The shared `async function expectVerifyClean(): Promise<void>` post-condition is reused here so the suite confirms verify stays clean after rerunning an isolated flow via `batch --only flow:cli-to-db <runId>`.

## CLI binary E2E (index, status, export, view)
<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#git packages/cli/src/cli-e2e.test.ts#gitInitCommit packages/cli/src/cli-e2e.test.ts#readIndexCounts packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#setupAnchoredRepo packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#readDestAt packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#writeWikiAt packages/cli/src/cli-view-e2e.test.ts#cliBin packages/cli/src/cli-view-e2e.test.ts#fileExists packages/cli/src/cli-view-e2e.test.ts#runCli packages/cli/src/cli-view-e2e.test.ts#writeFixtureWiki packages/cli/src/cli-view-e2e.test.ts#writeWiki -->

The binary-driven E2E files share the same shell-out boundary: `function cliBin(): string` resolves `dist/index.js` relative to `process.cwd()`, and `function runCli(args: string[]): CliRun` (synchronous, returning `{ status, stdout, stderr }`) wraps `spawnSync` against that path. Each suite provisions its own temp repo and tears it down in `afterEach`.

The `cli-e2e.test.ts` file owns the Phase-2 reviewer scenarios (one edited anchor → exactly one open `changed` event, moved anchor → `moved` plus detail de/para, deleted anchor counted exactly once across three follow-up `index` runs). Its helpers include `async function setupAnchoredRepo(): Promise<void>` to lay down a fixture repo with one anchorable function, `async function writeIgnoresConfig(ignores: string[]): Promise<void>` to drop a `livewiki.json` with `ignore` entries, `function statusDebt(): { changed: number; moved: number; deleted: number }` to query `status --json` for the open-debt aggregate, and the git helpers `function git(args: string[]): void` plus `function gitInitCommit(): void` for cases that need a committed baseline. `function readIndexCounts(): { scanned: number; added: number }` reads back `index --json`'s scanner counters. Per-suite timeouts are raised to 20 s (`vi.setConfig({ testTimeout: 20_000 })`) because these scenarios spawn the real CLI several times in sequence.

The `cli-export-e2e.test.ts` file drives `livewiki export` across every supported target (`github-wiki`, `gitlab-wiki`, `generic`) plus the negative paths (invalid target exits 1 without writing anything, `--push` fails before writing, preflight failure leaves the destination unchanged, `--force` opts past overwrite refusal, stale generated files are removed, a second run is idempotent). Its filesystem helpers `async function writeWiki(rel: string, content: string): Promise<void>`, `async function readDest(target: string, name: string): Promise<string | null>`, and `async function listDest(target: string): Promise<string[]>` operate against the canonical `.livewiki/export/<target>/` layout under the temp repo. The spaces+Unicode scenario builds an explicit root and uses the `*At` overloads `async function writeWikiAt(root: string, rel: string, content: string): Promise<void>` and `async function readDestAt(root: string, target: string, name: string): Promise<string | null>` to address it.

The `cli-view-e2e.test.ts` file validates `livewiki view` for `--no-open --out`, `--template docs`, `--badge-days`, the missing-wiki failure, and the rejection of `--out` paths that resolve inside `livewiki/`. Its `async function writeFixtureWiki(): Promise<void>` lays down `quickstart.md`, `auth.md`, and `diagrams/auth.mmd`, while `async function fileExists(abs: string): Promise<boolean>` checks the rendered site files (`index.html`, `pages/auth.html`, `assets/view-*.css`, `assets/mermaid.min.js`, etc.). The `--json` exit path is asserted to round-trip a `{ ok: true, view: { pagesWritten, opened, template } }` payload that reports `pagesWritten: 3` for the three-page fixture.

## CLI scaffold and install command
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/install.test.ts#runCli -->

`cli.ts` holds the program factory and the shared path helper. `export function createProgram(): Command` constructs a `commander.Command`, names it `livewiki`, attaches a description that points to `VISION.md`/`SPEC.md`, and pins the version via `function readVersion(): string` (synchronous, reads `@livewiki/cli`'s `package.json`; falls back to `"0.0.0"` if the file is missing or unparseable). It registers the eleven subcommands (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`, `install`) and the two global flags (`--json`, `--repo <path>`, default `"."`). `export async function run(argv: readonly string[]): Promise<void>` parses argv through the constructed program, and `export function resolveRepoRoot(repoOpt: string | undefined): string` resolves `--repo` against `process.cwd()` (so `--repo undefined`, `"."`, and absolute paths all collapse to the same canonical absolute form).

`cli.test.ts` holds the scaffold smoke tests: program name is `"livewiki"`; the eleven command names are present in the exact order listed; `--json` and `--repo` are registered as global options; `--help` output contains every command name; `resolveRepoRoot` accepts `undefined`, `"."`, and an absolute path.

`install.test.ts` exercises `livewiki install` through the in-process `createProgram` API. Its `async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }>` captures `process.stdout.write` / `process.stderr.write` for the lifetime of a `parseAsync(..., { from: "user" })` call. `beforeEach` allocates a fake `LIVEWIKI_HOME` temp dir and a fake repo temp dir; `afterEach` restores both the env and `process.exitCode`. The visible contracts asserted here are: `--print` writes nothing anywhere (the fake HOME stays empty and the repo has no `.git` or `AGENTS.md`); `--json --print` emits a parseable payload with `ok: true, dryRun: true, plan.length > 0` and still writes nothing; `--agents bogus` (or `--agents kimi,bogus`) exits 2 with `stderr` containing `invalid --agents` and the bogus id; a non-TTY run without `--yes` fails closed (exit 1, `requires --yes` on stderr, zero writes). Together these make up the CLI-level contract for the `install` subcommand.

## Additional indexed symbols

<!-- lw:anchors packages/cli/src/cli-batch-e2e-prose-tier.test.ts#expectVerifyClean -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [CLI command handlers](commands.md) — dependency and dependent

> Coverage note: this module's source (12 files, ~174k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
