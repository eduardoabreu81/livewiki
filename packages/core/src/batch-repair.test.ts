/**
 * batch-repair.test.ts — Phase-5 plan (X): bounded corrective repair +
 * transactional write + defensive gates. Covers the mandatory criteria:
 *
 *   6. Unknown anchor → repair; valid second response = 2 usage entries
 *      and no circuit-breaker failure.
 *   7. Exhausting initial + 2 repairs = 1 final failure, 3 calls,
 *      restore/delete rejected page.
 *   8. Human ownership and manual-block protections remain intact.
 *   9. Config default and override validation work (covered in
 *      config.test.ts).
 *   10. Status and result totals include repair usage without fake
 *       duplicate usage.
 *   + Additional plan criteria:
 *     - No think-only response can be accepted (artifact test covers)
 *     - No duplicate module ID reaches stage 4 (modules test covers
 *       the algorithm + assertUniqueModuleIds; here we test integration)
 *     - Previous page and lw:manual are restored byte by byte
 *     - owner: human stays untouchable
 *     - key-leak test stays green (regression)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import * as safeIo from "./safe-io.js";
import type { LlmClient } from "./llm/index.js";
import { LlmTimeoutError } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";

/**
 * Programmable LLM mock: each call consumes the next response in the queue,
 * or throws an error if the index is in `throwOn`.
 *
 * `getPromptShape(callIdx)` returns the system/user prompt received by the LLM
 * in that call — useful to assert that the repair prompt was built
 * correctly.
 */
class ProgrammableMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public responses: string[] = [];
  public throwOn: Set<number> = new Set();
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  /**
   * If true, generates the page automatically from the closed key list
   * extracted from the prompt. Useful for tests that don't want to enumerate the keys
   * manually (e.g.: uniqueness test with 5 modules).
   */
  public autoPageFromPrompt = false;

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    this.callLog.push({ system: req.system, user: req.user });
    const idx = this.callCount;
    this.callCount++;
    if (this.throwOn.has(idx)) {
      throw new Error(`simulated LLM failure at call ${idx}`);
    }

    // Extract the closed key list from the user prompt (format: "- <key>" one per line)
    const closedKeys: string[] = [];
    for (const line of req.user.split("\n")) {
      const m = /^- (\S+)$/.exec(line);
      if (m && m[1]) closedKeys.push(m[1]);
    }

    let content: string;
    if (this.autoPageFromPrompt && closedKeys.length > 0) {
      // Generate a valid page that references ALL the keys.
      content = makeValidPage(closedKeys);
    } else {
      content = this.responses[idx] ?? this.responses[this.responses.length - 1] ?? "";
    }
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

/** Build a valid page for the first symbol of the module. */
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
    `<!-- lw:anchors ${closedKeyList[0] ?? "src/x.ts#placeholder"} -->`,
    "",
    "Body.",
    "",
  ].join("\n");
}

let repoRoot: string;
let llm: ProgrammableMockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-repair-"));
  // Create minimal repo with 1 TS file with 1 exported function
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/auth/login.ts"),
    "export function login() { return 'auth'; }\nexport function logout() { return 'bye'; }",
    "utf8",
  );
  llm = new ProgrammableMockLlm();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === Repair: success path ===
