/**
 * batch-community.test.ts — Roadmap item 9, phase 2: stage-2 community
 * cross-check wiring.
 *
 * Covers:
 *   - divergent heuristic partition persists the cross-check report in the
 *     stage-2 checkpoint (diagnostic-only; run still completes);
 *   - `communityDetection: false` persists no report;
 *   - the report audits the HEURISTIC partition (computed before LLM
 *     refine) and the refine flow is unchanged;
 *   - the hoisted edge resolution runs exactly ONCE per run (stage 3
 *     reuses it — no double resolution);
 *   - determinism: the same fixture produces a byte-identical report.
 *
 * Runs offline (programmable mock LLM, no network, no charge).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import * as importsMod from "./imports.js";
import * as modulesMod from "./modules.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";

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

class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;

  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — these tests exercise the
    // stage-2 cross-check; stage 5c has its own dedicated suite
    // (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callCount++;
    // Extract the closed key list from the user prompt (format "- <key>")
    const closedKeys: string[] = [];
    for (const line of req.user.split("\n")) {
      const m = /^- (\S+)$/.exec(line);
      if (m && m[1]) closedKeys.push(m[1]);
    }
    const content =
      closedKeys.length > 0
        ? [
            "---",
            "title: Module responsibilities",
            "owner: generated",
            "anchors:",
            ...closedKeys.map((k) => `  - ${k}`),
            "---",
            "",
            "# Module responsibilities",
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
            `<!-- lw:anchors ${closedKeys.join(" ")} -->`,
            "",
            "Body.",
            "",
          ].join("\n")
        : "# t\n";
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

/**
 * Directory heuristic disagrees with the import graph: `a/x.ts` and
 * `b/z.ts` import each other (one community), while `a/y.ts` is isolated
 * (its own community). The directory heuristic puts x+y in module "a",
 * so file z sits outside its community's plurality module.
 */
async function writeDivergentFixture(repoRoot: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/a"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "src/b"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/a/x.ts"),
    'import { z } from "../b/z";\nexport function x() { return z(); }\n',
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/a/y.ts"),
    "export function y() { return 'y'; }\n",
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/b/z.ts"),
    'import { x } from "../a/x";\nexport function z() { return x(); }\n',
    "utf8",
  );
}

async function readStage2Checkpoint(repoRoot: string): Promise<TaskCheckpoint> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(repoRoot, ".livewiki/index.db"), {
    readonly: true,
  });
  try {
    const row = db
      .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 2")
      .get() as { checkpoint_json: string };
    return JSON.parse(row.checkpoint_json) as TaskCheckpoint;
  } finally {
    db.close();
  }
}

let repoRoot: string;
let llm: MockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-community-"));
  llm = new MockLlm();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("stage-2 community cross-check (roadmap item 9)", () => {
  it("persists a divergent report in the stage-2 checkpoint; run still completes", async () => {
    await writeDivergentFixture(repoRoot);
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    // Diagnostic-only: the report NEVER changes run status.
    expect(result.status).toBe("completed");

    const cp = await readStage2Checkpoint(repoRoot);
    expect(cp.status).toBe("done");
    expect(cp.communityCrossCheck).toBeDefined();
    expect(cp.communityCrossCheck!.verdict).toBe("divergent");
    expect(cp.communityCrossCheck!.disagreementCount).toBeGreaterThanOrEqual(1);
    expect(cp.communityCrossCheck!.perModule.length).toBe(2);
  });

  it("communityDetection: false persists no report", async () => {
    await writeDivergentFixture(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ communityDetection: false }),
      "utf8",
    );
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const cp = await readStage2Checkpoint(repoRoot);
    expect(cp.status).toBe("done");
    expect(cp.communityCrossCheck).toBeUndefined();
  });

  it("audits the HEURISTIC partition and leaves the refine flow unchanged", async () => {
    await writeDivergentFixture(repoRoot);
    // Refine ENABLED: the mock returns a doc page for the stage-2 prompt,
    // which fails refine validation → heuristic kept + degradation error.
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const cp = await readStage2Checkpoint(repoRoot);
    // Refine flow unchanged: degradation recorded in the error channel.
    expect(cp.error?.code).toMatch(/^refine_/);
    // The cross-check ran on the heuristic partition BEFORE refine.
    expect(cp.communityCrossCheck).toBeDefined();
    expect(cp.communityCrossCheck!.verdict).toBe("divergent");
    // Refine call + stage-4 doc calls.
    expect(llm.callCount).toBeGreaterThanOrEqual(2);
  });

  it("resolves import edges exactly ONCE for the pipeline (hoisted; stage 3 reuses)", async () => {
    await writeDivergentFixture(repoRoot);
    const collectSpy = vi.spyOn(importsMod, "collectImportsForFiles");
    const moduleEdgesSpy = vi.spyOn(modulesMod, "resolveModuleEdges");
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");
    // The batch pipeline collects per-file imports exactly once — the
    // hoist did not introduce a second collection. (The end-of-run
    // `regenerateArchitectureOverview` → `buildPlan` does its OWN
    // pre-existing resolution and is untouched by the hoist.)
    expect(collectSpy).toHaveBeenCalledTimes(1);
    // Stage 3 receives the hoisted resolved edges (never falls back to
    // its internal empty-workspace-map re-resolution).
    expect(moduleEdgesSpy).toHaveBeenCalled();
    for (const call of moduleEdgesSpy.mock.calls) {
      expect(call[3]).toBeDefined();
    }
  });

  it("is deterministic: the same fixture twice yields a byte-identical report", async () => {
    await writeDivergentFixture(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    const firstReport = (await readStage2Checkpoint(repoRoot)).communityCrossCheck;
    expect(firstReport).toBeDefined();

    const repoRoot2 = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-community-"));
    try {
      await writeDivergentFixture(repoRoot2);
      const second = await runBatch({
        repoRoot: repoRoot2,
        llmClient: new MockLlm(),
        noRefine: true,
        skipManifestWrite: true,
      });
      expect(second.status).toBe("completed");
      const secondReport = (await readStage2Checkpoint(repoRoot2)).communityCrossCheck;
      expect(JSON.stringify(secondReport)).toBe(JSON.stringify(firstReport));
    } finally {
      await nodeFs.rm(repoRoot2, { recursive: true, force: true });
    }
  });
});
