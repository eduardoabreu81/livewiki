import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  AGENT_REGISTRY,
  buildMcpEntry,
  buildLocalCommandEntry,
  detectAgents,
  mergeMcpServersJson,
  mergeTomlManagedBlock,
  renderTomlManagedBlock,
  renderYamlManagedBlock,
  stripJsoncComments,
  mergeClaudeCodeSettings,
  planInstall,
  applyInstall,
  SHARED_SKILL_TARGET,
  type AgentId,
  type InstallSources,
} from "./install.js";

const FAKE_DOCUMENT_SKILL = "---\nname: document-as-you-go\n---\nfake maintenance skill\n";
const FAKE_BOOTSTRAP_SKILL = "---\nname: bootstrap-wiki\n---\nfake bootstrap skill\n";
const FAKE_GIT_HOOK = "#!/usr/bin/env bash\n# livewiki post-commit hook (template)\nexit 0\n";
const FAKE_CLAUDE_SETTINGS = JSON.stringify({
  hooks: {
    Stop: [
      {
        hooks: [{ type: "command", command: "bash -c 'livewiki index --quiet; exit 0'" }],
      },
    ],
  },
});

const SOURCES: InstallSources = {
  gitPostCommit: FAKE_GIT_HOOK,
  claudeCodeSettings: FAKE_CLAUDE_SETTINGS,
  skills: [
    { name: "document-as-you-go", content: FAKE_DOCUMENT_SKILL },
    { name: "bootstrap-wiki", content: FAKE_BOOTSTRAP_SKILL },
  ],
};

let home: string;
let repoRoot: string;

beforeEach(async () => {
  home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-install-home-"));
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-install-repo-"));
});

afterEach(async () => {
  await nodeFs.rm(home, { recursive: true, force: true });
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeHome(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(home, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

describe("install.AGENT_REGISTRY", () => {
  it("contains exactly the 13 registered agents", () => {
    expect(AGENT_REGISTRY.map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "kimi",
      "gemini",
      "opencode",
      "openclaw",
      "cline",
      "kiro",
      "qwen",
      "warp",
      "zed",
      "hermes",
    ]);
  });

  it("does NOT register minimax/mmx (provider, not an MCP host)", () => {
    expect(AGENT_REGISTRY.some((a) => a.id.includes("mmx") || a.id.includes("minimax"))).toBe(false);
  });
});

describe("install.detectAgents", () => {
  it("detects via config probe with evidence", async () => {
    await nodeFs.mkdir(nodePath.join(home, ".claude"), { recursive: true });
    const result = await detectAgents({ home, pathEnv: "" });
    expect(result["claude-code"].detected).toBe(true);
    expect(result["claude-code"].evidence).toContain("config found: ~/.claude");
  });

  it("detects via PATH probe including Windows variants", async () => {
    const binDir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-install-bin-"));
    try {
      await nodeFs.writeFile(nodePath.join(binDir, "kimi.cmd"), "@echo off\r\n", "utf8");
      const result = await detectAgents({ home, pathEnv: binDir });
      expect(result.kimi.detected).toBe(true);
      const binEvidence = result.kimi.evidence.find((e) => e.startsWith("bin found on PATH"));
      expect(binEvidence).toBeDefined();
      expect(binEvidence).toContain("kimi.cmd");
    } finally {
      await nodeFs.rm(binDir, { recursive: true, force: true });
    }
  });

  it("reports miss evidence for undetected agents", async () => {
    const result = await detectAgents({ home, pathEnv: "" });
    expect(result.gemini.detected).toBe(false);
    expect(result.gemini.evidence).toContain("config missing: ~/.gemini/settings.json");
    expect(result.gemini.evidence).toContain("bin not found on PATH: gemini");
  });
});

describe("install.mergeMcpServersJson", () => {
  // Pure merge tests — a fixed root keeps them independent of the tmp fixtures.
  const entry = buildMcpEntry("fake-repo-root");

  it("creates mcpServers from scratch", () => {
    const r = mergeMcpServersJson(null, entry);
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.mcpServers.livewiki).toEqual(entry);
  });

  it("preserves existing servers and unrelated keys", () => {
    const existing = JSON.stringify({
      theme: "dark",
      mcpServers: { other: { command: "node", args: ["server.js"] } },
    });
    const r = mergeMcpServersJson(existing, entry);
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: ["server.js"] });
    expect(parsed.mcpServers.livewiki).toEqual(entry);
  });

  it("no-op when the livewiki entry is identical", () => {
    const existing = JSON.stringify({ mcpServers: { livewiki: entry } });
    const r = mergeMcpServersJson(existing, entry);
    expect(r.status).toBe("skip");
    expect(r.content).toBeNull();
  });

  it("updates in place when args changed", () => {
    const existing = JSON.stringify({
      mcpServers: {
        livewiki: { command: "npx", args: ["-y", "@livewiki/mcp", "--repo", "/old/path"] },
        other: { command: "node", args: [] },
      },
    });
    const r = mergeMcpServersJson(existing, entry);
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.mcpServers.livewiki.args).toEqual(entry.args);
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: [] });
  });

  it("refuses on invalid JSON (never clobbers)", () => {
    const r = mergeMcpServersJson("{ not json", entry);
    expect(r.status).toBe("refuse");
    expect(r.content).toBeNull();
  });

  it("refuses when mcpServers is not an object", () => {
    const r = mergeMcpServersJson(JSON.stringify({ mcpServers: "oops" }), entry);
    expect(r.status).toBe("refuse");
  });
});

