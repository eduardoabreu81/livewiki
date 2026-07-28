/**
 * `livewiki install` CLI tests (backlog #4).
 *
 * Covers the two CLI-level contracts from the plan:
 *   - `--print` is a full dry-run: writes NOTHING anywhere (fake HOME stays
 *     empty, repo untouched)
 *   - `--agents bogus` exits 2
 *
 * The fake HOME goes through the documented LIVEWIKI_HOME seam
 * (packages/cli/src/commands/install.ts), so real user config is never
 * touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { createProgram } from "./cli.js";

let home: string;
let repoRoot: string;
let savedHome: string | undefined;
let savedExitCode: typeof process.exitCode;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const program = createProgram();
  let stdout = "";
  let stderr = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await program.parseAsync(args, { from: "user" });
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { stdout, stderr };
}

beforeEach(async () => {
  home = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-install-home-"));
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-cli-install-repo-"));
  savedHome = process.env.LIVEWIKI_HOME;
  process.env.LIVEWIKI_HOME = home;
  savedExitCode = process.exitCode;
  process.exitCode = undefined;
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.LIVEWIKI_HOME;
  else process.env.LIVEWIKI_HOME = savedHome;
  process.exitCode = savedExitCode;
  await nodeFs.rm(home, { recursive: true, force: true });
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("livewiki install --print", () => {
  it("writes nothing anywhere (fake HOME stays empty, repo untouched)", async () => {
    const { stdout } = await runCli([
      "install",
      "--print",
      "--repo",
      repoRoot,
      "--agents",
      "kimi,codex",
    ]);
    expect(process.exitCode ?? 0).toBe(0);

    // Detection table + plan rendered
    expect(stdout).toContain("Agent detection");
    expect(stdout).toContain("kimi");
    expect(stdout).toContain("codex");
    expect(stdout).toContain("mcp-config");

    // Zero writes: HOME empty, repo has no .git and no AGENTS.md
    expect(await nodeFs.readdir(home)).toEqual([]);
    expect(await nodeFs.readdir(repoRoot)).toEqual([]);
  });

  it("--json --print emits parseable JSON and still writes nothing", async () => {
    const { stdout } = await runCli([
      "--json",
      "install",
      "--print",
      "--repo",
      repoRoot,
      "--agents",
      "gemini",
    ]);
    expect(process.exitCode ?? 0).toBe(0);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.plan.length).toBeGreaterThan(0);
    expect(await nodeFs.readdir(home)).toEqual([]);
  });
});

describe("livewiki install --agents validation", () => {
  it("--agents bogus exits 2", async () => {
    const { stderr } = await runCli(["install", "--repo", repoRoot, "--agents", "bogus"]);
    expect(process.exitCode).toBe(2);
    expect(stderr).toContain("invalid --agents");
    expect(stderr).toContain("bogus");
  });

  it("--agents with one valid + one invalid id exits 2 and writes nothing", async () => {
    await runCli(["install", "--repo", repoRoot, "--agents", "kimi,bogus", "--yes"]);
    expect(process.exitCode).toBe(2);
    expect(await nodeFs.readdir(home)).toEqual([]);
  });
});

describe("livewiki install non-interactive safety", () => {
  it("without --yes and without TTY, fails closed (exit 1, zero writes)", async () => {
    // Vitest stdin is not a TTY
    const { stderr } = await runCli(["install", "--repo", repoRoot, "--agents", "kimi"]);
    expect(process.exitCode).toBe(1);
    expect(stderr).toContain("requires --yes");
    expect(await nodeFs.readdir(home)).toEqual([]);
  });

  it("--yes applies the plan and a re-run is a no-op (exit 0)", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".git", "hooks"), { recursive: true });
    const first = await runCli(["install", "--repo", repoRoot, "--agents", "kimi", "--yes"]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(first.stdout).toContain("Results:");

    const mcpPath = nodePath.join(home, ".kimi-code", "mcp.json");
    const mcp = JSON.parse(await nodeFs.readFile(mcpPath, "utf8"));
    expect(mcp.mcpServers.livewiki.command).toBe("npx");
    expect(mcp.mcpServers.livewiki.args).toContain("--repo");
    // Skill installed to the shared dir
    await nodeFs.access(nodePath.join(home, ".agents", "skills", "document-as-you-go", "SKILL.md"));
    // Git hook installed
    await nodeFs.access(nodePath.join(repoRoot, ".git", "hooks", "post-commit"));
    // Pointer NOT written without --write-pointer (rule #2)
    await expect(nodeFs.access(nodePath.join(repoRoot, "AGENTS.md"))).rejects.toThrow();

    process.exitCode = undefined;
    await runCli(["install", "--repo", repoRoot, "--agents", "kimi", "--yes"]);
    expect(process.exitCode ?? 0).toBe(0);
  });
});
