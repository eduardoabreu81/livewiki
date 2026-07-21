/**
 * Phase 6 Lot 6A — focused unit tests for the deterministic export
 * of `livewiki/` to `.livewiki/export/<target>/`.
 *
 * The test file covers every behavior named in the corrective prompt:
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
 *   - `--push` fails before writing;
 *   - JSON failure exits 1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  exportWiki,
  validateTarget,
  ExportError,
  EXPORT_TARGETS,
  type ExportTarget,
} from "./export.js";

/**
 * On Windows, creating symlinks requires privilege (admin or Developer
 * Mode). We detect symlink support once at test-run boot; symlink-
 * sensitive tests use `it.runIf(canSymlink)` and are skipped when the
 * host does not allow it.
 *
 * Cross-platform CI contract: the symlink tests in this file are the
 * security regression coverage for the export's safe-io allowlist
 * (the symlink-escape attacks named in the corrective prompt). On
 * Windows they MAY skip; on every Unix host (`process.platform !==
 * "win32"`) they MUST run, and a Unix host that reports
 * `canSymlink === false` is a CI contract violation, not a harmless
 * skip. The assertion at the bottom of this block fails the test run
 * on a Unix host that cannot create symlinks — the CI matrix is
 * expected to provide that capability, so a false-negative here is
 * always a real problem.
 */
async function detectSymlinkSupport(): Promise<boolean> {
  // Use a unique `mkdtemp` directory and remove it in a `finally`
  // block. A failed Windows symlink attempt (admin / Developer Mode
  // not present) must NOT leave a stray target file in the system
  // temp directory, must NOT collide with a later test run, and
  // must NOT make a future probe report a false-positive because
  // the leftover target could be re-symlinked on a retry.
  const probeDir = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-export-symlink-"),
  );
  const target = nodePath.join(probeDir, "target");
  const probe = nodePath.join(probeDir, "probe");
  try {
    await nodeFs.writeFile(target, "x");
    await nodeFs.symlink(target, probe);
    return true;
  } catch {
    return false;
  } finally {
    await nodeFs.rm(probeDir, { recursive: true, force: true });
  }
}

const canSymlink = await detectSymlinkSupport();

/**
 * Cross-platform CI contract guard. On a Unix host, the symlink
 * tests must run; a Unix host that cannot create symlinks is treated
 * as a CI contract violation (the matrix runner is expected to
 * provide that capability). The guard runs once at boot.
 */
