---
title: Interactive configuration and credential management for the LiveWiki CLI
owner: generated
anchors:
- packages/cli/src/commands/config.ts#BARE_CONFIG_HINT
- packages/cli/src/commands/config.ts#decideBareInvocation
- packages/cli/src/commands/config.ts#emitError
- packages/cli/src/commands/config.ts#formatShowHuman
- packages/cli/src/commands/config.ts#isConfigured
- packages/cli/src/commands/config.ts#processIo
- packages/cli/src/commands/config.ts#promptForPreset
- packages/cli/src/commands/config.ts#promptRequired
- packages/cli/src/commands/config.ts#readLineInput
- packages/cli/src/commands/config.ts#readSecretInput
- packages/cli/src/commands/config.ts#registerConfig
- packages/cli/src/commands/config.ts#runConfigFlow
- packages/cli/src/commands/config.ts#runConfigWizard
- packages/cli/src/commands/config.ts#selectPreset
- packages/cli/src/commands/config.ts#showConfig
---

# Configuration command: interactive setup, validation, and display

This module implements the `livewiki config` command family and the shared flow that configures a repository's LLM provider, model, language, and API credential.

## When to use this page

- Understand how the interactive configuration wizard collects provider choices and credentials.
- Learn how the CLI routes a bare `livewiki` invocation between help, hint, and wizard.
- Discover how the `config show` subcommand reports effective settings without revealing secret values.

## How it fits

This file lives in the `packages/cli/src/commands` directory and implements the user-facing `livewiki config` command alongside the fallback behavior for a bare `livewiki` run. It imports configuration loading/saving, credential status checks, preset resolution, install planning, and provider probing from `@livewiki/core`, and it presents results through the CLI's output utilities. The command covers both interactive wizard flow and a non-interactive query path, sharing the same underlying project configuration data.

## Diagram

The wizard's flow starts when the command is registered and routed by `runConfigFlow`, which decides whether to invoke the interactive wizard or the non-interactive show path. The wizard itself chains several stages: it first prompts for a preset, then prompts for the required model and language fields, then probes the provider, and finally plans and installs credentials.

```mermaid
%% livewiki/diagrams/commands-config.mmd
```

The diagram begins at `registerConfig`, which is the entry point that defines the command on the CLI program; from there, `runConfigFlow` chooses between the interactive wizard (`runConfigWizard`) and the non-interactive query path (`showConfig`). The wizard prompts for a preset via `promptForPreset`, which relies on `selectPreset` to validate answers and calls `processIo` to adapt the prompt to the active output mode before reading input through `readLineInput`; this same reader is used for the required model and language fields. After all values are collected, the wizard runs the connectivity probe and, if successful, plans and applies the credential store, then loads and saves the final configuration. Both `showConfig` and the wizard route their outputs through the shared error emitter, while `registerConfig` also invokes the readiness checks that decide what a bare invocation should do.

<!-- lw:anchors packages/cli/src/commands/config.ts#runConfigWizard -->

These anchors identify indexed symbols whose implementation is part of this module.

## Orchestrating interactive configuration

`runConfigWizard` is the central routine that drives first-time setup; it collects values from the operator, tests their combination against a live provider endpoint, and persists them only after explicit confirmation.

```ts
export async function runConfigWizard(opts: {
  repoRoot: string;
  home: string;
  io: ConfigWizardIo;
  env?: NodeJS.ProcessEnv;
  /** Test seam: replaces the real connectivity probe. */
  probe?: (repoRoot: string, config: LivewikiConfig) => Promise<ProviderProbeResult>;
}): Promise<ConfigWizardResult>
```

This function takes repository root, home directory, an I/O abstraction (`io`), and optional environment and probe arguments, and returns a result object indicating success, cancellation, error, or chosen settings. The wizard rejects early with `ok: false` if standard input is not a TTY. It loads any existing configuration, re-prompts for preset, model, and language, and asks for an optional base URL. Credential handling checks whether the environment variable named by the preset is already set, offering to skip the credential store in that case; otherwise it requests a secret, which may be omitted only when the preset marks the credential as optional. Before writing anything, the wizard temporarily exposes a typed credential through the process environment, runs a connectivity probe that checks for both endpoint failure and a thinking-leak condition, and restores the environment in a `finally` block. If the probe fails but no thinking leak occurs, it asks whether to save configuration anyway; a thinking leak aborts without saving. After a successful probe, it plans a credential-store installation, asks for explicit confirmation, applies the plan only when approved, and reports a failure if any write did not apply. On confirmation it saves the final configuration and returns a success result naming the provider variable, credential presence, and their source.

