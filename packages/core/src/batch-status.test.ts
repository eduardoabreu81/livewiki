/**
 * batch-status.test.ts — H6 (Lot B) backward compatibility and the
 * JSON shape guard for the `diagnosticHistory` additive field.
 *
 * CONTRACT I5: checkpoints WITHOUT `diagnosticHistory` MUST load
 * unchanged. The field is additive in `batch status --json` — when
 * the checkpoint doesn't have it, the status output is byte-stable.
 *
 * Test strategy: seed a checkpoint JSON (the pre-Lot A shape, with
 * `usageHistory` but no `diagnosticHistory`) directly into the DB,
 * then call `buildStatusReport` and assert:
 *   - the report loads successfully
 *   - the per-task `diagnosticHistory` field is ABSENT (not undefined
 *     printed as `null`, not an empty array — the property is missing)
 *   - the per-task JSON keys are byte-stable vs a pre-Lot A baseline
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import { buildStatusReport } from "./batch-status.js";
import { openIndex } from "./db.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";

class OneShotMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";

  async generate(): Promise<GenerateResult> {
    // Not used by the H6 test (we seed the DB directly). Included so
    // TypeScript narrows the interface; the test never calls into it.
    throw new Error("OneShotMockLlm.generate was called — should not happen");
  }
}

let repoRoot: string;
let dbPath: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-status-"));
  // Touch the directory + open the index so the SQLite file exists.
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  dbPath = nodePath.join(repoRoot, ".livewiki/index.db");
  // Open + close to materialize the schema (CURRENT_SCHEMA_VERSION).
  const db = openIndex(dbPath);
  db.close();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/**
 * Insert a run + a single task whose checkpoint_json is the
 * pre-diagnostics shape (no `diagnosticHistory` field). Returns the
 * runId for inspection.
 */
async function seedLegacyCheckpoint(): Promise<number> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath);
  try {
    const runRes = db
      .prepare(
        "INSERT INTO batch_runs (started_at, started_by, stage, config_json, status) VALUES (?, 'test', 4, ?, 'completed_with_failures')",
      )
      .run(Date.now() - 1000, JSON.stringify({ language: "en", noRefine: false }));
    const runId = Number(runRes.lastInsertRowid);
    const now = Date.now();
    const legacyCheckpoint = {
      stage: 4,
      status: "failed",
      attempt: 2,
      startedAt: now - 500,
      finishedAt: now,
      usageHistory: [
        {
          attempt: 1,
          usage: { inputTokens: 100, outputTokens: 50, model: "claude-test-mock" },
          costUsd: { input: 0, output: 0, total: 0, refDate: "2026-01-01" },
          finishedAt: now - 200,
          stopReason: "complete",
          rawStopReason: "stop",
        },
        {
          attempt: 2,
          usage: { inputTokens: 120, outputTokens: 60, model: "claude-test-mock" },
          costUsd: { input: 0, output: 0, total: 0, refDate: "2026-01-01" },
          finishedAt: now,
          stopReason: "complete",
          rawStopReason: "stop",
        },
      ],
      // NB: NO `diagnosticHistory` field — the pre-Lot A shape.
      error: {
        code: "repair_exhausted",
        message: "task \"legacy\" exhausted 2 LLM call(s) (legacy shape).",
      },
    };
    db.prepare(
      "INSERT INTO batch_tasks (run_id, stage, target, status, checkpoint_json, updated_at) VALUES (?, 4, ?, 'failed', ?, ?)",
    ).run(runId, "legacy", JSON.stringify(legacyCheckpoint), now);
    return runId;
  } finally {
    db.close();
  }
}

