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

Reference documentation for the `@livewiki/cli` package source. Covers the
program entry point, output formatters, and the end-to-end test suites that
exercise the full `livewiki` binary against temporary repositories using a
stub HTTP server for the LLM provider.

## CLI entry point

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot -->

The CLI is built on Commander. `createProgram` constructs the top-level
Command named `livewiki`, declares the global `--json` and `--repo <path>`
flags, and registers all subcommands (`init`, `index`, `status`, `update`,
`verify`, `serve`, `batch`, `export`, `view`, `pointer`). The program
description references `VISION.md` and `SPEC.md` for command semantics.

`readVersion` synchronously reads `package.json` (resolved relative to
`import.meta.url`) and returns the `version` string, falling back to
`"0.0.0"` on any read or parse error. The version is shown by `--help`.

`resolveRepoRoot` is a small helper that turns a `--repo` option into an
absolute path via `path.resolve(process.cwd(), repoOpt ?? ".")`. Subcommands
use it to build their `CommandContext`.

`run` is the main async entry point: it builds the program with
`createProgram` and forwards `argv` to `parseAsync`.

## Output formatters

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`output.ts` is the single channel through which the CLI writes to stdout.
Per the SPEC, every command must produce output that is simultaneously
readable by humans and parseable by agents when `--json` is passed.

`emitHuman(text)` writes `text` to stdout, appending a trailing newline if
the caller did not include one. Use this for plain multi-line messages.

`emitJson(data)` writes `JSON.stringify(data)` followed by a single newline
on one line, so consumers can safely parse line-delimited JSON streams.

`emit(json, data, human)` is the shared helper. If `json` is true, it
serializes `data`; otherwise it writes `human`. Callers must supply exactly
one of `data` or `human`, never both.

## E2E test scaffolding

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt -->

`cli-e2e.test.ts` exercises the compiled `livewiki` binary against an
isolated temporary repo. Each test creates a fresh tmpdir, drops code and
wiki files into it, runs the CLI via `node <bin> ...`, and inspects outputs.

`cliBin()` resolves the compiled entry point at
`packages/cli/dist/index.js` relative to the current working directory.

`runCli(args)` uses `child_process.spawnSync` under `process.execPath`,
capturing `status`, `stdout`, and `stderr` into a `CliRun` object. This is
synchronous, so assertions in the same test see the full output.

`writeCode(rel, content)` and `writeWiki(rel, content)` both create
intermediate directories and write a file at `<repoRoot>/<rel>`. They are
helpers for the indexed source tree and the generated wiki tree.

`statusDebt()` is a test-scoped helper that runs `livewiki status --json`
and returns the `{ changed, moved, deleted }` aggregate from
`debt.byEvent`. Tests use this total to assert deduplication of open debt
across multiple `index` runs, which `index --json` alone cannot reveal
because its per-run `debtByEvent` resets on each invocation.

## Batch pipeline E2E (Anthropic-shaped stub)

<!-- lw:anchors packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig -->

`cli-batch-e2e.test.ts` runs the full `init --batch` pipeline with a stub
HTTP server impersonating the Anthropic API. No real LLM call is made; all
network traffic stays in-process on a random localhost port.

`startStubServer()` brings up a `node:http` server bound to an ephemeral
port. It parses Anthropic-shape (`{ system, messages: [...] }`) and
OpenAI-shape (`{ messages: [...] }`) request bodies, extracts `system` and
the concatenation of `user`-role messages, and dispatches to a configurable
handler set via `setHandler`. Returns an object with `url`, `close`,
`setHandler`, and `callCount()`.

`closedKeysFromPrompt(user, fallbackModuleId)` scans the user prompt for
lines matching `^- (\S+#\S+)$` and returns the captured keys. If the prompt
contains no such lines, it returns a single synthetic placeholder key
derived from `fallbackModuleId`. The stub uses these keys verbatim when
building the YAML `anchors:` block in generated Markdown.

`defaultHandler(req, opts?)` returns a `StubResponse` shaped like the
Anthropic `messages` API: `{ content: [{ type: "text", text }], model,
usage: { input_tokens, output_tokens } }`. The Markdown body embeds the
closed-list keys inside `frontmatter` `anchors`. An optional
`{ failNTimes }` parameter causes the first N invocations to return HTTP
500 (`{ error: "simulated failure" }`) before falling through to the
success path — used by the circuit-breaker test.

`runCli(args, env?)` spawns the CLI asynchronously via
`child_process.spawn`, captures `stdout` and `stderr` as strings, and
resolves to `{ status, stdout, stderr }`. It merges `env` over
`process.env`, so tests can inject `ANTHROPIC_API_KEY` for key-leak
assertions.

`writeCode(rel, content)` creates a file at `<repoRoot>/<rel>`, `mkdir -p`-style.

`writeConfig(provider, model, baseUrl)` writes
`<repoRoot>/.livewiki/config.json` with those three fields. The stub URL is
read by the CLI when it instantiates the Anthropic provider.

## Subdirectory & openai-compat E2E

<!-- lw:anchors packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#closedKeysFromPrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

`cli-batch-e2e-subdirs.test.ts` covers reviewer findings H–M. It exercises
a repo with modules under `src/auth/`, `src/billing/`, and `src/utils/`,
cross-module NodeNext imports of the form `../utils/crypto.js`, and the
`openai-compat` provider pointed at the local stub.

`startStubServer()` here extends the variant above with a `received()` log
that records every parsed `{ system, user }` pair, so tests can make fine
assertions about prompts sent to the LLM.

`closedKeysFromPrompt(user, fallbackModuleId)` has the same implementation
as in the flat suite: scan user-prompt lines for `^- (\S+#\S+)$`, fall back
to a synthetic placeholder.

`defaultHandler(req)` returns an OpenAI-shape response
(`choices[0].message.content`, plus `usage.prompt_tokens` /
`completion_tokens`), embedding the closed-list keys into the generated
Markdown frontmatter.

`isStage2RefinePrompt(user)` returns true when the user prompt contains the
literal string `"Heuristic module grouping"`. This sentinel appears only in
the stage-2 `buildStage2RefinePrompt` output, never in stage-4
`# Module: <id>` prompts, so it disambiguates the two without regex
fragility.

`makeRefineHandler(refinedModules)` returns a stub handler that, when it
sees a stage-2 prompt, replies with `{ modules: refinedModules }`
serialized as the assistant content, and otherwise delegates to
`defaultHandler`. Tests use this to drive the LLM-produced module grouping
or to force it to return `{ modules: [] }` (finding I).

`runCli(args, env?)` is identical in shape to the flat-suite helper.

`writeCode(rel, content)` mirrors the flat suite.

`writeOpenAiConfig(model, baseUrl)` writes
`<repoRoot>/.livewiki/config.json` with `provider: "openai-compat"`, the
given `model`, `baseUrl`, and a fixed pricing block
`{ inputUsdPerMtok: 3.0, outputUsdPerMtok: 15.0 }`. The stub URL is read by
the CLI when it constructs the OpenAI-compat provider.