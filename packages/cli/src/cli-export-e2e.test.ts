/**
 * CLI E2E — `livewiki export <target>` (Phase 6 Lot 6A).
 *
 * The CLI runs the real binary against a temporary repository. The test
 * file exercises every behavior named in the corrective prompt:
 *   - all targets and home filenames;
 *   - deterministic flattening and collision failure;
 *   - anchor metadata removal;
 *   - link and fragment rewriting;
 *   - code-span/fence exclusion;
 *   - Mermaid conversion and missing-diagram failure;
 *   - broken-link failure;
 *   - exact generated marker;
 *   - overwrite refusal and `--force`;
 *   - stale generated-file removal;
 *   - idempotent second export;
 *   - preflight failure leaves destination unchanged;
 *   - `--push` fails before writing (JSON exits 1);
 *   - Repository path with spaces and Unicode (platform-neutral).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-cli-export-"),
  );
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

async function readDest(target: string, name: string): Promise<string | null> {
  const abs = nodePath.join(repoRoot, ".livewiki", "export", target, name);
  try {
    return await nodeFs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

async function listDest(target: string): Promise<string[]> {
  const dir = nodePath.join(repoRoot, ".livewiki", "export", target);
  try {
    return await nodeFs.readdir(dir);
  } catch {
    return [];
  }
}

/** Same as `writeWiki` but pinned to an explicit root (used by the
 * spaces+Unicode test that builds its own repoRoot). */