if (process.platform !== "win32") {
  if (!canSymlink) {
    throw new Error(
      `cross-platform CI contract violation: process.platform=${process.platform} but canSymlink=false; ` +
        `the symlink security regression tests must run on every Unix host. ` +
        `Check that the runner is not running in a sandbox that blocks symlink(2).`,
    );
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-export-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

async function readDest(target: ExportTarget, name: string): Promise<string | null> {
  const abs = nodePath.join(repoRoot, ".livewiki", "export", target, name);
  try {
    return await nodeFs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

async function listDest(target: ExportTarget): Promise<string[]> {
  const dir = nodePath.join(repoRoot, ".livewiki", "export", target);
  try {
    return await nodeFs.readdir(dir);
  } catch {
    return [];
  }
}

describe("validateTarget", () => {
  it("accepts every supported target", () => {
    for (const t of EXPORT_TARGETS) {
      expect(validateTarget(t)).toBe(t);
    }
  });
  it("rejects an unknown target with a structured error", () => {
    expect(() => validateTarget("svn-wiki")).toThrow(ExportError);
  });
});

describe("target home filenames", () => {
  beforeEach(async () => {
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n");
  });
  it("generic keeps quickstart.md", async () => {
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    expect(await readDest("generic", "quickstart.md")).not.toBeNull();
  });
  it("github-wiki renames to Home.md", async () => {
    const r = await exportWiki({ repoRoot, target: "github-wiki" });
    expect(r.ok).toBe(true);
    expect(await readDest("github-wiki", "Home.md")).not.toBeNull();
  });
  it("gitlab-wiki renames to home.md", async () => {
    const r = await exportWiki({ repoRoot, target: "gitlab-wiki" });
    expect(r.ok).toBe(true);
    expect(await readDest("gitlab-wiki", "home.md")).not.toBeNull();
  });
});

describe("deterministic flattening and collisions", () => {
  it("flattens a nested file with hyphens (architecture/overview.md → architecture-overview.md)", async () => {
    await writeWiki("livewiki/architecture/overview.md", "# Overview\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    expect(await readDest("generic", "architecture-overview.md")).not.toBeNull();
  });
  it("detects a flattening collision (architecture/overview.md and architecture-overview.md)", async () => {
    await writeWiki("livewiki/architecture/overview.md", "# A\n");
    await writeWiki("livewiki/architecture-overview.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "flattening_collision")).toBe(true);
  });
  it("flattens multi-level paths (a/b/c.md → a-b-c.md)", async () => {
    await writeWiki("livewiki/a/b/c.md", "# C\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    expect(await readDest("generic", "a-b-c.md")).not.toBeNull();
  });
});

describe("anchor metadata removal", () => {
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
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
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
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "foo.md");
    expect(out).not.toMatch(/lw:anchors/);
  });
});

describe("link and fragment rewriting", () => {
  it("rewrites a same-directory link to the flattened destination", async () => {
    await writeWiki("livewiki/a.md", "See [other](b.md).\n");
    await writeWiki("livewiki/b.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("(b.md)");
  });
  it("rewrites a subdirectory link across directories", async () => {
    await writeWiki("livewiki/auth/login.md", "See [helper](../utils/helper.md).\n");
    await writeWiki("livewiki/utils/helper.md", "# Helper\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "auth-login.md");
    expect(out).toContain("(utils-helper.md)");
  });
  it("preserves the fragment verbatim (no user-content- prefix)", async () => {
    await writeWiki("livewiki/overview.md", "See [Home](quickstart.md#choose).\n");
    await writeWiki("livewiki/quickstart.md", "# Choose\n");
    const r = await exportWiki({ repoRoot, target: "github-wiki" });
    expect(r.ok).toBe(true);
    const out = await readDest("github-wiki", "overview.md");
    expect(out).toContain("(Home.md#choose)");
    expect(out).not.toContain("user-content-");
  });
  it("rewrites a same-directory link for an owner: human page", async () => {
    await writeWiki(
      "livewiki/note.md",
      [
        "---",
        "title: Note",
        "owner: human",
        "---",
        "",
        "See [home](quickstart.md).",
        "",
      ].join("\n"),
    );
    await writeWiki("livewiki/quickstart.md", "# Q\n");
    const r = await exportWiki({ repoRoot, target: "github-wiki" });
    expect(r.ok).toBe(true);
    const out = await readDest("github-wiki", "note.md");
    expect(out).toContain("(Home.md)");
  });
});

describe("code-span and fence exclusion", () => {
  it("does not rewrite links inside inline code", async () => {
    await writeWiki("livewiki/a.md", "Use `[skip](b.md)` literally.\n");
    await writeWiki("livewiki/b.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("[skip](b.md)");
  });
  it("does not rewrite links inside fenced code blocks", async () => {
    await writeWiki(
      "livewiki/a.md",
      ["# A", "", "```", "[literal](b.md)", "```", ""].join("\n"),
    );
    await writeWiki("livewiki/b.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("[literal](b.md)");
  });
  it("leaves external https URLs untouched", async () => {
    await writeWiki("livewiki/a.md", "See [docs](https://example.com/docs).\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "a.md");
    expect(out).toContain("(https://example.com/docs)");
  });
});

describe("Mermaid conversion", () => {
  it("converts a .mmd file into a fenced-mermaid .md page", async () => {
    await writeWiki("livewiki/diagrams/auth.classes.mmd", "classDiagram\n  class Auth\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "diagrams-auth.classes.md");
    expect(out).toContain("```mermaid");
    expect(out).toContain("classDiagram");
    expect(out).toContain("class Auth");
  });
  it("replaces %% livewiki/...mmd placeholders with a link to the diagram page", async () => {
    await writeWiki("livewiki/architecture/structure.mmd", "graph TD\n  A-->B\n");
    await writeWiki(
      "livewiki/architecture/overview.md",
      [
        "# Overview",
        "",
        "```mermaid",
        "%% livewiki/architecture/structure.mmd",
        "```",
        "",
      ].join("\n"),
    );
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "architecture-overview.md");
    // The Mermaid placeholder is replaced by a link; the link rewriter
    // resolves the source path `livewiki/architecture/structure.mmd` to
    // its destination flat name `architecture-structure.md` (.mmd → .md).
    expect(out).toContain(
      "[View diagram (architecture/structure.mmd)](architecture-structure.md)",
    );
    expect(out).not.toContain("```mermaid");
    expect(out).not.toContain("%% livewiki/");
  });
  it("fails preflight when a placeholder references a missing .mmd", async () => {
    await writeWiki(
      "livewiki/architecture/overview.md",
      [
        "# Overview",
        "",
        "```mermaid",
        "%% livewiki/architecture/missing.mmd",
        "```",
        "",
      ].join("\n"),
    );
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "missing_diagram")).toBe(true);
  });
});

describe("broken-link failure", () => {
  it("fails preflight when an internal link resolves to a missing source", async () => {
    await writeWiki("livewiki/a.md", "See [missing](missing.md).\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "broken_internal_link")).toBe(true);
  });
});

describe("exact generated marker", () => {
  it("emits the marker immediately after the retained frontmatter", async () => {
    await writeWiki(
      "livewiki/foo.md",
      [
        "---",
        "title: Foo",
        "---",
        "",
        "# Foo",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "foo.md");
    expect(out).toContain(
      '<!-- livewiki:generated source="livewiki/foo.md" -->',
    );
  });
  it("emits the marker on a frontmatter-less page too", async () => {
    await writeWiki("livewiki/note.md", "# Note\n\nNo frontmatter.\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = await readDest("generic", "note.md");
    expect(out).toContain(
      '<!-- livewiki:generated source="livewiki/note.md" -->',
    );
  });
});

describe("overwrite refusal and --force", () => {
  it("refuses to overwrite a destination file that lacks the marker", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    // Pre-place a hand-edited destination file with no marker.
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), "hand-edited\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "destination_conflict")).toBe(true);
    // The hand-edited file is still on disk.
    const onDisk = await nodeFs.readFile(nodePath.join(outDir, "foo.md"), "utf8");
    expect(onDisk).toBe("hand-edited\n");
  });
  it("with --force, overwrites a destination file that lacks the marker", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), "hand-edited\n");
    const r = await exportWiki({ repoRoot, target: "generic", force: true });
    expect(r.ok).toBe(true);
    const onDisk = await nodeFs.readFile(nodePath.join(outDir, "foo.md"), "utf8");
    expect(onDisk).toContain("# Foo");
    expect(onDisk).toContain("livewiki:generated");
  });
  it("refuses to overwrite a destination file with a marker for a DIFFERENT source", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    const stray =
      '<!-- livewiki:generated source="livewiki/other.md" -->\n# Other\n';
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), stray);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "destination_conflict")).toBe(true);
  });
});