describe("install.mergeTomlManagedBlock", () => {
  const block = renderTomlManagedBlock("fake-repo-root");

  it("contains the managed markers and the MCP entry", () => {
    expect(block).toContain("# livewiki:start");
    expect(block).toContain("# livewiki:end");
    expect(block).toContain("[mcp_servers.livewiki]");
    expect(block).toContain("@livewiki/mcp");
  });

  it("appends to an existing config preserving user content", () => {
    const existing = 'model = "gpt-5"\n';
    const r = mergeTomlManagedBlock(existing, block);
    expect(r.status).toBe("write");
    expect(r.content!.startsWith(existing)).toBe(true);
    expect(r.content).toContain(block);
  });

  it("is idempotent — second merge is a skip", () => {
    const first = mergeTomlManagedBlock(null, block);
    expect(first.status).toBe("write");
    const second = mergeTomlManagedBlock(first.content, block);
    expect(second.status).toBe("skip");
    expect(second.content).toBeNull();
  });

  it("replaces only the block, preserving content around it", () => {
    const oldBlock = "# livewiki:start\nold = true\n# livewiki:end";
    const existing = `before = 1\n\n${oldBlock}\n\nafter = 2\n`;
    const r = mergeTomlManagedBlock(existing, block);
    expect(r.status).toBe("write");
    expect(r.content).toContain("before = 1");
    expect(r.content).toContain("after = 2");
    expect(r.content).not.toContain("old = true");
    expect(r.content).toContain(block);
  });
});

describe("install.mergeClaudeCodeSettings", () => {
  it("adds the Stop hook to an empty settings file", () => {
    const r = mergeClaudeCodeSettings(null, FAKE_CLAUDE_SETTINGS);
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.hooks.Stop).toHaveLength(1);
  });

  it("preserves existing keys and hooks", () => {
    const existing = JSON.stringify({
      model: "opus",
      hooks: { PreToolUse: [{ matcher: "x" }] },
    });
    const r = mergeClaudeCodeSettings(existing, FAKE_CLAUDE_SETTINGS);
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.model).toBe("opus");
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
    expect(parsed.hooks.Stop).toHaveLength(1);
  });

  it("is idempotent when a livewiki Stop hook already exists", () => {
    const first = mergeClaudeCodeSettings(null, FAKE_CLAUDE_SETTINGS);
    const second = mergeClaudeCodeSettings(first.content, FAKE_CLAUDE_SETTINGS);
    expect(second.status).toBe("skip");
    expect(second.content).toBeNull();
  });

  it("refuses on invalid existing JSON", () => {
    const r = mergeClaudeCodeSettings("{ broken", FAKE_CLAUDE_SETTINGS);
    expect(r.status).toBe("refuse");
  });
});

