import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  readGitignore,
  ensureGitignoreEntries,
} from "./gitignore.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-gitignore-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("gitignore.readGitignore", () => {
  it("returns '' if .gitignore does not exist", async () => {
    expect(await readGitignore(repoRoot)).toBe("");
  });

  it("returns content of .gitignore", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".gitignore"),
      "node_modules/\n",
      "utf8",
    );
    expect(await readGitignore(repoRoot)).toBe("node_modules/\n");
  });
});

describe("gitignore.ensureGitignoreEntries — file missing", () => {
  it("creates .gitignore with managed block", async () => {
    const result = await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    expect(result.changed).toBe(true);
    expect(result.added).toEqual([".livewiki/"]);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content).toContain(".livewiki/");
    expect(content).toContain("# livewiki:start");
    expect(content).toContain("# livewiki:end");
  });

  it("creates with multiple entries in order", async () => {
    const result = await ensureGitignoreEntries(repoRoot, [
      ".livewiki/",
      ".livewiki.tmp/",
    ]);
    expect(result.added).toEqual([".livewiki/", ".livewiki.tmp/"]);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    const lines = content.split("\n");
    const lwi = lines.indexOf(".livewiki/");
    const tmp = lines.indexOf(".livewiki.tmp/");
    expect(lwi).toBeGreaterThan(-1);
    expect(tmp).toBeGreaterThan(lwi);
  });
});

describe("gitignore.ensureGitignoreEntries — file exists WITHOUT block", () => {
  it("appends managed block at end (preserves user entries)", async () => {
    const original = "node_modules/\ndist/\n";
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), original, "utf8");

    const result = await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    expect(result.changed).toBe(true);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content.startsWith(original)).toBe(true);
    expect(content).toContain(".livewiki/");
  });

  it("adds separator \\n\\n between user entries and managed block", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content).toMatch(/node_modules\/\n\n# livewiki:start/);
  });

  it("preserves files WITHOUT trailing newline", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), "node_modules/", "utf8");
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content).toMatch(/node_modules\/\n\n# livewiki:start/);
  });
});

describe("gitignore.ensureGitignoreEntries — file WITH block", () => {
  it("replaces block in-place, preserving entries outside the block", async () => {
    const original = [
      "node_modules/",
      "",
      "# livewiki:start",
      ".livewiki/",
      "# livewiki:end",
      "",
      "dist/",
    ].join("\n");
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), original, "utf8");

    await ensureGitignoreEntries(repoRoot, [".livewiki/", ".livewiki.tmp/"]);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    // Entries outside the block preserved
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    // New entry inside the block
    expect(content).toContain(".livewiki.tmp/");
    // Order: .livewiki/ before .livewiki.tmp/
    const lwi = content.indexOf(".livewiki/");
    const tmp = content.indexOf(".livewiki.tmp/");
    expect(lwi).toBeLessThan(tmp);
  });

  it("rewrites truncated block (no end marker)", async () => {
    // Malformed block — no # livewiki:end
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".gitignore"),
      "node_modules/\n\n# livewiki:start\n.livewiki/\n",
      "utf8",
    );
    // Should not throw — extraction returns null, fallback is append
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content).toContain(".livewiki/");
  });
});

describe("gitignore.ensureGitignoreEntries — idempotence", () => {
  it("second call with same entry = no-op", async () => {
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    const before = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    const result2 = await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    expect(result2.changed).toBe(false);
    expect(result2.added).toEqual([]);

    const after = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(after).toBe(before);
  });

  it("second call adds ONLY new entries", async () => {
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    const result = await ensureGitignoreEntries(repoRoot, [".livewiki/", ".livewiki.tmp/"]);
    expect(result.changed).toBe(true);
    expect(result.added).toEqual([".livewiki.tmp/"]);
  });

  it("does NOT duplicate entry even with different whitespace", async () => {
    await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    // Caller passes with whitespace — no duplicate
    const result = await ensureGitignoreEntries(repoRoot, ["  .livewiki/  "]);
    expect(result.changed).toBe(false);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    const occurrences = (content.match(/^\.livewiki\/$/gm) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe("gitignore.ensureGitignoreEntries — doesn't touch entries outside block", () => {
  it("preserves user entry with same name but in another location", async () => {
    // User already has .livewiki/ manually, OUTSIDE the block
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".gitignore"),
      ".livewiki/\n",
      "utf8",
    );
    const result = await ensureGitignoreEntries(repoRoot, [".livewiki/"]);
    // Entry already in file (even outside block) — no duplicate
    expect(result.changed).toBe(false);
    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    expect(content).toBe(".livewiki/\n"); // untouched
  });
});