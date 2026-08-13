/**
 * install — agent auto-detection + merge adapters (`livewiki install`).
 *
 * Backlog #4 (ROADMAP): one command that detects installed coding agents
 * and offers to configure, per agent: the MCP server entry, the existing
 * hook templates, the shared skill, and the opt-in AGENTS.md/CLAUDE.md
 * pointer.
 *
 * Scope (maintainer-confirmed 2026-07-28): registry + merge adapters +
 * shared skill + EXISTING hook templates (git post-commit + claude-code
 * Stop) + opt-in pointer + dry-run. NO plugin marketplaces, NO per-host
 * lifecycle hooks beyond the shipped templates, NO TOML parser (managed
 * block only).
 *
 * Safety model:
 *   - Every write target is OUTSIDE the repo allowlist (home-dir agent
 *     configs), so this module deliberately does NOT go through safe-io —
 *     safe-io only knows repo-internal paths. Instead, `planInstall`
 *     computes every write up front. Non-sensitive actions can be rendered
 *     exactly in dry-run output; credential content remains internal and is
 *     redacted from apply results.
 *   - Never overwrites user content: an existing foreign git hook, an
 *     unparseable JSON config, or a different file at the skill target is
 *     a REFUSAL, not a merge attempt.
 *   - The pointer keeps rule #2: it is only writable when the caller
 *     passes `writePointer: true` (CLI `--write-pointer` or interactive
 *     confirmation). Without it the action is `requires-opt-in` and
 *     `applyInstall` never writes it.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import { insertPointer, readPointerStatus, buildPointerBlock } from "./pointer.js";
import { credentialStorePath, readCredentialStoreSync } from "./credentials.js";

// ── Registry (pure data) ────────────────────────────────────────────────────

export type AgentId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "kimi"
  | "gemini"
  | "opencode"
  | "openclaw"
  | "cline"
  | "kiro"
  | "qwen"
  | "warp"
  | "zed"
  | "hermes";

export type McpConfigShape =
  /** `{"<jsonKey>": {"livewiki": {command, args}}}` — jsonKey defaults to "mcpServers" (zed uses "context_servers"). */
  | "json-mcpServers"
  /** opencode: `{"mcp": {"livewiki": {type: "local", command: [...], enabled: true}}}`. */
  | "json-local-command"
  /** Codex config.toml: delimited block, no TOML parser. */
  | "toml-managed-block"
  /** Hermes config.yaml: delimited block with YAML lines, no YAML parser. */
  | "yaml-managed-block";

export interface AgentDefinition {
  id: AgentId;
  displayName: string;
  /** Home-relative paths whose existence proves installation (e.g. ".claude"). */
  configProbes: readonly string[];
  /** Binary names probed on PATH (Windows variants .cmd/.exe/.ps1 included). */
  binProbes: readonly string[];
  /** Where the MCP server entry lives for this agent. */
  mcpConfig: { path: string; shape: McpConfigShape; jsonKey?: string };
  /** claude-code only: merge the shipped Stop-hook settings template. */
  hasStopHookTemplate?: boolean;
  /** Agents that scan the shared ~/.agents/skills/ directory. */
  usesSharedSkills?: boolean;
}