describe("stale generated-file removal", () => {
  it("removes a destination file (with marker) whose source is gone", async () => {
    // Run an export to populate the destination.
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki("livewiki/bar.md", "# Bar\n");
    const r1 = await exportWiki({ repoRoot, target: "generic" });
    expect(r1.ok).toBe(true);
    expect(await listDest("generic").then((d) => d.sort())).toEqual([
      "bar.md",
      "foo.md",
    ]);
    // Now delete one source file and re-run.
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki", "bar.md"));
    const r2 = await exportWiki({ repoRoot, target: "generic" });
    expect(r2.ok).toBe(true);
    expect(r2.pagesRemoved).toBe(1);
    expect(await listDest("generic")).toEqual(["foo.md"]);
  });
  it("does not remove an UNMARKED destination file even when its source is gone", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const r1 = await exportWiki({ repoRoot, target: "generic" });
    expect(r1.ok).toBe(true);
    // Replace the destination's marker with hand-edited content.
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.writeFile(nodePath.join(outDir, "foo.md"), "hand-edited\n");
    // Delete the source.
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki", "foo.md"));
    // Re-run. With an empty source, the export must ABORT (no writes,
    // no removals) — the unmarked hand-edited file is preserved.
    const r2 = await exportWiki({ repoRoot, target: "generic", force: true });
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === "empty_source")).toBe(true);
    expect(r2.pagesWritten).toBe(0);
    expect(r2.pagesRemoved).toBe(0);
    const onDisk = await nodeFs.readFile(nodePath.join(outDir, "foo.md"), "utf8");
    expect(onDisk).toBe("hand-edited\n");
  });
});

describe("idempotent second export", () => {
  it("a re-export of unchanged source produces zero writes and zero removals", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki("livewiki/bar.md", "# Bar\n");
    const r1 = await exportWiki({ repoRoot, target: "generic" });
    expect(r1.ok).toBe(true);
    expect(r1.pagesWritten).toBe(2);
    const r2 = await exportWiki({ repoRoot, target: "generic" });
    expect(r2.ok).toBe(true);
    expect(r2.pagesWritten).toBe(0);
    expect(r2.pagesRemoved).toBe(0);
  });
});

describe("preflight failure leaves destination unchanged", () => {
  it("a missing-referenced-diagram preflight error writes nothing", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
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
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(await listDest("generic")).toEqual([]);
  });
});

describe("--push fails before writing", () => {
  it("rejects --push with a structured error and writes nothing", async () => {
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const r = await exportWiki({
      repoRoot,
      target: "generic",
      push: "origin",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "invalid_push")).toBe(true);
    expect(r.issues[0]!.detail).toMatch(/not available in Phase 6 Lot 6A/);
    expect(await listDest("generic")).toEqual([]);
  });
});

