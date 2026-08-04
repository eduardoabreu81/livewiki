---
title: livewiki docs-debt GitHub Actions workflow
owner: generated
anchors: []
---

# livewiki docs-debt GitHub Actions workflow

This template is a single GitHub Actions workflow that, on every push to the default branch, re-runs the deterministic `livewiki` index and reports — and optionally gates on — documentation debt.

## When to use this page

- **Install** the workflow by copying `docs-debt.yml` into `.github/workflows/` of a repo that already has a `livewiki/` directory produced by `livewiki init`.
- **Toggle** the `enforce` / `report` behavior by changing the `LIVEWIKI_DEBT_MODE` environment variable in the workflow's `env:` block.
- **Read** the job summary the workflow appends on every run to see whether the spawn incurred any documentation debt and, if it did, which anchors need rewriting.
- **Adjust** the trigger branch (`main` by default) and the Node version (`24`) to match the host repository before merging the file.

## How it fits

The file lives at `packages/cli/templates/github-actions/docs-debt.yml` inside the `livewiki` CLI package, alongside other GitHub-facing workflow templates. It is a deliverable installer, not a runtime component of the CLI itself: `livewiki init` (or a manual copy) drops this workflow into the consumer repository, after which GitHub Actions becomes the recurring host for the deterministic index step. The workflow depends only on `actions/checkout@v6`, `actions/setup-node@v6`, and the `livewiki` CLI from npm — there are no additional secrets, GitHub App permissions, or `GITHUB_TOKEN` scopes beyond `contents: read`. The non-Goals of v1 are also encoded in the file's preamble: no LLM calls, no repository writes, no PR or issue comments.

## Diagram

```mermaid
%% livewiki/diagrams/github-actions.mmd
```

## Trigger and permissions

The workflow listens on `push` to the `main` branch and on `workflow_dispatch`. The `branches: [main]` filter is annotated as something to adjust when the consumer repo's default branch differs. `permissions: contents: read` is the only declared permission set, consistent with the preamble's claim of needing no write capability, no `GITHUB_TOKEN` escalation, and no extra secrets.

## Deterministic detection step

The `livewiki index (deterministic — no LLM)` step runs `npx --yes @livewiki/cli index --quiet`. The `--quiet` flag suppresses progress output during the index pass; the `npx --yes` form means the step does not require a prior `npm install` in the consumer repo. Because the workflow preamble states that detection compares `tree-sitter` symbols and content hashes, this step is the source of the JSON the next step consumes.

## Debt reporting and gate step

The `docs-debt report and gate` step shells out to `bash` under `set -euo pipefail`, runs `npx --yes @livewiki/cli status --json` into a temporary file, and then evaluates an inline Node script that reads that JSON. The script reads `debt.total`, `debt.byEvent`, and `debt.items` from the parsed status; the `debt ?? { total: 0, byEvent: {}, items: [] }` fallback is the only visible defensive branch, and it exists to keep the script predictable when the status payload omits a `debt` field.

When `debt.total === 0`, the script appends a single green line to `$GITHUB_STEP_SUMMARY`. When `debt.total > 0`, it appends a Markdown table of up to the first ten items drawn from `debt.items`, with columns for `risk` (the numeric `it.risk.score` when present, otherwise an em dash), `event`, `assignee`, and `anchor` (preferring `it.symbol_key`, falling back to `it.wiki_path`, and finally to `"?"`), plus a header line summarizing the three `debt.byEvent` counts (`changed`, `moved`, `deleted`) — each of those header counts is itself defended by a `?? 0` fallback.

After writing the summary, the script echoes the same lines to the job log and then decides the step's exit code: if `debt.total > 0` **and** `process.env.LIVEWIKI_DEBT_MODE !== "report"`, it writes an error to `stderr` and calls `process.exit(1)`. This is the single visible failure branch; under `mode=enforce` it triggers the red X on the merge, and under `mode=report` the job always exits 0 regardless of `debt.total`. Because the script appends to `GITHUB_STEP_SUMMARY` before deciding the exit code, the report is visible on the Actions run page even when the step fails.

## Mode switch and absence of remediation

The `LIVEWIKI_DEBT_MODE: enforce` line in the workflow's top-level `env:` block is the only toggle. Setting it to `report` is the documented way to keep the job green while still surfacing the table in the run summary; the preamble of the workflow is explicit that the v1 workflow never makes LLM calls, never writes to the repository, and never opens PRs or issues. The paid remediation path (`livewiki update --llm` followed by a `gh pr create --draft`) is described in the preamble as a v2 deliverable and is not implemented in this file.

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