describe("install.planInstall + applyInstall", () => {
  it("git hook: writes when absent, refuses a foreign hook, never overwrites it", async () => {
    // Not a git repo yet → skip
    let plan = await planInstall({ repoRoot, home, agents: [], sources: SOURCES });
    const skipAction = plan.find((a) => a.kind === "git-hook")!;
    expect(skipAction.status).toBe("skip");
    expect(skipAction.reason).toMatch(/not a git repository/);

    // Git repo, no hook → write
    await nodeFs.mkdir(nodePath.join(repoRoot, ".git", "hooks"), { recursive: true });
    plan = await planInstall({ repoRoot, home, agents: [], sources: SOURCES });
    const writeAction = plan.find((a) => a.kind === "git-hook")!;
    expect(writeAction.status).toBe("write");
    expect(writeAction.content).toBe(FAKE_GIT_HOOK);

    // Foreign hook → refuse, content untouched after apply
    const hookPath = nodePath.join(repoRoot, ".git", "hooks", "post-commit");
    await nodeFs.writeFile(hookPath, "#!/bin/sh\necho foreign\n", "utf8");
    plan = await planInstall({ repoRoot, home, agents: [], sources: SOURCES });
    const refuseAction = plan.find((a) => a.kind === "git-hook")!;
    expect(refuseAction.status).toBe("refuse");
    await applyInstall(plan, repoRoot);
    expect(await nodeFs.readFile(hookPath, "utf8")).toBe("#!/bin/sh\necho foreign\n");

    // Our hook, byte-identical → skip
    await nodeFs.writeFile(hookPath, FAKE_GIT_HOOK, "utf8");
    plan = await planInstall({ repoRoot, home, agents: [], sources: SOURCES });
    expect(plan.find((a) => a.kind === "git-hook")!.status).toBe("skip");
  });

  it("skills: writes both, skips byte-identical, and refuses a different file without merging", async () => {
    const documentSkillPath = nodePath.join(home, SHARED_SKILL_TARGET);
    const bootstrapSkillPath = nodePath.join(
      home,
      ".agents",
      "skills",
      "bootstrap-wiki",
      "SKILL.md",
    );

    let plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    const writes = plan.filter((a) => a.kind === "skill");
    expect(writes).toHaveLength(2);
    expect(writes.every((action) => action.status === "write")).toBe(true);
    await applyInstall(plan, repoRoot);
    expect(await nodeFs.readFile(documentSkillPath, "utf8")).toBe(FAKE_DOCUMENT_SKILL);
    expect(await nodeFs.readFile(bootstrapSkillPath, "utf8")).toBe(FAKE_BOOTSTRAP_SKILL);

    plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    expect(plan.filter((a) => a.kind === "skill").map((a) => a.status)).toEqual([
      "skip",
      "skip",
    ]);

    await nodeFs.writeFile(bootstrapSkillPath, "user customizations\n", "utf8");
    plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    const refuse = plan.find(
      (a) => a.kind === "skill" && a.targetPath === bootstrapSkillPath,
    )!;
    expect(refuse.status).toBe("refuse");
    expect(refuse.reason).toMatch(/not overwriting user content/);
    await applyInstall(plan, repoRoot);
    expect(await nodeFs.readFile(bootstrapSkillPath, "utf8")).toBe("user customizations\n");
    expect(await nodeFs.readFile(documentSkillPath, "utf8")).toBe(FAKE_DOCUMENT_SKILL);
  });

  it("skill actions are deduped across agents and only planned for shared-skill agents", async () => {
    const plan = await planInstall({
      repoRoot,
      home,
      agents: ["claude-code", "codex", "kimi"],
      sources: SOURCES,
    });
    const skillActions = plan.filter((a) => a.kind === "skill");
    expect(skillActions).toHaveLength(2);
    expect(new Set(skillActions.map((action) => action.targetPath)).size).toBe(2);

    const none = await planInstall({ repoRoot, home, agents: ["cursor", "gemini"], sources: SOURCES });
    expect(none.filter((a) => a.kind === "skill")).toHaveLength(0);
  });

  it("pointer: requires opt-in even inside install; applyInstall never writes it without it", async () => {
    const plan = await planInstall({
      repoRoot,
      home,
      agents: [],
      sources: SOURCES,
      writePointer: false,
    });
    const pointer = plan.find((a) => a.kind === "pointer")!;
    expect(pointer.status).toBe("requires-opt-in");
    const results = await applyInstall(plan, repoRoot);
    expect(results.find((r) => r.action.kind === "pointer")!.applied).toBe(false);
    // No AGENTS.md/CLAUDE.md created
    await expect(nodeFs.access(nodePath.join(repoRoot, "AGENTS.md"))).rejects.toThrow();
    await expect(nodeFs.access(nodePath.join(repoRoot, "CLAUDE.md"))).rejects.toThrow();
  });

  it("pointer: writes with explicit opt-in, skips when already present", async () => {
    let plan = await planInstall({
      repoRoot,
      home,
      agents: [],
      sources: SOURCES,
      writePointer: true,
    });
    expect(plan.find((a) => a.kind === "pointer")!.status).toBe("write");
    await applyInstall(plan, repoRoot);
    const agentsMd = await nodeFs.readFile(nodePath.join(repoRoot, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("<!-- livewiki:start -->");

    plan = await planInstall({ repoRoot, home, agents: [], sources: SOURCES, writePointer: true });
    expect(plan.find((a) => a.kind === "pointer")!.status).toBe("skip");
  });

  it("dry-run byte-equality: planned content is exactly what gets written", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".git", "hooks"), { recursive: true });
    await writeHome(".cursor/mcp.json", JSON.stringify({ mcpServers: {} }));
    await writeHome(".codex/config.toml", 'model = "gpt-5"\n');

    const plan = await planInstall({
      repoRoot,
      home,
      agents: ["claude-code", "codex", "cursor", "kimi", "gemini"],
      sources: SOURCES,
    });
    const writable = plan.filter((a) => a.status === "write" && a.kind !== "pointer");
    expect(writable.length).toBeGreaterThan(0);

    await applyInstall(plan, repoRoot);
    for (const action of writable) {
      const onDisk = await nodeFs.readFile(action.targetPath, "utf8");
      expect(onDisk, `bytes differ for ${action.kind} ${action.targetPath}`).toBe(action.content);
    }

    // Full re-run: everything converges to skip (idempotent install)
    const second = await planInstall({
      repoRoot,
      home,
      agents: ["claude-code", "codex", "cursor", "kimi", "gemini"],
      sources: SOURCES,
    });
    for (const a of second) {
      expect(a.status, `second run should not rewrite ${a.kind} ${a.targetPath}`).not.toBe("write");
    }
  });

  it("claude-code gets mcp config + agent hook; other agents only mcp config", async () => {
    const plan = await planInstall({
      repoRoot,
      home,
      agents: ["claude-code", "gemini"],
      sources: SOURCES,
    });
    const claudeKinds = plan.filter((a) => a.agentId === "claude-code").map((a) => a.kind);
    expect(claudeKinds.sort()).toEqual(["agent-hook", "mcp-config"]);
    const geminiKinds = plan.filter((a) => a.agentId === "gemini").map((a) => a.kind);
    expect(geminiKinds).toEqual(["mcp-config"]);
    // agent hook target is the claude settings.local.json
    const hook = plan.find((a) => a.kind === "agent-hook")!;
    expect(hook.targetPath).toBe(nodePath.join(home, ".claude", "settings.local.json"));
  });
});

