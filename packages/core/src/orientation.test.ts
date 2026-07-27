import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import {
  extractPurpose,
  extractRepoOrientation,
  findFastPathSection,
  PURPOSE_MAX_CHARS,
} from "./orientation.js";

describe("repo orientation (D1)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-orientation-"));
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  async function write(rel: string, content: string): Promise<void> {
    const abs = nodePath.join(repoRoot, rel);
    await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
    await nodeFs.writeFile(abs, content, "utf8");
  }

  it("skips MPTP-style HTML blocks, badges, and language switchers to reach the first prose paragraph", async () => {
    await write("README.md", [
      "<div align=\"center\">",
      "  <img src=\"docs/logo.png\" alt=\"logo\" width=\"200\"/>",
      "  <h1>MoneyPrinterTurbo-Plus</h1>",
      "  <p>Badges below</p>",
      "</div>",
      "",
      "[![CI](https://img.shields.io/badge/ci-passing-green)](https://ci.example) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)",
      "",
      "[English](README.en.md) | [中文](README.zh.md)",
      "",
      "# MoneyPrinterTurbo-Plus",
      "",
      "MoneyPrinterTurbo-Plus turns a short topic brief into a fully rendered short video, wiring script generation, voice synthesis, subtitle alignment, and stock footage assembly into one local pipeline.",
      "",
      "## Quick Start",
      "",
      "1. Clone the repository.",
    ].join("\n"));

    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.readmePath).toBe("README.md");
    expect(orientation.purpose).toBe(
      "MoneyPrinterTurbo-Plus turns a short topic brief into a fully rendered short video, wiring script generation, voice synthesis, subtitle alignment, and stock footage assembly into one local pipeline.",
    );
    expect(orientation.fastPathSection).toBe("Quick Start");
  });

  it("traverses HTML containers to reach the purpose sentence inside them (real MPTP README head)", async () => {
    // The real MoneyPrinterTurbo-Plus head: the product purpose sentence sits
    // INSIDE the centered header div; the first plain-markdown paragraph is
    // the "About This Fork" colon lead-in, which is not a purpose statement.
    await write("README.md", [
      "<div align=\"center\">",
      "  <img src=\"docs/logo.png\" alt=\"logo\" width=\"200\"/>",
      "  <h1>MoneyPrinterTurbo-Plus</h1>",
      "  <a href=\"https://ci.example\"><img src=\"https://img.shields.io/badge/ci-passing-green\"/></a>",
      "",
      "Simply provide a <b>topic</b> or <b>keyword</b>, and it will automatically generate the video copy, video materials, video subtitles, and video background music, then synthesize a high-definition short video with one click.",
      "</div>",
      "",
      "### WebUI",
      "",
      "## About This Fork",
      "",
      "This is a fork of [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo), with additional features ported/built on top:",
      "",
      "- Feature one",
      "- Feature two",
    ].join("\n"));

    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.purpose).toBe(
      "Simply provide a topic or keyword, and it will automatically generate the video copy, video materials, video subtitles, and video background music, then synthesize a high-definition short video with one click.",
    );
    expect(orientation.purpose).not.toContain("<b>");
    expect(orientation.purpose).not.toContain("fork");
  });

  it("rejects a colon-terminated list lead-in and keeps scanning to the next paragraph", () => {
    const purpose = extractPurpose([
      "This repository extends the upstream project with additional features ported on top:",
      "",
      "The pipeline renders short videos from a topic brief, wiring script generation, voice synthesis, and subtitle alignment into one local flow.",
    ].join("\n"));
    expect(purpose).toBe(
      "The pipeline renders short videos from a topic brief, wiring script generation, voice synthesis, and subtitle alignment into one local flow.",
    );
  });

  it("returns null when the only prose candidate is a list lead-in", () => {
    expect(
      extractPurpose([
        "This is a fork of [upstream/project](https://example.com), with additional features ported/built on top:",
        "",
        "- Feature one",
        "- Feature two",
      ].join("\n")),
    ).toBeNull();
    // Fullwidth colon lead-ins are rejected the same way.
    expect(
      extractPurpose("这是一个用于本地视频生成的工具仓库分支，新增功能与特性说明如下：\n"),
    ).toBeNull();
  });

  it("reads plain prose READMEs and detects surfaces in the planned order", async () => {
    await write("README.md", "Plain tool.\n\nThis repository indexes local files and serves them over a tiny HTTP interface for quick browsing.\n");
    await write("main.py", "print('hi')\n");
    await write("Dockerfile", "FROM python:3\n");
    await write("pyproject.toml", "[project]\nname = 'x'\n");
    await write("go.mod", "module example.com/x\n");
    await write("Cargo.toml", "[package]\nname = 'x'\n");
    await write("package.json", JSON.stringify({ name: "x", bin: { x: "dist/cli.js" } }));

    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.purpose).toBe(
      "This repository indexes local files and serves them over a tiny HTTP interface for quick browsing.",
    );
    expect(orientation.surfaces).toEqual([
      "Python entry point: `main.py`",
      "Node.js CLI entry point declared in `package.json` (`bin`)",
      "Container build file: `Dockerfile`",
      "Python project metadata: `pyproject.toml`",
      "Go module definition: `go.mod`",
      "Rust crate manifest: `Cargo.toml`",
    ]);
  });

  it("falls back to a zh-only README when README.md and README.en.md are absent", async () => {
    await write(
      "README.zh.md",
      "# 项目\n\n这是一个用于本地视频生成的工具仓库，支持脚本生成、语音合成与字幕对齐的完整流水线。\n",
    );
    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.readmePath).toBe("README.zh.md");
    expect(orientation.purpose).toContain("本地视频生成");
    expect(orientation.purpose).not.toContain("#");
  });

  it("prefers README.md over README.en.md and uses README.en.md when README.md is absent", async () => {
    await write("README.en.md", "English fallback text that describes what this repository actually does for its users.\n");
    let orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.readmePath).toBe("README.en.md");
    expect(orientation.purpose).toContain("English fallback text");

    await write("README.md", "Primary text that describes what this repository actually does for its users.\n");
    orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.readmePath).toBe("README.md");
    expect(orientation.purpose).toContain("Primary text");
  });

  it("returns null purpose and readmePath when no README exists, and never invents text", async () => {
    await write("src/app.ts", "export const x = 1;\n");
    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.purpose).toBeNull();
    expect(orientation.readmePath).toBeNull();
    expect(orientation.fastPathSection).toBeNull();
    expect(orientation.surfaces).toEqual([]);
  });

  it("clips long paragraphs at a sentence boundary within the character cap", () => {
    const sentence = "This is a fairly long sentence that describes the repository purpose in detail and keeps going with more clauses. ";
    const long = sentence.repeat(12).trim();
    const clipped = extractPurpose(long);
    expect(clipped).not.toBeNull();
    expect(clipped!.length).toBeLessThanOrEqual(PURPOSE_MAX_CHARS);
    expect(clipped!).toMatch(/[.。]$/);
    expect(clipped!).not.toContain("…");
  });

  it("hard-clips at a word boundary with an ellipsis when the first sentence exceeds the cap", () => {
    const long = `${"word ".repeat(200).trim()} tail`;
    const clipped = extractPurpose(long);
    expect(clipped).not.toBeNull();
    expect(clipped!.length).toBeLessThanOrEqual(PURPOSE_MAX_CHARS + 1);
    expect(clipped!).toMatch(/…$/);
    // The cut lands on a word boundary: the source continues with a space.
    const cut = clipped!.slice(0, -1);
    expect(long.startsWith(cut)).toBe(true);
    expect(long[cut.length]).toBe(" ");
  });

  it("ignores fragments below the meaningful threshold and keeps scanning", () => {
    const purpose = extractPurpose([
      "Short.",
      "",
      "This paragraph carries enough prose to describe the repository purpose for a new reader.",
    ].join("\n"));
    expect(purpose).toBe(
      "This paragraph carries enough prose to describe the repository purpose for a new reader.",
    );
  });

  it("detects manage.py and package.json main surfaces", async () => {
    await write("manage.py", "# django\n");
    await write("package.json", JSON.stringify({ name: "x", main: "dist/index.js" }));
    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.surfaces).toEqual([
      "Django management entry point: `manage.py`",
      "Node.js package entry point declared in `package.json` (`main`)",
    ]);
  });

  it("tolerates a malformed package.json without failing the whole extraction", async () => {
    await write("package.json", "{ not json");
    await write("README.md", "A repository whose package manifest is broken but whose documentation still reads fine.\n");
    const orientation = await extractRepoOrientation(repoRoot);
    expect(orientation.purpose).toContain("package manifest is broken");
    expect(orientation.surfaces).toEqual([]);
  });

  it("findFastPathSection matches common fast-path headings and nothing else", () => {
    expect(findFastPathSection("## Getting Started\nx\n")).toBe("Getting Started");
    expect(findFastPathSection("## Architecture\nx\n")).toBeNull();
    expect(findFastPathSection("plain prose\n")).toBeNull();
  });
});