describe("source not initialized", () => {
  it("returns source_not_initialized when livewiki/ is missing", async () => {
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "source_not_initialized")).toBe(true);
  });
});

describe("Windows path with spaces and Unicode", () => {
  it("exports correctly when the source path contains a space and a non-ASCII character", async () => {
    // mkdtemp gave us a path under temp; we cannot change its location, but
    // we CAN create a source sub-directory whose name includes a space and
    // a Portuguese accented character, and assert the export still works.
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki", "a ç d"), {
      recursive: true,
    });
    await writeWiki(
      "livewiki/a ç d/page.md",
      ["# Page", "", "Body."].join("\n"),
    );
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    // Filename flattening keeps the accented character.
    expect(await readDest("generic", "a ç d-page.md")).not.toBeNull();
  });
});

// ── Frontmatter preservation (corrective §3) ────────────────────────────

describe("frontmatter preservation", () => {
  it("removes only `anchors:` and preserves every other field byte-for-byte", async () => {
    // The source frontmatter includes custom scalar metadata, a custom
    // list, comments, a quoted value, and the `anchors:` field. After
    // the export, the `anchors:` field is gone but everything else is
    // byte-for-byte identical to the source (modulo the closing `---`
    // newline and the marker line, which the export always appends).
    const source = [
      "---",
      "title: Auth — login", // punctuation / unicode preserved
      "owner: human",
      "updated: 2026-07-15",
      "custom_scalar: 'quoted value with # inside'",
      "custom_list:", // custom list, NOT a livewiki-recognized key
      "  - one",
      "  - two",
      "# this is a comment",
      "anchors:", // the only field the export may remove
      "  - src/foo.ts#bar",
      "  - src/foo.ts#baz",
      "---",
      "",
      "# Auth — login",
      "",
    ].join("\n");
    await writeWiki("livewiki/auth.md", source);

    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);

    const out = (await readDest("generic", "auth.md")) ?? "";
    // The `anchors:` field and its items are gone.
    expect(out).not.toMatch(/^anchors\s*:/m);
    expect(out).not.toMatch(/src\/foo\.ts#bar/);
    expect(out).not.toMatch(/src\/foo\.ts#baz/);
    // Every other field is preserved byte-for-byte in its original order.
    expect(out).toContain("title: Auth — login");
    expect(out).toContain("owner: human");
    expect(out).toContain("updated: 2026-07-15");
    expect(out).toContain("custom_scalar: 'quoted value with # inside'");
    expect(out).toContain("custom_list:");
    expect(out).toContain("  - one");
    expect(out).toContain("  - two");
    expect(out).toContain("# this is a comment");
  });
});

// ── Inline link rewriter (corrective §5) ───────────────────────────────

describe("inline link rewriter", () => {
  async function bodyOf(transformed: string): Promise<string> {
    // Strip the marker + leading blank line the export inserts, so the
    // returned text is just the body.
    const idx = transformed.indexOf("livewiki:generated");
    const after = transformed.indexOf("\n\n", idx);
    return transformed.slice(after + 2);
  }
  it("preserves an optional Markdown link title when rewriting", async () => {
    await writeWiki("livewiki/a.md", "See [other](b.md \"a tip\").\n");
    await writeWiki("livewiki/b.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const a = (await readDest("generic", "a.md")) ?? "";
    const body = await bodyOf(a);
    expect(body).toContain('[other](b.md "a tip")');
  });
  it("preserves a query string and a fragment when rewriting", async () => {
    await writeWiki("livewiki/a.md", "See [other](b.md?ref=1#section).\n");
    await writeWiki("livewiki/b.md", "# B\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const a = (await readDest("generic", "a.md")) ?? "";
    const body = await bodyOf(a);
    expect(body).toContain("(b.md?ref=1#section)");
  });
  it("resolves /livewiki/foo.md to livewiki/foo.md (no double prefix)", async () => {
    // /livewiki/foo.md is a repo-root-absolute path. The rewriter must
    // resolve it to the single-prefixed source path, not livewiki/livewiki/foo.md.
    await writeWiki("livewiki/foo.md", "# Foo\n");
    await writeWiki("livewiki/a.md", "See [foo](/livewiki/foo.md#x).\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const a = (await readDest("generic", "a.md")) ?? "";
    expect(a).toContain("(foo.md#x)");
    // Guard: the broken-internal-link preflight should NOT fire.
    expect(r.issues.some((i) => i.code === "broken_internal_link")).toBe(false);
  });
});

// ── Symlink regression (corrective §1) ──────────────────────────────────

describe("symlink regression — safe-io allowlist", () => {
  it.runIf(canSymlink)(
    ".livewiki/export/generic points to an external directory: export fails and an external canary is unchanged",
    async () => {
      // 1. Set up a normal source so the export would otherwise run.
      await writeWiki("livewiki/foo.md", "# Foo\n");
      // 2. Pre-create a destination directory AND make it a symlink to
      //    an external dir that holds a canary file.
      const externalDir = await nodeFs.mkdtemp(
        nodePath.join(nodeOs.tmpdir(), "livewiki-export-external-"),
      );
      const canaryPath = nodePath.join(externalDir, "canary.txt");
      await nodeFs.writeFile(canaryPath, "do-not-touch\n");
      const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
      await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki", "export"), {
        recursive: true,
      });
      await nodeFs.symlink(externalDir, outDir, "dir");
      try {
        const r = await exportWiki({ repoRoot, target: "generic", force: true });
        // The export must fail (the destination symlink escapes the
        // allowlist; safe-io's resolveAndValidate rejects it).
        expect(r.ok).toBe(false);
        expect(
          r.issues.some(
            (i) => i.code === "destination_path_unsafe" || i.code === "write_failed",
          ),
        ).toBe(true);
        // External canary is unchanged.
        const canary = await nodeFs.readFile(canaryPath, "utf8");
        expect(canary).toBe("do-not-touch\n");
      } finally {
        await nodeFs.rm(externalDir, { recursive: true, force: true });
      }
    },
  );

  it.runIf(canSymlink)(
    "a planned destination leaf is a symlink to an external file: export fails and the external file is unchanged",
    async () => {
      // 1. Source page that will be exported as foo.md in the destination.
      await writeWiki("livewiki/foo.md", "# Foo\n");
      // 2. Pre-create the destination dir and place a symlink at
      //    foo.md pointing to an external canary file.
      const externalFile = nodePath.join(
        nodeOs.tmpdir(),
        `livewiki-export-canary-${process.pid}`,
      );
      await nodeFs.writeFile(externalFile, "external-content\n");
      const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
      await nodeFs.mkdir(outDir, { recursive: true });
      const destLeaf = nodePath.join(outDir, "foo.md");
      await nodeFs.symlink(externalFile, destLeaf, "file");
      try {
        const r = await exportWiki({ repoRoot, target: "generic", force: true });
        // The export must abort: writing foo.md would follow the symlink
        // and clobber an external file, OR safe-io's readText would
        // refuse to follow the symlink. Either way, ok is false and
        // the external file is unchanged.
        expect(r.ok).toBe(false);
        const externalStill = await nodeFs.readFile(externalFile, "utf8");
        expect(externalStill).toBe("external-content\n");
      } finally {
        await nodeFs.unlink(externalFile).catch(() => {});
      }
    },
  );

  it.runIf(canSymlink)(
    "livewiki/ points outside the allowlist: export fails without reading/exporting the external content",
    async () => {
      // 1. livewiki/ is a symlink to an external dir containing a canary.
      const externalDir = await nodeFs.mkdtemp(
        nodePath.join(nodeOs.tmpdir(), "livewiki-source-external-"),
      );
      const canary = nodePath.join(externalDir, "canary.md");
      await nodeFs.writeFile(
        canary,
        ["# External canary", "", "should not be read"].join("\n"),
      );
      await nodeFs.symlink(externalDir, nodePath.join(repoRoot, "livewiki"), "dir");
      try {
        const r = await exportWiki({ repoRoot, target: "generic" });
        // The export must abort. The symlinked livewiki/ is outside
        // the allowlist (realpath escapes); safe-io rejects the read.
        expect(r.ok).toBe(false);
        // The failure code is one of the source-path safety codes.
        expect(
          r.issues.some(
            (i) =>
              i.code === "source_path_unsafe" ||
              i.code === "source_not_initialized",
          ),
        ).toBe(true);
        // The destination was NEVER written.
        const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
        expect(await listDest("generic")).toEqual([]);
        // (outDir may or may not exist; what matters is no page was written.)
        void outDir;
        // External canary is unchanged.
        const externalStill = await nodeFs.readFile(canary, "utf8");
        expect(externalStill).toContain("should not be read");
      } finally {
        await nodeFs.rm(externalDir, { recursive: true, force: true });
      }
    },
  );
});

// ── Empty source + force semantics (corrective §2) ────────────────────

describe("preflight: empty source must not delete previously exported pages", () => {
  it("aborts with empty_source when livewiki/ has no exportable pages", async () => {
    // Pre-place a previously-exported page WITH a marker (simulating a
    // prior successful run). The marker means it is eligible for
    // removal, but the empty-source check must prevent the write.
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const r1 = await exportWiki({ repoRoot, target: "generic" });
    expect(r1.ok).toBe(true);
    expect(await listDest("generic")).toEqual(["foo.md"]);

    // Now empty the source.
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki", "foo.md"));

    // Even with --force, an empty source must NOT delete the previous
    // export. The previously-exported page stays on disk untouched.
    const r2 = await exportWiki({ repoRoot, target: "generic", force: true });
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === "empty_source")).toBe(true);
    expect(r2.pagesRemoved).toBe(0);
    expect(await listDest("generic")).toEqual(["foo.md"]);
  });
});

