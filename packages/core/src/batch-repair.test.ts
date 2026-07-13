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
  target = "auth",
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
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === Repair: success path ===
describe("batch X — repair success (Criterion #6)", () => {
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
        .get("auth") as { checkpoint_json: string };
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
      "TODO replace this single placeholder.",
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
      maxRepairAttempts: 2,
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
      maxRepairAttempts: 2,
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
      onlyTarget: "auth",
      skipManifestWrite: true,
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
    const expectedValidationErrors = fakeKeys.length * 2 + 2;
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
      maxRepairAttempts: 2,
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
      onlyTarget: "auth",
      skipManifestWrite: true,
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
        .get("auth") as { checkpoint_json: string };
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
    expect(stage4.inputTokens).toBe(cumulativeInput);
    expect(stage4.outputTokens).toBe(cumulativeOutput);
    const authMod = report.byModule.find((m) => m.module === "auth")!;
    expect(authMod.inputTokens).toBe(cumulativeInput);
    expect(authMod.outputTokens).toBe(cumulativeOutput);
    expect(report.totals.inputTokens).toBe(cumulativeInput);
    expect(report.totals.outputTokens).toBe(cumulativeOutput);
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
      onlyTarget: "auth",
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
    expect(report.totals.inputTokens).toBe(300);
    expect(report.totals.outputTokens).toBe(150);
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
    expect(llm.callLog[1]?.system).not.toContain("REPAIR assistant");

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
      "# auth",
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
        .get("auth") as { checkpoint_json: string };
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
      "F".repeat(17_000),
      "CORE_SRC_04_FULL_NEAR_MISS_TAIL",
      "TODO replace this single placeholder.",
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
      "TODO replace this single placeholder.",
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
      maxRepairAttempts: 2,
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
        .get("auth") as { checkpoint_json: string };
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
    const authTask = report.tasks.find((t) => t.target === "auth" && t.stage === 4);
    expect(authTask).toBeDefined();
    // The task has 2 attempts; the cumulative usage reflects 2
    // real LLM calls (no fake duplicate zero-usage).
    expect(authTask!.inputTokens).toBe(200);
    expect(authTask!.outputTokens).toBe(100);
  });
});