// NOTE — agents deliberately NOT in this registry:
//   minimax/mmx CLI has NO MCP-server config convention (verified
//   2026-07-28: ~/.mmx/config.json holds only oauth + region). It is an
//   LLM provider (see presets.ts), not an MCP host — there is nothing for
//   `livewiki install` to configure.
export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  {
    id: "claude-code",
    displayName: "Claude Code",
    configProbes: [".claude"],
    binProbes: ["claude"],
    mcpConfig: { path: ".claude.json", shape: "json-mcpServers" },
    hasStopHookTemplate: true,
    usesSharedSkills: true,
  },
  {
    id: "codex",
    displayName: "Codex",
    configProbes: [".codex/config.toml"],
    binProbes: ["codex"],
    mcpConfig: { path: ".codex/config.toml", shape: "toml-managed-block" },
    usesSharedSkills: true,
  },
  {
    id: "cursor",
    displayName: "Cursor",
    configProbes: [".cursor/mcp.json"],
    binProbes: ["cursor"],
    mcpConfig: { path: ".cursor/mcp.json", shape: "json-mcpServers" },
  },
  {
    id: "kimi",
    displayName: "Kimi Code",
    configProbes: [".kimi-code/mcp.json"],
    binProbes: ["kimi"],
    mcpConfig: { path: ".kimi-code/mcp.json", shape: "json-mcpServers" },
    usesSharedSkills: true,
  },
  {
    id: "gemini",
    displayName: "Gemini CLI",
    configProbes: [".gemini/settings.json"],
    binProbes: ["gemini"],
    mcpConfig: { path: ".gemini/settings.json", shape: "json-mcpServers" },
  },
  {
    id: "opencode",
    displayName: "opencode",
    // JSONC: comments are stripped (string-aware) before parsing; a rewrite
    // re-emits plain JSON (comments are lost — surfaced in the action reason).
    configProbes: [".config/opencode/opencode.jsonc"],
    binProbes: ["opencode"],
    mcpConfig: { path: ".config/opencode/opencode.jsonc", shape: "json-local-command", jsonKey: "mcp" },
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    configProbes: [".openclaw/openclaw.json"],
    binProbes: ["openclaw"],
    mcpConfig: { path: ".openclaw/openclaw.json", shape: "json-mcpServers" },
  },
  {
    id: "cline",
    displayName: "Cline",
    configProbes: [".cline/mcp.json"],
    binProbes: ["cline"],
    mcpConfig: { path: ".cline/mcp.json", shape: "json-mcpServers" },
  },
  {
    id: "kiro",
    displayName: "Kiro",
    configProbes: [".kiro/settings/mcp.json"],
    binProbes: ["kiro"],
    mcpConfig: { path: ".kiro/settings/mcp.json", shape: "json-mcpServers" },
  },
  {
    id: "qwen",
    displayName: "Qwen Code",
    configProbes: [".qwen/settings.json"],
    binProbes: ["qwen"],
    mcpConfig: { path: ".qwen/settings.json", shape: "json-mcpServers" },
  },
  {
    id: "warp",
    displayName: "Warp",
    configProbes: [".warp/.mcp.json"],
    binProbes: ["warp"],
    mcpConfig: { path: ".warp/.mcp.json", shape: "json-mcpServers" },
  },
  {
    id: "zed",
    displayName: "Zed",
    configProbes: [".config/zed/settings.json"],
    binProbes: ["zed"],
    mcpConfig: { path: ".config/zed/settings.json", shape: "json-mcpServers", jsonKey: "context_servers" },
  },
  {
    id: "hermes",
    displayName: "Hermes",
    configProbes: [".hermes", ".hermes/config.yaml"],
    binProbes: ["hermes"],
    mcpConfig: { path: ".hermes/config.yaml", shape: "yaml-managed-block" },
  },
];

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.id === id);
}

/** Home-relative target of the shared skill copy. */
export const SHARED_SKILL_TARGET = ".agents/skills/document-as-you-go/SKILL.md";

// ── Detection ───────────────────────────────────────────────────────────────

export interface AgentDetection {
  detected: boolean;
  /** Why the agent was (or was not) detected — hits AND misses. */
  evidence: string[];
}

/** Executable extensions probed after the bare name (Windows variants). */
const BIN_VARIANTS = ["", ".cmd", ".exe", ".ps1"] as const;

