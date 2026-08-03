import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import { snapshotMetrics } from "./update-metrics.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";

/**
 * Roadmap item 7 (`batchConcurrency`) — stage-4 worker pool tests.
 *
 * Same MockLlm shape as batch.test.ts: deterministic pages, fixed usage
 * (100 input / 50 output per call), no paid calls. Stage 5 is disabled in
 * the fixture config (maxFlows/maxTopics = 0, understandingSynthesis:
 * false) so these tests exercise the stage-4 pool in isolation.
 */

/** Valid page generator; tracks in-flight parallelism for pool assertions. */
class ValidMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string; maxTokens: number | undefined }> = [];
  public inFlight = 0;
  public maxInFlight = 0;
  /** Artificial latency so concurrent workers actually overlap. */
  constructor(private readonly delayMs = 5) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callCount++;
    this.callLog.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    } finally {
      this.inFlight--;
    }
    const match = req.user.match(/# Module: ([^\s]+)/);
    const moduleId = match ? match[1] : "unknown";
    const keyMatch = req.user.match(/^- (.+?#[\w.]+)$/m);
    const firstKey = keyMatch ? keyMatch[1] : `${moduleId}.ts#placeholder`;
    const content = `---
title: ${moduleId} responsibilities
owner: generated
anchors:
  - ${firstKey}
---

# ${moduleId} responsibilities

This page documents the responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides part of the repository implementation described by the indexed source.

## Details
<!-- lw:anchors ${firstKey} -->

Some prose about ${moduleId}.
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }

  /** Distinct module IDs this mock was called for (stage-4 prompts only). */
  calledModuleIds(): string[] {
    const ids = new Set<string>();
    for (const call of this.callLog) {
      const match = call.user.match(/# Module: ([^\s]+)/);
      if (match) ids.add(match[1]!);
    }
    return [...ids];
  }
}

/** Always emits a bogus anchor key — every task fails validation and
 * exhausts its repair budget deterministically. */
class FailingMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  public inFlight = 0;
  public maxInFlight = 0;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callCount++;
    this.callLog.push({ system: req.system, user: req.user });
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
    } finally {
      this.inFlight--;
    }
    const match = req.user.match(/# Module: ([^\s]+)/);
    const moduleId = match ? match[1] : "unknown";
    const bogusKey = `${moduleId}.ts#symbol_that_does_not_exist`;
    const content = `---
title: ${moduleId} responsibilities
owner: generated
anchors:
  - ${bogusKey}
---

# ${moduleId} responsibilities

This page documents the responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides part of the repository implementation described by the indexed source.

## Details
<!-- lw:anchors ${bogusKey} -->

Some prose about ${moduleId}.
`;
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }

  calledModuleIds(): string[] {
    const ids = new Set<string>();
    for (const call of this.callLog) {
      const match = call.user.match(/# Module: ([^\s]+)/);
      if (match) ids.add(match[1]!);
    }
    return [...ids];
  }
}

const MODULE_IDS = ["m1", "m2", "m3", "m4", "m5", "m6"];

/** Creates a fresh repo with one tiny module per id + stage-5 disabled. */
async function createRepo(moduleIds: string[]): Promise<string> {
  const root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-conc-"));
  for (const id of moduleIds) {
    await nodeFs.mkdir(nodePath.join(root, "src", id), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(root, "src", id, "index.ts"),
      `export function ${id}Fn() { return '${id}'; }\n`,
      "utf8",
    );
  }
  // Stage 5 disabled: the pool tests isolate stage 4.
  await nodeFs.mkdir(nodePath.join(root, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, ".livewiki", "config.json"),
    JSON.stringify({ maxFlows: 0, maxTopics: 0, understandingSynthesis: false }),
    "utf8",
  );
  return root;
}

const createdRepos: string[] = [];

beforeEach(() => {
  createdRepos.length = 0;
});

afterEach(async () => {
  for (const root of createdRepos.splice(0)) {
    await nodeFs.rm(root, { recursive: true, force: true });
  }
});

async function makeRepo(moduleIds: string[]): Promise<string> {
  const root = await createRepo(moduleIds);
  createdRepos.push(root);
  return root;
}

describe("batchConcurrency — stage-4 worker pool (roadmap item 7)", () => {
  it("concurrency 3: all tasks complete; totals and per-module usage equal the sequential run", async () => {
    const repoSeq = await makeRepo(MODULE_IDS.slice(0, 5));
    const repoPool = await makeRepo(MODULE_IDS.slice(0, 5));
    const seqLlm = new ValidMockLlm(0);
    const poolLlm = new ValidMockLlm();

    const seq = await runBatch({
      repoRoot: repoSeq,
      llmClient: seqLlm,
      noRefine: true,
      skipManifestWrite: true,
      concurrency: 1,
    });
    const pool = await runBatch({
      repoRoot: repoPool,
      llmClient: poolLlm,
      noRefine: true,
      skipManifestWrite: true,
      concurrency: 3,
    });

    // (a) all tasks complete; usage sums equal the sequential run's totals.
    expect(seq.status).toBe("completed");
    expect(pool.status).toBe("completed");
    expect(pool.tasksDone).toBe(seq.tasksDone);
    expect(pool.tasksFailed).toBe(seq.tasksFailed);
    expect(pool.failures).toEqual([]);
    expect(pool.totals.inputTokens).toBe(seq.totals.inputTokens);
    expect(pool.totals.outputTokens).toBe(seq.totals.outputTokens);

    // (b) report byModule order is deterministic: stage-3 priority order,
    // identical to the sequential run — not completion order.
    expect(pool.byModule.map((m) => m.module)).toEqual(
      seq.byModule.map((m) => m.module),
    );
    const seqUsageByModule = new Map(seq.byModule.map((m) => [m.module, m]));
    for (const entry of pool.byModule) {
      const seqEntry = seqUsageByModule.get(entry.module);
      expect(seqEntry).toBeDefined();
      expect(entry.inputTokens).toBe(seqEntry!.inputTokens);
      expect(entry.outputTokens).toBe(seqEntry!.outputTokens);
    }

    // The pool actually parallelized and stayed within its bound.
    expect(poolLlm.maxInFlight).toBeGreaterThan(1);
    expect(poolLlm.maxInFlight).toBeLessThanOrEqual(3);
    expect(poolLlm.callCount).toBe(seqLlm.callCount);
  });

  it("concurrency 3: circuit breaker still aborts on 3 consecutive failures; no new tasks start after the trip", async () => {
    const repo = await makeRepo(MODULE_IDS);
    const llm = new FailingMockLlm();

    const result = await runBatch({
      repoRoot: repo,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      concurrency: 3,
      // Keep the failure path deterministic: 1 initial + 1 repair per task,
      // no relaxed completion round.
      maxRepairAttempts: 1,
      relaxedRound: false,
    });

    expect(result.status).toBe("aborted");
    expect(result.circuitBreakerTriggered).toBe(true);
    expect(result.tasksDone).toBe(0);
    // The 3 tripping failures are certain; up to `concurrency - 1` more
    // in-flight tasks may finish (and fail) after the trip.
    expect(result.tasksFailed).toBeGreaterThanOrEqual(3);
    expect(result.tasksFailed).toBeLessThanOrEqual(5);

    // No calls for unstarted tasks: at most the 3 tripping tasks plus the
    // tasks in flight at trip time may have been called.
    const called = llm.calledModuleIds();
    expect(called.length).toBeGreaterThanOrEqual(3);
    expect(called.length).toBeLessThanOrEqual(5);
    expect(called.length).toBeLessThan(MODULE_IDS.length);

    // The pool bound held even while the breaker tripped.
    expect(llm.maxInFlight).toBeLessThanOrEqual(3);
  });

  it("concurrency 1 is behaviorally identical to the default sequential run", async () => {
    const repoDefault = await makeRepo(MODULE_IDS.slice(0, 5));
    const repoOne = await makeRepo(MODULE_IDS.slice(0, 5));
    const defaultLlm = new ValidMockLlm(0);
    const oneLlm = new ValidMockLlm(0);

    const defaultRun = await runBatch({
      repoRoot: repoDefault,
      llmClient: defaultLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    const oneRun = await runBatch({
      repoRoot: repoOne,
      llmClient: oneLlm,
      noRefine: true,
      skipManifestWrite: true,
      concurrency: 1,
    });

    expect(oneRun.status).toBe(defaultRun.status);
    expect(oneRun.tasksDone).toBe(defaultRun.tasksDone);
    expect(oneRun.tasksFailed).toBe(defaultRun.tasksFailed);
    expect(oneRun.byModule.map((m) => m.module)).toEqual(
      defaultRun.byModule.map((m) => m.module),
    );
    expect(oneRun.totals.inputTokens).toBe(defaultRun.totals.inputTokens);
    expect(oneRun.totals.outputTokens).toBe(defaultRun.totals.outputTokens);
    expect(oneLlm.maxInFlight).toBe(1);
  });

  it("rejects an out-of-range concurrency override (opts > config > default)", async () => {
    const repo = await makeRepo(MODULE_IDS.slice(0, 2));
    const llm = new ValidMockLlm(0);
    await expect(
      runBatch({
        repoRoot: repo,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        concurrency: 17,
      }),
    ).rejects.toThrow(/invalid batchConcurrency/);
    await expect(
      runBatch({
        repoRoot: repo,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        concurrency: 0,
      }),
    ).rejects.toThrow(/invalid batchConcurrency/);
    expect(llm.callCount).toBe(0);
  });

  it("honors the config `batchConcurrency` when no override is given", async () => {
    const repo = await makeRepo(MODULE_IDS.slice(0, 5));
    await nodeFs.writeFile(
      nodePath.join(repo, ".livewiki", "config.json"),
      JSON.stringify({ maxFlows: 0, maxTopics: 0, batchConcurrency: 2, understandingSynthesis: false }),
      "utf8",
    );
    const llm = new ValidMockLlm();

    const result = await runBatch({
      repoRoot: repo,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.maxInFlight).toBeGreaterThan(1);
    expect(llm.maxInFlight).toBeLessThanOrEqual(2);
  });

  it("finalizeRun mirrors the run's totals into the activity ledger (roadmap item 14)", async () => {
    const repo = await makeRepo(MODULE_IDS.slice(0, 3));
    const llm = new ValidMockLlm(0);

    const result = await runBatch({
      repoRoot: repo,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      concurrency: 2,
    });
    expect(result.status).toBe("completed");

    // runBatch drains the fire-and-forget ledger write before returning.
    const snap = await snapshotMetrics(repo);
    expect(snap.batchRuns).toBe(1);
    expect(snap.batchInputTokens).toBe(result.totals.inputTokens);
    expect(snap.batchOutputTokens).toBe(result.totals.outputTokens);

    const entry = snap.recent[snap.recent.length - 1];
    expect(entry).toBeDefined();
    if (entry?.kind !== "batch_run") throw new Error("expected a batch_run entry");
    expect(entry.runId).toBe(result.runId);
    expect(entry.status).toBe("completed");
    expect(entry.tasksDone).toBe(result.tasksDone);
    expect(entry.tasksFailed).toBe(0);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
