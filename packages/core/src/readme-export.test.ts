/**
 * readme-export — deterministic README.md synthesis from the wiki.
 *
 * Covers: content generation from a fixture wiki (purpose, digests,
 * flows/topics links, fallbacks), the rule-#6 contract (create /
 * replace-block preserving outside bytes / refuse without marker),
 * idempotence, the missing-quickstart error, and the dry-run (writes
 * nothing). No LLM, no paid calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  README_START,
  README_END,
  ReadmeExportError,
  applyReadme,
  findReadmeBlock,
  generateReadmeContent,
  exportReadme,
} from "./readme-export.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-readme-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

async function readOrNull(rel: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(nodePath.join(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}

const QUICKSTART = [
  "# Quickstart",
  "",
  "## What this repository is",
  "",
  "WidgetKit is a toolkit for rendering dashboard widgets from declarative configs.",
  "",
  "*(Purpose excerpt from the repository README: `README.old.md`.)*",
  "",
  "## What you'll find in this wiki",
  "",
  "- **[Renderer](renderer.md)** — Renders widget trees into the host surface.",
  "- **[Config loader](config-loader.md)** — Parses and validates widget configs.",
  "- **[State store](state-store.md)**",
  "",
  "## Work by intent",
  "",
  "- **Change product behavior:** start with [Tasks](tasks.md).",
  "",
].join("\n");

const FLOWS_INDEX = [
  "---",
  "title: How it works",
  "owner: generated",
  "---",
  "",
  "# How it works",
  "",
  "Each page below explains one principal end-to-end flow across modules, with its companion diagram.",
  "",
  "### [Config to render](config-to-render.md)",
  "",
].join("\n");

const TOPICS_INDEX = [
  "# Concept topics",
  "",
  "- [Deployment](deployment.md)",
  "",
].join("\n");

async function writeFixtureWiki(): Promise<void> {
  await write("livewiki/quickstart.md", QUICKSTART);
  await write("livewiki/tasks.md", "# Tasks\n");
  await write("livewiki/flows/index.md", FLOWS_INDEX);
  await write("livewiki/topics/index.md", TOPICS_INDEX);
}

describe("generateReadmeContent", () => {
  it("builds purpose, digests, and flow/topic links from the wiki", async () => {
    await writeFixtureWiki();
    const content = await generateReadmeContent(repoRoot);
    expect(content).toContain(
      "WidgetKit is a toolkit for rendering dashboard widgets",
    );
    expect(content).not.toContain("Purpose excerpt from");
    expect(content).toContain("## Documentation");
    expect(content).toContain("[quickstart](livewiki/quickstart.md)");
    expect(content).toContain(
      "- **[Renderer](livewiki/renderer.md)** — Renders widget trees into the host surface.",
    );
    // Title-link-only digest entry (no responsibility) survives as a link only.
    expect(content).toContain("- **[State store](livewiki/state-store.md)**");
    expect(content).toContain("- [Config to render](livewiki/flows/config-to-render.md)");
    expect(content).toContain("- [Deployment](livewiki/topics/deployment.md)");
    expect(content).toContain(`# ${nodePath.basename(repoRoot)}`);
  });

  it("omits flow/topic sections when the hubs are absent (never an error)", async () => {
    await write("livewiki/quickstart.md", QUICKSTART);
    const content = await generateReadmeContent(repoRoot);
    expect(content).not.toContain("## How it works");
    expect(content).not.toContain("## Concept topics");
    expect(content).toContain("## Documentation");
  });

  it("falls back to the digest synthesis when no purpose paragraph exists", async () => {
    await write(
      "livewiki/quickstart.md",
      [
        "# Quickstart",
        "",
        "## What you'll find in this wiki",
        "",
        "- **[Renderer](renderer.md)** — Renders widget trees.",
        "- **[Config loader](config-loader.md)** — Parses widget configs.",
        "",
      ].join("\n"),
    );
    const content = await generateReadmeContent(repoRoot);
    expect(content).toContain(
      "This repository is organized around Renderer (Renders widget trees.) and Config loader (Parses widget configs.).",
    );
  });

  it("falls back to a neutral sentence naming the repo directory", async () => {
    await write("livewiki/quickstart.md", "# Quickstart\n\n## Work by intent\n\n- x\n");
    const content = await generateReadmeContent(repoRoot);
    expect(content).toContain(`This is the \`${nodePath.basename(repoRoot)}\` repository.`);
  });

  it("throws missing_wiki when livewiki/quickstart.md does not exist", async () => {
    await expect(generateReadmeContent(repoRoot)).rejects.toThrow(ReadmeExportError);
    await expect(generateReadmeContent(repoRoot)).rejects.toThrow(/livewiki init/);
  });

  it("notes non-English wiki language in the export result", async () => {
    await writeFixtureWiki();
    await write(".livewiki/config.json", JSON.stringify({ language: "pt-BR" }));
    const result = await exportReadme(repoRoot, { yes: true });
    expect(result.ok).toBe(true);
    expect(result.notes.some((n) => n.includes("pt-BR"))).toBe(true);
  });
});

describe("applyReadme (rule #6 contract)", () => {
  const generated = "# repo\n\nSome purpose.\n";

  it("creates a full file wrapped in markers when README.md is absent", () => {
    const result = applyReadme(null, generated);
    expect("refusal" in result).toBe(false);
    if ("refusal" in result) return;
    expect(result.action).toBe("create");
    expect(result.content).toContain(README_START);
    expect(result.content).toContain(README_END);
    expect(result.content).toContain("Some purpose.");
    expect(result.content).toContain("livewiki export readme --yes");
  });

  it("replaces only the block content, preserving outside bytes exactly", () => {
    const existing =
      "# My Project\n\nHuman intro stays.\n\n" +
      `${README_START}\n\nold generated\n\n${README_END}\n` +
      "\nHuman footer stays — äccents and  emoji.\n";
    const result = applyReadme(existing, generated);
    expect("refusal" in result).toBe(false);
    if ("refusal" in result) return;
    expect(result.action).toBe("replace-block");
    expect(result.content.startsWith("# My Project\n\nHuman intro stays.\n\n")).toBe(true);
    expect(result.content.endsWith("\nHuman footer stays — äccents and  emoji.\n")).toBe(true);
    expect(result.content).toContain("Some purpose.");
    expect(result.content).not.toContain("old generated");
  });

  it("refuses a marker-less README with the exact opt-in instructions", () => {
    const result = applyReadme("# Human README\n", generated);
    expect("refusal" in result).toBe(true);
    if (!("refusal" in result)) return;
    expect(result.refusal).toContain("never overwritten");
    expect(result.refusal).toContain(README_START);
    expect(result.refusal).toContain(README_END);
  });

  it("is idempotent: applying the result again reports unchanged", () => {
    const first = applyReadme(null, generated);
    if ("refusal" in first) throw new Error("unexpected refusal");
    const second = applyReadme(first.content, generated);
    expect("refusal" in second).toBe(false);
    if ("refusal" in second) return;
    expect(second.action).toBe("unchanged");
    expect(second.content).toBe(first.content);
  });

  it("treats a truncated block (no end marker) as absent and refuses", () => {
    const existing = `# x\n\n${README_START}\n\norphan\n`;
    expect(findReadmeBlock(existing)).toBeNull();
    expect("refusal" in applyReadme(existing, generated)).toBe(true);
  });
});

describe("exportReadme", () => {
  it("dry-run reports the planned action and writes nothing", async () => {
    await writeFixtureWiki();
    const result = await exportReadme(repoRoot);
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.action).toBe("create");
    expect(result.bytesChanged).toBe(0);
    expect(result.preview!.join("\n")).toContain(README_START);
    expect(await readOrNull("README.md")).toBeNull();
  });

  it("writes with yes:true and is idempotent on re-run", async () => {
    await writeFixtureWiki();
    const first = await exportReadme(repoRoot, { yes: true });
    expect(first.ok).toBe(true);
    expect(first.action).toBe("create");
    expect(first.bytesChanged).toBeGreaterThan(0);
    const onDisk = await readOrNull("README.md");
    expect(onDisk).toContain(README_START);

    const second = await exportReadme(repoRoot, { yes: true });
    expect(second.action).toBe("unchanged");
    expect(second.bytesChanged).toBe(0);
    expect(await readOrNull("README.md")).toBe(onDisk);
  });

  it("refuses a marker-less README even with yes:true (exit path ok:false)", async () => {
    await writeFixtureWiki();
    await write("README.md", "# Hand-written\n");
    const result = await exportReadme(repoRoot, { yes: true });
    expect(result.ok).toBe(false);
    expect(result.action).toBe("refused");
    expect(result.refusal).toContain(README_START);
    expect(await readOrNull("README.md")).toBe("# Hand-written\n");
  });

  it("replaces the block in an opted-in README, preserving human text", async () => {
    await writeFixtureWiki();
    await write(
      "README.md",
      `# Mine\n\nIntro.\n\n${README_START}\n\nstale\n\n${README_END}\n\nFooter.\n`,
    );
    const result = await exportReadme(repoRoot, { yes: true });
    expect(result.ok).toBe(true);
    expect(result.action).toBe("replace-block");
    const onDisk = await readOrNull("README.md");
    expect(onDisk).toContain("Intro.");
    expect(onDisk).toContain("Footer.");
    expect(onDisk).toContain("WidgetKit is a toolkit");
    expect(onDisk).not.toContain("stale");
  });

  it("fails clearly when the wiki is missing", async () => {
    await expect(exportReadme(repoRoot, { yes: true })).rejects.toThrow(ReadmeExportError);
    expect(await readOrNull("README.md")).toBeNull();
  });
});

// ── Item 23: the understanding synthesis is the purpose paragraph ──────────

describe("generateReadmeContent — understanding synthesis (item 23)", () => {
  const UNDERSTANDING_PAGE = [
    "---",
    "title: WidgetKit",
    "owner: generated",
    "kind: understanding",
    "updated: 2026-08-03",
    "---",
    "",
    "# WidgetKit",
    "",
    "WidgetKit is a small engine that turns declarative configs into rendered dashboard widgets for product teams.",
    "",
    "## Key surfaces",
    "",
    "- Declarative widget configs",
    "- Dashboard rendering pipeline",
    "",
  ].join("\n");

  it("prefers the synthesis over the quickstart purpose paragraph", async () => {
    await writeFixtureWiki();
    await write("livewiki/understanding.md", UNDERSTANDING_PAGE);
    const content = await generateReadmeContent(repoRoot);
    expect(content).toContain(
      "WidgetKit is a small engine that turns declarative configs into rendered dashboard widgets for product teams.",
    );
    // The quickstart-extracted purpose loses to the synthesis.
    expect(content).not.toContain("WidgetKit is a toolkit for rendering dashboard widgets");
  });

  it("falls back to the quickstart purpose when the synthesis is absent or unrecognizable", async () => {
    await writeFixtureWiki();
    const without = await generateReadmeContent(repoRoot);
    expect(without).toContain("WidgetKit is a toolkit for rendering dashboard widgets");
    await write("livewiki/understanding.md", "not a page at all\n");
    const garbage = await generateReadmeContent(repoRoot);
    expect(garbage).toContain("WidgetKit is a toolkit for rendering dashboard widgets");
  });
});