async function pathExists(abs: string): Promise<boolean> {
  try {
    await nodeFs.access(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects installed agents. Pure filesystem probing (no spawn): config
 * probes under `home`, binary probes by scanning each `pathEnv` entry for
 * the binary name plus Windows variants. Every agent reports WHY it was
 * detected or not — no silent guessing.
 */
export async function detectAgents(opts: {
  home: string;
  pathEnv: string;
}): Promise<Record<AgentId, AgentDetection>> {
  const home = nodePath.resolve(opts.home);
  const pathDirs = opts.pathEnv
    .split(nodePath.delimiter)
    .map((d) => d.trim())
    .filter((d) => d !== "");

  const result = {} as Record<AgentId, AgentDetection>;
  for (const agent of AGENT_REGISTRY) {
    const evidence: string[] = [];
    let detected = false;

    for (const probe of agent.configProbes) {
      const abs = nodePath.join(home, probe);
      if (await pathExists(abs)) {
        detected = true;
        evidence.push(`config found: ~/${probe}`);
      } else {
        evidence.push(`config missing: ~/${probe}`);
      }
    }

    for (const bin of agent.binProbes) {
      let hit: string | null = null;
      for (const dir of pathDirs) {
        for (const variant of BIN_VARIANTS) {
          const candidate = nodePath.join(dir, bin + variant);
          if (await pathExists(candidate)) {
            hit = candidate;
            break;
          }
        }
        if (hit) break;
      }
      if (hit) {
        detected = true;
        evidence.push(`bin found on PATH: ${bin} (${hit})`);
      } else {
        evidence.push(`bin not found on PATH: ${bin}`);
      }
    }

    result[agent.id] = { detected, evidence };
  }
  return result;
}

// ── MCP entry + merge adapters (pure) ───────────────────────────────────────

export interface McpEntry {
  command: string;
  args: string[];
}

/** The documented MCP server entry (AGENTS.md §"Entry points"). */
export function buildMcpEntry(repoRoot: string): McpEntry {
  return {
    command: "npx",
    args: ["-y", "@livewiki/mcp", "--repo", nodePath.resolve(repoRoot)],
  };
}

/** opencode entry form: local server, command as a single argv array. */
export interface LocalCommandMcpEntry {
  type: "local";
  command: string[];
  enabled: boolean;
}

export function buildLocalCommandEntry(repoRoot: string): LocalCommandMcpEntry {
  return {
    type: "local",
    command: ["npx", "-y", "@livewiki/mcp", "--repo", nodePath.resolve(repoRoot)],
    enabled: true,
  };
}

export type MergeStatus = "write" | "skip" | "refuse";

export interface MergeResult {
  status: MergeStatus;
  /** Exact bytes to write when status === "write"; null otherwise. */
  content: string | null;
  reason?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Strips JSONC comments (`//` line and `/* *​/` block) OUTSIDE string
 * literals — a `//` inside a quoted string is data, not a comment.
 * Newlines inside block comments are preserved so line numbers survive.
 */
export function stripJsoncComments(text: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Merges the livewiki entry into a `{"<jsonKey>": {...}}` JSON config
 * (jsonKey defaults to "mcpServers"; zed uses "context_servers", opencode
 * uses "mcp"). The entry shape is caller-provided (command/args object or
 * opencode local-command object). Preserves existing servers and unrelated
 * keys. No-op when the entry is already identical (deep equality, key
 * order irrelevant); update-in-place when it changed; REFUSES on
 * unparseable or non-object JSON (never clobbers user config).
 */
export function mergeMcpServersJson(
  existing: string | null,
  entry: unknown,
  jsonKey: string = "mcpServers",
): MergeResult {
  let obj: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (!isPlainObject(parsed)) {
        return {
          status: "refuse",
          content: null,
          reason: "existing config is not a JSON object; not overwriting",
        };
      }
      obj = parsed;
    } catch {
      return {
        status: "refuse",
        content: null,
        reason: "existing config is not valid JSON; not overwriting",
      };
    }
  }

  const currentServers = obj[jsonKey];
  if (currentServers !== undefined && !isPlainObject(currentServers)) {
    return {
      status: "refuse",
      content: null,
      reason: `existing "${jsonKey}" is not an object; not overwriting`,
    };
  }
  const servers: Record<string, unknown> = currentServers ?? {};

  if ("livewiki" in servers) {
    if (deepEqual(servers.livewiki, entry)) {
      return {
        status: "skip",
        content: null,
        reason: `${jsonKey}.livewiki already up to date`,
      };
    }
  }
  servers.livewiki = entry;
  obj[jsonKey] = servers;
  return { status: "write", content: JSON.stringify(obj, null, 2) + "\n" };
}

/** Stable markers of the TOML managed block (same idiom as gitignore.ts). */
export const TOML_BLOCK_START = "# livewiki:start";
export const TOML_BLOCK_END = "# livewiki:end";

/**
 * Renders the Codex `config.toml` managed block. TOML literal strings
 * (single quotes) are used so Windows paths need no escaping.
 */
export function renderTomlManagedBlock(repoRoot: string): string {
  const root = nodePath.resolve(repoRoot);
  return [
    TOML_BLOCK_START,
    "[mcp_servers.livewiki]",
    "command = 'npx'",
    `args = ['-y', '@livewiki/mcp', '--repo', '${root}']`,
    TOML_BLOCK_END,
  ].join("\n");
}

/**
 * Renders the Hermes `config.yaml` managed block. No YAML parser by
 * design — the block is plain text between the markers. YAML single-quoted
 * scalars keep Windows paths literal (no escape processing).
 */
export function renderYamlManagedBlock(repoRoot: string): string {
  const root = nodePath.resolve(repoRoot);
  return [
    TOML_BLOCK_START,
    "mcp_servers:",
    "  livewiki:",
    "    command: npx",
    "    args:",
    "      - '-y'",
    "      - '@livewiki/mcp'",
    "      - '--repo'",
    `      - '${root}'`,
    TOML_BLOCK_END,
  ].join("\n");
}

/**
 * Merges the managed block into a TOML/YAML config. No parser by design:
 * only the delimited block is touched, everything else is preserved
 * byte-for-byte. Idempotent — identical block is a no-op.
 */
export function mergeTomlManagedBlock(
  existing: string | null,
  block: string,
): MergeResult {
  // [ \t]* (not \s*): the end marker must not swallow the trailing newline,
  // otherwise the extracted block never compares equal to the rendered one.
  const startRegex = /^#[ \t]*livewiki:start[ \t]*$/m;
  const endRegex = /^#[ \t]*livewiki:end[ \t]*$/m;
  const content = existing ?? "";
  const startMatch = startRegex.exec(content);
  const endMatch = endRegex.exec(content);

  if (startMatch && endMatch && endMatch.index > startMatch.index) {
    const current = content.slice(
      startMatch.index,
      endMatch.index + endMatch[0].length,
    );
    if (current === block) {
      return { status: "skip", content: null, reason: "managed block already up to date" };
    }
    const merged =
      content.slice(0, startMatch.index) +
      block +
      content.slice(endMatch.index + endMatch[0].length);
    return { status: "write", content: merged };
  }

  const sep = content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return { status: "write", content: content + sep + block + "\n" };
}

/** Extracts the nested hook commands of a claude-code settings Stop entry. */
function stopEntryCommands(entry: unknown): string[] {
  if (!isPlainObject(entry)) return [];
  const hooks = entry.hooks;
  if (!Array.isArray(hooks)) return [];
  const commands: string[] = [];
  for (const h of hooks) {
    if (isPlainObject(h) && typeof h.command === "string") {
      commands.push(h.command);
    }
  }
  return commands;
}

/**
 * Merges the shipped claude-code Stop-hook template into a settings JSON
 * file. Idempotent: an existing Stop entry whose command mentions
 * "livewiki" makes this a no-op. All other keys/hooks are preserved.
 * REFUSES on unparseable existing JSON.
 */
export function mergeClaudeCodeSettings(
  existing: string | null,
  templateRaw: string,
): MergeResult {
  const template: unknown = JSON.parse(templateRaw);
  if (!isPlainObject(template) || !isPlainObject(template.hooks)) {
    return { status: "refuse", content: null, reason: "shipped template has no hooks block" };
  }
  const templateStop = template.hooks.Stop;
  if (!Array.isArray(templateStop) || templateStop.length === 0) {
    return { status: "refuse", content: null, reason: "shipped template has no hooks.Stop entries" };
  }

  let obj: Record<string, unknown> = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (!isPlainObject(parsed)) {
        return {
          status: "refuse",
          content: null,
          reason: "existing settings is not a JSON object; not overwriting",
        };
      }
      obj = parsed;
    } catch {
      return {
        status: "refuse",
        content: null,
        reason: "existing settings is not valid JSON; not overwriting",
      };
    }
  }

  const hooks: Record<string, unknown> = isPlainObject(obj.hooks) ? obj.hooks : {};
  const stop: unknown[] = Array.isArray(hooks.Stop) ? hooks.Stop : [];

  const alreadyInstalled = stop.some((entry) =>
    stopEntryCommands(entry).some((cmd) => cmd.includes("livewiki")),
  );
  if (alreadyInstalled) {
    return { status: "skip", content: null, reason: "Stop hook already references livewiki" };
  }

  hooks.Stop = [...stop, ...templateStop];
  obj.hooks = hooks;
  return { status: "write", content: JSON.stringify(obj, null, 2) + "\n" };
}

// ── Plan + apply (ONE code path — dry-run renders the exact bytes) ──────────

export type InstallActionKind =
  | "mcp-config"
  | "agent-hook"
  | "skill"
  | "git-hook"
  | "pointer"
  | "credentials";

export type InstallActionStatus = "write" | "skip" | "refuse" | "requires-opt-in";

export interface InstallAction {
  kind: InstallActionKind;
  /** Present for per-agent actions; absent for repo-level ones. */
  agentId?: AgentId;
  /** Absolute target path (or the pointer target file name for "pointer"). */
  targetPath: string;
  status: InstallActionStatus;
  reason?: string;
  /**
   * Exact bytes to write when status === "write". Null for the pointer
   * (written by the pointer machinery, which merges with the existing
   * file) — `reason` then carries a preview of the block.
   */
  content: string | null;
  /** chmod 0o755 after write (git hook). */
  executable?: boolean;
  /** Exact POSIX file mode to enforce after writing. Ignored on Windows. */
  mode?: number;
  /** Result formatters must never expose content from a sensitive action. */
  sensitive?: boolean;
}

/** Contents of the shipped templates/skill, read by the CLI (its package owns the files). */
export interface InstallSources {
  gitPostCommit: string;
  claudeCodeSettings: string;
  skillDocumentAsYouGo: string;
}

export interface PlanInstallOptions {
  repoRoot: string;
  home: string;
  /** Agents to install for (already detected/selected by the caller). */
  agents: readonly AgentId[];
  sources: InstallSources;
  /** Rule #2 opt-in: without it the pointer action is requires-opt-in. */
  writePointer?: boolean;
}

export interface PlanCredentialInstallOptions {
  repoRoot: string;
  home: string;
  credential: {
    envVar: string;
    value: string;
  };
}

async function readIfExists(abs: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

async function planMcpConfig(
  home: string,
  agent: AgentDefinition,
  repoRoot: string,
): Promise<InstallAction> {
  const targetPath = nodePath.join(home, agent.mcpConfig.path);
  const existing = await readIfExists(targetPath);
  const shape = agent.mcpConfig.shape;
  let merged: MergeResult;
  if (shape === "json-mcpServers" || shape === "json-local-command") {
    const jsonKey = agent.mcpConfig.jsonKey ?? "mcpServers";
    const isJsonc = targetPath.endsWith(".jsonc");
    const parseInput =
      existing !== null && isJsonc ? stripJsoncComments(existing) : existing;
    const entry =
      shape === "json-local-command"
        ? buildLocalCommandEntry(repoRoot)
        : buildMcpEntry(repoRoot);
    merged = mergeMcpServersJson(parseInput, entry, jsonKey);
    if (
      merged.status === "write" &&
      isJsonc &&
      existing !== null &&
      existing.trim() !== ""
    ) {
      merged = {
        ...merged,
        reason: "re-emitted as plain JSON (JSONC comments are not preserved)",
      };
    }
  } else {
    const block =
      shape === "toml-managed-block"
        ? renderTomlManagedBlock(repoRoot)
        : renderYamlManagedBlock(repoRoot);
    merged = mergeTomlManagedBlock(existing, block);
  }
  return {
    kind: "mcp-config",
    agentId: agent.id,
    targetPath,
    status: merged.status,
    content: merged.content,
    ...(merged.reason !== undefined ? { reason: merged.reason } : {}),
  };
}

async function planAgentHook(
  home: string,
  agent: AgentDefinition,
  sources: InstallSources,
): Promise<InstallAction | null> {
  if (!agent.hasStopHookTemplate) return null;
  const targetPath = nodePath.join(home, ".claude", "settings.local.json");
  const existing = await readIfExists(targetPath);
  const merged = mergeClaudeCodeSettings(existing, sources.claudeCodeSettings);
  return {
    kind: "agent-hook",
    agentId: agent.id,
    targetPath,
    status: merged.status,
    content: merged.content,
    ...(merged.reason !== undefined ? { reason: merged.reason } : {}),
  };
}

async function planSkill(
  home: string,
  agents: readonly AgentId[],
  sources: InstallSources,
): Promise<InstallAction | null> {
  if (!agents.some((id) => getAgentDefinition(id)?.usesSharedSkills)) return null;
  const targetPath = nodePath.join(home, SHARED_SKILL_TARGET);
  const existing = await readIfExists(targetPath);
  if (existing === null) {
    return { kind: "skill", targetPath, status: "write", content: sources.skillDocumentAsYouGo };
  }
  if (existing === sources.skillDocumentAsYouGo) {
    return {
      kind: "skill",
      targetPath,
      status: "skip",
      content: null,
      reason: "skill already installed (byte-identical)",
    };
  }
  return {
    kind: "skill",
    targetPath,
    status: "refuse",
    content: null,
    reason: "a different file already occupies the skill target; not overwriting user content",
  };
}

async function planGitHook(
  repoRoot: string,
  sources: InstallSources,
): Promise<InstallAction> {
  const gitDir = nodePath.join(repoRoot, ".git");
  const targetPath = nodePath.join(gitDir, "hooks", "post-commit");
  try {
    const stat = await nodeFs.stat(gitDir);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    return {
      kind: "git-hook",
      targetPath,
      status: "skip",
      content: null,
      reason: "not a git repository (no .git directory)",
    };
  }
  const existing = await readIfExists(targetPath);
  if (existing === null) {
    return { kind: "git-hook", targetPath, status: "write", content: sources.gitPostCommit, executable: true };
  }
  if (!existing.includes("livewiki")) {
    return {
      kind: "git-hook",
      targetPath,
      status: "refuse",
      content: null,
      reason: "a non-livewiki post-commit hook exists; install manually per templates/README.md",
    };
  }
  if (existing === sources.gitPostCommit) {
    return {
      kind: "git-hook",
      targetPath,
      status: "skip",
      content: null,
      reason: "git post-commit hook already up to date",
    };
  }
  return {
    kind: "git-hook",
    targetPath,
    status: "write",
    content: sources.gitPostCommit,
    executable: true,
    reason: "updating existing livewiki hook",
  };
}

async function planPointer(
  repoRoot: string,
  writePointer: boolean,
): Promise<InstallAction> {
  const status = await readPointerStatus(repoRoot);
  if (status.present) {
    return {
      kind: "pointer",
      targetPath: nodePath.join(repoRoot, status.file ?? "AGENTS.md"),
      status: "skip",
      content: null,
      reason: `pointer already present in ${status.file}`,
    };
  }
  if (!writePointer) {
    return {
      kind: "pointer",
      targetPath: nodePath.join(repoRoot, "AGENTS.md"),
      status: "requires-opt-in",
      content: null,
      reason:
        "rule #2: pointer needs --write-pointer or interactive confirmation.\n" +
        buildPointerBlock(),
    };
  }
  return {
    kind: "pointer",
    targetPath: nodePath.join(repoRoot, "AGENTS.md"),
    status: "write",
    content: null,
    reason: buildPointerBlock(),
  };
}

function planCredentialStore(
  home: string,
  credential: PlanCredentialInstallOptions["credential"],
): InstallAction {
  if (credential.envVar.trim() === "" || credential.value.length === 0) {
    throw new Error("Credential env-var name and value must be non-empty.");
  }
  const targetPath = credentialStorePath(home);
  const existing = readCredentialStoreSync(home) ?? {};
  return {
    kind: "credentials",
    targetPath,
    status: "write",
    content: JSON.stringify(
      { ...existing, [credential.envVar]: credential.value },
      null,
      2,
    ) + "\n",
    mode: 0o600,
    sensitive: true,
  };
}

/**
 * Computes the full install plan: per-agent MCP config merge, claude-code
 * Stop hook, shared skill copy (deduped), repo-level git hook and opt-in
 * pointer. Each writable action carries the EXACT bytes that
 * `applyInstall` will write — dry-run and write share one code path.
 */
export function planInstall(opts: PlanInstallOptions): Promise<InstallAction[]>;
export function planInstall(opts: PlanCredentialInstallOptions): Promise<InstallAction[]>;
export async function planInstall(
  opts: PlanInstallOptions | PlanCredentialInstallOptions,
): Promise<InstallAction[]> {
  const home = nodePath.resolve(opts.home);
  const repoRoot = nodePath.resolve(opts.repoRoot);
  if ("credential" in opts) {
    return [planCredentialStore(home, opts.credential)];
  }
  const actions: InstallAction[] = [];

  for (const id of opts.agents) {
    const agent = getAgentDefinition(id);
    if (!agent) continue;
    actions.push(await planMcpConfig(home, agent, repoRoot));
    const hook = await planAgentHook(home, agent, opts.sources);
    if (hook) actions.push(hook);
  }

  const skill = await planSkill(home, opts.agents, opts.sources);
  if (skill) actions.push(skill);

  actions.push(await planGitHook(repoRoot, opts.sources));
  actions.push(await planPointer(repoRoot, Boolean(opts.writePointer)));

  return actions;
}

export interface InstallActionResult {
  action: InstallAction;
  applied: boolean;
  detail?: string;
}

/**
 * Executes the writable actions of a plan. Skip/refuse/requires-opt-in
 * actions are reported unchanged — only `status === "write"` touches
 * disk, and it writes exactly `action.content`. The pointer goes through
 * the pointer machinery (its own merge/idempotence, rule #2 already
 * enforced by the plan status).
 */
export async function applyInstall(
  actions: readonly InstallAction[],
  repoRoot: string,
): Promise<InstallActionResult[]> {
  const results: InstallActionResult[] = [];
  for (const action of actions) {
    const resultAction = action.sensitive ? { ...action, content: null } : action;
    if (action.status !== "write") {
      results.push({ action: resultAction, applied: false, ...(action.reason !== undefined ? { detail: action.reason } : {}) });
      continue;
    }
    try {
      if (action.kind === "pointer") {
        const res = await insertPointer(repoRoot);
        results.push({ action: resultAction, applied: res.action !== "unchanged", detail: `pointer ${res.action} in ${res.file}` });
        continue;
      }
      if (action.content === null) {
        results.push({ action: resultAction, applied: false, detail: "internal: writable action without content" });
        continue;
      }
      await nodeFs.mkdir(nodePath.dirname(action.targetPath), { recursive: true });
      await nodeFs.writeFile(action.targetPath, action.content, {
        encoding: "utf8",
        ...(action.mode !== undefined ? { mode: action.mode } : {}),
      });
      if (action.mode !== undefined && process.platform !== "win32") {
        await nodeFs.chmod(action.targetPath, action.mode);
      }
      if (action.executable) {
        // Best-effort on Windows (no-op semantics there); required on Unix.
        await nodeFs.chmod(action.targetPath, 0o755).catch(() => undefined);
      }
      results.push({ action: resultAction, applied: true, detail: `wrote ${action.targetPath}` });
    } catch (err) {
      results.push({ action: resultAction, applied: false, detail: `error: ${(err as Error).message}` });
    }
  }
  return results;
}
