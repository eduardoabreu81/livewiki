import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, runOnly } from "./batch.js";
import { markDegradedArtifact } from "./artifact.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";

/** Valid stage-5c understanding page returned outside mock instrumentation. */
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

/**
 * Mock LLM that returns a valid Markdown with frontmatter + anchor.
 * Used to test the orchestrator without real calls.
 */
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public totalCallCount = 0;
  public callLog: Array<{ system: string; user: string; maxTokens: number | undefined }> = [];

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    this.totalCallCount++;
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — stage 5c has its own dedicated
    // suite (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callCount++;
    this.callLog.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    // #29 folder task: the LLM writes ONLY the purpose paragraph (plain
    // prose, 40–800 chars) — the page skeleton is deterministic.
    if (/purpose paragraph/.test(req.system)) {
      return {
        content:
          "This directory holds the auth module: login, session, and token handling.",
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    // #29 file page task: the prompt names the file ("# File: <path>") and
    // the closed list is the file's own symbols — anchor them ALL (dual
    // complete coverage: frontmatter + section markers).
    const fileMatch = req.user.match(/# File: ([^\s]+)/);
    const filePath = fileMatch ? fileMatch[1] : "unknown.ts";
    const keys = [...req.user.matchAll(/^- (\S+#\S+)$/gm)].map((m) => m[1]!);
    const anchorKeys = keys.length > 0 ? keys : [`${filePath}#placeholder`];
    const anchorsYaml = anchorKeys.map((k) => `  - ${k}`).join("\n");
    const content = `---
title: ${filePath} responsibilities
owner: generated
anchors:
${anchorsYaml}
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
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

let repoRoot: string;
let mockLlm: MockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-"));
  // Creates minimal repo structure: 1 file with 1 function
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'auth'; }",
    "utf8",
  );
  mockLlm = new MockLlm();
  // Roadmap #22: pin the pre-#22 stage-4 format for these orchestrator
  // fixtures (the mock emits no Diagram section); the #22-on behavior is
  // covered by module-diagram-format.test.ts and batch-module-diagrams.test.ts.
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

describe("batch.runBatch — end-to-end orchestrator with mock LLM", () => {
  it("runs the full pipeline: creates batch_run + tasks + manifest", async () => {
    const result = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true, // skips stage 2 refinement (deterministic)
      skipManifestWrite: false,
    });

    expect(result.status).toBe("completed");
    expect(result.runId).toBeGreaterThan(0);
    expect(result.byModule.length).toBeGreaterThan(0);

    // #29: file page at livewiki/<folderId>/<fileBase>.md and folder page
    // at livewiki/<folderId>/index.md.
    const filePagePath = nodePath.join(repoRoot, "livewiki/auth/login.md");
    expect(await nodeFs.readFile(filePagePath, "utf8")).toMatch(/title: src\/auth\/login\.ts/);
    const folderPagePath = nodePath.join(repoRoot, "livewiki/auth/index.md");
    expect(await nodeFs.readFile(folderPagePath, "utf8")).toContain(
      "login, session, and token handling",
    );

    // Manifest written
    const manifestPath = nodePath.join(repoRoot, "livewiki/.manifest.json");
    expect(await nodeFs.readFile(manifestPath, "utf8")).toMatch(/"version": 2/);
  });

  it("rebuilds a lost SQLite queue without repeating proven documentation calls", async () => {
    const first = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: false,
    });
    expect(first.status).toBe("completed");
    expect(mockLlm.totalCallCount).toBeGreaterThan(0);

    for (const name of ["index.db", "index.db-shm", "index.db-wal"]) {
      await nodeFs.rm(nodePath.join(repoRoot, ".livewiki", name), { force: true });
    }
    const recoveryLlm = new MockLlm();
    const recovered = await runBatch({
      repoRoot,
      llmClient: recoveryLlm,
      noRefine: true,
      skipManifestWrite: false,
    });

    expect(recovered.status).toBe("completed");
    expect(recoveryLlm.totalCallCount).toBe(0);
  });

  it("rebuilds a lost SQLite queue for a relaxed-round (degraded) file page without a paid call", async () => {
    const first = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: false,
    });
    expect(first.status).toBe("completed");

    // Mark the file page as completed under the relaxed contract
    // (`quality: degraded` + reader notice): it only passes relaxed
    // validation, so recovery must re-validate it under that same contract.
    const filePageAbs = nodePath.join(repoRoot, "livewiki/auth/login.md");
    const degraded = markDegradedArtifact(await nodeFs.readFile(filePageAbs, "utf8"));
    expect(degraded).toContain("quality: degraded");
    await nodeFs.writeFile(filePageAbs, degraded, "utf8");

    for (const name of ["index.db", "index.db-shm", "index.db-wal"]) {
      await nodeFs.rm(nodePath.join(repoRoot, ".livewiki", name), { force: true });
    }
    const recoveryLlm = new MockLlm();
    const recovered = await runBatch({
      repoRoot,
      llmClient: recoveryLlm,
      noRefine: true,
      skipManifestWrite: false,
    });

    expect(recovered.status).toBe("completed");
    expect(recoveryLlm.totalCallCount).toBe(0);
  });

  it("etapa 2 é determinística (#29): zero LLM calls, com ou sem --no-refine", async () => {
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    // 1 file-page call + 1 folder-purpose call. NO stage-2 refine call
    // (the LLM refine pass was removed in #29).
    expect(mockLlm.callCount).toBe(2);
    expect(
      mockLlm.callLog.some((c) => c.user.includes("# File: src/auth/login.ts")),
    ).toBe(true);
    expect(mockLlm.callLog.some((c) => /purpose paragraph/.test(c.system))).toBe(true);
    expect(mockLlm.callLog.at(-1)?.user).not.toContain("# Suggested display title");
  });

  it("noRefine: false é no-op (#29): etapa 2 continua sem LLM call e a task persiste", async () => {
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: false, // legacy flag — stage 2 never calls the LLM anymore
      skipManifestWrite: true,
    });
    // Same 2 calls as the noRefine run (file page + folder purpose).
    expect(mockLlm.callCount).toBe(2);

    // The stage-2 task still persists (deterministic planner; empty usage).
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT status, checkpoint_json FROM batch_tasks WHERE stage = 2")
        .get() as { status: string; checkpoint_json: string };
      expect(task.status).toBe("done");
      const cp = JSON.parse(task.checkpoint_json) as { usageHistory: unknown[] };
      expect(cp.usageHistory).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("each task's checkpoint has populated usageHistory", async () => {
    await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const tasks = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4")
        .all() as Array<{ checkpoint_json: string | null }>;
      expect(tasks.length).toBeGreaterThan(0);
      for (const t of tasks) {
        const cp = JSON.parse(t.checkpoint_json!) as {
          usageHistory: Array<{ usage: { model: string; inputTokens: number; outputTokens: number }; costUsd: unknown }>;
        };
        expect(cp.usageHistory).toHaveLength(1);
        expect(cp.usageHistory[0]!.usage.model).toBe("claude-test-mock");
        expect(cp.usageHistory[0]!.usage.inputTokens).toBeGreaterThan(0);
      }
    } finally {
      db.close();
    }
  });
});

describe("batch.runOnly — re-runs 1 task", () => {
  it("increments attempt in the existing checkpoint", async () => {
    // Initial run
    const r1 = await runBatch({
      repoRoot,
      llmClient: mockLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(r1.byModule.length).toBeGreaterThan(0);
    const moduleId = r1.byModule[0]!.module;

    // Re-runs 1 task
    const r2 = await runOnly({
      repoRoot,
      llmClient: mockLlm,
      onlyTarget: moduleId,
    });

    // usageHistory has 2 entries (1 original + 1 from retry)
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE target = ? AND stage = 4")
        .get(moduleId) as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        attempt: number;
        usageHistory: unknown[];
      };
      expect(cp.attempt).toBe(2); // 1 initial + 1 retry
      expect(cp.usageHistory).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe("batch.runBatch — dynamic output-token budget (Priority-0 fix)", () => {
  it("a module with many exported symbols gets a maxTokens budget larger than the old flat 8192 default", async () => {
    // 40 exported functions in one file -> a closed key list large enough
    // that the dynamic formula (base 2048 + 300/anchor) clears 8192.
    const lines = Array.from({ length: 40 }, (_, i) => `export function fn${i}() { return ${i}; }`);
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/big"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/big/many.ts"), lines.join("\n") + "\n", "utf8");

    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    const bigModuleCall = mockLlm.callLog.find((c) => c.user.includes("# File: src/big/many.ts"));
    expect(bigModuleCall).toBeDefined();
    expect(bigModuleCall!.maxTokens).toBeGreaterThan(8192);
  });

  it("a tiny module stays near the floor, well below the old flat 8192 default", async () => {
    // The default fixture (src/auth/login.ts, 1 function) already exercises
    // the small-module path via beforeEach.
    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    const authModuleCall = mockLlm.callLog.find((c) => c.user.includes("# File: src/auth/login.ts"));
    expect(authModuleCall).toBeDefined();
    expect(authModuleCall!.maxTokens).toBeLessThan(8192);
  });

  it("outputTokenStrategy: 'fixed' sends the configured ceiling literally, ignoring content size", async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `export function fn${i}() { return ${i}; }`);
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/big"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/big/many.ts"), lines.join("\n") + "\n", "utf8");
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        outputTokenStrategy: "fixed",
        stage4MaxOutputTokens: 8192,
        // Roadmap #22: same pre-#22 format pins as beforeEach (this config overwrites it).
        moduleDiagrams: false,
        deepHierarchy: false,
      }),
      "utf8",
    );

    await runBatch({ repoRoot, llmClient: mockLlm, noRefine: true, skipManifestWrite: true });

    // The fixed ceiling applies to the stage-4 FILE-page calls.
    const fileCalls = mockLlm.callLog.filter((c) => c.user.includes("# File:"));
    expect(fileCalls.length).toBeGreaterThan(0);
    for (const call of fileCalls) {
      expect(call.maxTokens).toBe(8192);
    }
    // #29 folder-purpose paragraphs keep their own bounded budget (2048),
    // independent of the stage-4 page strategy.
    const folderCalls = mockLlm.callLog.filter((c) => /purpose paragraph/.test(c.system));
    expect(folderCalls.length).toBeGreaterThan(0);
    for (const call of folderCalls) {
      expect(call.maxTokens).toBe(2048);
    }
  });
});

// === Step 2a — closed repair contract: early abort + report-only (stage 4) ===
describe("batch — Step 2a closed repair contract (stage 4)", () => {
  it("all-unclassified verify set aborts with `unrepairable` after ZERO repair calls", async () => {
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    // Every verify call reports ONLY `manual_block_altered` on the page the
    // task writes — human content is never model-repaired (rule #6), so the
    // orchestrator must not burn a single paid repair call on it.
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      const real = await realRun(root);
      return {
        ...real,
        ok: false,
        issues: [
          {
            severity: "error" as const,
            code: "manual_block_altered" as const,
            wikiPath: "livewiki/auth/login.md",
            detail: "lw:manual block hash diverges from the baseline",
          },
        ],
      };
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: mockLlm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 2,
        maxIncompleteRetries: 0,
      });

      // TWO LLM calls: the file-page initial generation (zero repair calls —
      // the set is all-unclassified) + the folder-purpose paragraph (#29).
      expect(mockLlm.callCount).toBe(2);
      expect(result.status).toBe("completed_with_failures");
      expect(result.failures).toHaveLength(1);
      // Distinct from `repair_exhausted`, with the codes + reasons rendered.
      expect(result.failures[0]!.error.code).toBe("unrepairable");
      expect(result.failures[0]!.error.message).toContain("[manual_block_altered]");
      expect(result.failures[0]!.error.message).toContain("rule #6");

      // The checkpoint carries the same outcome (drives `batch status`).
      const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      try {
        const task = db
          .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = 'auth/login'")
          .get() as { checkpoint_json: string };
        const cp = JSON.parse(task.checkpoint_json) as {
          status: string;
          error?: { code: string; message: string };
          usageHistory: unknown[];
        };
        expect(cp.status).toBe("failed");
        expect(cp.error?.code).toBe("unrepairable");
        expect(cp.usageHistory).toHaveLength(1);
      } finally {
        db.close();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("mixed set proceeds to repair: directive for the supported code + report-only section for the rest", async () => {
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let verifyCalls = 0;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      verifyCalls++;
      const real = await realRun(root);
      if (verifyCalls > 1) return real;
      return {
        ...real,
        ok: false,
        issues: [
          {
            severity: "error" as const,
            code: "manual_block_altered" as const,
            wikiPath: "livewiki/auth/login.md",
            detail: "lw:manual block hash diverges from the baseline",
          },
          {
            severity: "error" as const,
            code: "broken_internal_link" as const,
            wikiPath: "livewiki/auth/login.md",
            detail: 'the link "./missing.md" resolves to a page that does not exist',
          },
        ],
      };
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: mockLlm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 2,
        maxIncompleteRetries: 0,
      });

      // THREE LLM calls (#29): file-page initial + one repair call (the
      // repaired page passes the real second verify) + the folder-purpose
      // paragraph.
      expect(mockLlm.callCount).toBe(3);
      expect(result.status).toBe("completed");
      expect(result.failures).toHaveLength(0);

      const repairCall = mockLlm.callLog[1]!;
      // The supported code renders its specific ACTION directive...
      expect(repairCall.user).toMatch(/broken_internal_link.*ACTION: correct the named internal link/s);
      // ...and the unclassified code is REPORT-ONLY, never repaired by guessing.
      expect(repairCall.user).toContain("# Errors with NO supported repair");
      expect(repairCall.user).toContain("do NOT attempt to guess");
      expect(repairCall.user).toContain("- [manual_block_altered]:");
    } finally {
      spy.mockRestore();
    }
  });
});