describe("batch X — repair success (Criterion #6)", () => {
  it("unknown anchor → repair prompt; second valid response = 2 entries, no circuit failure", async () => {
    // Initial: INVENTED anchor (not in the closed list) — fails validator.
    // Repair: correct anchor — passes.
    // Expected: cb.done = 1, cb.fails = 0, status = completed.

    // LLM will be called 2x:
    //   call 0 (initial): anchor "fake" — validator rejects
    //   call 1 (repair): correct anchor — validator accepts
    llm.responses = [
      // initial: invented anchor (validator rejects)
      [
        "---",
        "title: auth",
        "owner: generated",
        "anchors:",
        "  - fake-key-not-in-closed-list",
        "---",
        "",
        "# auth",
        "",
        "Body.",
      ].join("\n"),
      // repair: correct anchor (validator accepts)
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // 2 LLM calls were made (1 initial + 1 repair)
    expect(llm.callCount).toBe(2);

    // Repair prompt was built with the structured errors
    const repairPromptUser = llm.callLog[1]?.user ?? "";
    expect(repairPromptUser).toMatch(/anchor_outside_closed_list/);
    expect(repairPromptUser).toMatch(/fake-key-not-in-closed-list/);

    // usageHistory has 2 entries (real usage, NOT a zero-usage fake)
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth") as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        status: string;
        attempt: number;
        usageHistory: Array<{ usage: { inputTokens: number; model: string } }>;
      };
      expect(cp.status).toBe("done");
      expect(cp.attempt).toBe(2);
      expect(cp.usageHistory).toHaveLength(2);
      // CRITERION: each real call = one entry. No "fake duplicate" zero-usage.
      for (const u of cp.usageHistory) {
        expect(u.usage.inputTokens).toBeGreaterThan(0);
        expect(u.usage.model).toBe("claude-test-mock");
      }
    } finally {
      db.close();
    }

    // Final status: completed, no failures, no circuit breaker
    expect(result.status).toBe("completed");
    expect(result.failures).toHaveLength(0);
    expect(result.circuitBreakerTriggered).toBe(false);
    // Totals include the usage of the 2 calls (200 input + 100 output)
    expect(result.totals.inputTokens).toBe(200);
    expect(result.totals.outputTokens).toBe(100);
  });

  it("successful repair does NOT increment circuit-breaker failures", async () => {
    // Force a repair that fixes it: cb should go to 0 consecutives, 0 fails.
    llm.responses = [
      // initial: missing frontmatter
      "# auth\n\nno frontmatter at all\n",
      // repair: valid
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });
    expect(result.status).toBe("completed");
    expect(result.failures).toHaveLength(0);
  });
});

// === Repair: exhausted (Criterion #7) ===
describe("batch X — repair exhausted (Criterion #7)", () => {
  it("1 initial + 2 repairs, all invalid = 1 final failure, 3 calls, page never persisted", async () => {
    llm.responses = [
      // initial: no frontmatter
      "# bad\n\n",
      // repair 1: wrong owner
      "---\ntitle: x\nowner: human\nanchors:\n  - src/auth/login.ts#login\n---\n# x\n",
      // repair 2: anchor outside closed list
      "---\ntitle: x\nowner: generated\nanchors:\n  - not-a-real-key\n---\n# x\n",
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(llm.callCount).toBe(3);

    // Status: completed_with_failures (1 task done=0, 1 task fail=1)
    expect(result.status).toBe("completed_with_failures");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.code).toBe("repair_exhausted");
    expect(result.circuitBreakerTriggered).toBe(false);

    // Page NEVER persisted (artifact never passed validator → never wrote)
    const wikiPath = nodePath.join(repoRoot, "livewiki/auth.md");
    await expect(nodeFs.access(wikiPath)).rejects.toThrow();

    // Checkpoint has 3 usage entries (all with real usage, no fake duplicate)
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth") as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        status: string;
        attempt: number;
        usageHistory: unknown[];
      };
      expect(cp.status).toBe("failed");
      expect(cp.attempt).toBe(3);
      expect(cp.usageHistory).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("maxRepairAttempts=0 → 1 call only, no repair", async () => {
    llm.responses = [
      // initial: invalid
      "# bad\n",
    ];
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });
    expect(llm.callCount).toBe(1);
    expect(result.status).toBe("completed_with_failures");
  });
});

