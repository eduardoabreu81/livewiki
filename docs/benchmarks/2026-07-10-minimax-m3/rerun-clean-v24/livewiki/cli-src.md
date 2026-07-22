---
title: CLI package source surface
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

# CLI package source surface

This page documents the test scaffolding, command dispatch, and output formatters that compose the `@livewiki/cli` package source tree.

## When to use this page

- **Read** this page when adding or modifying CLI end-to-end fixtures, the commander program scaffold, or the human/JSON output formatter.
- **Diagnose** a failing E2E by checking the relevant stub-server or fixture helper documented here.

## How it fits

The `packages/cli/src` tree contains the published entry point (`index.ts`), the commander-based program (`cli.ts`), and the output helpers (`output.ts`). It is surrounded by Vitest test files that exercise the real `livewiki` binary against temporary repositories using a local stub HTTP server in place of any real LLM. Command implementations live in sibling files under `./commands/` and are not part of this surface.

## CLI program scaffold

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

`createProgram` returns the configured `Command` instance for `livewiki`, registering global flags `--json` and `--repo` plus ten subcommands (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`). The version string is sourced from `../../package.json` via the synchronous helper:

```ts
function readVersion(): string {
  const here = new URL(import.meta.url);
  const pkgUrl = new URL("../../package.json", here);
  try {
    const raw = nodeFs.readFileSync(pkgUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
```

If the package manifest is unreadable or unparsable, `readVersion` falls back to the literal string `"0.0.0"`. `resolveRepoRoot(repoOpt)` resolves the `--repo` value against `process.cwd()` (defaulting to `"."` when `undefined`), so callers receive an absolute path. `run(argv)` is the thin async wrapper that parses argv through `program.parseAsync`; `index.ts` invokes it and converts any thrown error to a `livewiki: fatal error — <message>` line on stderr with `process.exitCode = 1`.

## Output formatting helpers

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The `output.ts` module centralises how every CLI command writes to stdout so that "human-readable AND JSON-parseable" remains a uniform contract. `emitHuman(text)` appends a trailing newline if missing. `emitJson(data)` emits a single line of `JSON.stringify(data)` plus `\n`, so callers can safely `JSON.parse` each output line. `emit(json, data, human)` chooses between them — never both — based on the JSON flag passed in. The source-visible guarantee is "one of, never both"; the formatter does not validate `data` shape, and any error inside `JSON.stringify` would surface as an exception to the caller.

## Phase 3 batch E2E (flat repo)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

This suite spawns the real `livewiki` binary against a flat temporary repo and routes every LLM call through a local HTTP stub. The stub server accepts an injectable handler:

```ts
async function startStubServer(): Promise<StubServer> {
  // ... binds 127.0.0.1:0, exposes url/close/setHandler/callCount
}
```

If a request body fails to parse as JSON, the server responds with HTTP 400 and an `{"error":"invalid json"}` body. If no handler is configured at request time, it responds with HTTP 500 and `{"error":"no handler configured"}`. `closedKeysFromPrompt(user, fallbackModuleId)` extracts `- <key>#<key>` lines from the user prompt, falling back to `[`${fallbackModuleId}.ts#placeholder`]` when none are found. `defaultHandler(req, opts)` honours an optional `failNTimes` counter that short-circuits to a simulated 500 error before any prompt inspection. `writeConfig(provider, model, baseUrl)` and `writeCode(rel, content)` are fixture helpers that lay down provider config and TS source files; `runCli(args, env)` spawns the CLI with environment overrides and returns the captured `CliRun` (status/stdout/stderr). Because the suite is truncated in the supplied excerpt, the assertions specific to each scenario beyond the helpers themselves are not visible here.

## Phase 3 rev2 batch E2E (subdirectories + refine)

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

This is the reviewer-scenario companion to the flat-fixture suite. The repo fixture lives under `src/auth/`, `src/billing/`, `src/utils/` with NodeNext cross-imports; the stub server reuses the same `startStubServer` shape and adds a `received()` accessor for fine-grained per-request assertions. `closedKeysFromPrompt(user, fallbackModuleId)` has identical semantics to the flat-fixture version. `defaultHandler(req)` builds a Markdown page keyed off the module id parsed from the prompt (`# Module: <id>`), falling back to `"unknown"` when the regex does not match. `isStage2RefinePrompt(user)` classifies whether a user prompt is a stage-2 refinement request (its full body is not visible in the supplied excerpt). `makeRefineHandler(refinedModules)` returns a handler that the suite can swap in to simulate LLM-driven module refinement. `writeOpenAiConfig(model, baseUrl)` writes the OpenAI-compat config block, `writeCode` lays down source files, and `runCli(args, env)` spawns the CLI as in the flat-fixture suite. The full behaviour of these helpers beyond their signatures is not exhaustively established by the excerpt.

## Phase S3b batch stage-5 E2E (product flows)

<!-- lw:anchors packages/cli/src/cli-batch-stage5-e2e.test.ts#startStubServer packages/cli/src/cli-batch-stage5-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#modulePageHandler packages/cli/src/cli-batch-stage5-e2e.test.ts#parseFlowPrompt packages/cli/src/cli-batch-stage5-e2e.test.ts#makeFlowPage packages/cli/src/cli-batch-stage5-e2e.test.ts#runCli packages/cli/src/cli-batch-stage5-e2e.test.ts#writeFlowRepo packages/cli/src/cli-batch-stage5-e2e.test.ts#writeCode packages/cli/src/cli-batch-stage5-e2e.test.ts#writeConfig packages/cli/src/cli-batch-stage5-e2e.test.ts#readWiki packages/cli/src/cli-batch-stage5-e2e.test.ts#pathExists packages/cli/src/cli-batch-stage5-e2e.test.ts#readStatus packages/cli/src/cli-batch-stage5-e2e.test.ts#expectVerifyClean -->

This suite is the product-flows extension of the batch E2E. The fixture is a small TS project whose module heuristic yields three product modules (`cli`, `core`, `db`) with one detectable flow candidate. `startStubServer` follows the same 400/500 fallbacks as the other suites. `closedKeysFromPrompt(user)` extracts `- <key>#<key>` lines without a fallback module id (returning an empty array when none match). `modulePageHandler(req)` builds a valid stage-4 module page response. `parseFlowPrompt(user)` parses the user prompt into a `FlowPromptCtx`; `makeFlowPage(ctx, diagramSource)` synthesises the page body — full bodies are not visible in the supplied excerpt, so the exact rendering rules cannot be quoted. `writeFlowRepo`, `writeCode`, and `writeConfig(extra)` are fixture writers; `writeConfig` defaults `extra` to `{}`. `readWiki(rel)`, `pathExists(rel)`, and `readStatus()` are filesystem readers; `expectVerifyClean()` is the post-run assertion helper. `runCli(args, env)` again spawns the CLI as in the other suites. Behaviour beyond the visible signatures is not exhaustively established by the excerpt.

## Core CLI E2E (index/verify/status)

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#writeIgnoresConfig packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-e2e.test.ts#readIndexCounts -->

This is the integration suite mandated alongside the Phase 2 review fixes: it runs the real `dist/index.js` binary through `spawnSync` against a fresh temp repo per test. `cliBin()` resolves to `dist/index.js` relative to the test file's working directory; if the build is missing, callers downstream see `spawnSync` fail with a non-zero status. `runCli(args)` returns `{ status, stdout, stderr }`, defaulting `status` to `-1` when `spawnSync` does not populate it. `writeCode` and `writeWiki` create parent directories as needed before writing. `writeIgnoresConfig(ignores)` writes the ignore file for the index pass. `statusDebt()` runs `livewiki status` and returns the aggregated `debt.byEvent` counts (`changed`, `moved`, `deleted`) — note that it asserts `r.status === 0` and `j.ok === true` and throws on failure rather than returning a partial result. `readIndexCounts()` returns `{ scanned, added }` for assertions against `index --json` output. The excerpt does not establish the full exhaustive behaviour of each scenario beyond the helpers above.

## Export E2E (Phase 6 Lot 6A)

<!-- lw:anchors packages/cli/src/cli-export-e2e.test.ts#cliBin packages/cli/src/cli-export-e2e.test.ts#runCli packages/cli/src/cli-export-e2e.test.ts#writeWiki packages/cli/src/cli-export-e2e.test.ts#readDest packages/cli/src/cli-export-e2e.test.ts#listDest packages/cli/src/cli-export-e2e.test.ts#writeWikiAt packages/cli/src/cli-export-e2e.test.ts#readDestAt -->

This suite covers the `livewiki export <target>` surface end-to-end against the real binary. `cliBin()` and `runCli(args)` mirror the core E2E shape (`spawnSync` against `dist/index.js`). `writeWiki` and the explicit-root variant `writeWikiAt(root, rel, content)` create parent directories and write content as utf8; `readDest(target, name)` and `readDestAt(root, target, name)` read under `.livewiki/export/<target>/<name>` and return `null` (not throw) when the file is absent. `listDest(target)` lists the export directory, returning `[]` when the directory is missing. Scenarios exercised in the visible portion include renaming `quickstart.md` to `Home.md` for `github-wiki`, to `home.md` for `gitlab-wiki`, preserving it for `generic`, rejecting invalid targets with exit 1 and zero writes, and rejecting `--push` with a JSON `ok:false` payload before any file is written. The full scenario inventory and assertions beyond the helpers are not exhaustively visible in the excerpt.