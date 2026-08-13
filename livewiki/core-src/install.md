---
title: install — agent auto-detection and merge adapters
owner: generated
anchors:
  - packages/core/src/install.ts#AGENT_REGISTRY
  - packages/core/src/install.ts#SHARED_SKILL_TARGET
  - packages/core/src/install.ts#TOML_BLOCK_END
  - packages/core/src/install.ts#TOML_BLOCK_START
  - packages/core/src/install.ts#applyInstall
  - packages/core/src/install.ts#buildLocalCommandEntry
  - packages/core/src/install.ts#buildMcpEntry
  - packages/core/src/install.ts#deepEqual
  - packages/core/src/install.ts#detectAgents
  - packages/core/src/install.ts#getAgentDefinition
  - packages/core/src/install.ts#isPlainObject
  - packages/core/src/install.ts#mergeClaudeCodeSettings
  - packages/core/src/install.ts#mergeMcpServersJson
  - packages/core/src/install.ts#mergeTomlManagedBlock
  - packages/core/src/install.ts#pathExists
  - packages/core/src/install.ts#planAgentHook
  - packages/core/src/install.ts#planGitHook
  - packages/core/src/install.ts#planInstall
  - packages/core/src/install.ts#planMcpConfig
  - packages/core/src/install.ts#planPointer
  - packages/core/src/install.ts#planSkill
  - packages/core/src/install.ts#readIfExists
  - packages/core/src/install.ts#renderTomlManagedBlock
  - packages/core/src/install.ts#renderYamlManagedBlock
  - packages/core/src/install.ts#stopEntryCommands
  - packages/core/src/install.ts#stripJsoncComments
---

# install — agent auto-detection and merge adapters

This module powers `livewiki install`, a single command that detects which coding agents a user has installed and computes the exact bytes needed to register the livewiki MCP server, ship claude-code Stop hooks, copy the shared skill, install the repo-level git post-commit hook, and (opt-in) insert the AGENTS.md pointer.

## When to use this page

- **Run detection over a home directory** to enumerate installed agents with evidence using `detectAgents`.
- **Plan a dry-run install** with `planInstall` to see every write target and the precise bytes before any disk mutation.
- **Apply a plan** with `applyInstall`, which performs only the actions whose status is `"write"` and reports skipped/refused/opt-in actions unchanged.

## How it fits

`install.ts` lives in `packages/core/src/install.ts` and is consumed by the CLI surface — the CLI owns the shipped hook and skill templates (passed in via `InstallSources`) and calls `detectAgents` → `planInstall` → `applyInstall`. The module deliberately bypasses the project's `safe-io` layer because every write target is outside the repo allowlist (home-dir agent configs); instead, planning computes exact byte content up front so a dry-run and a real apply share one code path. Merge adapters are pure functions, detection is pure filesystem probing (no process spawning), and the pointer is gated by an explicit `writePointer` opt-in so interactive confirmation is the only way past rule #2.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-install.mmd
```

## Registry of agents

<!-- lw:anchors packages/core/src/install.ts#AGENT_REGISTRY packages/core/src/install.ts#getAgentDefinition packages/core/src/install.ts#SHARED_SKILL_TARGET -->

The registry is a pure-data table of every supported agent. Each entry declares the home-relative config paths that prove installation, the binary names to probe on `PATH` (Windows variants included), the MCP config location and shape, and two capability flags: `hasStopHookTemplate` (claude-code only) and `usesSharedSkills` (agents that scan the shared `~/.agents/skills/` directory).

```ts
export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  // 13 entries: claude-code, codex, cursor, kimi, gemini, opencode,
  // openclaw, cline, kiro, qwen, warp, zed, hermes — see source.
];
```

`getAgentDefinition` resolves an id back to its row. The shared skill copy lands at the home-relative constant `SHARED_SKILL_TARGET = ".agents/skills/document-as-you-go/SKILL.md"`.

## Detection

<!-- lw:anchors packages/core/src/install.ts#detectAgents packages/core/src/install.ts#pathExists packages/core/src/install.ts#readIfExists -->

```ts
export async function detectAgents(opts: {
  home: string;
  pathEnv: string;
}): Promise<Record<AgentId, AgentDetection>>
```

Detection walks every agent in the registry and accumulates evidence — both hits and misses — so the caller never has to guess why an agent was or was not chosen. For each agent it (a) `pathExists`-checks every `configProbes` entry under `home`, and (b) scans every `PATH` directory for each `binProbes` name, suffixed with `BIN_VARIANTS = ["", ".cmd", ".exe", ".ps1"]` to cover Windows executables. No process is spawned; the function is pure filesystem probing. `pathExists` and `readIfExists` are shared IO helpers — both swallow `node:fs/promises` errors and return `false`/`null` respectively.

## MCP entry builders

<!-- lw:anchors packages/core/src/install.ts#buildMcpEntry packages/core/src/install.ts#buildLocalCommandEntry packages/core/src/install.ts#isPlainObject packages/core/src/install.ts#deepEqual packages/core/src/install.ts#stripJsoncComments -->

```ts
export function buildMcpEntry(repoRoot: string): McpEntry
export function buildLocalCommandEntry(repoRoot: string): LocalCommandMcpEntry
```

`buildMcpEntry` produces the canonical livewiki MCP server (command + args) for agents that take the `{ "<jsonKey>": { "livewiki": { command, args } } }` shape. `buildLocalCommandEntry` produces the opencode local-server form (`type: "local"`, full `command` array, `enabled: true`). Both resolve `repoRoot` so callers don't have to.

`isPlainObject` and `deepEqual` are shared by every JSON merge path: `isPlainObject` accepts only objects that are not arrays and not null; `deepEqual` is order-insensitive over plain objects and arrays and falls back to reference equality otherwise. `stripJsoncComments` removes `//` line and `/* */` block comments outside string literals — the loop tracks string state and preserves `\\` escapes so a `//` inside a quoted string remains data. Newlines inside block comments are kept so line numbers survive a round-trip.