## Interactive prompt handlers for standard and secret input

These functions perform the polling that the wizard relies on to obtain answers from the operator about presets and required fields, ensuring each response is either valid or re-prompted.

<!-- lw:anchors packages/cli/src/commands/config.ts#promptForPreset packages/cli/src/commands/config.ts#promptRequired packages/cli/src/commands/config.ts#selectPreset -->

The helper `selectPreset` decides whether an answer names a preset; `promptForPreset` shows the list and asks until a valid choice is given; `promptRequired` forces a non-empty answer for text fields.

```ts
function selectPreset(answer: string, fallback?: PresetName): PresetName | null {
```

`selectPreset` takes a raw string (and an optional fallback) and returns a preset name, or `null` when the answer does not match one. It returns a fallback for a blank answer, treats a numeric string as an index into the available presets only when that number is within range, and also accepts a direct preset-name match.

```ts
async function promptForPreset(
  io: ConfigWizardIo,
  current?: PresetName,
): Promise<PresetName>
```

`promptForPreset` takes an I/O object and an optional current preset value, returning a preset name once the operator picks an existing one. It writes the numbered list of available presets, then loops by invoking `io.promptText` until `selectPreset` returns a non-null answer; when the answer is blank and a current preset exists, the fallback yields that current preset, but otherwise the loop warns and tries again.

```ts
async function promptRequired(
  io: ConfigWizardIo,
  label: string,
  current?: string,
): Promise<string>
```

`promptRequired` takes an I/O object, a question label, and an optional current string value, returning a non-empty trimmed answer. It enters a loop that reads a response, returns the trimmed value if it is not empty, falls back to a current value when the answer is empty and a current exists, and otherwise writes that the field is required and continues.

## Stream-level terminal readers

These exports provide the low-level promise-based readers that convert terminal characters into a single line or a masked secret for the prompt handlers above.

<!-- lw:anchors packages/cli/src/commands/config.ts#readLineInput packages/cli/src/commands/config.ts#readSecretInput -->

`readLineInput` opens a stream to gather an entire line, and `readSecretInput` enables raw mode to hide characters as they are typed.

```ts
export function readLineInput(
  question: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string>
```

`readLineInput` writes the question to the output stream and returns a promise that resolves to the trimmed text up to the first carriage return or newline (or until the stream ends). It resumes the input stream, accumulates chunks into a value, and when a newline appears, slices the value to that point, removes the data and end listeners, pauses the stream, and resolves.

```ts
export function readSecretInput(
  question: string,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string>
```

`readSecretInput` writes a question and returns a promise for the raw, masked secret; it rejects if the input stream is not a TTY or does not provide raw mode. It records the previous raw state, enables raw mode, and processes each character: Control-C aborts with a "Configuration cancelled" error, Enter or carriage return completes input, backspace deletes a prior character, and printable characters are appended; both normal completion and abort restore the original raw state, output a newline, and pause the stream.

## Building I/O based on JSON mode

This step adapts the wizard's interaction target to the CLI's current output mode, which matters because a JSON caller still needs interactive prompts but must not corrupt stdout output.

<!-- lw:anchors packages/cli/src/commands/config.ts#processIo -->

```ts
function processIo(json: boolean): ConfigWizardIo
```

`processIo` takes a JSON-mode flag and returns an `io` object that routes prompts and writes to stderr in JSON mode (or stdout otherwise), while also reporting whether the standard input is a terminal. It wires the `promptText`, `promptSecret`, and `promptYesNo` methods to either `readLineInput` or `readSecretInput`, and implements `write` as direct text output to the appropriate target stream; for yes/no questions, a blank answer uses the provided default.

## Inspecting and presenting effective configuration

The `config show` subcommand path resolves and renders the repository's current provider details without printing the credential material itself.

