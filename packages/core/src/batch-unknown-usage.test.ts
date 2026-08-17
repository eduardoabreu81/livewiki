/**
 * Unknown usage is not zero usage.
 *
 * An OpenAI-compatible proxy can answer 200 with no `usage` block. The
 * adapter then reports `usage: null`, and every accounting surface must
 * carry that through as `usageKnown: false` + `usageIncomplete` instead of
 * booking a real 0/0 call — the cost report is the product's central metric.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";

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

/** Answers valid content, but never reports usage (proxy without accounting). */
class UsagelessLlm implements LlmClient {
  public readonly provider = "openai-compat" as const;
  public readonly model = "proxy-without-usage";

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return { content: VALID_UNDERSTANDING_PAGE, usage: null };
    }
    if (/purpose paragraph/.test(req.system)) {
      return {
        content:
          "This directory holds the auth module: login, session, and token handling.",
        usage: null,
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
      usage: null,
    };
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-usage-"));
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
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function readCheckpoints(root: string): Promise<TaskCheckpoint[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), { readonly: true });
  try {
    const rows = db
      .prepare("SELECT checkpoint_json FROM batch_tasks WHERE checkpoint_json IS NOT NULL")
      .all() as Array<{ checkpoint_json: string }>;
    return rows.map((row) => JSON.parse(row.checkpoint_json) as TaskCheckpoint);
  } finally {
    db.close();
  }
}

describe("batch — provider response without usage", () => {
  it("records the attempt as unknown usage instead of a real 0/0 call", async () => {
    const result = await runBatch({
      repoRoot,
      llmClient: new UsagelessLlm(),
      noRefine: true,
      skipManifestWrite: false,
    });

    expect(result.status).toBe("completed");

    const attempts = (await readCheckpoints(repoRoot)).flatMap(
      (checkpoint) => checkpoint.usageHistory ?? [],
    );
    expect(attempts.length).toBeGreaterThan(0);
    for (const attempt of attempts) {
      expect(attempt.usageKnown).toBe(false);
      expect(attempt.usage).toBeNull();
      expect(attempt.costUsd).toBeNull();
    }

    // The run total flags the gap instead of claiming measured zero tokens.
    expect(result.totals.usageIncomplete).toBe(true);
    expect(result.totals.inputTokens).toBe(0);
    expect(result.totals.outputTokens).toBe(0);
    expect(result.totals.costUsd).toBeNull();
    expect(result.totals.models).toEqual([]);
  });
});
