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
import { runBatch, runOnly } from "./batch.js";
import { buildStatusReport } from "./batch-status.js";
import { DEGRADED_NOTICE_PREFIX } from "./artifact.js";
import * as safeIo from "./safe-io.js";
import type { LlmClient } from "./llm/index.js";
import { LlmTimeoutError } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";
import type { StopReason } from "./llm/types.js";
import {
  DIAGNOSTIC_MAX_ERRORS,
  DIAGNOSTIC_TEXT_CAP,
  type DiagnosticAttempt,
  type TaskCheckpoint,
} from "./batch-state.js";

/**
 * Programmable LLM mock: each call consumes the next response in the queue,
 * or throws an error if the index is in `throwOn`.
 *
 * `getPromptShape(callIdx)` returns the system/user prompt received by the LLM
 * in that call — useful to assert that the repair prompt was built
 * correctly.
 */
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
 * Valid folder-purpose paragraph (#29) returned outside mock
 * instrumentation. Plain prose, 40-800 chars, no headings/fences/links.
 */
const VALID_FOLDER_PURPOSE =
  "This directory holds the authentication module: login, logout, and session token handling for the product.";

class ProgrammableMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public responses: string[] = [];
  public stopReasons: Array<StopReason | undefined> = [];
  public rawStopReasons: Array<string | undefined> = [];
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
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation (callCount/callLog/response
    // queue stay stage-4-only) — stage 5c has its own dedicated suite
    // (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }    // #29: answer folder-purpose prompts (product folder pages) with a
    // valid plain paragraph OUTSIDE this mock's instrumentation — folder
    // tasks have their own bounded slots and would otherwise consume the
    // response queue this suite scripts for the file-page task. Matches
    // both the initial prompt ("purpose paragraph of ONE folder page")
    // and the repair prompt ("folder purpose paragraph").
    if (
      req.system.includes("purpose paragraph of ONE folder page") ||
      req.system.includes("folder purpose paragraph")
    ) {
      return {
        content: VALID_FOLDER_PURPOSE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
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
      ...(this.stopReasons[idx] !== undefined ? { stopReason: this.stopReasons[idx] } : {}),
      ...(this.rawStopReasons[idx] !== undefined
        ? { rawStopReason: this.rawStopReasons[idx] }
        : {}),
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

function makeInvalidPage(uniqueText: string): string {
  return `# invalid\n\n${uniqueText}\n`;
}

async function readStage4Checkpoint(
  root: string,
  target = "auth/login",
): Promise<TaskCheckpoint> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), {
    readonly: true,
  });
  try {
    const row = db
      .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?")
      .get(target) as { checkpoint_json: string };
    return JSON.parse(row.checkpoint_json) as TaskCheckpoint;
  } finally {
    db.close();
  }
}

function expectJoinedAttempts(checkpoint: TaskCheckpoint): void {
  expect(checkpoint.diagnosticHistory).toBeDefined();
  expect(checkpoint.diagnosticHistory).toHaveLength(checkpoint.usageHistory.length);
  expect(checkpoint.diagnosticHistory!.map((entry) => entry.attempt)).toEqual(
    checkpoint.usageHistory.map((entry) => entry.attempt),
  );
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
  // Roadmap #22: pin the pre-#22 stage-4 format for these repair-contract
  // fixtures (stubs do not emit the Diagram section); the #22-on behavior is
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

// === Repair: success path ===
describe("batch X — repair success (Criterion #6)", () => {
  it("uses the validated mechanical fallback only on the final repair slot", async () => {
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const nearMiss = makeValidPage(closedKeys)
      .replace(
        `<!-- lw:anchors ${closedKeys.join(" ")} -->`,
        `<!-- lw:anchors ${closedKeys[0]} -->`,
      )
      .replace(
        "Body.",
        "Body.\n\nThe literal delimiter ``` is documented here; `commands.md` stays paired while `orphan remains visible.",
      );
    llm.responses = [nearMiss, nearMiss, nearMiss];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[1]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[2]?.mechanicalRepairs).toEqual([
      "escape_unmatched_inline_delimiter",
      "append_missing_section_anchors",
    ]);
    expectJoinedAttempts(checkpoint);

    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(page).toContain("The literal delimiter &#96;&#96;&#96; is documented here;");
    expect(page).toContain("`commands.md` stays paired while &#96;orphan remains visible.");
    expect(page).toContain(`<!-- lw:anchors ${closedKeys[1]} -->`);
  });

  it("fills an empty anchored section only on the final repair slot", async () => {
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const nearMiss = makeValidPage(closedKeys).replace("Body.\n", "");
    llm.responses = [nearMiss, nearMiss, nearMiss];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.errors?.map((error) => error.code)).toEqual([
      "empty_section",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[1]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[2]?.mechanicalRepairs).toEqual([
      "fill_empty_anchored_section",
    ]);
    expectJoinedAttempts(checkpoint);

    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(page).toContain(
      `<!-- lw:anchors ${closedKeys.join(" ")} -->\n\n` +
        "These anchors identify indexed symbols whose implementation is part of this module.",
    );
  });

  it("removes a later duplicate section anchor only on the final repair slot", async () => {
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const firstMarker = `<!-- lw:anchors ${closedKeys[0]} -->`;
    const secondMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;
    const duplicateOnlyMarker = `<!--  lw:anchors   ${closedKeys[0]}   -->`;
    const codeExample = `\`\`\`md\n${firstMarker}\n\`\`\``;
    const nearMiss = makeValidPage(closedKeys).replace(
      secondMarker,
      [
        firstMarker,
        "",
        "The first section documents the login symbol.",
        "",
        codeExample,
        "",
        "## Remaining behavior",
        "",
        secondMarker,
        "",
        "Body.",
        "",
        "## Duplicate-only placement",
        "",
        duplicateOnlyMarker,
        "",
        "This placement still has explanatory prose.",
      ].join("\n"),
    );
    llm.responses = [nearMiss, nearMiss, nearMiss];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.errors?.map((error) => error.code)).toEqual([
      "duplicate_anchor",
      "duplicate_anchor",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[1]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[2]?.mechanicalRepairs).toEqual([
      "remove_duplicate_section_anchors",
    ]);
    expectJoinedAttempts(checkpoint);

    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(page).toContain(codeExample);
    expect(page).toContain(firstMarker);
    expect(page).toContain(`<!-- lw:anchors ${closedKeys[1]} -->`);
    expect(page).not.toContain(secondMarker);
    expect(page).not.toContain(duplicateOnlyMarker);
  });

  it("strips invented manual markers but preserves their content only on the final repair slot", async () => {
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const codeExample = [
      "```md",
      "The literal label lw:manual remains ordinary text.",
      "```",
    ].join("\n");
    const preservedContent = "MODEL-WRITTEN DETAIL MUST SURVIVE";
    const nearMiss = makeValidPage(closedKeys).replace(
      "Body.",
      [
        "Body before the model-written block.",
        "",
        "<!-- lw:manual -->",
        preservedContent,
        "<!-- /lw:manual -->",
        "",
        "Body after the model-written block.",
        "",
        codeExample,
      ].join("\n"),
    );
    llm.responses = [nearMiss, nearMiss, nearMiss];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.errors?.map((error) => error.code)).toEqual([
      "model_invented_manual",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[1]?.mechanicalRepairs).toBeUndefined();
    expect(checkpoint.diagnosticHistory?.[2]?.mechanicalRepairs).toEqual([
      "strip_invented_manual_markers",
    ]);
    expectJoinedAttempts(checkpoint);

    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(page).toContain(preservedContent);
    expect(page).toContain(codeExample);
    expect(page.match(/<!-- lw:manual -->/g) ?? []).toHaveLength(0);
    expect(page.match(/<!-- \/lw:manual -->/g) ?? []).toHaveLength(0);
  });

  it("retries a token-limit truncation with a fresh initial prompt", async () => {
    llm.responses = [
      "# truncated candidate",
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    llm.stopReasons = ["length", "complete"];
    llm.rawStopReasons = ["max_tokens", "end_turn"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).not.toContain("# truncated candidate");

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    try {
      const task = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth/login") as { checkpoint_json: string };
      const checkpoint = JSON.parse(task.checkpoint_json) as {
        usageHistory: Array<{ stopReason?: StopReason; rawStopReason?: string }>;
      };
      expect(checkpoint.usageHistory.map((entry) => entry.stopReason)).toEqual([
        "length",
        "complete",
      ]);
      expect(checkpoint.usageHistory[0]?.rawStopReason).toBe("max_tokens");
    } finally {
      db.close();
    }

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "truncated_by_token_limit",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
    ]);
    expectJoinedAttempts(checkpoint);
  });

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
        .get("auth/login") as { checkpoint_json: string | null };
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
    // +100/+50: the stage-5c understanding task succeeds with one call.
    expect(result.totals.inputTokens).toBe(400);
    expect(result.totals.outputTokens).toBe(200);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.errors.map((error) => error.code)).toContain(
      "anchor_outside_closed_list",
    );
  });

  it("uses a fresh initial prompt when the completed invalid candidate exceeds the char budget", async () => {
    const oversizedFragment = `OVERSIZED_CANDIDATE_${"X".repeat(300)}_TAIL`;
    llm.responses = [
      makeInvalidPage(oversizedFragment),
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 128,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    expect(llm.callLog[1]?.system).toContain("documentation generator");
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).not.toContain("# Prior candidate");
    expect(llm.callLog[1]?.user).not.toContain("OVERSIZED_CANDIDATE_");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
    ]);
    // Lot D — D3.2: I1 (1:1 join between usageHistory and
    // diagnosticHistory) must still hold under the new
    // oversized-candidate gate.
    expectJoinedAttempts(checkpoint);
  });

  it("embeds a completed invalid candidate beyond 16k in full when it fits the char budget", async () => {
    const fullCandidatePayload = `${"P".repeat(17_000)}FULL_CANDIDATE_TAIL`;
    llm.responses = [
      makeInvalidPage(fullCandidatePayload),
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 20_000,
    });

    expect(result.status).toBe("completed");
    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).toContain("P".repeat(17_000));
    expect(llm.callLog[1]?.user).toContain("FULL_CANDIDATE_TAIL");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
    ]);
  });

  it("recovers the v11 near-miss shape with intact markers and the full candidate", async () => {
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;
    const nearMiss = [
      "---",
      "title: test",
      "owner: generated",
      "anchors:",
      ...closedKeys.map((key) => `  - ${key}`),
      "---",
      "",
      "# test",
      "",
      validMarker,
      "",
      "F".repeat(17_000),
      "FULL_NEAR_MISS_TAIL",
      "TODO: replace this single placeholder.",
      "",
    ].join("\n");
    llm.responses = [nearMiss, makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 25_000,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).toContain(validMarker);
    expect(llm.callLog[1]?.user).toContain("F".repeat(17_000));
    expect(llm.callLog[1]?.user).toContain("FULL_NEAR_MISS_TAIL");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.errors.map((error) => error.code)).toContain(
      "todo_marker_present",
    );
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
    ]);
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

  it("repairs a granular page-opening failure through its specific mechanical ACTION", async () => {
    const keys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const valid = makeValidPage(keys);
    const invalid = valid.replace("- Change this module's implementation.\n", "");
    llm.responses = [invalid, valid];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 1,
    });
    expect(result.status).toBe("completed");
    expect(llm.callLog[1]?.user).toMatch(
      /missing_page_opening.*page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets.*ACTION: SPECIFIC FAILURE: page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets/s,
    );
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.[0]?.errors).toContainEqual(expect.objectContaining({
      code: "missing_page_opening",
      message: 'page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets',
      offending: "- Review this module's behavior.",
    }));
    expect(checkpoint.diagnosticHistory?.[1]?.outcome).toBe("success");
  });

  it("repairs a product title equal to the module ID through its mechanical ACTION", async () => {
    const keys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const valid = makeValidPage(keys);
    llm.responses = [valid.replace("title: test", "title: auth/login"), valid];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 1,
    });
    expect(result.status).toBe("completed");
    expect(llm.callLog[1]?.user).toMatch(/title_equals_module_id.*ACTION: replace the frontmatter title and H1/s);
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.[0]?.errors.map((error) => error.code)).toContain("title_equals_module_id");
    expect(checkpoint.diagnosticHistory?.[1]?.outcome).toBe("success");
  });
});

