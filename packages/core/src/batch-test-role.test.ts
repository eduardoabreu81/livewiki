/**
 * batch-test-role.test.ts — #24 (2026-08-04) test-role classification
 * end-to-end through the batch orchestrator (stub LLM, zero paid calls),
 * rewritten for the #29 real-units contract (D3: ZERO test pages).
 *
 * Contracts covered:
 *   - a 1:1 same-name test file (`login.test.ts` → `login.ts`) never gets
 *     a page and never enters a product page's anchors: the product file
 *     page gains a deterministic "## Tests" pointer appended AFTER
 *     validation (never model prose);
 *   - a full run removes stale generated module pages from a previous
 *     partition (`removedStalePages`) and preserves human pages;
 *   - an `--only` run NEVER removes stale pages (its re-derived partition
 *     may differ from the persisted one — footgun guard);
 *   - test-role exclusion is STRUCTURAL: there is no refine pass under
 *     #29, so no LLM output can merge a test file back into a product
 *     unit;
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
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    // #29 folder page: the model writes ONLY the purpose paragraph
    // (plain prose, 40–800 chars); the skeleton is deterministic.
    if (req.system.includes("purpose paragraph of ONE folder page")) {
      return {
        content:
          "This directory holds product source files whose documented responsibilities are covered by the file pages it groups.",
        usage,
      };
    }
    return { content: makeValidPage(parseClosedKeys(req.user)), usage };
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

  it("full run: 1:1 test becomes a deterministic pointer on the product file page; stale generated pages removed, human preserved", async () => {
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
    // Two file pages (auth/login, utils/helper) + two folder-purpose
    // paragraphs (auth, utils). The paired test file cost ZERO calls.
    expect(llm.callLog).toHaveLength(4);

    // Pages: file pages ride the id-with-slash path; folder pages are the
    // directory index. No test page exists anywhere.
    expect(await exists("livewiki/auth/login.md")).toBe(true);
    expect(await exists("livewiki/auth/index.md")).toBe(true);
    expect(await exists("livewiki/utils/helper.md")).toBe(true);
    expect(await exists("livewiki/utils/index.md")).toBe(true);
    expect(await exists("livewiki/auth-tests.md")).toBe(false);
    const filePage = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(filePage).toContain("## Tests");
    expect(filePage).toContain("Covered by `src/auth/login.test.ts` (same-name test file on disk).");
    // The test file's symbols never enter the product page's anchor set.
    expect(filePage).not.toContain("loginWorks");

    // Stale cleanup: generated leftover removed + surfaced; human preserved.
    expect(result.removedStalePages).toEqual(["livewiki/auth-01.md"]);
    expect(await exists("livewiki/auth-01.md")).toBe(false);
    expect(await exists("livewiki/human-legacy.md")).toBe(true);

    const verify = await runVerify(repoRoot);
    expect(verify.issues).toEqual([]);
  });

  it("--only NEVER removes stale pages (partition may differ from a previously persisted one)", async () => {
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

  it("test-role exclusion is structural: no refine pass exists to merge a test file back into a product unit", async () => {
    // #29 removed the stage-2 LLM refine entirely, so the #24 rehearsal
    // defect (MiniMax-M3 merging login.test.ts back into the product
    // module) has no channel: the planner never assigns a test-role file
    // to a file unit, and no LLM call can re-partition.
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: false,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    // Zero refine/partition calls: only the 2 file pages + 2 folder
    // paragraphs. No prompt carries a grouping proposal.
    expect(llm.callLog).toHaveLength(4);
    expect(llm.callLog.some((user) => user.includes("# Heuristic module grouping:"))).toBe(false);

    const authPage = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(authPage).not.toContain("login.test.ts#");
    expect(authPage).not.toContain("loginWorks");

    // The stage-2 checkpoint is clean done — no degradation to record.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 2")
        .get() as { checkpoint_json: string };
      const cp = JSON.parse(row.checkpoint_json) as { status: string; error?: { code: string } };
      expect(cp.status).toBe("done");
      expect(cp.error).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
