---
title: livewiki install command
owner: generated
anchors:
  - packages/cli/src/commands/install.ts#formatDetectionHuman
  - packages/cli/src/commands/install.ts#formatPlanHuman
  - packages/cli/src/commands/install.ts#formatResultJson
  - packages/cli/src/commands/install.ts#formatResultsHuman
  - packages/cli/src/commands/install.ts#promptYesNo
  - packages/cli/src/commands/install.ts#readSources
  - packages/cli/src/commands/install.ts#registerInstall
---

# livewiki install command

This page documents the `livewiki install` CLI command, which detects supported coding agents on the user's machine and configures the livewiki MCP (Model Context Protocol — a host-managed tool/plugin channel) entry, the existing hook templates, the shared skill, and an opt-in pointer document.

## When to use this page

- **Register the command** in the CLI program by calling `registerInstall(program)` from a Commander setup step.
- **Review the safety model** (dry-run, TTY confirmation, pointer opt-in, exit codes) before changing interactive behavior.
- **Locate the asset loader** that ships the bundled templates and the shared `document-as-you-go` skill.
- **Understand the human/JSON output formatters** when adding a new `InstallAction` kind or status.

## How it fits

The install command lives in `packages/cli/src/commands/install.ts` inside the `packages/cli` workspace and is registered on a Commander `Command` instance supplied by the CLI entry point (`packages/cli/src/cli.ts`). All agent-aware logic — registry lookup, detection, plan construction, and application — is delegated to `@livewiki/core/install`, while this file owns the CLI surface: option parsing, confirmation, output formatting, and exit-code handling. Shared output helpers come from `../output.js` (the `emit` and `emitHuman` helpers that multiplex JSON and human-friendly output). Asset bytes (the post-commit hook template, the Claude Code settings template, and the `document-as-you-go` skill) are read directly from disk inside the CLI package and passed to the core planner via `InstallSources`.

The command is intentionally conservative: it never writes outside the working repository unless the user confirms, and the pointer write is a second-stage opt-in that even `--yes` does not unlock.

## Diagram

```mermaid
%% livewiki/diagrams/commands-install.mmd
```

## Command registration and option surface

<!-- lw:anchors packages/cli/src/commands/install.ts#registerInstall -->

`registerInstall` is the single export that the CLI program calls to mount the `install` subcommand. It attaches the `install` command to a Commander `Command` instance, declares its options, and wires up the async action handler that orchestrates the whole flow.

```ts
export function registerInstall(program: Command): void {
```

This function takes the parent Commander `program` and returns nothing; the side effect is that `program` now has an `install` subcommand wired up. Four flags shape the run:

- `--agents <csv>` — restricts detection to an explicit subset of agent ids.
- `--yes` — skips interactive confirmation (intended for scripting).
- `--print` — full dry-run; prints the detection table and the plan, performs zero writes.
- `--write-pointer` — also writes the `AGENTS.md`/`CLAUDE.md` pointer block (otherwise a separate interactive prompt is required).

The action handler resolves `LIVEWIKI_HOME` (with `os.homedir()` as the documented fallback for tests and smoke runs), validates `--agents` against `AGENT_REGISTRY`, and exits with code `2` on invalid input — both as a JSON envelope via `emit` and as a plain message on stderr when not in JSON mode.

## Detection, sources, and plan construction

<!-- lw:anchors packages/cli/src/commands/install.ts#readSources -->

After option validation, the handler drives the core pipeline. `detectAgents` produces a `Record<AgentId, AgentDetection>` keyed by agent id; the handler then derives `toInstall` as either the explicit `--agents` list or the subset of registered agents whose detection returned `detected: true`. `readSources` is called next to load the three on-disk assets the core planner needs.

```ts
async function readSources(): Promise<InstallSources> {
```

This function takes no arguments and returns a promise resolving to `InstallSources`. It walks up two levels from the current file URL — the comment in source explains that `templates/` and `skills/` ship at the CLI package root, both for `src/commands/` and the compiled `dist/commands/` — and reads `templates/git/post-commit`, `templates/claude-code/settings.local.json`, and `skills/document-as-you-go/SKILL.md` concurrently with `Promise.all`. The bytes are returned as a single object the core planner consumes verbatim; the CLI file does not mutate or template them.