// ── Broader agent coverage (maintainer follow-up, 2026-07-28) ───────────────

describe("install.stripJsoncComments", () => {
  it("strips // line comments outside strings", () => {
    const input = '{\n  // a comment\n  "a": 1 // trailing\n}\n';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
  });

  it("strips /* */ block comments outside strings", () => {
    const input = '{ /* multi\nline\ncomment */ "a": 1 }';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
  });

  it("does NOT strip // inside quoted strings", () => {
    const input = '{"url": "https://example.com//path", "b": "/* not a comment */"}';
    const parsed = JSON.parse(stripJsoncComments(input));
    expect(parsed.url).toBe("https://example.com//path");
    expect(parsed.b).toBe("/* not a comment */");
  });

  it("handles escaped quotes inside strings", () => {
    const input = '{"a": "quote \\" // not comment", "b": 1}';
    const parsed = JSON.parse(stripJsoncComments(input));
    expect(parsed.a).toBe('quote " // not comment');
  });

  it("plain JSON passes through unchanged semantically", () => {
    const input = '{"mcp": {"x": [1, 2]}}';
    expect(JSON.parse(stripJsoncComments(input))).toEqual({ mcp: { x: [1, 2] } });
  });
});

describe("install.mergeMcpServersJson — jsonKey variant (zed)", () => {
  const entry = buildMcpEntry("fake-repo-root");

  it("writes under context_servers, not mcpServers", () => {
    const r = mergeMcpServersJson(null, entry, "context_servers");
    expect(r.status).toBe("write");
    const parsed = JSON.parse(r.content!);
    expect(parsed.context_servers.livewiki).toEqual(entry);
    expect(parsed.mcpServers).toBeUndefined();
  });

  it("preserves existing context_servers entries, skips when identical", () => {
    const existing = JSON.stringify({
      context_servers: { other: { command: "x", args: [] } },
    });
    const first = mergeMcpServersJson(existing, entry, "context_servers");
    expect(first.status).toBe("write");
    const parsed = JSON.parse(first.content!);
    expect(parsed.context_servers.other).toEqual({ command: "x", args: [] });

    const second = mergeMcpServersJson(first.content, entry, "context_servers");
    expect(second.status).toBe("skip");
  });

  it("refuses when context_servers is not an object", () => {
    const r = mergeMcpServersJson(
      JSON.stringify({ context_servers: [1, 2] }),
      entry,
      "context_servers",
    );
    expect(r.status).toBe("refuse");
    expect(r.reason).toContain("context_servers");
  });
});