async function writeWikiAt(
  root: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = nodePath.join(root, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

/** Same as `readDest` but pinned to an explicit root. */
async function readDestAt(
  root: string,
  target: string,
  name: string,
): Promise<string | null> {
  const abs = nodePath.join(root, ".livewiki", "export", target, name);
  try {
    return await nodeFs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

describe("CLI E2E — livewiki export", () => {
  it("github-wiki renames quickstart.md to Home.md and exits 0", async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "github-wiki"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    expect(await readDest("github-wiki", "Home.md")).not.toBeNull();
  });
  it("gitlab-wiki renames quickstart.md to home.md and exits 0", async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "gitlab-wiki"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    expect(await readDest("gitlab-wiki", "home.md")).not.toBeNull();
  });
  it("generic keeps quickstart.md as-is and exits 0", async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    expect(await readDest("generic", "quickstart.md")).not.toBeNull();
  });
  it("invalid target exits 1 and writes nothing", async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "svn-wiki"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(await listDest("svn-wiki")).toEqual([]);
  });
  it("--push is rejected with exit 1 and writes nothing", async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
    const r = runCli([
      "--json",
      "--repo",
      repoRoot,
      "export",
      "generic",
      "--push",
      "origin",
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    // The JSON error includes the rejection reason.
    const parsed = JSON.parse(r.stdout) as { ok: boolean; export: { issues: Array<{ code: string }> } };
    expect(parsed.ok).toBe(false);
    expect(parsed.export.issues.some((i) => i.code === "invalid_push")).toBe(true);
    // Destination is untouched.
    expect(await listDest("generic")).toEqual([]);
  });
  it("flattens a nested file (architecture/overview.md → architecture-overview.md)", async () => {
    await writeWiki("livewiki/architecture/overview.md", "# Overview\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    expect(await readDest("generic", "architecture-overview.md")).not.toBeNull();
  });
  it("a flattening collision exits 1 and writes nothing", async () => {
    await writeWiki("livewiki/architecture/overview.md", "# A\n");
    await writeWiki("livewiki/architecture-overview.md", "# B\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(await listDest("generic")).toEqual([]);
  });
  it("strips the frontmatter `anchors:` key but keeps title/owner", async () => {
    await writeWiki(
      "livewiki/foo.md",
      [
        "---",
        "title: Foo",
        "owner: generated",
        "anchors:",
        "  - src/foo.ts#bar",
        "---",
        "",
        "# Foo",
        "",
      ].join("\n"),
    );
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "foo.md");
    expect(out).toContain("title: Foo");
    expect(out).toContain("owner: generated");
    expect(out).not.toMatch(/anchors:/);
  });
  it("removes lw:anchors markers from the body", async () => {
    await writeWiki(
      "livewiki/foo.md",
      [
        "---",
        "title: Foo",
        "---",
        "",
        "## Details",
        "<!-- lw:anchors src/foo.ts#bar -->",
        "",
        "Some prose.",
        "",
      ].join("\n"),
    );
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "foo.md");
    expect(out).not.toMatch(/lw:anchors/);
  });
  it("rewrites a same-directory link and preserves the fragment verbatim", async () => {
    await writeWiki("livewiki/a.md", "See [other](b.md#section).\n");
    await writeWiki("livewiki/b.md", "# B\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("(b.md#section)");
    expect(out).not.toContain("user-content-");
  });
  it("does not rewrite links inside inline code or fenced code blocks", async () => {
    await writeWiki("livewiki/a.md", "Use `[skip](b.md)` literally.\n");
    await writeWiki(
      "livewiki/c.md",
      ["# C", "", "```", "[literal](b.md)", "```", ""].join("\n"),
    );
    await writeWiki("livewiki/b.md", "# B\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const outA = await readDest("generic", "a.md");
    const outC = await readDest("generic", "c.md");
    expect(outA).toContain("[skip](b.md)");
    expect(outC).toContain("[literal](b.md)");
  });
  it("leaves external https URLs untouched", async () => {
    await writeWiki("livewiki/a.md", "See [docs](https://example.com/docs).\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("(https://example.com/docs)");
  });
  it("converts a .mmd file into a fenced-mermaid .md page", async () => {
    await writeWiki("livewiki/diagrams/auth.classes.mmd", "classDiagram\n  class Auth\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "diagrams-auth.classes.md");
    expect(out).toContain("```mermaid");
    expect(out).toContain("classDiagram");
  });
  it("a missing referenced diagram exits 1 and writes nothing", async () => {
    await writeWiki(
      "livewiki/overview.md",
      [
        "# Overview",
        "",
        "```mermaid",
        "%% livewiki/missing.mmd",
        "```",
        "",
      ].join("\n"),
    );
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(await listDest("generic")).toEqual([]);
  });
  it("a broken internal link exits 1 and writes nothing", async () => {
    await writeWiki("livewiki/a.md", "See [missing](missing.md).\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(await listDest("generic")).toEqual([]);
  });
  it("emits the exact generated marker on every page", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const out = await readDest("generic", "foo.md");
    expect(out).toContain(
      '<!-- livewiki:generated source="livewiki/foo.md" -->',
    );
  });
  it("refuses to overwrite a destination file that lacks the marker (exit 1)", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), "hand-edited\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    // The hand-edited file is untouched.
    const onDisk = await nodeFs.readFile(nodePath.join(outDir, "foo.md"), "utf8");
    expect(onDisk).toBe("hand-edited\n");
  });
  it("--force overwrites a destination file that lacks the marker (exit 0)", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), "hand-edited\n");
    const r = runCli([
      "--json",
      "--repo",
      repoRoot,
      "export",
      "generic",
      "--force",
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const onDisk = await nodeFs.readFile(nodePath.join(outDir, "foo.md"), "utf8");
    expect(onDisk).toContain("# Foo");
    expect(onDisk).toContain("livewiki:generated");
  });
  it("removes a stale destination file (with marker) whose source is gone", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki("livewiki/bar.md", "# Bar\n");
    const r1 = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r1.status).toBe(0);
    expect((await listDest("generic")).sort()).toEqual(["bar.md", "foo.md"]);
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki", "bar.md"));
    const r2 = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r2.status).toBe(0);
    expect(await listDest("generic")).toEqual(["foo.md"]);
  });
  it("idempotent second export: zero writes, zero removals", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki("livewiki/bar.md", "# Bar\n");
    const r1 = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r1.status).toBe(0);
    const parsed1 = JSON.parse(r1.stdout) as { export: { pagesWritten: number; pagesRemoved: number } };
    expect(parsed1.export.pagesWritten).toBe(2);
    const r2 = runCli(["--json", "--repo", repoRoot, "export", "generic"]);
    expect(r2.status).toBe(0);
    const parsed2 = JSON.parse(r2.stdout) as { export: { pagesWritten: number; pagesRemoved: number } };
    expect(parsed2.export.pagesWritten).toBe(0);
    expect(parsed2.export.pagesRemoved).toBe(0);
  });
  it("repository path with spaces and Unicode: export still works on every OS", async () => {
    // Build an actual repository ROOT whose absolute path contains
    // both a space and a non-ASCII character. The test then passes
    // that path verbatim via `--repo` to the CLI (the spawnSync
    // call uses an arg array, so the path is never shell-unescaped
    // on any host) and asserts the export succeeds. The previous
    // version of this test only put spaces/Unicode in a SUBDIRECTORY
    // of the temp repo; the durable-path guarantees must hold for
    // the `--repo` argument itself, because that is what the user
    // will actually pass on a real Windows / Linux / macOS host.
    const weirdRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki ç repo with space-"),
    );
    try {
      // The wiki source uses a nested path with its own accented
      // character so the flattened destination filename also has to
      // survive.
      await nodeFs.mkdir(nodePath.join(weirdRoot, "livewiki", "a ç d"), {
        recursive: true,
      });
      await writeWikiAt(
        weirdRoot,
        "livewiki/a ç d/page.md",
        [
          "# Page",
          "",
          "See [other](another.md).",
          "",
        ].join("\n"),
      );
      await writeWikiAt(weirdRoot, "livewiki/a ç d/another.md", "# Another\n");
      const r = runCli([
        "--json",
        "--repo",
        weirdRoot,
        "export",
        "generic",
      ]);
      expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
      const page = await readDestAt(
        weirdRoot,
        "generic",
        "a ç d-page.md",
      );
      expect(page).not.toBeNull();
      // The flattened filename preserves the accented character.
      expect(
        await readDestAt(weirdRoot, "generic", "a ç d-another.md"),
      ).not.toBeNull();
      // Durable-path assertion: the generated Markdown body and
      // the generated marker MUST use forward slashes and MUST NOT
      // contain a backslash, regardless of the host filesystem.
      expect(page).not.toContain("\\");
      expect(page).toContain(
        '<!-- livewiki:generated source="livewiki/a ç d/page.md" -->',
      );
      // The cross-page link is rewritten to the flattened
      // destination name. The link target must also contain no
      // backslash.
      expect(page).toContain("a ç d-another.md");
      expect(page).toMatch(/\(a ç d-another\.md\)/);
    } finally {
      await nodeFs.rm(weirdRoot, { recursive: true, force: true });
    }
  });
  it("invalid target in --json mode: exit 1, valid JSON, ok=false, invalid_target code", async () => {
    await writeWiki("livewiki/quickstart.md", "# Q\n");
    const r = runCli(["--json", "--repo", repoRoot, "export", "svn-wiki"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    // stdout is valid JSON (not a thrown error string).
    let parsed: { ok: boolean; export: { issues: Array<{ code: string }> } };
    expect(() => {
      parsed = JSON.parse(r.stdout) as typeof parsed;
    }).not.toThrow();
    expect(parsed!.ok).toBe(false);
    expect(parsed!.export.issues.some((i) => i.code === "invalid_target")).toBe(true);
  });
});