## JSON merge adapter

<!-- lw:anchors packages/core/src/install.ts#mergeMcpServersJson -->

```ts
export function mergeMcpServersJson(
  existing: string | null,
  entry: unknown,
  jsonKey: string = "mcpServers",
): MergeResult
```

This is the merge adapter for `json-mcpServers` (claude-code, cursor, kimi, gemini, openclaw, cline, kiro, qwen, warp, zed uses `context_servers`) and `json-local-command` (opencode uses `mcp`). The function parses existing bytes; if missing or empty the livewiki entry is added under the chosen `jsonKey`. When the same entry already exists (deep equality), the function returns `"skip"`. When the file is unparseable or the existing root is not a JSON object — or the targeted `jsonKey` is occupied by a non-object — it returns `"refuse"` rather than overwriting user content. Otherwise it returns `"write"` with the merged content serialized as pretty JSON plus a trailing newline. The function never silently mutates keys it does not own: unrelated top-level keys are preserved verbatim.

## TOML and YAML managed blocks

<!-- lw:anchors packages/core/src/install.ts#TOML_BLOCK_START packages/core/src/install.ts#TOML_BLOCK_END packages/core/src/install.ts#renderTomlManagedBlock packages/core/src/install.ts#renderYamlManagedBlock packages/core/src/install.ts#mergeTomlManagedBlock -->

```ts
export const TOML_BLOCK_START = "# livewiki:start";
export const TOML_BLOCK_END = "# livewiki:end";
```

For agents that don't speak JSON for MCP, livewiki uses a delimited block — same idiom as `gitignore.ts`. The start and end markers are stable string constants; everything between them belongs to livewiki, everything outside is opaque to the merger. `renderTomlManagedBlock` produces the Codex `config.toml` block using TOML literal strings so Windows paths need no escaping, and `renderYamlManagedBlock` produces the Hermes `config.yaml` block in a deliberately parse-free format (single-quoted scalars keep YAML escape processing out of the picture).

```ts
export function mergeTomlManagedBlock(
  existing: string | null,
  block: string,
): MergeResult
```

`mergeTomlManagedBlock` is the only function that touches these files. It runs two anchored regexes against the existing bytes (`/^#[ \t]*livewiki:start[ \t]*$/m` and the matching end marker). When both anchors match in the correct order, the slice between them is compared byte-for-byte against the freshly rendered block — an exact match returns `"skip"`, a mismatch returns `"write"` with the slice replaced. When no anchors exist, the block is appended with a single-or-double newline separator so the file always ends in a complete managed block followed by a newline. The end-marker regex intentionally matches `[ \t]*` rather than `\s*` so a trailing space never swallows the newline that terminates the block.

