---
title: LiveWiki Install Command Orchestration
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

# LiveWiki Install Command Orchestration

This page explains how the `livewiki install` CLI command detects installed coding agents and safely configures the livewiki MCP server entry, hook templates, shared skills, and optional pointer files.

## When to use this page

- Understand the full user flow of the `install` command, from option parsing to applying changes.
- Trace how the command validates user input and enforces safety checks before any file is written.
- Learn how the command formats its output for both human-readable terminal display and JSON consumption.

## How it fits

This module is the command-layer implementation for the `livewiki` CLI, responsible for coordinating the core `@livewiki/core/install` package. It handles user-facing concerns like option parsing, interactive prompting, and output formatting, then delegates the actual detection, planning, and application of changes to the core package's functions. The file is part of the CLI's command set, alongside other commands registered on the same `commander` program, and relies on shared helpers for emitting output and resolving the repository root.

The command's central policy is safety: it shows the user every intended action before writing anything, supports a full dry-run via `--print`, and refuses to write in non-interactive mode unless explicitly told to with `--yes`. It also implements an opt-in rule for writing pointer files, requiring a dedicated flag or an additional interactive confirmation.

## Diagram

```mermaid
%% livewiki/diagrams/commands-install.mmd
```

## Option Validation and Command Registration

<!-- lw:anchors packages/cli/src/commands/install.ts#registerInstall -->

This section is the entry point for the entire command. `registerInstall` exists to wire the `install` subcommand into the CLI's `commander` program, defining its options and the action that runs when the user invokes it. The function takes the program object and returns nothing; it registers the command, its description, all its flags, and the async callback that implements the command's behavior.

```typescript
export function registerInstall(program: Command): void {
```

This function takes a `Command` instance and returns nothing, registering the `install` command with its options and action handler on that program.

The command defines several options that shape its behavior: `--agents <csv>` restricts the run to a comma-separated subset of agent IDs; `--yes` skips interactive confirmation for scripting; `--print` performs a full dry-run showing the plan with zero writes; `--write-pointer` opts into writing the AGENTS.md/CLAUDE.md pointer file (rule #2). When the action runs, it first resolves the repository root from `opts.repo` and the home directory, honoring the `LIVEWIKI_HOME` environment variable as a seam for tests.

The action then validates any `--agents` value against a known registry of agent IDs. If the value is empty or contains any unknown ID, the command emits an error (JSON if requested, otherwise to standard error), sets exit code 2, and returns immediately. This early validation prevents any work from proceeding with a malformed selection.

## Source Loading and Interactive Prompting

<!-- lw:anchors packages/cli/src/commands/install.ts#readSources packages/cli/src/commands/install.ts#promptYesNo -->

These two helpers supply the command's inputs and interactive confirmation mechanism. `readSources` exists to load the shipped template and skill files from the CLI package's root directory, which is two levels up from both the source and compiled command directories. It reads the git post-commit hook template, the Claude Code settings template, and two skill definition files in parallel, returning them as a structured `InstallSources` object that the core planner consumes.

```typescript
async function readSources(): Promise<InstallSources> {
```

This async function takes no arguments and returns a promise resolving to an `InstallSources` object containing the loaded template and skill content.

`promptYesNo` exists to ask the user a yes/no question interactively during the confirmation phase. It writes the question to standard output, then reads from standard input until a newline or end-of-stream, resolving to `true` only for a "y" or "yes" answer.

```typescript
async function promptYesNo(question: string): Promise<boolean> {
```

This async function takes a question string and returns a promise resolving to a boolean indicating whether the user answered yes.

The function attaches data and end listeners to standard input, accumulating the response, and cleans up its listeners once it has a complete answer. It treats a lowercased, trimmed input of "y" or "yes" as affirmative; any other input, including an empty line, is treated as no.

## Human-Readable Output Formatting

<!-- lw:anchors packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatPlanHuman packages/cli/src/commands/install.ts#formatResultsHuman -->

These three functions exist to present the command's output as readable terminal text. They are used for both the interactive review before confirmation and the final human-facing result after applying changes. `formatDetectionHuman` builds a table of each registered agent and whether it was detected, optionally listing evidence lines for each.

```typescript
function formatDetectionHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
): string {
```

This function takes a record of agent detections and the home directory path, returning a formatted string describing each agent's detection status and evidence.

`formatPlanHuman` renders the planned installation actions. It starts with a header naming the selected agents, then summarizes the counts of each action status (write, skip, refuse, requires-opt-in), and finally lists each action in detail.

```typescript
function formatPlanHuman(plan: readonly InstallAction[], toInstall: readonly AgentId[]): string {
```

This function takes an array of planned install actions and the list of agent IDs to install, returning a formatted string of the complete plan.

For each action it prints the status, kind, target agent (if any), and target path. It shows the reason for any non-write status, and for write actions it includes the full content block, redacting it if flagged as sensitive. This detailed display is what lets the user review exactly what the command intends to do before approving it.

`formatResultsHuman` presents the outcome of applying the plan. It reuses the detection table and then lists each action with its final result.

```typescript
function formatResultsHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
  plan: readonly InstallAction[],
  results: readonly { action: InstallAction; applied: boolean; detail?: string }[],
): string {
```

This function takes the detection record, home directory, the original plan, and the array of results, returning a human-readable results summary.

For each result it determines the outcome: non-write actions show their status, write actions show "written" on success or "FAILED" otherwise. It includes any detail or reason for each action, and adds a final note when there was nothing to write because every action was skipped, already up to date, or refused.

## JSON Result Formatting

<!-- lw:anchors packages/cli/src/commands/install.ts#formatResultJson -->

This function exists to convert a single installation result into a structured JSON object for the `--json` output mode. It provides a clean, machine-readable representation of each action's outcome, separate from the human-readable formatters.

```typescript
function formatResultJson(r: { action: InstallAction; applied: boolean; detail?: string }) {
```

This function takes a result object containing the action, whether it was applied, and an optional detail string, returning a plain object with normalized fields for output.

It extracts the action's kind, agent ID (or null), target path, and status, then adds the `applied` boolean and a `detail` field that prefers the explicit detail string, falling back to the action's reason, or null if neither exists. This normalized shape is what the command embeds in its JSON response for each result.