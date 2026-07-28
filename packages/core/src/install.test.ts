import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  AGENT_REGISTRY,
  buildMcpEntry,
  detectAgents,
  mergeMcpServersJson,
  mergeTomlManagedBlock,
  renderTomlManagedBlock,
  mergeClaudeCodeSettings,
  planInstall,
  applyInstall,
  SHARED_SKILL_TARGET,
  type InstallSources,
} from "./install.js";

const FAKE_SKILL = "---\nname: document-as-you-go\n---\nfake skill content\n";
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
  skillDocumentAsYouGo: FAKE_SKILL,
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
  it("contains exactly the v1 five agents", () => {
    expect(AGENT_REGISTRY.map((a) => a.id)).toEqual([
      "claude-code",
      "codex",
      "cursor",
      "kimi",
      "gemini",
    ]);
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

  it("skill: writes when absent, skips byte-identical, refuses a different file", async () => {
    const skillPath = nodePath.join(home, SHARED_SKILL_TARGET);

    let plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    const write = plan.find((a) => a.kind === "skill")!;
    expect(write.status).toBe("write");
    await applyInstall(plan, repoRoot);
    expect(await nodeFs.readFile(skillPath, "utf8")).toBe(FAKE_SKILL);

    plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    expect(plan.find((a) => a.kind === "skill")!.status).toBe("skip");

    await nodeFs.writeFile(skillPath, "user customizations\n", "utf8");
    plan = await planInstall({ repoRoot, home, agents: ["kimi"], sources: SOURCES });
    const refuse = plan.find((a) => a.kind === "skill")!;
    expect(refuse.status).toBe("refuse");
    expect(refuse.reason).toMatch(/not overwriting user content/);
    await applyInstall(plan, repoRoot);
    expect(await nodeFs.readFile(skillPath, "utf8")).toBe("user customizations\n");
  });

  it("skill action is deduped and only planned for shared-skill agents", async () => {
    const plan = await planInstall({
      repoRoot,
      home,
      agents: ["claude-code", "codex", "kimi"],
      sources: SOURCES,
    });
    expect(plan.filter((a) => a.kind === "skill")).toHaveLength(1);

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