describe("stage-4 per-attempt diagnostics", () => {
  it("H1 persists stop-invalid, stop-invalid, abort in order with a 1:1 usage join", async () => {
    llm.responses = [
      makeInvalidPage("FIRST_INVALID_CANDIDATE"),
      makeInvalidPage("SECOND_INVALID_CANDIDATE"),
      "PARTIAL_ABORT_CANDIDATE",
    ];
    llm.stopReasons = ["complete", "complete", "incomplete"];
    llm.rawStopReasons = ["stop", "stop", "abort"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    const diagnostics = checkpoint.diagnosticHistory!;
    expect(diagnostics.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "incomplete_generation",
    ]);
    expect(diagnostics.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
      "repair",
    ]);
    expect(diagnostics.map((entry) => entry.rawStopReason)).toEqual([
      "stop",
      "stop",
      "abort",
    ]);
    expectJoinedAttempts(checkpoint);
  });

  it("H2 persists abort, stop-invalid, abort with fresh then repair prompts", async () => {
    llm.responses = [
      "FIRST_PARTIAL_ABORT",
      makeInvalidPage("MIDDLE_INVALID_CANDIDATE"),
      "LAST_PARTIAL_ABORT",
    ];
    llm.stopReasons = ["incomplete", "complete", "incomplete"];
    llm.rawStopReasons = ["abort", "stop", "abort"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "incomplete_generation",
      "artifact_validation_failed",
      "incomplete_generation",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
      "repair",
    ]);
    expectJoinedAttempts(checkpoint);
  });

  it("H3 excludes an incomplete candidate from the next fresh prompt", async () => {
    const partial = "UNIQUE_PARTIAL_TEXT_MUST_NOT_BE_REUSED";
    llm.responses = [
      partial,
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    llm.stopReasons = ["incomplete", "complete"];
    llm.rawStopReasons = ["abort", "stop"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(llm.callLog[1]?.system).toContain("documentation generator");
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).not.toContain(partial);
    expect(llm.callLog[1]?.user).not.toContain("# Prior candidate");
  });

  it("uses a fresh third prompt after invalid then incomplete without resurrecting the invalid candidate", async () => {
    const invalid = "OLDER_INVALID_CANDIDATE_MUST_NOT_RETURN";
    const partial = "IMMEDIATE_PARTIAL_CANDIDATE_MUST_NOT_BE_REPAIRED";
    llm.responses = [
      makeInvalidPage(invalid),
      partial,
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    llm.stopReasons = ["complete", "incomplete", "complete"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[2]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[2]?.user).not.toContain(invalid);
    expect(llm.callLog[2]?.user).not.toContain(partial);
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
      "initial",
    ]);
  });

  it("repairs only the immediately previous invalid candidate after incomplete then invalid", async () => {
    const partial = "OLDER_PARTIAL_MUST_NOT_RETURN";
    const invalid = "IMMEDIATE_INVALID_MUST_BE_REPAIRED";
    llm.responses = [
      partial,
      makeInvalidPage(invalid),
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    llm.stopReasons = ["incomplete", "complete", "complete"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[2]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[2]?.user).toContain(invalid);
    expect(llm.callLog[2]?.user).not.toContain(partial);
    expect(llm.callLog[2]?.user).toContain("no_frontmatter");
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
      "repair",
    ]);
  });

  it("I2 appends seeded diagnostics with globally monotonic attempts on --only", async () => {
    llm.responses = [makeInvalidPage("FIRST_RUN_INVALID")];
    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
    });

    const retryLlm = new ProgrammableMockLlm();
    retryLlm.responses = [
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    await runOnly({
      repoRoot,
      llmClient: retryLlm,
      noRefine: true,
      onlyTarget: "auth/login",
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expectJoinedAttempts(checkpoint);
  });

  it("I4 caps persisted errors and text without retaining raw candidate, source, or prompt", async () => {
    const sourceSecret = "SOURCE_TEXT_MUST_NEVER_BE_PERSISTED";
    const candidateSecret = "RAW_CANDIDATE_MUST_NEVER_BE_PERSISTED";
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      `export function login() { return "${sourceSecret}"; }`,
      "utf8",
    );
    const fakeKeys = Array.from(
      { length: 60 },
      (_, index) => `${"outside-key-".repeat(20)}${index}`,
    );
    llm.responses = [
      [
        "---",
        "title: unsafe diagnostic candidate",
        "owner: generated",
        "anchors:",
        ...fakeKeys.map((key) => `  - ${key}`),
        "---",
        "",
        "# Unsafe candidate",
        `<!-- lw:anchors ${fakeKeys.join(" ")} -->`,
        "",
        candidateSecret.repeat(100),
      ].join("\n"),
    ];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    const diagnostic = checkpoint.diagnosticHistory?.[0];
    expect(diagnostic?.errors).toHaveLength(DIAGNOSTIC_MAX_ERRORS);
    // Existing anchor/coverage errors plus the new single structural-opening error.
    const expectedValidationErrors = fakeKeys.length * 2 + 3;
    expect(diagnostic?.truncatedErrorCount).toBe(
      expectedValidationErrors - DIAGNOSTIC_MAX_ERRORS,
    );
    expect(diagnostic?.errors.every((error) => error.message.length <= DIAGNOSTIC_TEXT_CAP)).toBe(
      true,
    );
    expect(
      diagnostic?.errors.every(
        (error) => error.offending === undefined || error.offending.length <= DIAGNOSTIC_TEXT_CAP,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(checkpoint);
    expect(serialized).not.toContain(candidateSecret);
    expect(serialized).not.toContain(sourceSecret);
    expect(serialized).not.toContain("# Closed list of canonical keys");
    expect(diagnostic?.candidateChars).toBeGreaterThan(candidateSecret.length);
    expect(diagnostic?.candidateSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("records candidate size/hash and empty errors for success", async () => {
    llm.responses = [
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    const diagnostic = checkpoint.diagnosticHistory?.[0];
    expect(diagnostic?.outcome).toBe("success");
    expect(diagnostic?.promptKind).toBe("initial");
    expect(diagnostic?.errors).toEqual([]);
    expect(diagnostic?.truncatedErrorCount).toBe(0);
    expect(diagnostic?.candidateChars).toBeGreaterThan(0);
    expect(diagnostic?.candidateSha256).toMatch(/^[a-f0-9]{64}$/);
    expectJoinedAttempts(checkpoint);
  });

  it("classifies normalization rejection separately from artifact validation", async () => {
    llm.responses = ["<think>unfinished reasoning"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.[0]).toMatchObject({
      outcome: "normalization_failed",
      promptKind: "initial",
      errors: [expect.objectContaining({ code: "unclosed_reasoning" })],
    });
    expectJoinedAttempts(checkpoint);
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
      relaxedRound: false,
      maxRepairAttempts: 2,
    });

    expect(llm.callCount).toBe(3);

    // Status: completed_with_failures (1 task done=0, 1 task fail=1)
    expect(result.status).toBe("completed_with_failures");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error.code).toBe("repair_exhausted");
    expect(result.circuitBreakerTriggered).toBe(false);

    // Page NEVER persisted (artifact never passed validator → never wrote)
    const wikiPath = nodePath.join(repoRoot, "livewiki/auth/login.md");
    await expect(nodeFs.access(wikiPath)).rejects.toThrow();

    // Checkpoint has 3 usage entries (all with real usage, no fake duplicate)
    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth/login") as { checkpoint_json: string | null };
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
      relaxedRound: false,
      maxRepairAttempts: 0,
    });
    expect(llm.callCount).toBe(1);
    expect(result.status).toBe("completed_with_failures");
  });

  // H5 (Lot B): the `repair_exhausted` message MUST list the FULL
  // attempt sequence and the real (summed) totals, not just the last
  // attempt's error count. This is the v9 misreport regression test.
  it("H5 repair_exhausted reports the full attempt sequence and real totals", async () => {
    // Mirrors the handover's failure shape:
    //   stop + invalid → stop + invalid → abort
    // 3 attempts, all invalid, exhausted after the third.
    llm.responses = [
      makeInvalidPage("FIRST_INVALID_CANDIDATE"),
      makeInvalidPage("SECOND_INVALID_CANDIDATE"),
      "PARTIAL_ABORT_CANDIDATE",
    ];
    llm.stopReasons = ["complete", "complete", "incomplete"];
    llm.rawStopReasons = ["stop", "stop", "abort"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.error.code).toBe("repair_exhausted");
    const message = failure.error.message;

    // The message lists every attempt in order with its normalized
    // stop reason, outcome, and error codes (deduplicated, first-seen
    // order). The H1 test already checks diagnosticHistory outcomes;
    // here we pin the exact line format so the contract is locked.
    expect(message).toContain("exhausted 3 LLM call(s) without producing a verified artifact.");
    expect(message).toContain("attempt 1: complete -> artifact_validation_failed");
    expect(message).toContain("attempt 2: complete -> artifact_validation_failed");
    expect(message).toContain("attempt 3: incomplete -> incomplete_generation");
    // Each attempt line ends with the bracketed codes (comma-separated).
    expect(message).toMatch(/attempt 1: complete -> artifact_validation_failed \[[^\]]+\]/);
    expect(message).toMatch(/attempt 3: incomplete -> incomplete_generation \[[^\]]+\]/);

    // Real totals: sum of errors.length + truncatedErrorCount across
    // THIS loop's attempts. We assert >= the count we know is there
    // (3 attempts × ≥ 1 error each) and that it is NOT the last
    // attempt's count.
    const totalMatch = /Total errors recorded: (\d+)\./.exec(message);
    expect(totalMatch).not.toBeNull();
    const totalErrors = Number(totalMatch![1]);
    expect(totalErrors).toBeGreaterThanOrEqual(3);
    // The v9 misreport bug: the message would say "Total errors
    // recorded: 1" when only the last attempt's count was used. With
    // summed totals that can never happen here (3 attempts each have
    // at least 1 error, and the third one is `incomplete_generation`).
    expect(totalErrors).not.toBe(1);

    // failedAt retry-hint behavior is preserved (equivalent to the
    // pre-Lot B logic): set when the last reported error has a
    // sectionSlug. The `incomplete_generation` error has no section,
    // so failedAt should be absent in this scenario. The
    // `BatchRunResult["failures"]` surface is intentionally minimal
    // (no `failedAt` field) so we read the persisted checkpoint
    // directly to inspect the retry-hint.
    const cp = await readStage4Checkpoint(repoRoot);
    expect((cp.error as { failedAt?: number } | undefined)?.failedAt).toBeUndefined();
  });

  // H7 (Lot B): with the new state machine (fresh-then-repair
  // sequencing driven by outcome category, not positional `i > 0`),
  // usageHistory MUST stay globally monotonic across runs and the
  // stage / module / run token totals MUST reconcile exactly with the
  // sum of usage entries. This guards the v9 misreport class of bugs
  // where accounting was a side-effect of how the loop happened to
  // be sequenced.
  it("H7 usageHistory stays monotonic across --only and totals reconcile exactly with usage entries", async () => {
    // Run 1: 3 invalid attempts, no success → exhausts the bounded
    // loop. usageHistory ends with 3 entries (attempts 1, 2, 3).
    llm.responses = [
      makeInvalidPage("FIRST_RUN_INVALID_A"),
      makeInvalidPage("FIRST_RUN_INVALID_B"),
      makeInvalidPage("FIRST_RUN_INVALID_C"),
    ];
    const firstResult = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
    });
    expect(firstResult.status).toBe("completed_with_failures");
    expect(firstResult.failures).toHaveLength(1);
    expect(llm.callCount).toBe(3);

    // Run 2 (--only retry): mix of fresh and repair attempts.
    //   attempt 4 = initial (invalid → repair)
    //   attempt 5 = repair with the new errors (truncated)
    //   attempt 6 = fresh initial after length (valid → success)
    const retryLlm = new ProgrammableMockLlm();
    retryLlm.responses = [
      makeInvalidPage("SECOND_RUN_INVALID"),
      "PARTIAL_TRUNCATED",
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    retryLlm.stopReasons = ["complete", "length", "complete"];
    retryLlm.rawStopReasons = ["stop", "max_tokens", "end_turn"];

    const secondResult = await runOnly({
      repoRoot,
      llmClient: retryLlm,
      noRefine: true,
      onlyTarget: "auth/login",
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
    });
    expect(secondResult.status).toBe("completed");
    expect(retryLlm.callCount).toBe(3);

    // 1: Checkpoint now has 6 usage entries with globally monotonic
    // attempts (1, 2, 3, 4, 5, 6) — exactly the invariant described
    // in `batch.ts:findings#5` and now in the H7 contract.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    try {
      const row = db
        .prepare(
          "SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?",
        )
        .get("auth/login") as { checkpoint_json: string };
      const cp = JSON.parse(row.checkpoint_json) as {
        attempt: number;
        usageHistory: Array<{
          attempt: number;
          usage: { inputTokens: number; outputTokens: number; model: string } | null;
          usageKnown: boolean;
        }>;
        diagnosticHistory: Array<{ attempt: number; outcome: string; promptKind: string }>;
      };
      expect(cp.usageHistory).toHaveLength(6);
      expect(cp.usageHistory.map((u) => u.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
      // The last attempt is 6 (the success).
      expect(cp.attempt).toBe(6);
      // Diagnostic history joins 1:1 with usage history.
      expect(cp.diagnosticHistory).toHaveLength(6);
      expect(cp.diagnosticHistory.map((d) => d.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
      // The new state machine's promptKind for this scenario:
      //   1: initial (invalid)
      //   2: repair
      //   3: repair
      //   4: initial (invalid)
      //   5: repair
      //   6: initial (fresh after `length` truncation)
      expect(cp.diagnosticHistory.map((d) => d.promptKind)).toEqual([
        "initial",
        "repair",
        "repair",
        "initial",
        "repair",
        "initial",
      ]);
      // Outcomes: invalid, invalid, invalid, invalid, length, success.
      expect(cp.diagnosticHistory.map((d) => d.outcome)).toEqual([
        "artifact_validation_failed",
        "artifact_validation_failed",
        "artifact_validation_failed",
        "artifact_validation_failed",
        "truncated_by_token_limit",
        "success",
      ]);
    } finally {
      db.close();
    }

    // 2: The per-run result reports only the SECOND run's usage
    // (3 calls × 100 input = 300 input). The cumulative totals live
    // in the checkpoint + the status report (below). This is by
    // design: each `runBatch`/`runOnly` returns its own atomic
    // result; aggregation across runs happens via `buildStatusReport`.
    const perRunInput = 3 * 100;
    const perRunOutput = 3 * 50;
    expect(secondResult.totals.inputTokens).toBe(perRunInput);
    expect(secondResult.totals.outputTokens).toBe(perRunOutput);
    expect(secondResult.byModule[0]?.inputTokens).toBe(perRunInput);
    expect(secondResult.byModule[0]?.outputTokens).toBe(perRunOutput);

    // 3: buildStatusReport reconciles the CUMULATIVE totals (6 calls
    // × 100 input = 600 input) — stage 4 + module-level sums match
    // the run total. This is the "totals reconcile exactly with the
    // sum of usage entries" guarantee that the H7 contract requires.
    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    const cumulativeInput = 6 * 100;
    const cumulativeOutput = 6 * 50;
    const stage4 = report.byStage["4"]!;
    // #29: stage 4 also ran ONE folder-purpose call in run 1 (+100/+50).
    expect(stage4.inputTokens).toBe(cumulativeInput + 100);
    expect(stage4.outputTokens).toBe(cumulativeOutput + 50);
    const authMod = report.byModule.find((m) => m.module === "auth/login")!;
    expect(authMod.inputTokens).toBe(cumulativeInput);
    expect(authMod.outputTokens).toBe(cumulativeOutput);
    // +100/+50 again: stage-5c understanding ran in the full run (the
    // accepted folder page is synthesis evidence).
    expect(report.totals.inputTokens).toBe(cumulativeInput + 200);
    expect(report.totals.outputTokens).toBe(cumulativeOutput + 100);
  });
});

