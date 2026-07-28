/**
 * CLI E2E — `livewiki view` (Phase 7).
 *
 * Runs the real binary against a temporary repository:
 *   - `--no-open --out <tmp>` exits 0 and the site files are present;
 *   - the output path is always printed;
 *   - `--template docs` switches the theme shell;
 *   - missing wiki exits 1 with a clear message (human and JSON modes);
 *   - `--out` inside livewiki/ is rejected with exit 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-cli-view-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

function cliBin(): string {
  return nodePath.resolve(process.cwd(), "dist/index.js");
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): CliRun {
  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [cliBin(), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

async function writeFixtureWiki(): Promise<void> {
  await writeWiki(
    "livewiki/quickstart.md",
    "# Quickstart\n\nStart with [Auth](auth.md).\n",
  );
  await writeWiki("livewiki/auth.md", "# Authentication\n\nHandles login.\n");
  await writeWiki("livewiki/diagrams/auth.mmd", "graph TD\n  A --> B\n");
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    await nodeFs.access(abs);
    return true;
  } catch {
    return false;
  }
}

describe("CLI E2E — livewiki view", () => {
  it("--no-open --out <tmp> exits 0 and the site files are present", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const r = runCli(["--repo", repoRoot, "view", "--no-open", "--out", outDir]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);

    // The path is always printed.
    expect(r.stdout).toContain("site-out");

    for (const rel of [
      "index.html",
      "pages/auth.html",
      "pages/diagrams/auth.html",
      "assets/view-agent.css",
      "assets/view-docs.css",
      "assets/view-app.js",
      "assets/search-index.js",
      "assets/mermaid.min.js",
    ]) {
      expect(await fileExists(nodePath.join(outDir, rel)), `missing ${rel}`).toBe(true);
    }

    // Links were rewritten to .html by the real pipeline.
    const index = await nodeFs.readFile(nodePath.join(outDir, "index.html"), "utf8");
    expect(index).toContain('href="pages/auth.html"');
  });

  it("--template docs switches the theme shell", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-docs");
    const r = runCli([
      "--repo",
      repoRoot,
      "view",
      "--no-open",
      "--out",
      outDir,
      "--template",
      "docs",
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const index = await nodeFs.readFile(nodePath.join(outDir, "index.html"), "utf8");
    expect(index).toContain("assets/view-docs.css");
    expect(index).toContain('class="template-docs"');
  });

  it("--json emits a parseable success payload", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-json");
    const r = runCli(["--json", "--repo", repoRoot, "view", "--no-open", "--out", outDir]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const payload = JSON.parse(r.stdout) as {
      ok: boolean;
      view: { pagesWritten: number; opened: boolean; template: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.view.pagesWritten).toBe(3);
    expect(payload.view.opened).toBe(false);
    expect(payload.view.template).toBe("agent");
  });

  it("missing wiki exits 1 with a clear message (human and JSON)", async () => {
    const outDir = nodePath.join(repoRoot, "site-out");
    const human = runCli(["--repo", repoRoot, "view", "--no-open", "--out", outDir]);
    expect(human.status).toBe(1);
    expect(human.stdout).toContain("missing_wiki");
    expect(human.stdout).toContain("no livewiki/ wiki found");
    expect(await fileExists(nodePath.join(outDir, "index.html"))).toBe(false);

    const json = runCli(["--json", "--repo", repoRoot, "view", "--no-open", "--out", outDir]);
    expect(json.status).toBe(1);
    const payload = JSON.parse(json.stdout) as { ok: boolean; error: { code: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("missing_wiki");
  });

  it("--out inside livewiki/ is rejected with exit 1", async () => {
    await writeFixtureWiki();
    const r = runCli([
      "--repo",
      repoRoot,
      "view",
      "--no-open",
      "--out",
      nodePath.join(repoRoot, "livewiki", "site-out"),
    ]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("invalid_out_dir");
  });
});