describe("install — opencode (json-local-command + JSONC)", () => {
  it("entry form is exact: type local, command argv array, enabled", () => {
    const entry = buildLocalCommandEntry(repoRoot);
    expect(entry).toEqual({
      type: "local",
      command: ["npx", "-y", "@livewiki/mcp", "--repo", nodePath.resolve(repoRoot)],
      enabled: true,
    });
  });

  it("plan writes the mcp.livewiki entry under the mcp key", async () => {
    const plan = await planInstall({ repoRoot, home, agents: ["opencode"], sources: SOURCES });
    const action = plan.find((a) => a.kind === "mcp-config")!;
    expect(action.targetPath).toBe(
      nodePath.join(home, ".config", "opencode", "opencode.jsonc"),
    );
    expect(action.status).toBe("write");
    const parsed = JSON.parse(action.content!);
    expect(parsed.mcp.livewiki).toEqual(buildLocalCommandEntry(repoRoot));
  });

  it("parses an existing JSONC file with comments and preserves other keys", async () => {
    const existing = [
      "{",
      '  "$schema": "https://opencode.ai/config.json",',
      "  // user comment",
      '  "model": "anthropic/claude-sonnet-4",',
      '  "mcp": { /* inline */ "other": { "type": "local", "command": ["x"], "enabled": true } }',
      "}",
    ].join("\n");
    await writeHome(".config/opencode/opencode.jsonc", existing);

    const plan = await planInstall({ repoRoot, home, agents: ["opencode"], sources: SOURCES });
    const action = plan.find((a) => a.kind === "mcp-config")!;
    expect(action.status).toBe("write");
    expect(action.reason).toMatch(/comments are not preserved/);
    const parsed = JSON.parse(action.content!);
    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
    expect(parsed.model).toBe("anthropic/claude-sonnet-4");
    expect(parsed.mcp.other).toEqual({ type: "local", command: ["x"], enabled: true });
    expect(parsed.mcp.livewiki).toEqual(buildLocalCommandEntry(repoRoot));
  });

  it("skip when the entry is already installed (comments preserved, no rewrite)", async () => {
    const installed = JSON.stringify({ mcp: { livewiki: buildLocalCommandEntry(repoRoot) } }, null, 2);
    await writeHome(".config/opencode/opencode.jsonc", `// keep me\n${installed}\n`);
    const plan = await planInstall({ repoRoot, home, agents: ["opencode"], sources: SOURCES });
    const action = plan.find((a) => a.kind === "mcp-config")!;
    expect(action.status).toBe("skip");
    await applyInstall(plan, repoRoot);
    const onDisk = await nodeFs.readFile(
      nodePath.join(home, ".config", "opencode", "opencode.jsonc"),
      "utf8",
    );
    expect(onDisk).toContain("// keep me");
  });

  it("refuses on unparseable JSONC", async () => {
    await writeHome(".config/opencode/opencode.jsonc", "{ not jsonc at all");
    const plan = await planInstall({ repoRoot, home, agents: ["opencode"], sources: SOURCES });
    expect(plan.find((a) => a.kind === "mcp-config")!.status).toBe("refuse");
  });
});

