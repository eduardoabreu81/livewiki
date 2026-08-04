---
title: CLI hook and CI templates
owner: generated
anchors: []
---

# CLI hook and CI templates

This page documents the opt-in hook and CI templates shipped under `packages/cli/templates` for integrating livewiki's docs-debt detection into git, Claude Code, and GitHub Actions.

## When to use this page

- **Install** the git post-commit hook template into your repository's custom hooks directory.
- **Wire** the Claude Code `Stop` hook template into `.claude/settings.local.json` or `.claude/settings.json`.
- **Drop** the GitHub Actions `docs-debt.yml` template into `.github/workflows` for CI-side debt reporting on merge.
- **Diagnose** a non-firing hook using the debug commands listed under `git config` and JSON validation.

## How it fits

The `templates` directory lives under the `@livewiki/cli` package alongside the `livewiki` binary. It contributes nothing to the indexing logic itself; its sole role is to deliver copy-pasteable integration snippets that invoke the installed CLI from places a developer or CI runner will actually hit — a `git commit`, a Claude Code session ending, or a push to the default branch. The visible source shows three concrete artifacts (`git/post-commit`, `claude-code/settings.local.json`, and `github-actions/docs-debt.yml`) plus an explanatory `README.md`. The README is the only path listed in this module's inventory.

Livewiki's position is opt-in: the package never mutates `git config`, `.claude/`, or `.github/` on its own; it only ships templates and instructions. The templates share one semantic — run `livewiki index --quiet`, surface any new debt on stderr, transcript, or a GitHub Actions step summary, and exit zero so they never block a commit or re-trigger an agent.

## Diagram

```mermaid
%% livewiki/diagrams/templates.mmd
```

## Templates and their semantic

The visible source enumerates three templates plus the explanatory README. They all share one contract: invoke the CLI's deterministic detection, never call an LLM, never write outside `.livewiki/`, and never block the calling event.

### `git/post-commit` (template)

A bash hook that fires on every `git commit`. The README's recommended install path is `core.hooksPath .git/hooks-livewiki`, so the hook does not collide with other project hooks already living in `.git/hooks/`. The alternative install path copies the script straight into `.git/hooks/post-commit`, which overwrites any pre-existing file of the same name — the README flags this risk explicitly.

Output destination is the terminal's stderr. Exit semantics are `exit 0` even when debt is reported, so a noisy docs ledger cannot fail a commit.

### `claude-code/settings.local.json` (template)

A JSON snippet targeting the Claude Code `Stop` hook. The hook fires when a session ends, and its output is rendered into the agent's transcript — the agent then decides whether to pay the debt (via the `document-as-you-go` skill or `livewiki_write_doc` MCP tool) before stopping. The README recommends either installing the snippet verbatim as `.claude/settings.local.json` (single-user) or hand-merging the `hooks` block into an existing `.claude/settings.json` (team-shared).

### `github-actions/docs-debt.yml` (template)

The CI sibling of the two hooks above. The README describes a workflow that checks out with `fetch-depth: 0` (because the risk/churn factor reads `git log`), runs `livewiki index --quiet`, then `livewiki status --json`, and finally publishes a debt summary to the step summary. Permissions are `contents: read`; the template does not need secrets or a GitHub App. A no-debt merge incurs zero token cost, which the README frames as the whole point of the design.

The template branches on the `LIVEWIKI_DEBT_MODE` env var at the top of the file: `enforce` (default) fails the job when debt is greater than zero, while `report` always succeeds and surfaces the summary only. A future paid v2 sketch (provider pays the debt, opens a draft PR with the merge author as reviewer via `livewiki update --llm`) is referenced from ROADMAP §6 and is explicitly out of scope for this template.

## Detection and notification contract

The README states that detection re-scans the repo, diffs symbol hashes, and reports `changed / moved / deleted` symbols with no LLM involvement — claimed at under 2 seconds incremental for a 50k LOC repo. Notification prints one to two lines to stderr (or the transcript, or the GitHub Actions step summary) when debt is non-zero, and never blocks the calling event. Payment of debt is left to the developer or agent; the hooks themselves do not invoke any LLM.

The privacy section restates the same contract in negative form: the hook reads no API keys, calls no LLM, and writes only inside `.livewiki/`, which is described as the derived cache. The README does not include a script body, so the exact glob, hash algorithm, and notification formatting live behind the deployed files and are not visible in this excerpt.

## Installation paths

### Recommended git install

```bash
mkdir -p .git/hooks-livewiki
cp node_modules/@livewiki/cli/templates/git/post-commit .git/hooks-livewiki/post-commit
chmod +x .git/hooks-livewiki/post-commit
git config core.hooksPath .git/hooks-livewiki
git config core.hooksPath
```

This keeps any pre-existing `.git/hooks/post-commit` untouched and confines livewiki's hook to its own directory. Removal reverses it: `git config --unset core.hooksPath` and `rm -rf .git/hooks-livewiki`.

### Alternative git install

```bash
cp node_modules/@livewiki/cli/templates/git/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Documented as the "no `core.hooksPath`" path. The README warns that it overwrites any existing `post-commit`.

### Claude Code install

```bash
mkdir -p .claude
cp node_modules/@livewiki/cli/templates/claude-code/settings.local.json \
   .claude/settings.local.json
```

The alternative is a manual merge of the template's `hooks` block into an existing `.claude/settings.json`. Uninstallation is `rm .claude/settings.local.json`, or manually stripping the `hooks.Stop` block from `settings.json`.

### GitHub Actions install

```bash
mkdir -p .github/workflows
cp node_modules/@livewiki/cli/templates/github-actions/docs-debt.yml \
   .github/workflows/docs-debt.yml
```

The README notes that `branches: [main]` may need adjustment for repos whose default branch is not `main`, and that the repo must already have a `livewiki/` directory — produced by running `livewiki init` once locally before enabling CI.

## Compatibility and platform notes

`git/post-commit` is a bash script; the README states it works on Linux and macOS directly and on Windows only via Git Bash (which is the environment in which `git commit` resolves hooks on Windows). `claude-code/settings.local.json` is JSON and is installed by copy or merge. `github-actions/docs-debt.yml` is a GitHub Actions workflow file and follows GitHub's runner semantics.

## Debugging

The README gives two debug recipes:

```bash
git config --get core.hooksPath
ls -la .git/hooks-livewiki/post-commit  # deve ter +x
```

For Claude Code, JSON validity is checked with:

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json', 'utf8'))"
```

When the CLI is not on `$PATH` (the README's "livewiki not found" symptom), it suggests installing `@livewiki/cli` either as a dev dependency (`npm install --save-dev @livewiki/cli`) or globally (`npm install -g @livewiki/cli`).

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