// === D3 — guard-rails (Lot D) ===
// The new oversized-candidate gate (Lot C) might silently break the
// 1:1 join or the seeding invariant if it's wired wrong. Pin both
// under the gate here.
describe("batch D3 — guard-rails under the new oversized-candidate gate", () => {
  it("D3.2 I2 (seeding) still holds: --only after an oversized-gate run keeps globally monotonic attempts + 1:1 join", async () => {
    // First run: oversized invalid candidate forces the gate to
    // fire, then a fresh initial succeeds. Seeded diagnosticHistory
    // has 2 entries (attempts 1, 2).
    const oversizedFragment = `OVERSIZED_SEEDING_${"Y".repeat(300)}_TAIL`;
    llm.responses = [
      makeInvalidPage(oversizedFragment),
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const firstResult = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 128,
    });
    expect(firstResult.status).toBe("completed");
    expect(llm.callCount).toBe(2);

    // Second run via --only: a fresh initial that succeeds (the
    // gate still has the same wiring, so it will only fire if the
    // new candidate is also oversized). Seeded diagnosticHistory
    // now has 3 entries (attempts 1, 2, 3) — globally monotonic.
    const retryLlm = new ProgrammableMockLlm();
    retryLlm.responses = [
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];
    const secondResult = await runOnly({
      repoRoot,
      llmClient: retryLlm,
      noRefine: true,
      onlyTarget: "auth/login",
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });
    expect(secondResult.status).toBe("completed");
    expect(retryLlm.callCount).toBe(1);

    // 1. I2 (seeding) still holds: diagnostic history is seeded
    // from the previous checkpoint and appended to — never reset.
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.attempt)).toEqual([
      1, 2, 3,
    ]);
    // The first 2 entries are the gate run; the 3rd is the
    // seeded fresh initial after --only retry.
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
      "success",
    ]);
    // 1:1 join between usage and diagnostic still holds.
    expectJoinedAttempts(checkpoint);

    // 2. The cumulative usage on the status report reflects 3
    // LLM calls × 100 input = 300 input. The gate did not break
    // accounting.
    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    expect(report.totals.inputTokens).toBe(500);
    expect(report.totals.outputTokens).toBe(250);
  });
});