describe("install — standard mcpServers agents (openclaw, cline, kiro, qwen, warp)", () => {
  const cases: Array<[string, string]> = [
    ["openclaw", ".openclaw/openclaw.json"],
    ["cline", ".cline/mcp.json"],
    ["kiro", ".kiro/settings/mcp.json"],
    ["qwen", ".qwen/settings.json"],
    ["warp", ".warp/.mcp.json"],
  ];

  it("per-agent target paths and exact entry content", async () => {
    for (const [agentId, rel] of cases) {
      const plan = await planInstall({
        repoRoot,
        home,
        agents: [agentId as AgentId],
        sources: SOURCES,
      });
      const action = plan.find((a) => a.kind === "mcp-config")!;
      expect(action.targetPath, agentId).toBe(nodePath.join(home, ...rel.split("/")));
      expect(action.status, agentId).toBe("write");
      const parsed = JSON.parse(action.content!);
      expect(parsed.mcpServers.livewiki, agentId).toEqual(buildMcpEntry(repoRoot));
    }
  });

  it("refuse-on-foreign (invalid JSON) for each", async () => {
    for (const [agentId, rel] of cases) {
      await writeHome(rel, "{ broken");
      const plan = await planInstall({
        repoRoot,
        home,
        agents: [agentId as AgentId],
        sources: SOURCES,
      });
      expect(plan.find((a) => a.kind === "mcp-config")!.status, agentId).toBe("refuse");
    }
  });
});

describe("install — zed (context_servers) end to end", () => {
  it("writes context_servers.livewiki and is idempotent", async () => {
    await writeHome(
      ".config/zed/settings.json",
      JSON.stringify({ theme: "One Dark", context_servers: {} }),
    );
    let plan = await planInstall({ repoRoot, home, agents: ["zed"], sources: SOURCES });
    const action = plan.find((a) => a.kind === "mcp-config")!;
    expect(action.status).toBe("write");
    const parsed = JSON.parse(action.content!);
    expect(parsed.theme).toBe("One Dark");
    expect(parsed.context_servers.livewiki).toEqual(buildMcpEntry(repoRoot));

    await applyInstall(plan, repoRoot);
    plan = await planInstall({ repoRoot, home, agents: ["zed"], sources: SOURCES });
    expect(plan.find((a) => a.kind === "mcp-config")!.status).toBe("skip");
  });
});