// === Owner: human (Criterion #8) ===
describe("batch X — owner: human is untouchable (Criterion #8)", () => {
  it("page with owner: human is NOT regenerated and NO LLM call is made", async () => {
    // Create a pre-existing page with owner: human
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    const humanPage = [
      "---",
      "title: auth",
      "owner: human",
      "---",
      "",
      "## Manual content",
      "",
      "<!-- lw:manual -->",
      "PROTECTED CONTENT",
      "<!-- /lw:manual -->",
      "",
    ].join("\n");
    await safeIo.writeText(repoRoot, "livewiki/auth.md", humanPage);

    // LLM that would return something completely different — MUST NOT be called
    llm.responses = ["OVERWRITTEN — should not appear"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // NO LLM call for that module (stage 2 refine still
    // may be called, but with --no-refine there are zero calls).
    expect(llm.callCount).toBe(0);

    // Page preserved byte-for-byte
    const onDisk = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8");
    expect(onDisk).toBe(humanPage);
    expect(onDisk).toContain("owner: human");
    expect(onDisk).toContain("PROTECTED CONTENT");
    expect(onDisk).not.toContain("OVERWRITTEN");

    // Checkpoint has refused_human_page
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth") as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        status: string;
        error: { code: string };
      };
      expect(cp.status).toBe("failed");
      expect(cp.error.code).toBe("refused_human_page");
    } finally {
      db.close();
    }

    // failures report
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.code).toBe("refused_human_page");
  });
});

// === Manual blocks protection (Criterion #8) ===
describe("batch X — lw:manual blocks preserved byte-for-byte", () => {
  it("page with manual block is rewritten but the block stays IDENTICAL", async () => {
    // Create pre-existing page WITH manual block
    const manualContent = "MANUAL: this text is sacred and must NOT change";
    const existingPage = [
      "---",
      "title: auth",
      "owner: generated",
      "anchors:",
      "  - src/auth/login.ts#login",
      "---",
      "",
      "## Section",
      "",
      "<!-- lw:manual -->",
      manualContent,
      "<!-- /lw:manual -->",
      "",
    ].join("\n");
    await safeIo.mkdir(repoRoot, ".livewiki");
    await safeIo.writeText(repoRoot, "livewiki/auth.md", existingPage);

    // LLM returns page WITHOUT manual block (expected: LLM does not write manual)
    llm.responses = [
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");

    // Page regenerated BUT the original manual block is there, byte-for-byte
    const onDisk = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8");
    expect(onDisk).toContain(manualContent);
    expect(onDisk).toContain("<!-- lw:manual -->");
    expect(onDisk).toContain("<!-- /lw:manual -->");
    // The manual block is EXACTLY what was there before (no extra spaces)
    expect(onDisk).toMatch(/<!-- lw:manual -->\nMANUAL: this text is sacred and must NOT change\n<!-- \/lw:manual -->/);
  });
});

// === Transactional rollback (Criterion #6) ===
describe("batch X — verify failure rollbacks a new page", () => {
  it("rejected candidate NEVER remains on disk", async () => {
    // Setup: the LLM will produce a VALID page (passes the validator). But
    // we'll use vi.spyOn on runVerify to return an error-level issue
    // to simulate a verify failure after the write.
    // Mock: inject `runVerify` that ALWAYS rejects the candidate.
    const verifyModule = await import("./verify.js");
    const runVerifySpy = vi.spyOn(verifyModule, "run");
    let callCount = 0;
    runVerifySpy.mockImplementation(async () => {
      callCount++;
      // First call: fails with broken_anchor to force rollback.
      // Subsequent calls (re-verify without write): ok.
      if (callCount === 1) {
        return {
          ok: false,
          pagesChecked: 1,
          issues: [
            {
              severity: "error",
              code: "broken_anchor",
              wikiPath: "livewiki/auth.md",
              detail: "broken anchor (injected by test)",
            },
          ],
        };
      }
      return { ok: true, pagesChecked: 0, issues: [] };
    });

    try {
      llm.responses = [
        makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
      ];

      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 0, // no repair — test only the rollback of one call
      });

      // Verify was called (1x — the write + 1 verify)
      expect(runVerifySpy).toHaveBeenCalled();

      // Page NEVER persisted (was removed by the rollback)
      const wikiPath = nodePath.join(repoRoot, "livewiki/auth.md");
      await expect(nodeFs.access(wikiPath)).rejects.toThrow();

      // Status reflects the failure
      expect(result.status).toBe("completed_with_failures");
      expect(result.failures).toHaveLength(1);
    } finally {
      runVerifySpy.mockRestore();
    }
  });
});