describe("CLI E2E — livewiki export readme", () => {
  const README_QUICKSTART = [
    "# Quickstart",
    "",
    "## What this repository is",
    "",
    "WidgetKit renders dashboard widgets from declarative configs.",
    "",
    "## What you'll find in this wiki",
    "",
    "- **[Renderer](renderer.md)** — Renders widget trees into the host surface.",
    "",
  ].join("\n");

  it("creates README.md with --yes and exits 0", async () => {
    await writeWiki("livewiki/quickstart.md", README_QUICKSTART);
    const r = runCli(["--repo", repoRoot, "export", "readme", "--yes"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const readme = await nodeFs.readFile(nodePath.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("<!-- livewiki:readme:start -->");
    expect(readme).toContain("WidgetKit renders dashboard widgets");
    expect(readme).toContain("- **[Renderer](livewiki/renderer.md)**");
  });

  it("dry-run without --yes exits 0 and writes nothing", async () => {
    await writeWiki("livewiki/quickstart.md", README_QUICKSTART);
    const r = runCli(["--repo", repoRoot, "export", "readme"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    expect(r.stdout).toContain("dry-run");
    await expect(
      nodeFs.access(nodePath.join(repoRoot, "README.md")),
    ).rejects.toThrow();
  });

  it("refuses a marker-less README with exit 1 and a clear opt-in message", async () => {
    await writeWiki("livewiki/quickstart.md", README_QUICKSTART);
    await writeWiki("README.md", "# Hand-written\n");
    const r = runCli(["--repo", repoRoot, "export", "readme", "--yes"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    expect(r.stdout).toContain("never overwritten");
    expect(r.stdout).toContain("<!-- livewiki:readme:start -->");
    // The human file is untouched.
    expect(await nodeFs.readFile(nodePath.join(repoRoot, "README.md"), "utf8")).toBe(
      "# Hand-written\n",
    );
  });

  it("replaces only the marker block of an opted-in README", async () => {
    await writeWiki("livewiki/quickstart.md", README_QUICKSTART);
    await writeWiki(
      "README.md",
      "# Mine\n\nIntro.\n\n<!-- livewiki:readme:start -->\n\nstale\n\n<!-- livewiki:readme:end -->\n\nFooter.\n",
    );
    const r = runCli(["--repo", repoRoot, "export", "readme", "--yes"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const readme = await nodeFs.readFile(nodePath.join(repoRoot, "README.md"), "utf8");
    expect(readme).toContain("Intro.");
    expect(readme).toContain("Footer.");
    expect(readme).toContain("WidgetKit renders dashboard widgets");
    expect(readme).not.toContain("stale");
  });

  it("missing wiki exits 1 with a run-init message (JSON honors the contract)", async () => {
    const r = runCli(["--json", "--repo", repoRoot, "export", "readme", "--yes"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      readme: { refusal?: string };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.readme.refusal).toContain("livewiki init");
  });
});