describe("install — hermes (yaml-managed-block)", () => {
  it("block body is exact YAML lines between the markers", () => {
    const block = renderYamlManagedBlock(repoRoot);
    const expected = [
      "# livewiki:start",
      "mcp_servers:",
      "  livewiki:",
      "    command: npx",
      "    args:",
      "      - '-y'",
      "      - '@livewiki/mcp'",
      "      - '--repo'",
      `      - '${nodePath.resolve(repoRoot)}'`,
      "# livewiki:end",
    ].join("\n");
    expect(block).toBe(expected);
  });

  it("plan targets ~/.hermes/config.yaml, merges idempotently", async () => {
    await writeHome(".hermes/config.yaml", "other_key: true\n");
    let plan = await planInstall({ repoRoot, home, agents: ["hermes"], sources: SOURCES });
    const action = plan.find((a) => a.kind === "mcp-config")!;
    expect(action.targetPath).toBe(nodePath.join(home, ".hermes", "config.yaml"));
    expect(action.status).toBe("write");
    expect(action.content!.startsWith("other_key: true\n")).toBe(true);
    expect(action.content).toContain(renderYamlManagedBlock(repoRoot));

    await applyInstall(plan, repoRoot);
    plan = await planInstall({ repoRoot, home, agents: ["hermes"], sources: SOURCES });
    expect(plan.find((a) => a.kind === "mcp-config")!.status).toBe("skip");
  });
});

describe("install — new agents share v1 semantics", () => {
  it("detection: config probe hit and miss evidence for new agents", async () => {
    await nodeFs.mkdir(nodePath.join(home, ".hermes"), { recursive: true });
    const result = await detectAgents({ home, pathEnv: "" });
    expect(result.hermes.detected).toBe(true);
    expect(result.hermes.evidence).toContain("config found: ~/.hermes");
    expect(result.opencode.detected).toBe(false);
    expect(result.opencode.evidence).toContain(
      "config missing: ~/.config/opencode/opencode.jsonc",
    );
    expect(result.opencode.evidence).toContain("bin not found on PATH: opencode");
  });

  it("detection: Windows bin variant (.ps1) for a new agent", async () => {
    const binDir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-install-bin2-"));
    try {
      await nodeFs.writeFile(nodePath.join(binDir, "zed.ps1"), "echo hi\r\n", "utf8");
      const result = await detectAgents({ home, pathEnv: binDir });
      expect(result.zed.detected).toBe(true);
      expect(result.zed.evidence.find((e) => e.startsWith("bin found on PATH"))).toContain(
        "zed.ps1",
      );
    } finally {
      await nodeFs.rm(binDir, { recursive: true, force: true });
    }
  });

  it("dry-run byte-equality + idempotent re-run for all 8 new agents", async () => {
    const agents = [
      "opencode",
      "openclaw",
      "cline",
      "kiro",
      "qwen",
      "warp",
      "zed",
      "hermes",
    ] as const;
    // Seed opencode with a JSONC file containing comments (exercises the
    // strip path inside plan/apply, not just the pure function).
    await writeHome(
      ".config/opencode/opencode.jsonc",
      '{\n  // seeded\n  "$schema": "https://opencode.ai/config.json"\n}\n',
    );

    const plan = await planInstall({ repoRoot, home, agents: [...agents], sources: SOURCES });
    const writable = plan.filter((a) => a.status === "write" && a.kind !== "pointer");
    // 8 mcp-config actions, one per agent
    expect(writable.filter((a) => a.kind === "mcp-config")).toHaveLength(8);

    await applyInstall(plan, repoRoot);
    for (const action of writable) {
      const onDisk = await nodeFs.readFile(action.targetPath, "utf8");
      expect(onDisk, `bytes differ for ${action.agentId} ${action.targetPath}`).toBe(
        action.content,
      );
    }

    const second = await planInstall({ repoRoot, home, agents: [...agents], sources: SOURCES });
    for (const a of second) {
      expect(a.status, `second run should not rewrite ${a.agentId} ${a.kind}`).not.toBe("write");
    }
  });
});