// === W — unique IDs reach stage 4 (Criterion #3, #5) ===
describe("batch X W — unique module IDs before stage 4", () => {
  it("5 directories with leaf 'src' → 5 distinct pages, no overwrite", async () => {
    // Remove the beforeEach file (src/auth/login.ts) to isolate this test
    await nodeFs.rm(nodePath.join(repoRoot, "src"), { recursive: true, force: true });

    // Create 5 packages with leaf "src" + 1 file each
    const dirs = ["packages/core", "packages/cli", "packages/mcp", "tests/fixtures", "scripts"];
    for (const d of dirs) {
      const dir = nodePath.join(repoRoot, d, "src");
      await nodeFs.mkdir(dir, { recursive: true });
      await nodeFs.writeFile(
        nodePath.join(dir, "auth.ts"),
        `export function login_${d.replace(/[\\/]/g, "_")}() { return "x"; }`,
        "utf8",
      );
    }

    // LLM autoPage: generates a valid page from the prompt's keys
    llm.autoPageFromPrompt = true;

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // Status: completed (5 tasks done, 0 fails)
    expect(result.status).toBe("completed");
    expect(result.byModule).toHaveLength(5);
    expect(result.failures).toHaveLength(0);

    // 5 distinct pages (not 1!) — no overwrite
    const livewikiDir = nodePath.join(repoRoot, "livewiki");
    const entries = await nodeFs.readdir(livewikiDir);
    const mdFiles = entries.filter((e) => e.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThanOrEqual(5);

    // Each page has frontmatter owner: generated (from the LLM)
    for (const f of mdFiles) {
      if (f === "quickstart.md" || f === ".manifest.json") continue;
      const content = await nodeFs.readFile(nodePath.join(livewikiDir, f), "utf8");
      expect(content).toMatch(/owner: generated/);
    }

    // Unique IDs: MUST NOT have two pages with the same id
    const moduleIds = mdFiles
      .filter((f) => f !== "quickstart.md" && f !== ".manifest.json")
      .map((f) => f.replace(/\.md$/, ""));
    expect(new Set(moduleIds).size).toBe(moduleIds.length);
  });
});

// === Criterion #10 — totals without fake duplicate usage ===
describe("batch X — usageHistory without fake duplicate zero-usage", () => {
  it("successful repair: each real call = 1 entry, ZERO zero-usage fake", async () => {
    llm.responses = [
      // initial: anchor outside closed list → validator rejects
      "---\ntitle: x\nowner: generated\nanchors:\n  - fake\n---\n# x\n",
      // repair: valid
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // 2 calls → 2 entries with real usage
    expect(llm.callCount).toBe(2);
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth") as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        usageHistory: Array<{ usage: { inputTokens: number; model: string } }>;
      };
      expect(cp.usageHistory).toHaveLength(2);
      for (const u of cp.usageHistory) {
        // CRITERION: zero-usage fake is only accepted when the LLM call FAILED
        // (network, 5xx, etc). NEVER after a real response.
        expect(u.usage.inputTokens).toBeGreaterThan(0);
        expect(u.usage.model).toBe("claude-test-mock");
      }
    } finally {
      db.close();
    }

    // Run totals = sum of usageHistory = 2 * 100 = 200 input
    expect(result.totals.inputTokens).toBe(200);
  });

  it("LLM call failed → ZERO-usage entry preserved (1x), no duplicate after real response", async () => {
    // Call 0: throw (network) → zero-usage entry
    // Call 1: valid response
    llm.responses = [""];
    llm.throwOn = new Set([0]);
    llm.responses[1] = makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]);

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // 2 calls total (1 throw + 1 ok)
    expect(llm.callCount).toBe(2);

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth") as { checkpoint_json: string | null };
      const cp = JSON.parse(task.checkpoint_json!) as {
        status: string;
        usageHistory: Array<{
          usage: { inputTokens: number; model: string } | null;
          usageKnown: boolean;
          costUsd: { total: number } | null;
        }>;
      };
      expect(cp.status).toBe("done");
      expect(cp.usageHistory).toHaveLength(2);
      // 1st entry: generate threw without usage → unknown (not fake 0/0 model)
      expect(cp.usageHistory[0]?.usageKnown).toBe(false);
      expect(cp.usageHistory[0]?.usage).toBeNull();
      expect(cp.usageHistory[0]?.costUsd).toBeNull();
      // 2nd entry: real usage (LLM returned)
      expect(cp.usageHistory[1]?.usageKnown).toBe(true);
      expect(cp.usageHistory[1]?.usage?.inputTokens).toBeGreaterThan(0);
      expect(cp.usageHistory[1]?.usage?.model).toBe("claude-test-mock");
    } finally {
      db.close();
    }

    expect(result.status).toBe("completed");
    expect(result.totals.usageIncomplete).toBe(true);
    expect(result.totals.models).not.toContain("(call failed)");
    expect(result.totals.models).not.toContain("(no usage)");
  });
});