<!-- lw:anchors packages/cli/src/commands/config.ts#showConfig packages/cli/src/commands/config.ts#formatShowHuman -->

```ts
async function showConfig(
  repoRoot: string,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<{
  ok: true;
  preset: string | null;
  model: string | null;
  language: string;
  credential: {
    envVar: string | null;
    set: boolean;
    source: "environment" | "credentials-store" | null;
    required: boolean | null;
  };
}>
```

`showConfig` takes a repository root, home directory, and process environment, and returns a structured summary of the provider, model, language, and credential status (but never the credential secret). It loads the current configuration, applies defaults, and reports all fields as null or defaults when no provider is configured; otherwise it resolves the provider, checks credential presence synchronously through the home and environment inputs, and reports which variable, whether it is set, where it comes from, and whether it is required.

```ts
function formatShowHuman(result: {
  preset: string | null;
  model: string | null;
  language: string;
  credential: {
    envVar: string | null;
    set: boolean;
    source: "environment" | "credentials-store" | null;
    required: boolean | null;
  };
}): string
```

`formatShowHuman` accepts the same summary shape as `showConfig` produces and returns a human-readable, multi-line text description of the effective configuration for display to the operator. It lists preset, model, and language, then reports when a credential variable is unavailable, when an optional one is unset, when a required one is unset, or when a set credential originates from the environment or the global credentials store.

## Failure reporting and onboarding routing

These symbols turn internal errors into user-facing messages and decide what a bare `livewiki` invocation should do next, separating routing decisions from terminal output.

<!-- lw:anchors packages/cli/src/commands/config.ts#emitError packages/cli/src/commands/config.ts#isConfigured packages/cli/src/commands/config.ts#decideBareInvocation packages/cli/src/commands/config.ts#BARE_CONFIG_HINT -->

```ts
function emitError(json: boolean, error: unknown, label = "config"): void
```

`emitError` takes a JSON-mode flag, an error object, and an optional label (defaulting to `config`), converting the error message into either a structured JSON failure record or a stderr line, and always sets exit code 1. This centralizes how every configuration error reaches the caller.

```ts
export async function isConfigured(repoRoot: string): Promise<boolean>
```

`isConfigured` takes a repository root and returns `true` only when the loaded file names a preset or a legacy provider; it returns `false` when neither exists or when the configuration cannot be read, allowing malformed data to surface later inside the wizard's own error handling.

```ts
export function decideBareInvocation(
  configured: boolean,
  isTTY: boolean,
  json: boolean,
): BareInvocationAction
```

`decideBareInvocation` takes whether the repo is configured, whether standard input is a terminal, and JSON mode, returning either `"help"`, `"hint"`, or `"wizard"` for a bare `livewiki` invocation. A configured repository always routes to help; an unconfigured non-interactive or JSON caller receives a hint; only an interactive unconfigured session proceeds to the wizard.

```ts
export const BARE_CONFIG_HINT =
```

`BARE_CONFIG_HINT` is a constant that holds the exact text suggesting how an unconfigured operator should obtain a configuration, telling them to run the wizard or set preset/model fields directly in a configuration file.

## Public command entry points

These exports let the outer CLI register the command subtree and provide a shared wrapper so both the `livewiki config` command and the bare-`livewiki` onboarding can run the wizard and emit the outcome consistently.

<!-- lw:anchors packages/cli/src/commands/config.ts#runConfigFlow packages/cli/src/commands/config.ts#registerConfig -->

```ts
export async function runConfigFlow(options: {
  json: boolean;
  repoRoot: string;
  home: string;
  errorLabel?: string;
}): Promise<void>
```

`runConfigFlow` takes a JSON flag, repository root, home, and an optional error label, invokes `runConfigWizard`, and then emits either a success, cancellation, or failure result via the shared output utility; it routes wizard failures and any escaping exception through `emitError`.

```ts
export function registerConfig(program: Command): void
```

`registerConfig` registers a `config` command on a commander program, resolving repository root and home in its action, then delegating to `runConfigFlow`; it also registers a nested `show` subcommand that queries `showConfig` and emits either JSON or the human-formatted text through the shared output utility, catching errors via `emitError`.