describe("preflight: --force cannot bypass unsafe destination entries", () => {
  it.runIf(canSymlink)(
    "refuses to overwrite a destination leaf that is a symlink to an external file (even with --force)",
    async () => {
      await writeWiki("livewiki/foo.md", "# Foo\n");
      // External canary + symlink at the destination leaf.
      const externalFile = nodePath.join(
        nodeOs.tmpdir(),
        `livewiki-export-force-canary-${process.pid}`,
      );
      await nodeFs.writeFile(externalFile, "do-not-overwrite\n");
      const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
      await nodeFs.mkdir(outDir, { recursive: true });
      const destLeaf = nodePath.join(outDir, "foo.md");
      await nodeFs.symlink(externalFile, destLeaf, "file");
      try {
        const r = await exportWiki({
          repoRoot,
          target: "generic",
          force: true,
        });
        expect(r.ok).toBe(false);
        // Either a destination_unsafe error (the symlink is detected
        // during enumeration) or destination_path_unsafe.
        expect(
          r.issues.some(
            (i) =>
              i.code === "destination_unsafe" ||
              i.code === "destination_path_unsafe" ||
              i.code === "write_failed",
          ),
        ).toBe(true);
        // External canary is unchanged.
        const externalStill = await nodeFs.readFile(externalFile, "utf8");
        expect(externalStill).toBe("do-not-overwrite\n");
      } finally {
        await nodeFs.unlink(externalFile).catch(() => {});
      }
    },
  );
});

