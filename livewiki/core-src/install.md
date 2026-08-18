---
title: Agent Discovery and Configuration Planning for livewiki Install
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
  - packages/core/src/install.ts#planCredentialStore
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

# Agent Discovery and Install Planning for livewiki

This module implements the `livewiki install` command: it detects installed coding agents, plans configuration writes for each, and applies them safely.

## When to use this page

- Understand how `livewiki install` discovers coding agents on the current machine.
- Learn how the module plans and applies per-agent MCP server config, hook templates, and the shared skill.
- Trace the safety model that refuses to overwrite foreign user config and keeps credential content internal.
- See how dry-run and actual install share one code path, with exact bytes computed upfront.

## How it fits

This file is the engine behind the `livewiki install` CLI action. It sits in the core package, orchestrating agent auto-detection and configuration merging across many different coding-agent config formats. It deliberately avoids the safe-io layer because every write target lives outside the repository (in home directories); instead it computes all writes upfront in a plan. The module composes lower-level helpers: pointer insertion from `pointer.js` and credential-store handling from `credentials.js`. The rest of the package invokes `planInstall` and `applyInstall`; this file defines the full agent registry and the merge adapters that adapt each agent's config shape.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-install.mmd
```

## Agent Registry

<!-- lw:anchors packages/core/src/install.ts#AGENT_REGISTRY packages/core/src/install.ts#getAgentDefinition packages/core/src/install.ts#SHARED_SKILL_TARGET -->

This section defines the core data model of which coding agents livewiki knows how to configure. The registry is a pure, static list; detection and planning logic consume it.

`AGENT_REGISTRY` is a readonly array of `AgentDefinition` objects, one per supported agent (Claude Code, Codex, Cursor, Kimi, Gemini, opencode, OpenClaw, Cline, Kiro, Qwen, Warp, Zed, Hermes). Each definition declares:

- `configProbes` — home-relative paths whose existence proves the agent is installed.
- `binProbes` — binary names probed on the PATH (Windows variants `.cmd`, `.exe`, `.ps1` are included).
- `mcpConfig` — target config path plus a `McpConfigShape` describing how to merge: JSON under a key, opencode's local-command JSON, a Codex TOML delimited block, or a Hermes YAML delimited block.
- optional flags: `hasStopHookTemplate` for Claude Code's Stop hook, and `usesSharedSkills` for agents that scan the shared `~/.agents/skills/` directory.

`getAgentDefinition(id)` looks up an agent by its string id:

```ts
export function getAgentDefinition(id: string): AgentDefinition | undefined {
```

It takes an agent id string and returns the matching definition from the registry, or `undefined` if no such agent exists. Callers use this to guard planning: unknown ids are silently skipped rather than crashing.

`SHARED_SKILL_TARGET` is a constant string:

```ts
export const SHARED_SKILL_TARGET = ".agents/skills/document-as-you-go/SKILL.md";
```

It names the backward-compatible home-relative target where the maintenance skill is installed. Since the skill is shared across agents, this single constant keeps the path consistent.

## Detection

<!-- lw:anchors packages/core/src/install.ts#pathExists packages/core/src/install.ts#detectAgents -->

This section covers how the module determines which agents are actually present on the machine. Detection is purely filesystem-based — no processes are spawned — because probing config files and executables is deterministic and safe on any platform.

`pathExists(abs)` is an async helper:

```ts
async function pathExists(abs: string): Promise<boolean> {
```

It takes an absolute path and returns `true` if a file or directory exists at that path, `false` otherwise (any access error counts as "does not exist").

`detectAgents(opts)` is the top-level detector:

```ts
export async function detectAgents(opts: {
  home: string;
  pathEnv: string;
}): Promise<Record<AgentId, AgentDetection>> {
```

It takes a home directory and the PATH environment string, and returns a record keyed by agent id, each with a `detected` boolean and an `evidence` array explaining hits and misses. The flow:

1. Resolve `home` to an absolute path and split `pathEnv` into non-empty directories.
2. For each agent in `AGENT_REGISTRY`:
   - Check every `configProbe` under `home`; a hit sets `detected` and appends `config found: ~/<probe>`, a miss appends `config missing: ~/<probe>`.
   - Check every `binProbe` against each PATH directory, trying each `BIN_VARIANTS` suffix. A hit records the full candidate path; a miss records the bare binary name.
3. Store the final `{ detected, evidence }` per agent.

## MCP Entry Builders

<!-- lw:anchors packages/core/src/install.ts#buildMcpEntry packages/core/src/install.ts#buildLocalCommandEntry -->

These builders produce the exact MCP server entry that gets merged into each agent's config. They are pure: given a repo root, they return the entry shape without touching disk.

`buildMcpEntry(repoRoot)` returns the standard entry:

```ts
export function buildMcpEntry(repoRoot: string): McpEntry {
```

It takes a repository root path and returns a `McpEntry` with `command: "npx"` and `args: ["-y", "@livewiki/mcp", "--repo", <resolved repoRoot>]`. This is the documented entry for agents like Claude Code, Codex, and Gemini that use a command-plus-args JSON shape.

`buildLocalCommandEntry(repoRoot)` returns the opencode-specific form:

```ts
export function buildLocalCommandEntry(repoRoot: string): LocalCommandMcpEntry {
```

It takes the same repo root and returns a `LocalCommandMcpEntry` with `type: "local"`, a single argv array `["npx", "-y", "@livewiki/mcp", "--repo", <resolved repoRoot>]`, and `enabled: true`. This matches opencode's `{"mcp": {"livewiki": {type: "local", command: [...], enabled: true}}}` shape.

## JSON Merge Helpers and Adapters

<!-- lw:anchors packages/core/src/install.ts#isPlainObject packages/core/src/install.ts#deepEqual packages/core/src/install.ts#stripJsoncComments packages/core/src/install.ts#mergeMcpServersJson packages/core/src/install.ts#mergeClaudeCodeSettings packages/core/src/install.ts#stopEntryCommands -->

This section contains the pure functions that merge the livewiki entry into JSON-based agent configs. These adapters preserve all existing user content and refuse to clobber invalid or foreign data.

`isPlainObject(v)` is a type guard:

```ts
function isPlainObject(v: unknown): v is Record<string, unknown> {
```

It returns `true` if the value is a non-null, non-array object, `false` otherwise. All JSON merge paths use this to validate that parsed configs are objects.

`deepEqual(a, b)` compares two values structurally:

```ts
function deepEqual(a: unknown, b: unknown): boolean {
```

It returns `true` if both are strictly equal, both are arrays of equal length with deeply equal elements, or both are plain objects with equal key sets and deeply equal values. Key order is irrelevant, which makes it safe for idempotence checks.

`stripJsoncComments(text)` removes JSONC comments outside strings:

```ts
export function stripJsoncComments(text: string): string {
```

It takes raw JSONC text and returns plain JSON text. The flow walks the string character by character: inside a quoted string, characters are copied verbatim (including escaped quotes); outside, `//` line comments are dropped to end-of-line and `/* ... */` block comments are dropped while preserving newlines so line numbers survive. This makes opencode's `.jsonc` config parseable.

`mergeMcpServersJson(existing, entry, jsonKey)` merges into a JSON object:

```ts
export function mergeMcpServersJson(
  existing: string | null,
  entry: unknown,
  jsonKey: string = "mcpServers",
): MergeResult
```

It takes the existing file content (or `null`), the new entry object, and the JSON key (defaulting to `"mcpServers"`; zed uses `"context_servers"`, opencode uses `"mcp"`). The flow:

1. If `existing` is non-empty, parse it. A parse failure or a non-object root returns `refuse` with a reason — never overwrites.
2. Check that `obj[jsonKey]` is either absent or a plain object; otherwise refuse.
3. If `livewiki` is already present and deeply equal to `entry`, return `skip` with `"already up to date"`.
4. Otherwise set `servers.livewiki = entry`, write it back, and return `write` with pretty-printed JSON plus a trailing newline.

`stopEntryCommands(entry)` extracts hook commands from a Stop entry:

```ts
function stopEntryCommands(entry: unknown): string[] {
```

It takes an unknown value and returns an array of strings. The flow: if the entry is not a plain object, return `[]`; if its `hooks` field is not an array, return `[]`; otherwise collect every `command` string from each hook object.

`mergeClaudeCodeSettings(existing, templateRaw)` merges the shipped Stop-hook template:

```ts
export function mergeClaudeCodeSettings(
  existing: string | null,
  templateRaw: string,
): MergeResult
```

It takes existing settings content (or `null`) and the raw template JSON, and returns a `MergeResult`. The flow:

1. Parse `templateRaw`. If the template is not a plain object with a `hooks` object containing a non-empty `Stop` array, refuse with a template error.
2. If `existing` is non-empty, parse it. Parse failure or non-object root refuses.
3. Build the current `hooks` object and `Stop` array (defaulting to empty).
4. If any existing Stop hook command contains `"livewiki"`, return `skip` with `"Stop hook already references livewiki"`.
5. Otherwise append the template's Stop entries, write back, and return `write` with pretty-printed JSON plus a newline.

## Managed-Block Renderers and Merger

<!-- lw:anchors packages/core/src/install.ts#TOML_BLOCK_START packages/core/src/install.ts#TOML_BLOCK_END packages/core/src/install.ts#renderTomlManagedBlock packages/core/src/install.ts#renderYamlManagedBlock packages/core/src/install.ts#mergeTomlManagedBlock -->

This section handles agents like Codex (TOML) and Hermes (YAML) whose configs are not parsed. Instead, the module writes a delimited block between stable comment markers and merges it textually.

`TOML_BLOCK_START` and `TOML_BLOCK_END` are the marker constants:

```ts
export const TOML_BLOCK_START = "# livewiki:start";
export const TOML_BLOCK_END = "# livewiki:end";
```

They delimit the managed region in both TOML and YAML configs.

`renderTomlManagedBlock(repoRoot)` builds the Codex block:

```ts
export function renderTomlManagedBlock(repoRoot: string): string {
```

It takes a repo root and returns a multi-line string: the start marker, `[mcp_servers.livewiki]`, `command = 'npx'`, and `args = ['-y', '@livewiki/mcp', '--repo', '<resolved root>']`, then the end marker. TOML single-quoted literals keep Windows paths unescaped.

`renderYamlManagedBlock(repoRoot)` builds the Hermes block:

```ts
export function renderYamlManagedBlock(repoRoot: string): string {
```

It takes a repo root and returns a multi-line YAML block: the start marker, `mcp_servers:`, a `livewiki:` sub-entry with `command: npx` and an `args:` list of single-quoted scalars, then the end marker. YAML single-quoted scalars similarly keep Windows paths literal.

`mergeTomlManagedBlock(existing, block)` merges the block into the file:

```ts
export function mergeTomlManagedBlock(
  existing: string | null,
  block: string,
): MergeResult
```

It takes existing content (or `null`) and the rendered block, and returns a `MergeResult`. The flow:

1. Match both markers with regexes that allow only horizontal whitespace (`[ \t]*`), so the end marker never swallows the trailing newline.
2. If both markers exist and end comes after start, extract the current block. If it equals the rendered block, return `skip` with "managed block already up to date".
3. Otherwise splice the new block in place of the old, preserving everything outside.
4. When no marker pair exists, append the block with a separator that keeps exactly one newline between content and block (empty file gets no leading separator).

## Plan Stages

<!-- lw:anchors packages/core/src/install.ts#readIfExists packages/core/src/install.ts#planMcpConfig packages/core/src/install.ts#planAgentHook packages/core/src/install.ts#planSkill packages/core/src/install.ts#planGitHook packages/core/src/install.ts#planPointer packages/core/src/install.ts#planCredentialStore -->

This section implements the per-action planning logic. Each plan function reads existing files and computes an `InstallAction` — the exact bytes to write, or a skip/refuse status — without mutating disk.

`readIfExists(abs)` is a shared async helper:

```ts
async function readIfExists(abs: string): Promise<string | null> {
```

It takes an absolute path and returns its UTF-8 content as a string, or `null` if the file does not exist or cannot be read.

`planMcpConfig(home, agent, repoRoot)` plans the MCP server entry:

```ts
async function planMcpConfig(
  home: string,
  agent: AgentDefinition,
  repoRoot: string,
): Promise<InstallAction> {
```

It takes the home directory, an agent definition, and the repo root, and returns an `InstallAction` of kind `"mcp-config"`. The flow:

1. Build the absolute target path and read existing content.
2. For JSON shapes, compute the JSON key, strip JSONC comments if the file ends in `.jsonc`, build the appropriate entry (`buildMcpEntry` or `buildLocalCommandEntry`), and call `mergeMcpServersJson`. If the result is `write` and the original file was JSONC with content, append a reason that comments are not preserved.
3. For TOML/YAML shapes, render the block (`renderTomlManagedBlock` or `renderYamlManagedBlock`) and call `mergeTomlManagedBlock`.
4. Return the action with the merged status, content, and reason.

`planAgentHook(home, agent, sources)` plans the Claude Code Stop hook:

```ts
async function planAgentHook(
  home: string,
  agent: AgentDefinition,
  sources: InstallSources,
): Promise<InstallAction | null> {
```

It takes home, an agent, and the shipped sources, and returns an `InstallAction` of kind `"agent-hook"` or `null`. The flow: if the agent has no `hasStopHookTemplate`, return `null`; otherwise read `settings.local.json` and call `mergeClaudeCodeSettings` with the shipped template, returning the resulting action.

`planSkill(home, agents, sources)` plans shared skill copies:

```ts
async function planSkill(
  home: string,
  agents: readonly AgentId[],
  sources: InstallSources,
): Promise<InstallAction[]> {
```

It takes home, the selected agents, and the skill sources, and returns an array of `InstallAction` of kind `"skill"`. The flow:

1. If no selected agent `usesSharedSkills`, return an empty array.
2. Validate each skill name against `SKILL_NAME_RE` (lowercase, hyphen-separated) and reject duplicates with a thrown error.
3. For each skill, read the target `~/.agents/skills/<name>/SKILL.md`. If missing, plan `write`; if byte-identical, plan `skip`; otherwise plan `refuse` with a "different file" reason — never overwrite foreign content.

`planGitHook(repoRoot, sources)` plans the repo-level git post-commit hook:

```ts
async function planGitHook(
  repoRoot: string,
  sources: InstallSources,
): Promise<InstallAction> {
```

It takes the repo root and sources, and returns an `InstallAction` of kind `"git-hook"`. The flow:

1. Stat `.git`; if absent or not a directory, return `skip` with "not a git repository".
2. Read the existing `hooks/post-commit` file.
3. If missing, plan `write` with the shipped template and `executable: true`.
4. If present but does not contain `"livewiki"`, plan `refuse` — a foreign hook must be installed manually.
5. If present and identical to the template, plan `skip`.
6. Otherwise plan `write` with the template, flagged as an update to an existing livewiki hook.

`planPointer(repoRoot, writePointer)` plans the opt-in AGENTS.md/CLAUDE.md pointer:

```ts
async function planPointer(
  repoRoot: string,
  writePointer: boolean,
): Promise<InstallAction> {
```

It takes the repo root and whether the user opted in, and returns an `InstallAction` of kind `"pointer"`. The flow:

1. Call `readPointerStatus(repoRoot)`; if a pointer is already present, return `skip` with the file name.
2. If `writePointer` is false, return `requires-opt-in` with a reason that includes a preview of the pointer block.
3. Otherwise return `write` with `content: null` (the pointer machinery owns the actual bytes) and the block preview as the reason.

`planCredentialStore(home, credential)` plans a credential write:

```ts
function planCredentialStore(
  home: string,
  credential: PlanCredentialInstallOptions["credential"],
): InstallAction {
```

It takes home and a credential object (`envVar` and `value`), and returns an `InstallAction` of kind `"credentials"`. The flow: validate the env-var name and value are non-empty, read the existing credential store synchronously (or default to `{}`), and return a `write` action with the merged JSON, `mode: 0o600`, and `sensitive: true`.

## Plan Orchestration and Apply

<!-- lw:anchors packages/core/src/install.ts#planInstall packages/core/src/install.ts#applyInstall -->

This section ties all planning stages into a single plan and then executes the writable actions. The key invariant: dry-run and real install share one code path, so a dry-run shows the exact bytes that a write would produce.

`planInstall(opts)` is the overloaded orchestrator:

```ts
export function planInstall(opts: PlanInstallOptions): Promise<InstallAction[]>;
export function planInstall(opts: PlanCredentialInstallOptions): Promise<InstallAction[]>;
export async function planInstall(
  opts: PlanInstallOptions | PlanCredentialInstallOptions,
): Promise<InstallAction[]>
```

It takes either a full install options object (repo root, home, agents, sources, optional `writePointer`) or a credential-install options object (repo root, home, credential). The credential form returns a single action from `planCredentialStore`. The full form:

1. Resolve home and repo root to absolute paths.
2. For each selected agent, look up its definition (skip unknowns) and call `planMcpConfig`; then call `planAgentHook` if applicable.
3. Append all `planSkill` results.
4. Append `planGitHook` and `planPointer` results.

`applyInstall(actions, repoRoot)` executes the plan:

```ts
export async function applyInstall(
  actions: readonly InstallAction[],
  repoRoot: string,
): Promise<InstallActionResult[]> {
```

It takes a read-only list of actions and the repo root, and returns per-action results with `applied` and `detail`. The flow:

1. For every action, create a sanitized copy: if `sensitive`, null out `content` so formatters never leak credentials.
2. For non-`write` statuses, report `applied: false` with the reason as detail, without touching disk.
3. For `pointer`, call `insertPointer(repoRoot)` and report whether it changed the file.
4. For `credentials`, delegate to `writeCredentialStoreAtomic` from `credentials.js` instead of the plain write below. The credential store is the one target where a half-written file locks the user out of every provider, so it is replaced through a temp file plus rename rather than truncated in place.
5. For every other `write` action, ensure the parent directory exists, write the exact `action.content` (with an optional POSIX `mode`), then chmod if needed. `executable` forces `0o755` best-effort on Windows.
6. On any write error, report `applied: false` with the error message.

## Tests

Covered by `packages/core/src/install.test.ts` (same-name test file on disk).
