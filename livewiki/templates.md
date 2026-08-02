---
title: Livewiki hook templates (Fase 5)
owner: generated
anchors: []
---

# Livewiki hook templates (Fase 5)

This page documents the opt-in hook templates that ship with the `@livewiki/cli` package and how to install or remove them without changing other repository configuration.

## When to use this page

- Install the **git post-commit hook** so every commit triggers `livewiki index --quiet` and reports any new documentation debt on stderr.
- Install the **Claude Code Stop hook** so each agent session ends with a transcript note about documentation debt.
- Verify hook presence with `git config core.hooksPath` and by validating `.claude/settings.local.json` as JSON.
- Uninstall either hook by reverting the git config (or removing the script) and deleting the Claude settings override.

## How it fits

The `packages/cli/templates` directory holds two opt-in files that delegate detection of documentation debt to existing developer workflows: a `git/post-commit` script and a `claude-code/settings.local.json` hook definition. Neither file is wired up automatically — the README states that livewiki never modifies git or Claude settings on its own, so installation is a deliberate copy/merge step. Both hooks call `livewiki index --quiet` to re-hash the repo and surface `changed/moved/deleted` symbols; they never invoke an LLM and always exit `0`, so they never block a commit or restart an agent.

The templates live alongside the rest of the `@livewiki/cli` package and are referenced by path under `node_modules/@livewiki/cli/templates/...` in the install instructions shown below.

## Git post-commit install

The recommended path uses `core.hooksPath` so the hook does not collide with anything already in `.git/hooks/`:

```bash
mkdir -p .git/hooks-livewiki
cp node_modules/@livewiki/cli/templates/git/post-commit .git/hooks-livewiki/post-commit
chmod +x .git/hooks-livewiki/post-commit
git config core.hooksPath .git/hooks-livewiki
git config core.hooksPath
```

To uninstall, unset the config and remove the custom directory:

```bash
git config --unset core.hooksPath
rm -rf .git/hooks-livewiki
```

If `.git/hooks/` already contains custom hooks and you do not want to change `core.hooksPath`, copy the template directly into `.git/hooks/post-commit` and `chmod +x` it. The README warns that this overwrites any existing `post-commit` script.

## Claude Code Stop hook install

The hook is shipped as `.claude/settings.local.json` (personal, not committed) or as a `hooks` block to merge into `.claude/settings.json` (team-shared):

```bash
mkdir -p .claude
cp node_modules/@livewiki/cli/templates/claude-code/settings.local.json \
   .claude/settings.local.json
```

For the team-shared variant, the README instructs you to add the `hooks` block from the template into your existing `settings.json` by hand. The `Stop` event fires when a Claude Code session ends; the hook's output lands in the agent transcript where the agent can decide to pay the debt before stopping.

To uninstall, delete `.claude/settings.local.json` or remove the `hooks.Stop` block from `settings.json`.

## How detection stays cheap

The README describes `livewiki index --quiet` as a no-token detection step: it re-scans the repo, hashes symbols, and compares against the previous index to flag `changed/moved/deleted`. The cited budget is under 2 seconds for an incremental run on a roughly 50k LOC repository. When new debt is greater than zero, the hook prints a one- or two-line notification; the hooks themselves never pay the debt — payment is left to the `document-as-you-go` skill or the `livewiki_write_doc` MCP tool.

## Privacy and side effects

The README states three explicit guarantees for both hooks:

- They do not read or send API keys.
- They do not call an LLM.
- They do not write outside `.livewiki/`, which the README describes as the derived cache.

These claims are limited to the hooks as documented; treat any extension of the template as out of scope.

## Platform compatibility

The `git/post-commit` template is a bash script. It runs directly on Linux and macOS and via Git Bash on Windows, which is where `git commit` executes hooks on that OS. The `claude-code/settings.local.json` template is JSON that is copied or merged into the user's settings file.

## Debugging

When a hook does not fire, the README offers two checks:

```bash
# git: confirm the config and that the script is executable
git config core.get core.hooksPath
ls -la .git/hooks-livewiki/post-commit
```

For Claude Code, validate the JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json', 'utf8'))"
```

If either hook reports "livewiki not found", the README's remediation is to install the CLI:

```bash
npm install --save-dev @livewiki/cli
# or globally
npm install -g @livewiki/cli
```

<!-- livewiki:navigate:start -->
## Navigate

<!-- livewiki:navigate:end -->
