/**
 * Wiki pages must land all-or-nothing.
 *
 * `tryWriteAndVerify` (and its diagram/flow variants) assume the write either
 * completes or is rolled back. A plain `writeText` killed mid-`writeFile`
 * breaks that assumption: the next run reads a truncated page as valid
 * content and no rollback can undo it. This suite pins the write of a wiki
 * page to the atomic primitive (temp + rename).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";

vi.mock("./safe-io.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./safe-io.js")>();
  return {
    ...actual,
    writeText: vi.fn(actual.writeText),
    writeTextAtomic: vi.fn(actual.writeTextAtomic),
  };
});

const { runBatch } = await import("./batch.js");
const safeIo = await import("./safe-io.js");

const VALID_UNDERSTANDING_PAGE = [
  "---",
  "title: Test repository",
  "owner: generated",
  "kind: understanding",
  "---",
  "",
  "# Test repository",
  "",
  "This test repository exercises the batch pipeline with a small product surface.",
  "",
].join("\n");

class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return { content: VALID_UNDERSTANDING_PAGE, usage };
    }
    if (/purpose paragraph/.test(req.system)) {
      return {
        content:
          "This directory holds the auth module: login, session, and token handling.",
        usage,
      };
    }
    const fileMatch = req.user.match(/# File: ([^\s]+)/);
    const filePath = fileMatch ? fileMatch[1] : "unknown.ts";
    const keys = [...req.user.matchAll(/^- (\S+#\S+)$/gm)].map((m) => m[1]!);
    const anchorKeys = keys.length > 0 ? keys : [`${filePath}#placeholder`];
    return {
      content: `---
title: ${filePath} responsibilities
owner: generated
anchors:
${anchorKeys.map((k) => `  - ${k}`).join("\n")}
---

# ${filePath} responsibilities

This page documents the responsibilities of ${filePath}.

## When to use this page

- Review ${filePath} behavior.
- Change ${filePath} implementation.

## How it fits

This file provides part of the repository implementation described by the indexed source.

## Details
<!-- lw:anchors ${anchorKeys.join(" ")} -->

Some prose about ${filePath}.
`,
      usage,
    };
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-atomic-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'auth'; }",
    "utf8",
  );
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify({ moduleDiagrams: false, deepHierarchy: false }),
    "utf8",
  );
  vi.mocked(safeIo.writeText).mockClear();
  vi.mocked(safeIo.writeTextAtomic).mockClear();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("batch — wiki page writes are atomic", () => {
  it("writes an accepted page through writeTextAtomic, never through writeText", async () => {
    const result = await runBatch({
      repoRoot,
      llmClient: new MockLlm(),
      noRefine: true,
      skipManifestWrite: false,
    });
    expect(result.status).toBe("completed");

    const pagePath = "livewiki/auth/login.md";
    const atomicPaths = vi
      .mocked(safeIo.writeTextAtomic)
      .mock.calls.map((call) => call[1]);
    const plainPaths = vi.mocked(safeIo.writeText).mock.calls.map((call) => call[1]);

    expect(atomicPaths).toContain(pagePath);
    expect(plainPaths).not.toContain(pagePath);
    // The page on disk is exactly what the transaction accepted.
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, pagePath), "utf8"),
    ).toMatch(/title: src\/auth\/login\.ts/);
  });

  it("leaves no temporary write artifact behind in the wiki", async () => {
    await runBatch({
      repoRoot,
      llmClient: new MockLlm(),
      noRefine: true,
      skipManifestWrite: false,
    });

    const leftovers: string[] = [];
    const stack = [nodePath.join(repoRoot, "livewiki")];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of await nodeFs.readdir(dir, { withFileTypes: true })) {
        const abs = nodePath.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(abs);
        else if (/\.tmp-/.test(entry.name)) leftovers.push(abs);
      }
    }
    expect(leftovers).toEqual([]);
  });
});
