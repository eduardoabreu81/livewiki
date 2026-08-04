---
title: GitHub Actions workflows for livewiki CI and docs-debt gating
owner: generated
anchors: []
---

# GitHub Actions workflows for livewiki CI and docs-debt gating

This page documents the GitHub Actions workflows that drive the livewiki repository's continuous integration matrix and its documentation-debt reporting gate.

## When to use this page

- **Diagnose** a cross-platform CI failure by reading the matrix definition and per-shell CLI smoke steps.
- **Configure** the docs-debt workflow by changing `LIVEWIKI_DEBT_MODE` from `report` to `enforce`.
- **Audit** the trigger surfaces and declared permissions of both workflows before granting new tokens or scopes.

## How it fits

The workflows live under `.github/workflows` and currently contain exactly two files: `cross-platform-ci.yml` and `docs-debt.yml`. Both workflows share a Node 24 + pnpm toolchain and intentionally avoid depending on a published `@livewiki/cli` — they invoke the locally-built binary at `packages/cli/dist/index.js` instead. `cross-platform-ci.yml` is the gating build triggered by pull requests, pushes to `main`, and manual dispatch; `docs-debt.yml` is a dogfood instance that runs `livewiki index` and `livewiki status` after merges to `main` to surface documentation debt.

## Diagram

```mermaid
%% livewiki/diagrams/workflows.mmd
```

## cross-platform-ci.yml

### Trigger surface

The workflow fires on `pull_request`, on `push` to the `main` branch, and via `workflow_dispatch`. `permissions: contents: read` is the only grant declared, so jobs cannot mutate repository content or post comments. `strategy.fail-fast` is `false`, which means a failure on one matrix leg does not cancel the others — every OS combination runs to completion so a single broken shell does not mask the others.

### Matrix

The matrix enumerates three runners — `ubuntu-latest`, `windows-latest`, and `macos-latest` — against a single Node version, `"24"`. The source comment in the file explains why Node 20 was dropped: GitHub Actions deprecates it and `better-sqlite3` does not ship a `win32` prebuilt for it, with the `node-gyp` fallback unable to parse the runner's VS 18 install. The job name is templated as `${{ matrix.os }} / node-${{ matrix.node }}` so each leg shows up distinctly in the Actions UI.

### Steps

After `actions/checkout@v6`, `pnpm/action-setup@v6`, and `actions/setup-node@v6` (with `cache: pnpm` keyed on `pnpm-lock.yaml`), every leg runs the same three commands: `pnpm install --frozen-lockfile`, `pnpm -r build`, and `pnpm -r test`. These run unconditionally across the matrix.

### CLI entry-point smoke

Three smoke steps invoke `node packages/cli/dist/index.js --help` to confirm the CLI binary resolves and runs. The default-shell step runs once per leg with the runner's default shell (PowerShell on Windows, Bash on Ubuntu/macOS); the inline comment notes that `pnpm exec livewiki` cannot resolve a workspace-local bin from the root and exits with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` (exit 254), which is why `node` is invoked directly. Two additional shell-specific steps narrow on `matrix.os`:

- On `windows-latest` only, a `cmd` shell step runs `node packages\cli\dist\index.js --help` with backslash-separated path separators.
- On `macos-latest` only, a `zsh {0}` shell step runs `node packages/cli/dist/index.js --help`.

The Linux leg is covered by the default-shell step alone; the matrix does not pin a Bash shell step for `ubuntu-latest`.

## docs-debt.yml

### Trigger surface

This workflow runs on `push` to `main` and on `workflow_dispatch`. Like the CI workflow, it declares `permissions: contents: read`. The job is pinned to a single runner (`ubuntu-latest`) and a single Node version (`"24"`); there is no matrix. The header comment notes this file is a dogfood instance of `packages/cli/templates/github-actions/docs-debt.yml`, sharing the same mechanics but building the CLI from the checkout because `@livewiki/cli` is not yet published to npm.

### Environment

The workflow-level `env:` block sets `LIVEWIKI_DEBT_MODE: report`. Detection is deterministic and spends zero LLM tokens; the comment instructs flipping `LIVEWIKI_DEBT_MODE` to `enforce` once the signal is trusted. This is the only environment variable defined at workflow scope.

### Steps

The first four steps mirror the CI workflow's preamble: `actions/checkout@v6` (with `fetch-depth: 0` so history is available for the indexer), `pnpm/action-setup@v6`, `actions/setup-node@v6` (Node 24, pnpm cache), and an install+build step that runs `pnpm install --frozen-lockfile` followed by `pnpm -r build`.

After the build, the workflow runs `node packages/cli/dist/index.js index --quiet` to produce the index, then a `docs-debt report and gate` step (shell `bash`) that:

1. Writes `livewiki status --json` to `${{ runner.temp }}/livewiki-status.json` via `STATUS_JSON`.
2. Reads the JSON back in an inline `node -e` script and reads `s.debt` with a fallback to `{ total: 0, byEvent: {}, items: [] }`.
3. Builds a Markdown summary and appends it to `$GITHUB_STEP_SUMMARY`, also echoing it to the log.
4. When `debt.total > 0` and `LIVEWIKI_DEBT_MODE !== "report"`, prints an error to stderr and `process.exit(1)`.

In the current `report` configuration the gate is fail-open — the job succeeds regardless of debt count, and the only effect of non-zero debt is the step summary and console output.

### Summary format

The generated summary has two shapes. When `debt.total === 0`, it prints `**No documentation debt — zero tokens spent.**`. Otherwise it prints a heading with the total, a breakdown by event (`changed`, `moved`, `deleted` — all read via `?? 0` fallbacks), and a Markdown table with up to ten rows. Each table row shows `risk` (the numeric `risk.score` when present, otherwise `—`), `event`, `assignee`, and an anchor column whose value is `symbol_key ?? wiki_path ?? "?"` rendered as inline code. The summary ends with guidance to pay debt via `livewiki update` (in-session) or `livewiki update --llm`, then `livewiki verify`, plus a reminder that detection above cost zero tokens.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
