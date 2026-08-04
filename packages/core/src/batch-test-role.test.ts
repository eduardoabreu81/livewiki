/**
 * batch-test-role.test.ts — #24 (2026-08-04): test-role classification
 * end-to-end through the batch orchestrator (stub LLM, zero paid calls).
 *
 * Contracts covered:
 *   - co-located test files become their own `<id>-tests` module and are
 *     documented through the deterministic auxiliary channel — ZERO LLM
 *     calls for them, anchored page on disk;
 *   - a full run removes stale generated module pages from a previous
 *     partition (`removedStalePages`) and preserves human pages;
 *   - an `--only` run NEVER removes stale pages (its re-derived partition
 *     may differ from a previously refined one — footgun guard);
 *   - verify ends clean on the migrated wiki.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, runOnly } from "./batch.js";
import { run as runVerify } from "./verify.js";
import { runInit } from "./init.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";

function parseClosedKeys(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

/** Valid stage-4 product page (same shape as the other batch suites). */
function makeValidPage(closedKeyList: string[]): string {
  return [
    "---",
    "title: test",
    "owner: generated",
    "anchors:",
    ...closedKeyList.map((k) => `  - ${k}`),
    "---",
    "",
    "# test",
    "",
    "This page documents the module's indexed responsibilities.",
    "",
    "## When to use this page",
    "",
    "- Review this module's behavior.",
    "- Change this module's implementation.",
    "",
    "## How it fits",
    "",
    "This module provides one part of the repository implementation.",
    "",
    "## Details",
    "",
    `<!-- lw:anchors ${closedKeyList.join(" ")} -->`,
    "",
    "Body.",
    "",
  ].join("\n");
}

class TestRoleMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callLog: string[] = [];

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callLog.push(req.user);
    return {
      content: makeValidPage(parseClosedKeys(req.user)),
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

function staleGeneratedPage(): string {
  return ["---", "title: Ghost", "owner: generated", "---", "", "# Ghost", "", "Body.", ""].join("\n");
}

describe("batch — #24 test-role classification", () => {
  let repoRoot: string;
  let llm: TestRoleMockLlm;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-test-role-"));
    llm = new TestRoleMockLlm();
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    // Disable every stage-5 surface: this suite is about stage-4 routing.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        moduleDiagrams: false,
        deepHierarchy: false,
        maxFlows: 0,
        maxTopics: 0,
        understandingSynthesis: false,
      }),
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/utils"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 'auth'; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.test.ts"),
      "export function loginWorks() { return true; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/utils/helper.ts"),
      "export function help() { return 1; }\n",
      "utf8",
    );
    // Deterministic layout first (structure/modules .mmd, overview, hubs) —
    // mirrors the real `init --batch` flow and keeps verify clean.
    await runInit({ repoRoot, quiet: true });
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  async function exists(rel: string): Promise<boolean> {
    return nodeFs.access(nodePath.join(repoRoot, rel)).then(() => true).catch(() => false);
  }

  it("full run: test module documented with zero LLM calls; stale generated pages removed, human preserved", async () => {
    // Leftovers from a previous partition.
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "livewiki/auth-01.md"), staleGeneratedPage(), "utf8");
    await nodeFs.writeFile(nodePath.join(repoRoot, "livewiki/human-legacy.md"), staleGeneratedPage().replace("owner: generated", "owner: human"), "utf8");

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    // Product modules only: auth (login.ts) + utils. The auth-tests module
    // went through the deterministic auxiliary channel — zero LLM calls.
    expect(llm.callLog).toHaveLength(2);

    // Pages: product via LLM, tests via the auxiliary channel.
    expect(await exists("livewiki/auth.md")).toBe(true);
    expect(await exists("livewiki/utils.md")).toBe(true);
    const testPage = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth-tests.md"), "utf8");
    expect(testPage).toContain("automated tests");
    expect(testPage).toContain("src/auth/login.test.ts#loginWorks");

    // Stale cleanup: generated leftover removed + surfaced; human preserved.
    expect(result.removedStalePages).toEqual(["livewiki/auth-01.md"]);
    expect(await exists("livewiki/auth-01.md")).toBe(false);
    expect(await exists("livewiki/human-legacy.md")).toBe(true);

    const verify = await runVerify(repoRoot);
    expect(verify.issues).toEqual([]);
  });

  it("--only NEVER removes stale pages (partition may differ from a refined one)", async () => {
    const full = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(full.status).toBe("completed");

    await nodeFs.writeFile(nodePath.join(repoRoot, "livewiki/ghost-only.md"), staleGeneratedPage(), "utf8");
    const only = await runOnly({
      repoRoot,
      llmClient: llm,
      onlyTarget: "auth",
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(only.status).toBe("completed");
    expect(only.removedStalePages).toBeUndefined();
    expect(await exists("livewiki/ghost-only.md")).toBe(true);
  });
});
