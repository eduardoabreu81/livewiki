---
title: claude-code hook template
owner: generated
---

# claude-code hook template

This page documents the Livewiki hook template packaged for Claude Code, which mirrors the git post-commit hook semantics.

## When to use this page

- **Configure** Livewiki to surface documentation debt inside Claude Code agent transcripts.
- **Understand** the failure mode when the `livewiki` binary is absent on `PATH` for a project consumer.
- **Audit** the bundled `settings.local.json` shipped from `packages/cli/templates/claude-code` into downstream consumers.
- **Compare** this hook's behavior to the equivalent git `post-commit` hook implementation in the repository.

## How it fits

The template lives under `packages/cli/templates/claude-code/settings.local.json` and is one of several hook templates shipped by the Livewiki CLI package. Its role is to install a `Stop` hook into a consumer's Claude Code configuration so that whenever an agent finishes, Livewiki can re-index and surface documentation debt non-blockingly. Because it is a static template asset, it has no call graph inside the `cli` package itself; instead, downstream tooling or end users copy it into a target `.claude/` directory. The template deliberately mirrors the git post-commit hook semantics described in its top-level `_comment` field: it runs an index pass, reports any debt, and never blocks the surrounding workflow.

## Visible source

The file declares a single hook entry under `hooks.Stop`, whose inner array contains one hook object of `type: "command"`. The accompanying `_comment` explains that the hook fires when the agent terminates and that its output is visible to the agent in the transcript.

### Hook command

The hook's `command` field is an inline `bash -c` invocation that begins with `set +e` to disable shell exit-on-error. It resolves the `livewiki` binary with `command -v livewiki`, defaulting to an empty string when the lookup fails, and immediately exits `0` if the resolution produced no path — this is the visible fail-open branch when `livewiki` is missing from `PATH`.

When `livewiki` is available, it runs `$L index --quiet` with stderr redirected away, captures `$L status --json` into a variable `S`, and parses the first `total` numeric field from that JSON via two `grep -oE` passes into `T` (falling back to `0` if the regex finds nothing). If `T` is non-empty and numerically greater than zero, the hook writes a blank line and a `livewiki: <T> documentation debt item(s) detected — run `livewiki status --json` to see details, or use the document-as-you-go skill.` message to stderr. The final line of the script is `exit 0`, so the hook never propagates a non-zero exit code to Claude Code regardless of whether debt was found or the intermediate commands failed.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