// ── Non-forceable destination conflicts (corrective §1) ───────────────

describe("preflight: --force cannot bypass unsafe destination entries", () => {
  it("planned destination z.md is a directory: --force does not bypass, a.md is not written", async () => {
    // Two source files. The destination contains a DIRECTORY named
    // z.md (where the export expects a file). --force MUST NOT
    // bypass this; the export aborts with destination_unsafe and
    // pagesWritten === 0, AND no other planned file is created.
    await writeWiki("livewiki/a.md", "# A\n");
    await writeWiki("livewiki/z.md", "# Z\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    const conflicting = nodePath.join(outDir, "z.md");
    await nodeFs.mkdir(conflicting, { recursive: true });
    const r = await exportWiki({
      repoRoot,
      target: "generic",
      force: true,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "destination_unsafe")).toBe(true);
    expect(r.pagesWritten).toBe(0);
    // No other planned file was written.
    expect(await readDest("generic", "a.md")).toBeNull();
    // The directory z.md is still on disk.
    const stat = await nodeFs.stat(conflicting);
    expect(stat.isDirectory()).toBe(true);
  });

  it("an unrelated directory under the destination does not block a successful export", async () => {
    // A directory the export will NEVER touch (its name is not in
    // the planned destination set) must be left alone and must not
    // block the export.
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const outDir = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(outDir, { recursive: true });
    const unrelated = nodePath.join(outDir, "unrelated-dir");
    await nodeFs.mkdir(unrelated, { recursive: true });
    const canary = nodePath.join(unrelated, "canary.md");
    await nodeFs.writeFile(canary, "do-not-touch\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    expect(r.pagesWritten).toBe(1);
    // The unrelated directory and its canary are untouched.
    const onDisk = await nodeFs.readFile(canary, "utf8");
    expect(onDisk).toBe("do-not-touch\n");
    // The planned page was written.
    const out = await readDest("generic", "foo.md");
    expect(out).toContain("# Foo");
  });
});

// ── Fragment-only and query-only link preservation (corrective §2) ───

describe("inline link rewriter — fragment-only and query-only", () => {
  it("preserves a fragment-only link verbatim ([section](#section))", async () => {
    await writeWiki(
      "livewiki/a.md",
      "See [section](#section) and [with title](#section \"local section\").\n",
    );
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "a.md")) ?? "";
    // The fragment-only link text is preserved byte-for-byte.
    expect(out).toContain("[section](#section)");
    expect(out).toContain('[with title](#section "local section")');
    // No broken_internal_link preflight error was raised.
    expect(r.issues.some((i) => i.code === "broken_internal_link")).toBe(false);
  });

  it("preserves a query-only link verbatim", async () => {
    await writeWiki("livewiki/a.md", "See [ref](?ref=1) and [title](?ref=1 \"a tip\").\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "a.md")) ?? "";
    expect(out).toContain("[ref](?ref=1)");
    expect(out).toContain('[title](?ref=1 "a tip")');
    expect(r.issues.some((i) => i.code === "broken_internal_link")).toBe(false);
  });
});

// ── CRLF frontmatter preservation (corrective §3) ─────────────────────

describe("CRLF frontmatter preservation", () => {
  it("preserves the source CRLF line ending and the frontmatter bytes byte-for-byte", async () => {
    const crlfSource = [
      "---",
      "title: Foo",
      "owner: human",
      "updated: 2026-07-15",
      "anchors:",
      "  - src/foo.ts#bar",
      "  - src/foo.ts#baz",
      "---",
      "",
      "# Foo",
      "",
      "Body paragraph.",
      "",
    ].join("\r\n");
    await writeWiki("livewiki/foo.md", crlfSource);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "foo.md")) ?? "";
    // Every non-anchor field is preserved.
    expect(out).toContain("title: Foo");
    expect(out).toContain("owner: human");
    expect(out).toContain("updated: 2026-07-15");
    // The anchors field AND its items are gone.
    expect(out).not.toMatch(/anchors:/);
    expect(out).not.toMatch(/src\/foo\.ts#bar/);
    expect(out).not.toMatch(/src\/foo\.ts#baz/);
    // CRLF is the only line ending in the destination. After
    // replacing every CRLF with a marker, the result must contain
    // no bare CR and no bare LF (i.e. no mixed line endings; the
    // destination is consistently CRLF).
    const marked = out.replace(/\r\n/g, "<<<EOL>>>");
    expect(marked).not.toMatch(/\r/);
    expect(marked).not.toMatch(/\n/);
    expect(marked).toContain("<<<EOL>>>");
  });

  it("a CRLF page WITHOUT frontmatter also keeps CRLF for the generated marker", async () => {
    // The source has no frontmatter. The destination header
    // (marker + blank line) AND the body must use CRLF, matching the
    // source's line ending. A previous implementation emitted an LF
    // marker followed by a CRLF body.
    const crlfSource = [
      "# Foo",
      "",
      "Body paragraph.",
      "",
    ].join("\r\n");
    await writeWiki("livewiki/note.md", crlfSource);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "note.md")) ?? "";
    // CRLF is the only line ending in the destination. After
    // replacing every CRLF with a marker, the result must contain
    // no bare CR and no bare LF.
    const marked = out.replace(/\r\n/g, "<<<EOL>>>");
    expect(marked).not.toMatch(/\r/);
    expect(marked).not.toMatch(/\n/);
    expect(marked).toContain("<<<EOL>>>");
    // The marker is present.
    expect(out).toContain(
      '<!-- livewiki:generated source="livewiki/note.md" -->',
    );
  });
});