describe("batch-status — H6 backward compatibility (no diagnosticHistory)", () => {
  it("loads a legacy checkpoint without diagnosticHistory and reports it cleanly", async () => {
    const runId = await seedLegacyCheckpoint();
    const report = await buildStatusReport(repoRoot, runId);
    expect(report.run.id).toBe(runId);
    const legacyTask = report.tasks.find((t) => t.target === "legacy");
    expect(legacyTask).toBeDefined();
    // The per-task `diagnosticHistory` field MUST be absent (not a
    // synthesized `[]` / `null` / `{errors: []}`). CONTRACT I5:
    // backward compat = the field does not appear in the output.
    expect("diagnosticHistory" in (legacyTask as object)).toBe(false);
    // Existing fields are unchanged.
    expect(legacyTask!.error?.code).toBe("repair_exhausted");
    expect(legacyTask!.attempts).toBe(2);
    expect(legacyTask!.inputTokens).toBe(220);
    expect(legacyTask!.outputTokens).toBe(110);
  });

  it("a checkpoint with diagnosticHistory surfaces it additively (post-Lot A)", async () => {
    // Run a real (stub) batch to produce a checkpoint WITH diagnostics.
    // The H6 above proves the legacy shape loads; this proves the new
    // shape surfaces the new field, all in the same status path.
    const fs = await import("node:fs/promises");
    await fs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await fs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\nexport function logout() { return 2; }\n",
      "utf8",
    );

    class ValidMockLlm implements LlmClient {
      public readonly provider = "anthropic" as const;
      public readonly model = "claude-test-mock";

      async generate(): Promise<GenerateResult> {
        return {
          content: [
            "---",
            "title: Authentication responsibilities",
            "owner: generated",
            "anchors:",
            "  - src/auth/login.ts#login",
            "  - src/auth/login.ts#logout",
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
            "<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->",
            "",
            "Body.",
            "",
          ].join("\n"),
          usage: { inputTokens: 100, outputTokens: 50, model: this.model },
          stopReason: "complete",
        };
      }
    }

    const result = await runBatch({
      repoRoot,
      llmClient: new ValidMockLlm(),
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const report = await buildStatusReport(repoRoot);
    const authTask = report.tasks.find((t) => t.target === "auth");
    expect(authTask).toBeDefined();
    expect(authTask!.diagnosticHistory).toBeDefined();
    expect(authTask!.diagnosticHistory).toHaveLength(1);
    expect(authTask!.diagnosticHistory![0]!.outcome).toBe("success");
  });

  it("loads an old summary_json whose refined modules have no displayTitle unchanged", async () => {
    const legacySummary = {
      totals: { inputTokens: 0, outputTokens: 0, costUsd: null, models: [], usageIncomplete: false },
      byStage: {},
      byModule: [],
      tasksDone: 0,
      tasksFailed: 0,
      tasksPending: 0,
      modulesRefined: [{ id: "auth", paths: ["src/auth/login.ts"] }],
    };
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    let runId: number;
    try {
      const row = db.prepare(
        "INSERT INTO batch_runs (started_at, finished_at, started_by, stage, config_json, status, summary_json) VALUES (?, ?, 'test', 4, '{}', 'completed', ?)",
      ).run(Date.now(), Date.now(), JSON.stringify(legacySummary));
      runId = Number(row.lastInsertRowid);
    } finally {
      db.close();
    }

    const report = await buildStatusReport(repoRoot, runId!);
    expect(report.run.summary).toEqual(legacySummary);
    expect(report.run.summary?.modulesRefined?.[0]).not.toHaveProperty("displayTitle");
  });
});

describe("batch-status — JSON shape guard (additive field only)", () => {
  it("batch status --json for a pre-diagnostics checkpoint is byte-stable except for the new additive field", async () => {
    const runId = await seedLegacyCheckpoint();
    const report = await buildStatusReport(repoRoot, runId);
    const json = JSON.stringify(report);

    // The new additive field MUST NOT appear in the serialized output
    // for a legacy checkpoint. This is the strictest possible reading
    // of "byte-stable except for the new additive field" — the new
    // field is simply absent, so the output is fully byte-stable.
    expect(json).not.toContain("diagnosticHistory");

    // The legacy error message and the existing fields are intact.
    expect(json).toContain("repair_exhausted");
    expect(json).toContain("legacy");

    // Snapshot a stable subset of keys for the per-task record. Any
    // drift here signals a non-additive change to a public field.
    const task = report.tasks.find((t) => t.target === "legacy")!;
    const taskKeys = Object.keys(task).sort();
    expect(taskKeys).toEqual(
      [
        "attempts",
        "costUsd",
        "error",
        "inputTokens",
        "outputTokens",
        "retryCommand",
        "stage",
        "status",
        "target",
        "taskId",
      ].sort(),
    );
  });

  it("a status report for a fresh run surfaces diagnosticHistory on the tasks that have it", async () => {
    // Run a batch with one success → the per-task report must carry
    // a `diagnosticHistory` array. The first test in this file proves
    // the field is absent for legacy checkpoints; this one proves it
    // appears for fresh runs. Together they pin the "additive only"
    // contract: no existing field changes shape or meaning.
    const fs = await import("node:fs/promises");
    await fs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await fs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\nexport function logout() { return 2; }\n",
      "utf8",
    );

    class OneModuleMockLlm implements LlmClient {
      public readonly provider = "anthropic" as const;
      public readonly model = "claude-test-mock";

      async generate(): Promise<GenerateResult> {
        return {
          content: [
            "---",
            "title: Authentication responsibilities",
            "owner: generated",
            "anchors:",
            "  - src/auth/login.ts#login",
            "  - src/auth/login.ts#logout",
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
            "<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->",
            "",
            "Body.",
            "",
          ].join("\n"),
          usage: { inputTokens: 100, outputTokens: 50, model: this.model },
          stopReason: "complete",
        };
      }
    }

    const result = await runBatch({
      repoRoot,
      llmClient: new OneModuleMockLlm(),
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const report = await buildStatusReport(repoRoot);
    const authTask = report.tasks.find((t) => t.target === "auth");
    expect(authTask).toBeDefined();
    expect(authTask!.diagnosticHistory).toBeDefined();
    expect(authTask!.diagnosticHistory).toHaveLength(1);
    expect(authTask!.diagnosticHistory![0]!.outcome).toBe("success");

    // The keys for a fresh-run task are a strict superset of the
    // required TaskReportItem keys (the success task has no `error`,
    // which is an optional field on the type). The "additive only"
    // contract is that the new field is the ONLY addition — the
    // legacy test in this file pins the byte-stability of every
    // pre-existing field. Here we just check the new field is
    // present alongside the required ones.
    const freshKeys = new Set(Object.keys(authTask!));
    const requiredKeys = [
      "taskId",
      "stage",
      "target",
      "status",
      "attempts",
      "inputTokens",
      "outputTokens",
      "costUsd",
      "retryCommand",
    ];
    for (const k of requiredKeys) {
      expect(freshKeys.has(k)).toBe(true);
    }
    expect(freshKeys.has("diagnosticHistory")).toBe(true);
  });
});
