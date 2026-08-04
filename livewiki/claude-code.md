---
title: claude-code settings.local.json template
owner: generated
anchors: []
---

# claude-code settings.local.json template

This page documents the Claude Code `settings.local.json` template shipped with the Livewiki CLI, which configures a post-session `Stop` hook that nudges the agent toward resolving documentation debt.

## When to use this page

- **Install** the Claude Code integration by copying this template into your project's Claude Code settings directory.
- **Audit** how the bundled hook invokes the `livewiki` binary and what it does (and does not) do on each agent run.
- **Customize** the hook command while preserving the same `set +e` fail-open posture so the agent is never blocked by Livewiki.

## How it fits

The file lives at `packages/cli/templates/claude-code/settings.local.json` inside the Livewiki CLI package, alongside other Claude Code scaffolding. It is a template only — it is not consumed directly at runtime by the CLI; rather, an installer or a developer copies it into the user's Claude Code settings folder so that Claude Code itself loads it.

The hook it defines is structurally analogous to a `git post-commit` hook: it fires once when the agent finishes, performs a lightweight index pass, reads the resulting status, and emits a stderr notice if any documentation debt is recorded. The template is annotated with a comment that explicitly states this design intent and that the hook is intentionally non-blocking.

Because the closed list of canonical keys is empty, this page deliberately has no anchored sections and no anchor control markers; everything below is plain prose describing what the supplied source visibly contains.

## Diagram

```mermaid
%% livewiki/diagrams/claude-code.mmd
```

## Hook payload

The top-level JSON object holds a single `"hooks"` object. Inside it, only the `Stop` event is configured. Each event maps to a non-empty array of hook definitions; the template supplies one definition, and that definition carries an inner `"hooks"` array with one command entry.

That command entry is a `type: "command"` shell invocation. The `_comment` field on the outer `Stop` definition explains that the hook fires when the agent terminates and that any output it produces is surfaced to the agent in its transcript.

## Command semantics

The shell command follows a deliberate fail-open pattern. It starts with `set +e`, which disables the shell's exit-on-error behavior for the rest of the hook, and ends with `exit 0`. Together these ensure the hook itself never returns a non-zero status to Claude Code, so the agent is not blocked by Livewiki when downstream steps fail.

The command body resolves the `livewiki` binary via `command -v livewiki`. If the binary is not found on `PATH`, the variable is empty and the hook short-circuits with `exit 0`. This makes the template safe to install on machines where `livewiki` has not yet been installed.

When the binary is present, the command runs `livewiki index --quiet` first, swallowing its stderr and exit status via the `2>/dev/null` redirect and the `set +e` posture, then runs `livewiki status --json` and parses the resulting JSON with a `grep -oE` extraction of the `"total":<digits>` field. If the parsed total is non-empty and numerically greater than zero, the hook writes a one-line notice to **stderr** (note the `1>&2` redirection on both the blank line and the message) telling the agent that documentation debt was detected and pointing it at `livewiki status --json` and the document-as-you-go skill. If the total is zero or unparseable, the hook produces no stderr output and exits cleanly.

## Observed guarantees and limits

What the visible source establishes about the hook's behavior:

- It is non-blocking on the visible normal path. `set +e` plus a final `exit 0` ensure Claude Code does not receive a failure from Livewiki when the script runs to completion along the normal path.
- It is a soft notification, not an enforcement mechanism. It only writes to stderr when debt is greater than zero; it never edits files, never modifies the agent's transcript beyond stdout/stderr, and never changes process exit codes based on debt.
- It tolerates a missing `livewiki` binary by exiting cleanly.
- It runs the `index` step before reading `status`, so the totals reflect a fresh pass rather than stale state — at least when the binary is on `PATH` and `index` itself succeeds along the visible path.

What the visible source does **not** establish:

- It does not visibly distinguish a missing `livewiki` binary from a `livewiki` binary whose `index` step failed for another reason; both paths can reach the final `exit 0` without a stderr notice in some scenarios, but the source does not prove which paths are reachable or what each produces.
- It does not visibly bound how long `index` may take; the hook has no explicit timeout and relies on whatever timeout Claude Code itself imposes on hooks.
- It does not visibly handle multi-line or non-integer `total` values; the regex extracts digits, so any JSON shape that does not include a literal `"total":<digits>` token silently falls through to the zero-debt branch.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
