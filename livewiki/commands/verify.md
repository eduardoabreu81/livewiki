---
title: livewiki verify command
owner: generated
anchors:
  - packages/cli/src/commands/verify.ts#registerVerify
---

# livewiki verify command

This page documents the `livewiki verify` CLI subcommand, which checks a generated wiki for the kinds of corruption that would break readers or CI pipelines.

## When to use this page

- **Wire** `livewiki verify` into a CI pipeline so build steps fail when the wiki no longer matches its index.
- **Inspect** what counts as a "verification failure": broken anchors, altered manual blocks, and broken internal links.
- **Choose** between the default human-readable report and a machine-readable JSON report using the `--json` flag.
- **Debug** non-zero exits from the verifier by understanding the option parsing, error handling, and exit-code flow inside `registerVerify`.

## How it fits

The file lives at `packages/cli/src/commands/verify.ts`, inside the `@livewiki/cli` package's commands directory. It sits in the command-registration layer of the CLI: each file here exports one `registerXxx(program)` function that a higher-level CLI bootstrap attaches to a `commander` `Command` instance. `registerVerify` delegates all heavy lifting to the `@livewiki/core/verify` module — specifically `runVerify` (the actual checker) and `formatVerifyHuman` (the text reporter) — and adds only the CLI-shaped concerns: parsing `VerifyOptions`, resolving the repository root, switching between JSON and human output, and translating outcomes into a process exit code. The verifier itself is what walks the wiki pages and the index; this file is the thin adapter that exposes it as a subcommand.

## Diagram

```mermaid
%% livewiki/diagrams/commands-verify.mmd
```

## Command registration

The single responsibility of this file is to teach the top-level commander program how to invoke the `verify` subcommand and how to render the result.

```ts
export function registerVerify(program: Command): void
```

`registerVerify` takes the parent commander `Command` instance and returns nothing; attaching a subcommand to it mutates the program in place.

```ts
// packages/cli/src/commands/verify.ts
export function registerVerify(program: Command): void {
  program
    .command("verify")
    .description(
      "validate wiki: anchors + manual blocks + internal links. Exit ≠ 0 on failure (Phase 2, CI-friendly)",
    )
    .action(async (_options: VerifyOptions, command: Command) => {
      const opts = command.optsWithGlobals<VerifyOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      let result: VerifyResult;
      try {
        result = await runVerify(repoRoot);
      } catch (err) {
        process.stderr.write(`livewiki verify: error — ${(err as Error).message}\n`);
        // An abrupt exit after writing stderr can crash libuv on Windows
        // while I/O is pending. Let Node drain the event loop naturally.
        process.exitCode = 1;
        return;
      }
      if (json) {
        process.stdout.write(JSON.stringify(result) + "\n");
      } else {
        process.stdout.write(formatVerifyHuman(result) + "\n");
      }
      // CI-friendly: exit code != 0 if there are errors
      if (!result.ok) process.exitCode = 1;
    });
}
```

The first thing `registerVerify` does is attach a `verify` subcommand to the parent `Command` with a description that names the three checks the verifier covers — anchors, manual blocks, and internal links — and promises a non-zero exit on failure, which is what makes the command CI-friendly. Everything else happens inside the `.action` callback that commander runs after argument and option parsing.

The action handler runs in four stages. First it resolves the effective options by calling `command.optsWithGlobals<VerifyOptions>()`, so that both the verify-specific flags (`--json`, `--repo`) and any global flags the top-level CLI may have set are visible. It then coerces `opts.json` to a boolean with `Boolean(opts.json)` and resolves the repository root by joining `process.cwd()` with `opts.repo` (defaulting to `"."` when `--repo` is not given) and passing the result through `path.resolve`, which produces an absolute path regardless of whether the user passed a relative or an absolute `--repo` value.

Second, the handler invokes `runVerify(repoRoot)` from `@livewiki/core/verify`, awaiting the `VerifyResult` it returns. The visible source wraps that call in a `try`/`catch` block: if `runVerify` itself throws, the handler writes a `livewiki verify: error — <message>` line to `stderr`, sets `process.exitCode = 1`, and returns early from the action. The early return is deliberate — the inline comment in the source explains that an abrupt `process.exit` while Node is still draining I/O can crash libuv on Windows — so the command lets Node flush its event loop before terminating while still signaling failure through the exit code. Once `runVerify` returns normally, control reaches the output stage.

Third, the output stage branches on `opts.json`. When the JSON flag is set, the handler serializes the `VerifyResult` with `JSON.stringify` and writes it to `stdout` followed by a newline, giving other tools (CI runners, scripts, editors) a stable machine-readable payload. When the JSON flag is absent, it calls `formatVerifyHuman(result)` to produce the human-readable report and writes that to `stdout` with a trailing newline. Either way the same `VerifyResult` value is the single source of truth for what gets reported; the handler does not inspect the result's contents itself.

Finally, the handler enforces the CI-friendly contract: if `!result.ok` it sets `process.exitCode = 1` and otherwise leaves the exit code at its default of `0`. Because the earlier `catch` branch already set `process.exitCode = 1` on thrown errors, every visible failure path — a thrown exception from the checker or a non-ok result returned by it — produces a non-zero exit code, which is what makes the command usable as a CI gate. The visible source contains no other branching around `result.ok`, so the prose above covers the only checks the excerpt establishes.

## Additional indexed symbols

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.