With detections and sources in hand, the handler builds the plan via a small closure (`buildPlan`) that always passes the current `writePointer` flag, so the plan can be rebuilt after the pointer opt-in flip without re-running detection.

## Dry-run, confirmation, and apply

The action handler is structured as three guarded stages:

1. **Dry-run.** When `--print` is set, the handler emits the JSON/human view of detections plus plan and returns before any write happens.
2. **Confirmation.** Without `--yes` and when at least one action has `status === "write"`, a non-TTY stdin fails closed with exit code `1`. On a TTY the handler prints the detection table and plan, optionally asks the pointer question, then asks a final proceed prompt. Cancelling emits a JSON envelope (or the word `cancelled` in human mode) and returns without applying.
3. **Apply.** `applyInstall` runs the plan; the handler then computes `failed` actions (refusals or writes that did not apply) and emits the final JSON/human output. If any refusal or failure is present, `process.exitCode` is set to `1`.

The pointer opt-in is intentionally a separate gate: setting `--writePointer` flips it on up-front; otherwise the handler asks an additional `promptYesNo` only when the plan contains a `pointer` action in `requires-opt-in` state, then rebuilds the plan before the final confirmation.

## Interactive confirmation helper

<!-- lw:anchors packages/cli/src/commands/install.ts#promptYesNo -->

The confirmation gate reuses one small helper for all yes/no prompts so behavior stays consistent.

```ts
async function promptYesNo(question: string): Promise<boolean> {
```

This function takes a `question` string and returns a promise resolving to `true` only when the trimmed, lowercased answer is `y` or `yes`; any other input resolves to `false`. It writes the question to stdout, accumulates `stdin` chunks until it sees a newline (or stdin ends), pauses stdin, and removes its listeners. The handler only invokes this helper on a TTY (after the non-TTY closed-fail check), so the `promptYesNo` path itself does not have to defend against a missing terminal.

## Human output formatters

<!-- lw:anchors packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatPlanHuman packages/cli/src/commands/install.ts#formatResultsHuman -->

Three pure functions render the user-facing text. They never throw and never call back into core; they take only the data they need to format.

```ts
function formatDetectionHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
): string {
```

This function takes a record of detections plus the resolved `home` directory and returns a string. The first line is `Agent detection (home: <home>):`, followed by one block per agent in `AGENT_REGISTRY` order showing `agentId (displayName): detected | not detected` and any `evidence` lines indented beneath.

```ts
function formatPlanHuman(plan: readonly InstallAction[], toInstall: readonly AgentId[]): string {
```

This function takes the plan plus the selected agent list and returns a string. It prints `Plan for: ...` (or a `nothing to do` line when `toInstall` is empty), then a summary count of statuses (`write`, `skip`, `refuse`, `requires-opt-in`), then one indented line per action showing `[status] kind [agentId] targetPath`. For `write` actions whose content is non-null, it additionally prints the full content between `--- content ---` and `--- end ---` markers so the user sees exactly what would be written.

```ts
function formatResultsHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
  plan: readonly InstallAction[],
  results: readonly { action: InstallAction; applied: boolean; detail?: string }),
): string {
```

This function takes detections, the resolved home, the original plan, and the apply results and returns a string. It reuses `formatDetectionHuman` as the header, then prints one line per result where a `write` action becomes `written` (on success) or `FAILED` (when `applied` is false), and any `detail` or `reason` is indented beneath. When no plan action was a `write`, it appends a final `(nothing to write ...)` line so the user is not left wondering why nothing happened.

## JSON result formatter

<!-- lw:anchors packages/cli/src/commands/install.ts#formatResultJson -->

```ts
function formatResultJson(r: { action: InstallAction; applied: boolean; detail?: string }) {
```

This function takes one apply result (action + applied flag + optional detail) and returns a plain object suitable for JSON serialization. It exposes `kind`, `agentId` (normalized to `null` when absent), `targetPath`, `status`, `applied`, and `detail` (falling back to `action.reason` when no result-level detail was provided, and to `null` when neither is present). The action handler maps every result through `formatResultJson` before emitting the JSON envelope so consumers see a stable shape regardless of the underlying `InstallAction` status.