## Claude Code Stop-hook merge

<!-- lw:anchors packages/core/src/install.ts#mergeClaudeCodeSettings packages/core/src/install.ts#stopEntryCommands -->

```ts
export function mergeClaudeCodeSettings(
  existing: string | null,
  templateRaw: string,
): MergeResult
```

This adapter merges the shipped `settings.local.json` Stop-hook template into an existing claude-code settings file. The template is `JSON.parse`-d up front — if it has no `hooks` object or no `hooks.Stop` entries, the function refuses (a defensive check, since the template ships with the CLI). Existing settings are parsed the same way as `mergeMcpServersJson`: unparseable input or a non-object root is a refusal, never an overwrite.

The idempotence check walks the existing `hooks.Stop` array via `stopEntryCommands` and returns `"skip"` when any nested entry's `command` string already contains `livewiki`. When the hook is absent, the function appends the template's `hooks.Stop` entries (preserving any unrelated hooks under `hooks` or any other top-level key) and returns `"write"` with the merged object serialized.

## Plan pipeline

<!-- lw:anchors packages/core/src/install.ts#planInstall packages/core/src/install.ts#planMcpConfig packages/core/src/install.ts#planAgentHook packages/core/src/install.ts#planSkill packages/core/src/install.ts#planGitHook packages/core/src/install.ts#planPointer -->

```ts
export async function planInstall(opts: PlanInstallOptions): Promise<InstallAction[]>
```

The plan pipeline is a sequence of pure async functions that produce `InstallAction` records without touching disk beyond the `readIfExists` calls. The orchestrator iterates the caller-selected `agents`, resolving each via `getAgentDefinition`, and for each one runs `planMcpConfig` followed by `planAgentHook` (which returns `null` for agents without `hasStopHookTemplate`). Then the repo-level actions run: `planSkill` once, `planGitHook` once, and `planPointer` once.

Each `plan*` function selects an action status from `{ "write", "skip", "refuse", "requires-opt-in" }` and, when writing, attaches `content: string` with the exact bytes that `applyInstall` will write later. The pointer is the exception: its `content` is always `null` because the pointer machinery in `pointer.ts` owns its own merge/idempotence — the plan encodes its intent through `status` and uses `reason` to carry a preview of `buildPointerBlock()`.

`planSkill` returns `null` when no selected agent has `usesSharedSkills`. When the skill is missing it returns `"write"` with the shipped bytes; when the existing file is byte-identical it returns `"skip"`; when a different file occupies the target it returns `"refuse"` (rule #2 — never overwrite user content).

`planGitHook` checks that `repoRoot/.git` is a directory and returns `"skip"` with reason `"not a git repository (no .git directory)"` if it isn't. When the hook exists and contains "livewiki" but isn't identical to the template it returns `"write"` with reason `"updating existing livewiki hook"`; when the hook exists and does not contain "livewiki" it refuses with a pointer to the manual install instructions; otherwise the hook is freshly written.

`planPointer` asks `readPointerStatus(repoRoot)` whether the pointer is already present. Present → `"skip"`. Absent and `writePointer` false → `"requires-opt-in"` (with the pointer preview in `reason`). Absent and `writePointer` true → `"write"` with the pointer preview in `reason` (content is `null`; `applyInstall` will route this through `insertPointer`).

## Apply pipeline

<!-- lw:anchors packages/core/src/install.ts#applyInstall -->

```ts
export async function applyInstall(
  actions: readonly InstallAction[],
  repoRoot: string,
): Promise<InstallActionResult[]>
```

`applyInstall` is the only place that writes to disk. It iterates the actions and short-circuits anything whose `status` is not `"write"`, reporting it unchanged with the plan's reason as `detail`. Writable actions fall into two branches: the `"pointer"` kind delegates to `insertPointer(repoRoot)` from the pointer module so the same merge/idempotence applies, and every other writable kind uses `node:fs/promises` to `mkdir -p` the target directory and `writeFile` `action.content` verbatim. When `action.executable` is set (the git hook) it `chmod`s the file `0o755`, catching the error so Windows machines silently no-op rather than fail the install. Any thrown error is caught per-action and surfaced as `detail` so a single failure does not abort the whole run.

## Tests

Covered by `packages/core/src/install.test.ts` (same-name test file on disk).