// === Owner: human (Criterion #8) ===
describe("batch X — owner: human is untouchable (Criterion #8)", () => {
  it("page with owner: human is NOT regenerated and NO LLM call is made", async () => {
    // Create a pre-existing page with owner: human
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    const humanPage = [
      "---",
      "title: Authentication responsibilities",
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
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", humanPage);

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
    const onDisk = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
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
        .get("auth/login") as { checkpoint_json: string | null };
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
    await safeIo.writeText(repoRoot, "livewiki/auth/login.md", existingPage);

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
    const onDisk = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
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
              wikiPath: "livewiki/auth/login.md",
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
        relaxedRound: false,
        maxRepairAttempts: 0, // no repair — test only the rollback of one call
      });

      // Verify was called (1x — the write + 1 verify)
      expect(runVerifySpy).toHaveBeenCalled();

      // Page NEVER persisted (was removed by the rollback)
      const wikiPath = nodePath.join(repoRoot, "livewiki/auth/login.md");
      await expect(nodeFs.access(wikiPath)).rejects.toThrow();

      // Status reflects the failure
      expect(result.status).toBe("completed_with_failures");
      expect(result.failures).toHaveLength(1);
      const checkpoint = await readStage4Checkpoint(repoRoot);
      expect(checkpoint.diagnosticHistory?.[0]).toMatchObject({
        outcome: "verify_failed",
        promptKind: "initial",
        errors: [expect.objectContaining({ code: "broken_anchor" })],
      });
      expectJoinedAttempts(checkpoint);
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
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        maxTopics: 0,
        // Roadmap #22: pin the pre-#22 stage-4 format (see beforeEach note).
        moduleDiagrams: false,
        deepHierarchy: false,
        // #29: disable fixture/tooling classification so all five files
        // stay product (bare `tests/` dirs are deliberately not tests).
        pathRoles: { fixturePatterns: [], toolingPatterns: [] },
      }),
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // Status: completed (10 unit tasks done, 0 fails)
    expect(result.failures).toEqual([]);
    expect(result.status).toBe("completed");
    // 5 file units + 5 folder units + the stage-5c understanding task.
    expect(result.byModule).toHaveLength(11);

    // #29: 5 directories with leaf "src" → 5 wave-expanded folder units
    // (cli-src, core-src, fixtures-src, mcp-src, scripts-src) + 5 file
    // units (<folder>/auth). All ids distinct — no overwrite.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), { readonly: true });
    try {
      const tasks = db
        .prepare("SELECT target, status FROM batch_tasks WHERE stage = 4 ORDER BY target")
        .all() as Array<{ target: string; status: string }>;
      const targets = tasks.map((t) => t.target);
      expect(new Set(targets).size).toBe(targets.length);
      expect(tasks.every((t) => t.status === "done")).toBe(true);
      const folderTargets = targets.filter((t) => !t.includes("/"));
      expect(folderTargets).toEqual([
        "cli-src",
        "core-src",
        "fixtures-src",
        "mcp-src",
        "scripts-src",
      ]);
      const fileTargets = targets.filter((t) => t.includes("/"));
      expect(fileTargets).toEqual([
        "cli-src/auth",
        "core-src/auth",
        "fixtures-src/auth",
        "mcp-src/auth",
        "scripts-src/auth",
      ]);
    } finally {
      db.close();
    }

    // Each file unit has its own page (livewiki/<folder>/auth.md) with
    // frontmatter owner: generated (from the LLM) — 5 distinct pages.
    for (const folder of ["cli-src", "core-src", "fixtures-src", "mcp-src", "scripts-src"]) {
      const content = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki", folder, "auth.md"),
        "utf8",
      );
      expect(content).toMatch(/owner: generated/);
    }
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
        .get("auth/login") as { checkpoint_json: string | null };
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

    // Run totals = 2 * 100 file-page calls + 100 folder purpose + 100 understanding = 400 input
    expect(result.totals.inputTokens).toBe(400);
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
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");

    const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath, { readonly: true });
    try {
      const task = db
        .prepare("SELECT * FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth/login") as { checkpoint_json: string | null };
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
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "llm_error",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
    ]);
    expectJoinedAttempts(checkpoint);
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
    // Roadmap #22: pin the pre-#22 stage-4 format for these repair-contract
    // fixtures (stubs do not emit the Diagram section); the #22-on behavior is
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

  it("LlmTimeoutError: one call, failed llm_timeout, no repair, unknown usage; other modules continue", async () => {
    // First stage-4 module times out; second succeeds (order depends on prioritize).
    let n = 0;
    llm.generate = async (req) => {
      // Stage 5c (item 23): valid page outside this override's counting.
      if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
        return {
          content: VALID_UNDERSTANDING_PAGE,
          usage: { inputTokens: 100, outputTokens: 50, model: llm.model },
        };
      }
      // #29: folder-purpose prompts get a valid plain paragraph outside
      // this override's counting (same convention as understanding).
      if (
        req.system.includes("purpose paragraph of ONE folder page") ||
        req.system.includes("folder purpose paragraph")
      ) {
        return {
          content: VALID_FOLDER_PURPOSE,
          usage: { inputTokens: 100, outputTokens: 50, model: llm.model },
        };
      }
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
        diagnosticHistory: DiagnosticAttempt[];
      };
      expect(cp.status).toBe("failed");
      expect(cp.error?.code).toBe("llm_timeout");
      expect(cp.error?.message).toMatch(/unknown|bill|timeout/i);
      expect(cp.attempt).toBe(1);
      expect(cp.usageHistory).toHaveLength(1);
      expect(cp.usageHistory[0]!.usageKnown).toBe(false);
      expect(cp.usageHistory[0]!.usage).toBeNull();
      expect(cp.usageHistory[0]!.attempt).toBe(1);
      expect(cp.diagnosticHistory).toHaveLength(1);
      expect(cp.diagnosticHistory[0]).toMatchObject({
        attempt: 1,
        outcome: "llm_error",
        promptKind: "initial",
        errors: [expect.objectContaining({ code: "llm_timeout" })],
        truncatedErrorCount: 0,
      });
      expect(cp.diagnosticHistory[0]!.candidateChars).toBeUndefined();
      expect(cp.diagnosticHistory[0]!.candidateSha256).toBeUndefined();

      const done = db
        .prepare(
          "SELECT COUNT(*) as c FROM batch_tasks WHERE stage = 4 AND status = 'done'",
        )
        .get() as { c: number };
      // The surviving file unit plus the two folder tasks.
      expect(done.c).toBe(3);
    } finally {
      db.close();
    }

    // Totals incomplete when timeout present
    expect(result.totals.usageIncomplete).toBe(true);
    // known file-unit success + 2 folder-purpose calls + the stage-5c understanding call
    expect(result.totals.inputTokens).toBe(400);
    expect(result.totals.outputTokens).toBe(200);
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
    // +200: two folder-purpose calls; +100: the stage-5c understanding task succeeds with one call.
    expect(report.totals.inputTokens).toBe(400);
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
    // The folder-purpose call succeeded (mock bypass) — its model is real usage.
    expect(result.totals.models).toEqual(["claude-test-mock"]);
  });

  it("timeout-only status rebuild: costUsd null never 0", async () => {
    await nodeFs.rm(nodePath.join(repoRoot, "src/utils"), {
      recursive: true,
      force: true,
    });
    llm.generate = async (req) => {
      // Stage 5c: valid page outside this override's counting.
      if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
        return {
          content: VALID_UNDERSTANDING_PAGE,
          usage: { inputTokens: 100, outputTokens: 50, model: llm.model },
        };
      }
      // #29: folder-purpose prompts get a valid plain paragraph outside
      // this override's counting — only the file-unit call times out.
      if (
        req.system.includes("purpose paragraph of ONE folder page") ||
        req.system.includes("folder purpose paragraph")
      ) {
        return {
          content: VALID_FOLDER_PURPOSE,
          usage: { inputTokens: 100, outputTokens: 50, model: llm.model },
        };
      }
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
    // #29: the stage-4 aggregate includes the successful folder-purpose
    // call (100/50, real model); the FAILED file task below still
    // reports 0 tokens / costUsd null / usageIncomplete.
    expect(t4!.inputTokens).toBe(100);
    expect(t4!.outputTokens).toBe(50);
    expect(t4!.costUsd).toBeNull();
    expect(t4!.models).toEqual(["claude-test-mock"]);
    expect(t4!.usageIncomplete).toBe(true);
    expect(report.totals.costUsd).toBeNull();
    expect(report.totals.usageIncomplete).toBe(true);
    const failed = report.tasks.find((t) => t.stage === 4 && t.status === "failed");
    expect(failed?.error?.code).toBe("llm_timeout");
  });
});