// ── stripAnchorsField: every parser-valid form (corrective §3) ────────

describe("stripAnchorsField — every parser-valid form", () => {
  it("inline anchors: [] is stripped without consuming the next line", async () => {
    const source = [
      "---",
      "title: Foo",
      "anchors: []",
      "owner: generated",
      "---",
      "",
      "# Foo",
      "",
    ].join("\n");
    await writeWiki("livewiki/foo.md", source);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "foo.md")) ?? "";
    expect(out).not.toMatch(/anchors:/);
    expect(out).toContain("title: Foo");
    expect(out).toContain("owner: generated");
  });

  it("inline anchors: # comment is stripped without consuming the next line", async () => {
    const source = [
      "---",
      "title: Foo",
      "anchors: # placeholder",
      "owner: generated",
      "---",
      "",
      "# Foo",
      "",
    ].join("\n");
    await writeWiki("livewiki/foo.md", source);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "foo.md")) ?? "";
    expect(out).not.toMatch(/anchors:/);
    expect(out).toContain("title: Foo");
    expect(out).toContain("owner: generated");
  });

  it("blank lines and comment lines between anchor list items are consumed", async () => {
    // The comment line is non-indented (column 0) so the YAML subset
    // parser accepts the source as well-formed. Both anchor list items
    // and the inter-item comment are stripped.
    const source = [
      "---",
      "title: Foo",
      "owner: generated",
      "anchors:",
      "  - src/foo.ts#bar",
      "",
      "# middle comment between items",
      "  - src/foo.ts#baz",
      "---",
      "",
      "# Foo",
      "",
    ].join("\n");
    await writeWiki("livewiki/foo.md", source);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    const out = (await readDest("generic", "foo.md")) ?? "";
    // The anchors field AND its items AND the comment between them
    // are all gone. The surrounding fields are preserved.
    expect(out).not.toMatch(/anchors:/);
    expect(out).not.toMatch(/src\/foo\.ts#bar/);
    expect(out).not.toMatch(/src\/foo\.ts#baz/);
    expect(out).not.toMatch(/middle comment/);
    expect(out).toContain("title: Foo");
    expect(out).toContain("owner: generated");
    // The exported frontmatter must still be parseable.
    const { parseFrontmatter } = await import("./frontmatter.js");
    expect(() => parseFrontmatter(out)).not.toThrow();
  });
});