describe("batch — llm_timeout is terminal (no repair loop)", () => {
  let repoRoot: string;
  let llm: ProgrammableMockLlm;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-timeout-"),
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/utils"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/utils/help.ts"),
      "export function help() { return 2; }\n",
      "utf8",
    );
    llm = new ProgrammableMockLlm();
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("LlmTimeoutError: one call, failed llm_timeout, no repair, unknown usage; other modules continue", async () => {
    // First stage-4 module times out; second succeeds (order depends on prioritize).
    let n = 0;
    llm.generate = async (req) => {
      llm.callLog.push({ system: req.system, user: req.user });
      const idx = n++;
      llm.callCount = n;
      if (idx === 0) {
        throw new LlmTimeoutError("openai-compat", 300_000);
      }
      // Valid page for whatever module is second
      const closedKeys: string[] = [];
      for (const line of req.user.split("\n")) {
        const m = /^- (\S+)$/.exec(line);
        if (m?.[1]) closedKeys.push(m[1]);
      }
      return {
        content: makeValidPage(closedKeys.length ? closedKeys : ["src/utils/help.ts#help"]),
        usage: { inputTokens: 100, outputTokens: 50, model: llm.model },
      };
    };

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // Only one call for the timeout module + one for the success module = 2
    // (timeout must NOT burn maxRepairAttempts+1 = 3)
    expect(llm.callCount).toBe(2);
    expect(result.status).toBe("completed_with_failures");
    expect(result.failures.some((f) => f.error.code === "llm_timeout")).toBe(
      true,
    );
    // No repair prompt (repair prompts mention "repair" / prior candidate structure)
    const repairish = llm.callLog.filter((c) =>
      /repair|prior candidate|Previous candidate/i.test(c.user + c.system),
    );
    expect(repairish).toHaveLength(0);

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const failed = db
        .prepare(
          "SELECT target, status, checkpoint_json FROM batch_tasks WHERE stage = 4 AND status = 'failed'",
        )
        .all() as Array<{ target: string; status: string; checkpoint_json: string }>;
      expect(failed).toHaveLength(1);
      const cp = JSON.parse(failed[0]!.checkpoint_json) as {
        status: string;
        attempt: number;
        error?: { code: string; message: string };
        usageHistory: Array<{
          usage: unknown;
          usageKnown: boolean;
          attempt: number;
        }>;
      };
      expect(cp.status).toBe("failed");
      expect(cp.error?.code).toBe("llm_timeout");
      expect(cp.error?.message).toMatch(/unknown|bill|timeout/i);
      expect(cp.attempt).toBe(1);
      expect(cp.usageHistory).toHaveLength(1);
      expect(cp.usageHistory[0]!.usageKnown).toBe(false);
      expect(cp.usageHistory[0]!.usage).toBeNull();
      expect(cp.usageHistory[0]!.attempt).toBe(1);

      const done = db
        .prepare(
          "SELECT COUNT(*) as c FROM batch_tasks WHERE stage = 4 AND status = 'done'",
        )
        .get() as { c: number };
      expect(done.c).toBe(1);
    } finally {
      db.close();
    }

    // Totals incomplete when timeout present
    expect(result.totals.usageIncomplete).toBe(true);
    expect(result.totals.inputTokens).toBe(100); // only known success
    expect(result.totals.outputTokens).toBe(50);
    expect(result.totals.models).not.toContain("(no usage)");
    expect(result.totals.models).not.toContain("(call failed)");

    // Status rebuild: timeout-only task has costUsd null (never 0)
    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    expect(report.totals.usageIncomplete).toBe(true);
    const failedTask = report.tasks.find((t) => t.error?.code === "llm_timeout");
    expect(failedTask).toBeDefined();
    expect(failedTask!.inputTokens).toBe(0);
    expect(failedTask!.outputTokens).toBe(0);
    expect(failedTask!.costUsd).toBeNull();
    expect(failedTask!.usageIncomplete).toBe(true);
    // Successful module still has known tokens
    const doneTask = report.tasks.find((t) => t.status === "done" && t.stage === 4);
    expect(doneTask!.inputTokens).toBe(100);
    expect(report.totals.inputTokens).toBe(100);
  });

  it("network failure without usage → usage null / usageKnown false / incomplete", async () => {
    llm.throwOn = new Set([0]);
    llm.responses = [makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"])];
    // single module only
    await nodeFs.rm(nodePath.join(repoRoot, "src/utils"), {
      recursive: true,
      force: true,
    });

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0, // one attempt only so task fails on network
    });

    expect(result.status).toBe("completed_with_failures");
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .prepare(
          "SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND status = 'failed'",
        )
        .get() as { checkpoint_json: string };
      const cp = JSON.parse(row.checkpoint_json) as {
        error?: { code: string };
        usageHistory: Array<{
          usage: unknown;
          usageKnown: boolean;
          costUsd: unknown;
        }>;
      };
      expect(cp.error?.code).toBe("repair_exhausted"); // maxRepairAttempts 0 → one fail
      expect(cp.usageHistory[0]!.usageKnown).toBe(false);
      expect(cp.usageHistory[0]!.usage).toBeNull();
      expect(cp.usageHistory[0]!.costUsd).toBeNull();
    } finally {
      db.close();
    }
    expect(result.totals.usageIncomplete).toBe(true);
    expect(result.totals.costUsd).toBeNull();
    expect(result.totals.models).not.toContain("(call failed)");
    expect(result.totals.models).toEqual([]);
  });

  it("timeout-only status rebuild: costUsd null never 0", async () => {
    await nodeFs.rm(nodePath.join(repoRoot, "src/utils"), {
      recursive: true,
      force: true,
    });
    llm.generate = async (req) => {
      llm.callLog.push({ system: req.system, user: req.user });
      llm.callCount++;
      throw new LlmTimeoutError("openai-compat", 300_000);
    };
    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });
    expect(llm.callCount).toBe(1);

    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    const t4 = report.byStage["4"];
    expect(t4).toBeDefined();
    expect(t4!.inputTokens).toBe(0);
    expect(t4!.outputTokens).toBe(0);
    expect(t4!.costUsd).toBeNull();
    expect(t4!.models).toEqual([]);
    expect(t4!.usageIncomplete).toBe(true);
    expect(report.totals.costUsd).toBeNull();
    expect(report.totals.usageIncomplete).toBe(true);
    const failed = report.tasks.find((t) => t.stage === 4 && t.status === "failed");
    expect(failed?.error?.code).toBe("llm_timeout");
  });
});