// === D2 — v11 evidence replay (Lot D) ===
// Replays the three v11 stage-4 task shapes with scripted stubs
// and asserts the NEW outcomes — recovery via one repair with
// intact markers, instead of the v11 collapse into 50+
// missing_closed_key errors per attempt.
describe("batch D2 — v11 evidence replay (recovery via one repair)", () => {
  it("D2.1 core-src-02 shape: 19k candidate, 2 frontmatter-side errors, one repair, done", async () => {
    // v11 evidence: attempt 1 = complete -> artifact_validation_failed
    // [anchor_outside_closed_list, missing_closed_key]. With Lot C's
    // selective preservation, attempt 2 embeds the FULL 19k
    // candidate with valid section markers intact — and a single
    // targeted repair fixes both errors.
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;

    // 19k near-miss candidate: valid section markers preserved
    // in payload, but two frontmatter-side errors (one invented
    // anchor that the validator catches as
    // `anchor_outside_closed_list`, one missing key from the
    // frontmatter list that the validator catches as
    // `missing_closed_key`).
    const nearMiss = [
      "---",
      "title: auth",
      "owner: generated",
      "anchors:",
      `  - ${closedKeys[0]}`,
      // <-- closedKeys[1] is MISSING from frontmatter (one missing_closed_key)
      "  - src/auth/login.ts#invented-anchor-not-in-closed-list",
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## Details",
      "",
      validMarker,
      "",
      "F".repeat(19_000 - 200),
      "CORE_SRC_02_FULL_NEAR_MISS_TAIL",
      "",
    ].join("\n");
    expect(nearMiss.length).toBeGreaterThan(19_000);

    llm.responses = [nearMiss, makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 25_000,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);

    // Repair prompt: the full candidate is embedded (no 16k
    // truncation), the valid section marker survives the
    // selective neutralization, and the structured errors drive
    // the targeted fix.
    const repairUser = llm.callLog[1]?.user ?? "";
    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(repairUser).toContain(validMarker);
    expect(repairUser).toContain("F".repeat(19_000 - 200));
    expect(repairUser).toContain("CORE_SRC_02_FULL_NEAR_MISS_TAIL");
    // The two frontmatter errors are present in the structured
    // error list of the repair prompt.
    expect(repairUser).toContain("anchor_outside_closed_list");
    expect(repairUser).toContain("missing_closed_key");
    expect(repairUser).toContain("src/auth/login.ts#invented-anchor-not-in-closed-list");
    expect(repairUser).toContain(closedKeys[1]!);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
    ]);
    // The attempt 1 errors MUST include both frontmatter-side
    // codes — and NOT collapse into a 50+ missing_closed_key
    // wall (the v11 failure mode).
    const attempt1Codes = checkpoint.diagnosticHistory?.[0]?.errors.map(
      (error) => error.code,
    );
    expect(attempt1Codes).toContain("anchor_outside_closed_list");
    expect(attempt1Codes).toContain("missing_closed_key");
    expect(attempt1Codes?.length ?? 0).toBeLessThanOrEqual(10);
    // Task is done in exactly 2 calls.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    try {
      const task = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth/login") as { checkpoint_json: string };
      const cp = JSON.parse(task.checkpoint_json) as {
        status: string;
        attempt: number;
      };
      expect(cp.status).toBe("done");
      expect(cp.attempt).toBe(2);
    } finally {
      db.close();
    }
  });

  it("D2.2 core-src-04 shape: >16k candidate, 1 todo_marker_present, one repair, done", async () => {
    // v11 evidence: attempt 1 = complete -> artifact_validation_failed
    // [todo_marker_present]. With Lot C's full-candidate embed
    // (no 16k truncation), attempt 2 sees the full prior candidate
    // and a single targeted repair fixes the TODO. No collapse into
    // missing_closed_key errors.
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;

    const nearMiss = [
      "---",
      "title: Authentication responsibilities",
      "owner: generated",
      "anchors:",
      ...closedKeys.map((key) => `  - ${key}`),
      "---",
      "",
      "# Authentication responsibilities",
      "",
      "This page documents authentication behavior.",
      "",
      "## When to use this page",
      "",
      "- Review authentication behavior.",
      "- Change authentication implementation.",
      "",
      "## How it fits",
      "",
      "This module provides authentication within the repository.",
      "",
      "## Details",
      "",
      validMarker,
      "",
      "F".repeat(17_000),
      "CORE_SRC_04_FULL_NEAR_MISS_TAIL",
      "TODO: replace this single placeholder.",
      "",
    ].join("\n");
    expect(nearMiss.length).toBeGreaterThan(16_000);

    llm.responses = [nearMiss, makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 25_000,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    const repairUser = llm.callLog[1]?.user ?? "";
    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(repairUser).toContain(validMarker);
    expect(repairUser).toContain("F".repeat(17_000));
    expect(repairUser).toContain("CORE_SRC_04_FULL_NEAR_MISS_TAIL");
    expect(repairUser).toContain("todo_marker_present");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
    ]);
    // The single error is the TODO marker — no cascade.
    const attempt1Codes = checkpoint.diagnosticHistory?.[0]?.errors.map(
      (error) => error.code,
    );
    expect(attempt1Codes).toEqual(["todo_marker_present"]);
  });

  it("D2.3 core-src-03 shape: invalid -> abort -> fresh initial (previous contract still holds)", async () => {
    // v11 evidence: attempt 1 = complete -> artifact_validation_failed
    // [todo_marker_present], attempt 2 = incomplete -> incomplete_generation,
    // attempt 3 = complete -> artifact_validation_failed [unclosed_markdown].
    // The previous contract's state machine rule: an `incomplete_generation`
    // outcome clears repair state, so attempt 3 is a fresh initial
    // (NOT a degenerate repair). Lot C's changes must not regress
    // this rule. We also verify that the partial abort content
    // (which itself contains no anchor markers) is never embedded
    // into a repair prompt, even though the LLM "had" a partial.
    //
    // promptKind semantics: the diagnostic entry's promptKind is the
    // prompt kind USED for THAT attempt. So:
    //   attempt 1: initial    (first call, no prior to repair)
    //   attempt 2: repair     (after attempt 1 invalid)
    //   attempt 3: initial    (after attempt 2 incomplete_generation
    //                          cleared repair state per previous
    //                          contract — even though attempt 1
    //                          would otherwise have fed it)
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;
    const todoPage = [
      "---",
      "title: auth",
      "owner: generated",
      "anchors:",
      ...closedKeys.map((key) => `  - ${key}`),
      "---",
      "",
      "# auth",
      "",
      validMarker,
      "",
      "Body.",
      "TODO: replace this single placeholder.",
      "",
    ].join("\n");
    const partialAbort = "PARTIAL_ABORT_FROM_CORE_SRC_03";
    // Attempt 3: fresh initial, but the LLM produced an
    // unclosed-markdown candidate (matches v11 evidence).
    const unclosedPage = [
      "---",
      "title: auth",
      "owner: generated",
      "anchors:",
      ...closedKeys.map((key) => `  - ${key}`),
      "---",
      "",
      "# auth",
      "",
      validMarker,
      "",
      "Body with an unclosed code span: `foo",
      "",
    ].join("\n");

    llm.responses = [todoPage, partialAbort, unclosedPage];
    llm.stopReasons = ["complete", "incomplete", "complete"];
    llm.rawStopReasons = ["stop", "abort", "stop"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    // 3 calls made (1 invalid -> 1 repair -> 1 fresh after abort).
    expect(llm.callCount).toBe(3);

    // call 1 (index 0): the FRESH initial stage-4 prompt
    expect(llm.callLog[0]?.system).toContain("documentation generator");
    expect(llm.callLog[0]?.system).not.toContain("REPAIR assistant");

    // call 2 (index 1): the REPAIR of attempt 1 (because attempt 1
    // was invalid). The todoPage is embedded as the prior
    // candidate, with the structured todo_marker_present error.
    expect(llm.callLog[1]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).toContain("# Prior candidate");
    expect(llm.callLog[1]?.user).toContain(todoPage);
    expect(llm.callLog[1]?.user).toContain("todo_marker_present");

    // call 3 (index 2): the FRESH initial after attempt 2 was
    // incomplete. The previous contract's rule: an
    // incomplete_generation outcome clears repair state, so
    // attempt 3 is a fresh initial — NOT a degenerate repair
    // built from the partial abort content. The partial abort
    // content is never embedded.
    expect(llm.callLog[2]?.system).toContain("documentation generator");
    expect(llm.callLog[2]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[2]?.user).not.toContain("# Prior candidate");
    expect(llm.callLog[2]?.user).not.toContain(partialAbort);
    expect(llm.callLog[2]?.user).not.toContain(todoPage);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    // promptKind sequence: initial (todo), repair (after invalid),
    // initial (fresh after abort cleared). The KEY invariant:
    // attempt 3 is "initial", confirming the previous contract's
    // rule still holds after Lot C.
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "repair",
      "initial",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "incomplete_generation",
      "artifact_validation_failed",
    ]);
    // attempt 3's errors include the unclosed_markdown code (matches
    // the v11 evidence shape).
    const attempt3Codes = checkpoint.diagnosticHistory?.[2]?.errors.map(
      (error) => error.code,
    );
    expect(attempt3Codes).toContain("unclosed_markdown");
    // I1 still holds: every attempt has exactly one diagnostic entry.
    expectJoinedAttempts(checkpoint);
  });

  it("D2.4 oversized path: candidate > contextCharBudget -> next attempt fresh, I5 round-trip", async () => {
    // Lot C's oversized-candidate gate: when a completed-but-invalid
    // candidate exceeds the stage-4 char budget, the next attempt is
    // a fresh initial (not a repair that would embed the truncated
    // candidate). Verify the diagnostic sequence and the
    // I5 round-trip of the checkpoint (the diagnosticHistory field
    // is additive — JSON.parse(JSON.stringify(cp)) must yield the
    // same shape and the same content).
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const validMarker = `<!-- lw:anchors ${closedKeys.join(" ")} -->`;
    const oversized = [
      "---",
      "title: auth",
      "owner: generated",
      "anchors:",
      `  - ${closedKeys[0]}`,
      // closedKeys[1] missing -> validator catches it
      "---",
      "",
      "# auth",
      "",
      validMarker,
      "",
      "X".repeat(5_000),
      "OVERSIZED_TAIL",
      "",
    ].join("\n");

    llm.responses = [oversized, makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      contextCharBudget: 256, // tiny budget — forces oversized gate
    });

    // 2 LLM calls: one initial (oversized invalid), one fresh
    // initial (after gate fires) that succeeds.
    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);

    // Attempt 2 system is the FRESH stage-4 system, not the
    // repair system. No candidate fragment is embedded.
    expect(llm.callLog[1]?.system).toContain("documentation generator");
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).not.toContain("# Prior candidate");
    expect(llm.callLog[1]?.user).not.toContain("OVERSIZED_TAIL");
    expect(llm.callLog[1]?.user).not.toContain("X".repeat(5_000));

    const checkpoint = await readStage4Checkpoint(repoRoot);
    // Both attempts are "initial" — gate forced a fresh prompt.
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);

    // I5 round-trip: serialize the persisted checkpoint JSON,
    // re-parse it, and confirm the diagnostic history is
    // bit-identical. This is the "additive field" guarantee.
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
      readonly: true,
    });
    try {
      const row = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 4 AND target = ?")
        .get("auth/login") as { checkpoint_json: string };
      const cpRaw = row.checkpoint_json;
      const reparsed = JSON.parse(cpRaw) as typeof checkpoint;
      expect(reparsed.diagnosticHistory).toEqual(checkpoint.diagnosticHistory);
      // usageHistory also round-trips intact.
      const cpParsed = JSON.parse(cpRaw) as {
        usageHistory: Array<{ attempt: number }>;
      };
      expect(cpParsed.usageHistory.map((u) => u.attempt)).toEqual(
        checkpoint.usageHistory.map((u) => u.attempt),
      );
    } finally {
      db.close();
    }

    // The status report must also surface the diagnostic history
    // (additive field — no existing field changes shape or meaning).
    const { buildStatusReport } = await import("./batch-status.js");
    const report = await buildStatusReport(repoRoot);
    const authTask = report.tasks.find((t) => t.target === "auth/login" && t.stage === 4);
    expect(authTask).toBeDefined();
    // The task has 2 attempts; the cumulative usage reflects 2
    // real LLM calls (no fake duplicate zero-usage).
    expect(authTask!.inputTokens).toBe(200);
    expect(authTask!.outputTokens).toBe(100);
  });
});