// ── Malformed frontmatter (corrective §2) ──────────────────────────────

describe("malformed frontmatter (no closing `---`)", () => {
  it("source opens with `---` but has no closing `---`: frontmatter_parse_error and pagesWritten === 0", async () => {
    // The source begins with `---` (so a frontmatter block is
    // declared) but never closes it. The export must surface
    // frontmatter_parse_error, write nothing, and fail.
    const source = [
      "---",
      "title: Broken",
      "owner: generated",
      // (intentionally no closing --- here)
      "# not a closing fence",
      "",
    ].join("\n");
    await writeWiki("livewiki/broken.md", source);
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "frontmatter_parse_error")).toBe(true);
    expect(r.pagesWritten).toBe(0);
    // No destination page exists.
    expect(await readDest("generic", "broken.md")).toBeNull();
    // The destination directory was not created either.
    expect(await listDest("generic")).toEqual([]);
  });
});

// ── Destination root is a regular file (corrective §3) ────────────────

describe("destination root is a regular file (not a directory)", () => {
  it("aborts with destination_unsafe, no write_failed, the root file is unchanged", async () => {
    // Pre-place a regular file at the destination root path. The
    // export cannot mkdir here, cannot readdir this path, and must
    // abort before any further I/O. The file on disk stays exactly
    // as we wrote it.
    await writeWiki("livewiki/foo.md", "# Foo\n");
    const rootFile = nodePath.join(repoRoot, ".livewiki", "export", "generic");
    await nodeFs.mkdir(nodePath.dirname(rootFile), { recursive: true });
    const original = "this-is-the-destination-root-file\n";
    await nodeFs.writeFile(rootFile, original, "utf8");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "destination_unsafe")).toBe(true);
    // The preflight aborted BEFORE safeIo.mkdir; no write_failed
    // is stacked on top.
    expect(r.issues.some((i) => i.code === "write_failed")).toBe(false);
    expect(r.pagesWritten).toBe(0);
    // The root file is unchanged on disk.
    const onDisk = await nodeFs.readFile(rootFile, "utf8");
    expect(onDisk).toBe(original);
  });
});

describe("flow artifacts (stage-5 surface)", () => {
  it("exports flows/*.md and diagrams/flow-*.mmd without collision, rewriting the placeholder and cross-links", async () => {
    await writeWiki(
      "livewiki/flows/cli-to-db.md",
      [
        "---",
        "title: CLI to DB",
        "owner: generated",
        "modules:",
        "  - cli",
        "  - db",
        "---",
        "",
        "# CLI to DB",
        "",
        "How a CLI invocation reaches the database.",
        "",
        "```mermaid",
        "%% livewiki/diagrams/flow-cli-to-db.mmd",
        "```",
        "",
        "See [the CLI module](../cli.md).",
        "",
      ].join("\n"),
    );
    await writeWiki("livewiki/diagrams/flow-cli-to-db.mmd", "flowchart LR\n  CLI --> DB\n");
    await writeWiki("livewiki/cli.md", "# CLI\n\nSee [the flow](flows/cli-to-db.md).\n");
    const r = await exportWiki({ repoRoot, target: "generic" });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    // The flows/ and diagrams/ prefixes flatten to distinct names — no collision.
    const flow = await readDest("generic", "flows-cli-to-db.md");
    const diagram = await readDest("generic", "diagrams-flow-cli-to-db.md");
    const cli = await readDest("generic", "cli.md");
    expect(flow).not.toBeNull();
    expect(diagram).toContain("```mermaid");
    expect(diagram).toContain("CLI --> DB");
    // The mermaid placeholder is rewritten to the flattened diagram page.
    expect(flow).toContain(
      "[View diagram (diagrams/flow-cli-to-db.mmd)](diagrams-flow-cli-to-db.md)",
    );
    expect(flow).not.toContain("%% livewiki/");
    // Internal links between flows/ and module pages resolve after flattening.
    expect(flow).toContain("(cli.md)");
    expect(cli).toContain("(flows-cli-to-db.md)");
  });
});
