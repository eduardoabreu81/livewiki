---
title: CLI output formatting
owner: generated
anchors:
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

# CLI output formatting

The CLI's single formatting choke-point that turns in-memory results into either machine-readable JSON or human-readable text on standard output.

## When to use this page

- **Pick** an output mode when adding a new command: use `emit` for the dual `--json`/human split, or call `emitHuman`/`emitJson` directly when a command has only one output shape.
- **Trace** where a string ends up on `stdout` by following `emitHuman`/`emitJson` and their newline conventions.
- **Diagnose** "extra blank line" or "JSON parse error" bugs by checking which helper a caller used and whether it appended a trailing newline.
- **Reason** about the `EmitOptions` contract (`json: boolean`) when wiring a new flag.

## How it fits

This file lives in `packages/cli/src/`. It is the formatting layer invoked by every CLI command once it has produced its result; nothing else in the package writes user-facing text to `process.stdout`. Downstream, terminal users see plain text and `--json` consumers parse the same payload as one JSON object per line. The file holds no I/O of its own beyond `process.stdout.write`, so it never touches files, sockets, or the filesystem. Callers from sibling modules depend on it for the dual output contract mandated by the CLI command spec.

## Diagram

```mermaid
%% livewiki/diagrams/cli-src-output.mmd
```

## Routing output through a single dispatcher

`emit` exists so every CLI command has exactly one place to branch between JSON and human rendering, keeping callers from duplicating the `if (json)` check. Without this single dispatcher, each command would have to re-implement the boolean toggle, which is how dual `--json`/human modes accumulate drift (one command forgets the `String(data)` step, another writes the human text even when `json` is true, and the output contract falls apart). Centralizing the branch in `emit` makes the contract auditable in one spot.

```ts
export function emit(
  json: boolean,
  data: unknown,
  human: string,
): void
```

`emit` takes a boolean mode flag, an arbitrary value to serialize when JSON is requested, and the pre-formatted human-readable string for the non-JSON path; it returns nothing.

When `json` is true, `emit` forwards `data` to `emitJson`. When `json` is false, it forwards `human` to `emitHuman`. The visible source guarantees that exactly one branch runs per call, so a caller can safely pass both arguments without risking both being written. The docstring on `emit` instructs callers to pass one or the other — never both — which is the contract the file enforces by branching before either helper is reached.

<!-- lw:anchors packages/cli/src/output.ts#emit -->

These anchors identify indexed symbols whose implementation is part of this module.

## Writing human-readable text

`emitHuman` exists so plain-text output always ends with a newline, which keeps shell prompts and log tailing behavior predictable regardless of how the caller built the string. Shell prompts reappear on the next line of the terminal after a command finishes, and log tailing utilities (including `tee`, `journalctl`, and CI runners that capture stdout) all key off line boundaries rather than call boundaries; a missing trailing newline therefore surfaces as a prompt glued to the last output character, which is the bug this helper exists to prevent.

```ts
export function emitHuman(text: string): void
```

`emitHuman` takes a string (possibly multi-line) and returns nothing.

The implementation writes the text to `process.stdout` unchanged if it already ends with `"\n"`; otherwise it appends `"\n"` before writing. This is a one-sided normalization: only the trailing-newline presence is enforced, not any other formatting invariant (no width wrapping, no color, no escaping). Callers are expected to pass text that is already in its final human-readable form; this function adds at most one byte.

<!-- lw:anchors packages/cli/src/output.ts#emitHuman -->

These anchors identify indexed symbols whose implementation is part of this module.

## Writing parseable JSON

`emitJson` exists so every `--json` invocation produces exactly one valid JSON document per line, which is the shape external `JSON.parse`-per-line consumers expect. Many external tools (CI scripts, observability agents, shell pipelines that pipe `xargs -L1` and call `JSON.parse` on each line) assume one JSON document per line; emitting a non-terminated document, a pretty-printed multi-line payload, or two documents on the same line would each break those consumers in a different way, so `emitJson` is the single place that pins the format.

```ts
export function emitJson(data: unknown): void
```

`emitJson` takes any value `JSON.stringify` accepts and returns nothing.

The function writes `JSON.stringify(data)` followed by `"\n"` to `process.stdout`. The result is therefore a single line: a complete JSON document plus a terminating newline, with no pretty-printing or indentation. There is no visible error handling around `JSON.stringify` — values containing circular references would throw at the `stringify` call rather than producing a fallback — so callers are responsible for passing data that serializes cleanly.

<!-- lw:anchors packages/cli/src/output.ts#emitJson -->

These anchors identify indexed symbols whose implementation is part of this module.