describe("Lot I — bounded non-consuming retries for incomplete responses", () => {
  const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];

  it("replays three consumed incomplete responses with two default non-consuming retries", async () => {
    llm.responses = Array.from({ length: 5 }, () => "PARTIAL_ABORT_CANDIDATE");
    llm.stopReasons = Array.from({ length: 5 }, () => "incomplete" as const);
    llm.rawStopReasons = Array.from({ length: 5 }, () => "abort");

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(llm.callCount).toBe(5);
    // 5 file-task calls + 1 folder purpose + 1 stage-5c understanding.
    expect(result.totals.inputTokens).toBe(700);
    expect(result.totals.outputTokens).toBe(350);

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual(
      Array.from({ length: 5 }, () => "incomplete_generation"),
    );
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual(
      Array.from({ length: 5 }, () => "initial"),
    );
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.budgetConsumed)).toEqual([
      false,
      false,
      undefined,
      undefined,
      undefined,
    ]);
    expect(result.failures[0]?.error.message).toContain("exhausted 5 LLM call(s)");
    expectJoinedAttempts(checkpoint);
  });

  it("uses a fresh retry after incomplete, then repairs a completed invalid candidate", async () => {
    llm.responses = [
      "PARTIAL_ABORT_CANDIDATE",
      makeInvalidPage("COMPLETED_INVALID_CANDIDATE"),
      makeValidPage(closedKeys),
    ];
    llm.stopReasons = ["incomplete", "complete", "complete"];
    llm.rawStopReasons = ["abort", "stop", "stop"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);
    expect(llm.callLog[1]?.system).toContain("documentation generator");
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");
    expect(llm.callLog[1]?.user).not.toContain("PARTIAL_ABORT_CANDIDATE");
    expect(llm.callLog[2]?.system).toContain("REPAIR assistant");
    expect(llm.callLog[2]?.user).toContain("COMPLETED_INVALID_CANDIDATE");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "incomplete_generation",
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
      "repair",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.budgetConsumed)).toEqual([
      false,
      undefined,
      undefined,
    ]);
    // +100/+50 folder purpose, +100/+50: the stage-5c understanding task succeeds with one call.
    expect(result.totals.inputTokens).toBe(500);
    expect(result.totals.outputTokens).toBe(250);
    expectJoinedAttempts(checkpoint);
  });

  it("maxIncompleteRetries zero preserves the legacy call bound and checkpoint shape", async () => {
    llm.responses = Array.from({ length: 3 }, () => "PARTIAL_ABORT_CANDIDATE");
    llm.stopReasons = ["incomplete", "incomplete", "incomplete"];
    llm.rawStopReasons = ["abort", "abort", "abort"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(llm.callCount).toBe(3);
    expect(result.failures[0]?.error.message).toContain("exhausted 3 LLM call(s)");

    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory).toHaveLength(3);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
      "initial",
    ]);
    expect(JSON.stringify(checkpoint.diagnosticHistory)).not.toContain("budgetConsumed");
    expectJoinedAttempts(checkpoint);
  });

  it("never spends the incomplete retry budget on a length-limited response", async () => {
    llm.responses = ["TRUNCATED_CANDIDATE"];
    llm.stopReasons = ["length"];
    llm.rawStopReasons = ["max_tokens"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 2,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(llm.callCount).toBe(1);
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "truncated_by_token_limit",
    ]);
    expect(checkpoint.diagnosticHistory?.[0]?.budgetConsumed).toBeUndefined();
    expectJoinedAttempts(checkpoint);
  });

  it("consumes the bounded slot when a second incomplete exceeds a retry budget of one", async () => {
    llm.responses = ["FIRST_PARTIAL", "SECOND_PARTIAL"];
    llm.stopReasons = ["incomplete", "incomplete"];
    llm.rawStopReasons = ["abort", "abort"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 1,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(llm.callCount).toBe(2);
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.budgetConsumed)).toEqual([
      false,
      undefined,
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.promptKind)).toEqual([
      "initial",
      "initial",
    ]);
    expectJoinedAttempts(checkpoint);
  });

  it("keeps usage and diagnostic attempts globally monotonic across runOnly retries", async () => {
    llm.responses = ["FIRST_PARTIAL", "SECOND_PARTIAL"];
    llm.stopReasons = ["incomplete", "incomplete"];
    llm.rawStopReasons = ["abort", "abort"];

    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 1,
    });

    const retryLlm = new ProgrammableMockLlm();
    retryLlm.responses = ["THIRD_PARTIAL", makeValidPage(closedKeys)];
    retryLlm.stopReasons = ["incomplete", "complete"];
    retryLlm.rawStopReasons = ["abort", "stop"];
    const result = await runOnly({
      repoRoot,
      llmClient: retryLlm,
      noRefine: true,
      onlyTarget: "auth/login",
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 1,
    });

    expect(result.status).toBe("completed");
    expect(retryLlm.callCount).toBe(2);
    expect(result.totals.inputTokens).toBe(200);
    expect(result.totals.outputTokens).toBe(100);
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.usageHistory.map((entry) => entry.attempt)).toEqual([1, 2, 3, 4]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.attempt)).toEqual([1, 2, 3, 4]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.budgetConsumed)).toEqual([
      false,
      undefined,
      false,
      undefined,
    ]);
    expectJoinedAttempts(checkpoint);
  });

  it("seeds and appends an old checkpoint whose diagnostics omit budgetConsumed", async () => {
    llm.responses = [makeInvalidPage("LEGACY_INVALID_CANDIDATE")];
    llm.stopReasons = ["complete"];
    llm.rawStopReasons = ["stop"];
    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 0,
    });

    const legacyCheckpoint = await readStage4Checkpoint(repoRoot);
    for (const entry of legacyCheckpoint.diagnosticHistory ?? []) {
      delete entry.budgetConsumed;
    }
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"));
    try {
      db.prepare(
        "UPDATE batch_tasks SET checkpoint_json = ? WHERE stage = 4 AND target = ?",
      ).run(JSON.stringify(legacyCheckpoint), "auth/login");
    } finally {
      db.close();
    }

    const retryLlm = new ProgrammableMockLlm();
    retryLlm.responses = [makeValidPage(closedKeys)];
    retryLlm.stopReasons = ["complete"];
    retryLlm.rawStopReasons = ["stop"];
    const result = await runOnly({
      repoRoot,
      llmClient: retryLlm,
      noRefine: true,
      onlyTarget: "auth/login",
      skipManifestWrite: true,
      relaxedRound: false,
      maxRepairAttempts: 0,
      maxIncompleteRetries: 0,
    });

    expect(result.status).toBe("completed");
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(checkpoint.diagnosticHistory?.map((entry) => entry.budgetConsumed)).toEqual([
      undefined,
      undefined,
    ]);
    expectJoinedAttempts(checkpoint);
  });
});

