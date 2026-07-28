# Backlog #4 — `livewiki install` (agent auto-detection + merge adapters)

Date: 2026-07-28
Base: `main` @ `81a501b` (pushed; tree clean)
Backlog ref: ROADMAP.md item 4 — "One command that detects installed
coding agents (Claude Code, Codex, Cursor, Zed, ... — start with the
agents already covered by the Phase 5 presets/templates) and offers to
configure, per agent: the MCP server entry, hook templates
(`packages/cli/templates/`), and the AGENTS.md/CLAUDE.md pointer.
Constraints: pointer stays opt-in per rule #2 (explicit flag or
interactive confirmation, never silent); every write outside the repo
allowlist is shown before it happens; idempotent re-run."
Scope confirmed with the maintainer (2026-07-28): registry + merge
adapters + shared skill + EXISTING hook templates + opt-in pointer +
dry-run. NO plugin marketplaces, NO per-host lifecycle hooks.

## Existing pieces to reuse (verified)

- `packages/core/src/pointer.ts` + `commands/pointer.ts` — full opt-in
  pointer machinery (`insertPointer`, `readPointerStatus`, interactive
  confirmation, `--write-pointer`).
- `packages/cli/templates/` — `git/post-commit`, `claude-code/
  settings.local.json`, README; shipped via package.json `files`.
- `packages/cli/skills/document-as-you-go/SKILL.md` — shipped the same
  way; valid for Claude Code, Kimi, Codex (all scan `.agents/skills/`).
- Managed-block idiom from `gitignore.ts` (`# livewiki:start/end`) for
  idempotent text insertion; JSON merge pattern from pointer/status code.
- MCP entry documented in AGENTS.md: `{"command": "npx", "args": ["-y",
  "@livewiki/mcp", "--repo", "<path>"]}`.

## Design

### Core — `packages/core/src/install.ts`

1. **`AGENT_REGISTRY` (pure data)**, per agent: `id`, `displayName`,
   `configProbes` (home-relative paths: `~/.claude`,
   `~/.cursor/mcp.json`, `~/.codex/config.toml`, `~/.gemini/settings.json`,
   `~/.kimi-code/mcp.json`), `binProbes` (`claude`, `cursor`, `codex`,
   `kimi`, `gemini`), `mcpConfig: { path, shape }` where shape is
   `json-mcpServers` (Claude Code `~/.claude.json`, Cursor
   `~/.cursor/mcp.json`, Kimi `~/.kimi-code/mcp.json`, Gemini
   `~/.gemini/settings.json`) or `toml-managed-block` (Codex
   `~/.codex/config.toml`), optional `hookTemplate` (claude-code settings
   merge), `skillTarget` (`~/.agents/skills/` shared — Claude Code, Kimi,
   Codex; and `~/.claude/skills/` for Claude Code).
   v1 agents: `claude-code`, `codex`, `cursor`, `kimi`, `gemini`.
2. **`detectAgents({ home, pathEnv })`** — per entry: config probe hit?
   binary on PATH (scan PATH entries for the binary incl. Windows
   `.cmd/.exe/.ps1` variants — pure fs, no spawn)? Returns per-agent
   `{ detected, evidence: string[] }` — every detection shows WHY (and
   every non-detection too; no silent guessing).
3. **`planInstall(repoRoot, detected, opts)`** — per detected agent, the
   action list: (a) merge MCP entry into its config (JSON merge
   preserving existing servers; TOML managed block for Codex); (b) hook
   template (claude-code settings.local.json merge); (c) skill copy to
   the shared dir; (d) pointer (repo-level, opt-in flow). Each action
   carries the exact target path + the exact bytes/content to write
   (dry-run renders from this — plan and write share ONE code path).
4. **Idempotence**: JSON merge recognizes an existing `mcpServers.livewiki`
   entry (no-op or update-in-place when args changed); TOML managed block
   is replaced between markers; skill copy skips when byte-identical and
   REFUSES with a clear message when a different file already sits at the
   target (never overwrites user content); git post-commit: refuse if a
   non-livewiki hook exists, managed block if ours exists.
5. **Safety**: every write is home-dir outside-repo — the plan prints
   each target path + content diff BEFORE writing; interactive TTY
   confirmation per action class (mcp config / hooks / skill / pointer);
   `--yes` skips prompts (scripting); `--print` = full dry-run, ZERO
   writes; pointer keeps rule #2 (needs `--write-pointer` or interactive
   confirmation even inside install). No `.bak` files (idempotence +
   shown diffs suffice; noted in output).

### CLI — `packages/cli/src/commands/install.ts`

Flags: `--agents <csv>` (explicit subset), `--yes`, `--print`,
`--write-pointer`, `--json`. Registered in `cli.ts`. Human output: a
detection table (agent / detected? / evidence) → plan → confirmation →
per-action result. Exit codes: 0 ok (incl. "nothing to do"), 1 on write
refusal/error, 2 on invalid `--agents` value.

### Tests

`packages/core/src/install.test.ts` (fake home dirs): registry probes
(config-hit, PATH-hit with Windows variants, miss with evidence), JSON
merge preserves existing servers + updates livewiki entry, TOML managed
block idempotent, skill copy skip/refuse paths, git hook never
overwrites foreign hook, plan/write share the same content (dry-run
byte-equality), pointer never writes without opt-in. CLI test: `--print`
writes nothing; `--agents bogus` exits 2.

## Non-goals (maintainer-scoped)

No plugin marketplaces/manifests, no per-host lifecycle hooks beyond the
EXISTING templates (git post-commit + claude-code Stop), no TOML parser
(managed block only), no new agents beyond the v1 five, no config keys.

## Validation gate

`pnpm -r build && pnpm -r test` green; live smoke on THIS machine with
`--print` (shows detected claude/codex/kimi + the plan, zero writes),
then one real `install --agents kimi --yes` into a throwaway HOME
(fixtures) proving idempotent re-run — free, local, no paid calls.