describe("Lot N — deterministic stage 2 (#29: no LLM refine) and page-unit navigation", () => {
  it("stage 2 never calls the LLM, even without --no-refine, and persists done with zero usage", async () => {
    llm.responses = [
      makeValidPage(["src/auth/login.ts#login", "src/auth/login.ts#logout"]),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: false, // backward-compatible no-op: stage 2 is deterministic (#29)
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    // Exactly ONE instrumented call: the file-page task (the folder-purpose
    // and stage-5c understanding answers bypass instrumentation). No refine
    // call exists — the single prompt is the stage-4 file prompt.
    expect(llm.callCount).toBe(1);
    expect(llm.callLog[0]?.user).toContain("# File: src/auth/login.ts");

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), { readonly: true });
    try {
      const stage2 = db.prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 2").get() as { checkpoint_json: string };
      const cp2 = JSON.parse(stage2.checkpoint_json) as {
        status: string;
        usageHistory: unknown[];
        error?: unknown;
      };
      expect(cp2.status).toBe("done");
      expect(cp2.usageHistory).toEqual([]);
      expect(cp2.error).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("Tasks and Overview link the real page units (folder index pages)", async () => {
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

    expect(await safeIo.readText(repoRoot, "livewiki/tasks.md")).toContain("](auth/index.md)");
    expect(await safeIo.readText(repoRoot, "livewiki/architecture/overview.md")).toContain(
      "[folder page](../auth/index.md)",
    );
  });
});

describe("batch — repair attempt number and total are propagated; usage accounting unchanged", () => {
  // Defect 4: the previous repair prompt carried no attempt context,
  // so a deterministic model received byte-identical repair prompts
  // and returned the same page. The fix: the attempt number and total
  // appear in BOTH system and user prompts, and the final repair
  // attempt in the current bounded execution carries the explicit
  // "do not reproduce the prior candidate unchanged" directive. This
  // test also asserts that the bounded slot accounting, the
  // usageHistory length, and the monotonic attempt numbering are
  // NOT changed by the attempt-number propagation.

  it("repair 1-of-2 → final repair 2-of-2 converges to a valid page; usage accounting unchanged", async () => {
    // 1 initial + 2 repair attempts (3 total). The 1st repair is the
    // 2nd LLM call; the 2nd (final) repair is the 3rd. The third
    // response must satisfy the module's full closed list (login AND
    // logout — the fixture exports both) so the test actually proves
    // convergence instead of just counting calls.
    llm.responses = [
      makeInvalidPage("INVALID_1"),
      makeInvalidPage("INVALID_2"),
      makeValidPage([
        "src/auth/login.ts#login",
        "src/auth/login.ts#logout",
      ]),
    ];
    llm.stopReasons = ["complete", "complete", "complete"];
    llm.rawStopReasons = ["stop", "stop", "stop"];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      maxIncompleteRetries: 0,
    });

    // Convergence: the bounded repair loop actually fixed the page.
    expect(result.status).toBe("completed");
    expect(result.failures).toHaveLength(0);

    // Bounded slot accounting: 1 initial + 2 repairs = 3 calls.
    expect(llm.callCount).toBe(3);

    // Call 1 is the initial; it MUST NOT carry a repair-attempt header.
    const c1 = llm.callLog[0]!;
    expect(c1.user).not.toMatch(/attempt\s+\d+\s+of\s+\d+/i);
    expect(c1.user).not.toMatch(/Repair attempt/i);

    // Call 2 is repair attempt 1 of 2 (non-final).
    const c2 = llm.callLog[1]!;
    expect(c2.user).toMatch(/attempt\s+1\s+of\s+2/i);
    expect(c2.user).not.toMatch(/final\s+repair\s+attempt/i);
    expect(c2.system).toMatch(/attempt\s+1\s+of\s+2/i);

    // Call 3 is the FINAL repair attempt in the current bounded
    // execution — must include the "do not reproduce the prior
    // candidate unchanged" directive and the audit checklist.
    const c3 = llm.callLog[2]!;
    expect(c3.user).toMatch(/attempt\s+2\s+of\s+2/i);
    expect(c3.user).toMatch(/final\s+repair\s+attempt/i);
    expect(c3.user).toMatch(/do not reproduce the prior candidate unchanged/i);
    expect(c3.user).toMatch(/audit/i);
    expect(c3.system).toMatch(/final\s+repair\s+attempt/i);

    // usageHistory length matches the bounded slot count and
    // attempt numbers are monotonic (1, 2, 3).
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.usageHistory).toHaveLength(3);
    expect(checkpoint.usageHistory!.map((u) => u.attempt)).toEqual([1, 2, 3]);
  });
});

// === R10.1 item A — write/verify exception rolls the page back (stage 4) ===
describe("batch X — write/verify exception rolls the page back (R10.1 A)", () => {
  it("verifier throws after the write → new page removed, task fails write_verify_exception", async () => {
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let crashed = false;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      if (!crashed) {
        crashed = true;
        throw new Error("simulated verifier crash");
      }
      return realRun(root);
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
        maxRepairAttempts: 0, // no repair — focus on the exception path
      });

      expect(crashed).toBe(true);
      expect(result.status).toBe("completed_with_failures");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error.code).toBe("write_verify_exception");
      expect(llm.callCount).toBe(1); // terminal for the task — no repair retry

      // The candidate page NEVER persisted (exception rollback removed it).
      const wikiPath = nodePath.join(repoRoot, "livewiki/auth/login.md");
      await expect(nodeFs.access(wikiPath)).rejects.toThrow();

      const checkpoint = await readStage4Checkpoint(repoRoot);
      expect(checkpoint.status).toBe("failed");
      expect(checkpoint.error?.code).toBe("write_verify_exception");
      expect(checkpoint.diagnosticHistory?.[0]).toMatchObject({
        outcome: "write_verify_exception",
        promptKind: "initial",
        errors: [expect.objectContaining({ code: "write_verify_exception" })],
      });
      expectJoinedAttempts(checkpoint);
    } finally {
      spy.mockRestore();
    }
  });

  it("rollback failure after the exception → rollback_failed aborts the ENTIRE RUN; second module never attempted", async () => {
    // Same 2-module shape as the review-#4 test: auth first, other second.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/other.ts"),
      "export function other() { return 'o'; }",
      "utf8",
    );

    const verifyModule = await import("./verify.js");
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async () => {
      throw new Error("simulated verifier crash");
    });
    // The rollback itself breaks (same simulation as review finding #4).
    const removeSpy = vi.spyOn(safeIo, "remove").mockImplementation(async () => {
      throw new Error("simulated rollback failure");
    });

    try {
      llm.autoPageFromPrompt = true;

      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 0,
      });

      // Terminal for the ENTIRE run — identical semantics to the
      // rejection-triggered rollback failure (review finding #4).
      expect(result.status).toBe("aborted");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.error.code).toBe("rollback_failed");
      expect(result.failures[0]?.module).toBe("auth/login");

      // The SECOND module never reached the LLM.
      expect(llm.callCount).toBe(1);

      // Via DB: "other" was NEVER created as a stage-4 task.
      const dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
      const Database = (await import("better-sqlite3")).default;
      const db = new Database(dbPath, { readonly: true });
      try {
        const tasks = db
          .prepare("SELECT target, status FROM batch_tasks WHERE stage = 4 ORDER BY target")
          .all() as Array<{ target: string; status: string }>;
        expect(tasks.length).toBe(1);
        expect(tasks[0]?.target).toBe("auth/login");
        expect(tasks[0]?.status).toBe("failed");
      } finally {
        db.close();
      }
    } finally {
      spy.mockRestore();
      removeSpy.mockRestore();
    }
  });
});

// === Recovery tier (Component 2): relaxed completion round ===
//
// After the strict loop would mark `repair_exhausted`, ONE final attempt
// runs under the relaxed presentation contract. Success marks the task
// DONE with the page flagged `quality: degraded` (frontmatter + reader
// notice) — never a failure, exit code stays 0. Infra failures and error
// sets containing unclassified codes never get the relaxed call.
describe("batch recovery tier — relaxed completion round (Component 2)", () => {
  const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];

  /**
   * Fails STRICT with a classified contract-shape error (the task list has
   * a single bullet; the strict rule wants 2 to 4). Passes relaxed.
   */
  function makeStrictFailingPage(): string {
    return makeValidPage(closedKeys).replace(
      "- Change this module's implementation.\n",
      "",
    );
  }

  /** Passes RELAXED only: 1-bullet task list AND bullets in How-it-fits. */
  function makeRelaxedOnlyPage(): string {
    return makeValidPage(closedKeys)
      .replace("- Change this module's implementation.\n", "")
      .replace(
        "This module provides one part of the repository implementation.",
        "- This module provides one part of the implementation.\n- It collaborates with the neighboring modules.",
      );
  }

  /** Fails BOTH contracts (a required opening H2 is absent). */
  function makeBothFailingPage(): string {
    return makeValidPage(closedKeys).replace(
      "## When to use this page\n\n- Review this module's behavior.\n- Change this module's implementation.\n\n## How it fits",
      "## How it fits",
    );
  }

  it("an exhausted contract-shaped failure completes as done with the degraded marking", async () => {
    llm.responses = [
      makeStrictFailingPage(),
      makeStrictFailingPage(),
      makeStrictFailingPage(),
      makeRelaxedOnlyPage(),
    ];
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    // Done, NOT a failure — the exit code stays 0 for a degraded-only run.
    expect(result.status).toBe("completed");
    expect(result.failures).toEqual([]);
    // The relaxed file task + the folder task + the stage-5c understanding task.
    expect(result.tasksDone).toBe(3);
    expect(result.tasksFailed).toBe(0);
    expect(llm.callCount).toBe(4); // 1 initial + 2 repairs + 1 relaxed
    expect(result.degradedPages).toEqual(["livewiki/auth/login.md"]);
    // Exact accounting: the relaxed attempt is a normal billed attempt.
    // +100/+50 folder purpose; +100/+50: the stage-5c understanding task succeeds with one call.
    expect(result.totals.inputTokens).toBe(600);
    expect(result.totals.outputTokens).toBe(300);

    // The page on disk carries the frontmatter flag + the reader notice
    // as the FIRST body line.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth/login.md"), "utf8");
    expect(page).toContain("quality: degraded");
    const bodyStart = page.indexOf("\n---\n") + "\n---\n".length;
    expect(page.slice(bodyStart).startsWith(`\n${DEGRADED_NOTICE_PREFIX}`)).toBe(true);

    // Checkpoint: done + degraded flag; the relaxed attempt joined the
    // normal 1:1 usage/diagnostic histories with the relaxed marker.
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.status).toBe("done");
    expect(checkpoint.degraded).toBe(true);
    expect(checkpoint.usageHistory).toHaveLength(4);
    expectJoinedAttempts(checkpoint);
    const relaxedDiag = checkpoint.diagnosticHistory![3]!;
    expect(relaxedDiag.outcome).toBe("success");
    expect((relaxedDiag as { relaxed?: boolean }).relaxed).toBe(true);

    // The run summary persisted the degraded pages (batch status surface).
    const report = await buildStatusReport(repoRoot);
    expect(report.run.summary?.degradedPages).toEqual(["livewiki/auth/login.md"]);
  });

  it("llm_timeout is in the no-relax set: original failure, no relaxed call", async () => {
    llm.generate = async () => {
      throw new LlmTimeoutError("openai-compat", 300_000);
    };
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures[0]!.error.code).toBe("llm_timeout");
    expect(result.degradedPages).toBeUndefined();
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.status).toBe("failed");
    // The timeout is terminal for the task — no repair, no relaxed call.
    expect(checkpoint.usageHistory).toHaveLength(1);
  });

  it("an error set containing unclassified codes gets no relaxed call", async () => {
    // Generic transport failures surface as llm_error — not a classified
    // validation code, so the exhaustion is not a contract-shape failure.
    llm.throwOn = new Set([0, 1, 2, 3]);
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures[0]!.error.code).toBe("repair_exhausted");
    expect(llm.callCount).toBe(3); // 1 initial + 2 repairs, NO relaxed call
    expect(result.degradedPages).toBeUndefined();
  });

  it("a failing relaxed attempt keeps the original repair_exhausted", async () => {
    llm.responses = [makeBothFailingPage()]; // repeated for every call
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures[0]!.error.code).toBe("repair_exhausted");
    expect(result.failures[0]!.error.message).toContain("exhausted 4 LLM call(s)");
    expect(llm.callCount).toBe(4);
    expect(result.degradedPages).toBeUndefined();
    const checkpoint = await readStage4Checkpoint(repoRoot);
    expect(checkpoint.status).toBe("failed");
    expect(checkpoint.degraded).toBeUndefined();
    expectJoinedAttempts(checkpoint);
    expect((checkpoint.diagnosticHistory![3] as { relaxed?: boolean }).relaxed).toBe(true);
  });

  it("relaxedRound: false disables the completion round", async () => {
    llm.responses = [makeRelaxedOnlyPage()]; // would pass the relaxed round
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      relaxedRound: false,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures[0]!.error.code).toBe("repair_exhausted");
    expect(llm.callCount).toBe(3); // no relaxed call
    expect(result.degradedPages).toBeUndefined();
  });
});
