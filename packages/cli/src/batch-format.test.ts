/**
 * Human formatters for incomplete usage + diagnosticHistory surfacing
 * (no public package surface change beyond testing the command module
 * helpers).
 */
import { describe, it, expect } from "vitest";
import {
  USAGE_INCOMPLETE_NOTE,
  formatResultHuman,
  formatStatusHuman,
} from "./commands/batch.js";

const baseTotals = {
  inputTokens: 100,
  outputTokens: 50,
  costUsd: null as number | null,
  models: ["claude-test-mock"] as string[],
};

describe("batch human format — usageIncomplete", () => {
  it("formatStatusHuman includes incomplete note when usageIncomplete", () => {
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed_with_failures",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: null,
      },
      totals: { ...baseTotals, usageIncomplete: true as boolean },
      byStage: {
        "4": { ...baseTotals, usageIncomplete: true as boolean },
      },
      byModule: [],
      tasks: [],
      failures: [
        {
          taskId: 1,
          module: "core-src-01",
          stage: 4 as const,
          error: { code: "llm_timeout", message: "timed out" },
          retryCommand: "livewiki batch --only core-src-01 1",
        },
      ],
      pricingRefDate: "2026-01-01",
    });
    expect(out).toContain(USAGE_INCOMPLETE_NOTE);
    expect(out).toContain("incomplete");
  });

  it("formatStatusHuman omits incomplete note when complete", () => {
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: null,
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [],
      failures: [],
      pricingRefDate: "2026-01-01",
    });
    expect(out).not.toContain(USAGE_INCOMPLETE_NOTE);
  });

  it("reports agent-written run accounting as unavailable instead of zero tokens", () => {
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      models: [] as string[],
      usageIncomplete: true,
    };
    const out = formatStatusHuman({
      run: {
        id: 8,
        status: "completed",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "agent",
        summary: {
          totals,
          byStage: {},
          byModule: [],
          tasksDone: 4,
          tasksFailed: 0,
          tasksPending: 0,
          modulesRefined: null,
          executor: "agent",
          accounting: "unavailable",
          topicRefine: "not-run",
        },
      },
      totals,
      byStage: {},
      byModule: [],
      tasks: [],
      failures: [],
      pricingRefDate: "2026-01-01",
    });
    expect(out).toContain("Tokens: unavailable");
    expect(out).not.toContain("0 input + 0 output");
    expect(out).not.toContain("estimated");
  });

  it("formatResultHuman includes incomplete note when usageIncomplete", () => {
    const out = formatResultHuman({
      runId: 3,
      status: "completed_with_failures",
      totals: { ...baseTotals, usageIncomplete: true as boolean },
      byModule: [{ module: "auth", ...baseTotals }],
      failures: [
        {
          taskId: 2,
          module: "x",
          error: { code: "llm_timeout", message: "timeout" },
          retryCommand: "livewiki batch --only x 3",
        },
      ],
      circuitBreakerTriggered: false,
      tasksDone: 1,
      tasksFailed: 1,
    });
    expect(out).toContain(USAGE_INCOMPLETE_NOTE);
    expect(out).toContain("incomplete");
  });

  it("formatResultHuman omits incomplete note when complete", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 0,
      tasksFailed: 0,
    });
    expect(out).not.toContain(USAGE_INCOMPLETE_NOTE);
  });
});

// === Lot B: per-attempt diagnostic sequence in status output ===
//
// The CLI human output MUST print the compact per-attempt sequence
// (CONTRACT: "for failed stage-4 tasks, print the compact per-attempt
// sequence") — derived from the per-task `diagnosticHistory` field
// surfaced by `buildStatusReport`. Token-first reporting is preserved
// (the diagnostics are appended after the failure details, not
// interleaved with the token section).
describe("batch human format — diagnosticHistory surfacing", () => {
  it("formatStatusHuman prints the per-attempt sequence for failed stage-4 tasks with diagnostics", () => {
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed_with_failures",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: null,
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [
        {
          taskId: 1,
          stage: 4 as const,
          target: "auth",
          status: "failed",
          attempts: 3,
          inputTokens: 300,
          outputTokens: 150,
          costUsd: null,
          error: { code: "repair_exhausted", message: "exhausted 3 LLM call(s)" },
          diagnosticHistory: [
            {
              attempt: 1,
              outcome: "artifact_validation_failed",
              promptKind: "initial",
              errors: [{ code: "no_frontmatter", location: "frontmatter" as const, message: "missing frontmatter" }],
              truncatedErrorCount: 0,
              finishedAt: 0,
            },
            {
              attempt: 2,
              outcome: "artifact_validation_failed",
              promptKind: "repair",
              errors: [{ code: "wrong_owner", location: "frontmatter" as const, message: "owner must be generated" }],
              truncatedErrorCount: 0,
              finishedAt: 0,
            },
            {
              attempt: 3,
              outcome: "incomplete_generation",
              promptKind: "repair",
              errors: [{ code: "incomplete_generation", location: "global" as const, message: "stopped" }],
              truncatedErrorCount: 0,
              finishedAt: 0,
            },
          ],
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      failures: [
        {
          taskId: 1,
          module: "auth",
          stage: 4 as const,
          error: { code: "repair_exhausted", message: "exhausted 3 LLM call(s)" },
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      pricingRefDate: "2026-01-01",
    });

    // The diagnostic block is appended with the failure details.
    expect(out).toContain("attempts:");
    expect(out).toMatch(/attempt 1: .* -> artifact_validation_failed \[no_frontmatter\]/);
    expect(out).toMatch(/attempt 2: .* -> artifact_validation_failed \[wrong_owner\]/);
    expect(out).toMatch(/attempt 3: .* -> incomplete_generation \[incomplete_generation\]/);
    // Token-first is preserved: the token section still appears
    // BEFORE the failure/diagnostic block.
    const tokenIdx = out.indexOf("Tokens (primary metric):");
    const failIdx = out.indexOf("Failures (1):");
    const diagIdx = out.indexOf("attempts:");
    expect(tokenIdx).toBeGreaterThan(0);
    expect(failIdx).toBeGreaterThan(tokenIdx);
    expect(diagIdx).toBeGreaterThan(failIdx);
  });

  it("formatStatusHuman omits the per-attempt sequence when the failed stage-4 task has no diagnosticHistory (legacy checkpoint)", () => {
    // A pre-Lot A checkpoint does not have `diagnosticHistory`. The
    // status output MUST remain byte-stable: the `attempts:` block
    // is simply absent. This is the "I5 — backward compatibility"
    // guarantee, asserted on the human output side.
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed_with_failures",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: null,
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [
        {
          taskId: 1,
          stage: 4 as const,
          target: "auth",
          status: "failed",
          attempts: 2,
          inputTokens: 200,
          outputTokens: 100,
          costUsd: null,
          error: { code: "repair_exhausted", message: "legacy message" },
          // No `diagnosticHistory` field — pre-Lot A shape.
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      failures: [
        {
          taskId: 1,
          module: "auth",
          stage: 4 as const,
          error: { code: "repair_exhausted", message: "legacy message" },
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      pricingRefDate: "2026-01-01",
    });
    expect(out).not.toContain("attempts:");
    expect(out).toContain("legacy message");
  });

  it("formatStatusHuman skips the per-attempt sequence for non-stage-4 failures (e.g. refused_human_page)", () => {
    // A stage-4 task that fails the pre-LLM owner check has no LLM
    // call → no diagnosticHistory. The status output must NOT print
    // an empty `attempts:` block.
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed_with_failures",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: null,
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [
        {
          taskId: 1,
          stage: 4 as const,
          target: "auth",
          status: "failed",
          attempts: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          error: { code: "refused_human_page", message: "owner: human — refused" },
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      failures: [
        {
          taskId: 1,
          module: "auth",
          stage: 4 as const,
          error: { code: "refused_human_page", message: "owner: human — refused" },
          retryCommand: "livewiki batch --only auth 1",
        },
      ],
      pricingRefDate: "2026-01-01",
    });
    expect(out).not.toContain("attempts:");
    expect(out).toContain("refused_human_page");
  });
});

// === R10.1 C / R11-NAV: protected generated hubs are never silent ===
describe("batch human format — skipped generated hubs", () => {
  it("formatResultHuman surfaces a preserved hub with path and owner", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 0,
      tasksFailed: 0,
      skippedFlowsHub: { path: "livewiki/flows/index.md", owner: "human" },
    });
    expect(out).toContain("flows hub: preserved (owner: human)");
    expect(out).toContain("livewiki/flows/index.md");
  });

  it("formatResultHuman surfaces a preserved auxiliary hub with path and owner", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 0,
      tasksFailed: 0,
      skippedAuxiliaryHub: {
        path: "livewiki/auxiliary/index.md",
        owner: "mixed",
      },
    });
    expect(out).toContain("auxiliary hub: preserved (owner: mixed)");
    expect(out).toContain("livewiki/auxiliary/index.md");
  });

  it("formatResultHuman prints no hub line when nothing was skipped", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 0,
      tasksFailed: 0,
    });
    expect(out).not.toContain("flows hub");
    expect(out).not.toContain("auxiliary hub");
  });
});

// === Recovery tier (Component 2): degraded page count in human output ===
describe("batch human format — degraded pages (recovery tier, Component 2)", () => {
  const summaryBase = {
    totals: { ...baseTotals },
    byStage: { "4": { ...baseTotals } },
    byModule: [],
    tasksDone: 1,
    tasksFailed: 0,
    tasksPending: 0,
    modulesRefined: null,
  };

  it("formatStatusHuman prints the degraded count when the summary lists degraded pages", () => {
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: { ...summaryBase, degradedPages: ["livewiki/auth.md"] },
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [],
      failures: [],
      pricingRefDate: "2026-01-01",
    });
    expect(out).toContain("degraded pages (relaxed contract): 1");
  });

  it("formatStatusHuman omits the degraded line when there are none", () => {
    const out = formatStatusHuman({
      run: {
        id: 1,
        status: "completed",
        startedAt: Date.now(),
        finishedAt: Date.now(),
        startedBy: "cli",
        summary: { ...summaryBase },
      },
      totals: { ...baseTotals },
      byStage: { "4": { ...baseTotals } },
      byModule: [],
      tasks: [],
      failures: [],
      pricingRefDate: "2026-01-01",
    });
    expect(out).not.toContain("degraded pages");
  });

  it("formatResultHuman prints the degraded count when the result lists degraded pages", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 1,
      tasksFailed: 0,
      degradedPages: ["livewiki/auth.md", "livewiki/flows/cli-to-core.md"],
    });
    expect(out).toContain("degraded pages (relaxed contract): 2");
  });

  it("formatResultHuman omits the degraded line when there are none", () => {
    const out = formatResultHuman({
      runId: 1,
      status: "completed",
      totals: { ...baseTotals },
      byModule: [],
      failures: [],
      circuitBreakerTriggered: false,
      tasksDone: 1,
      tasksFailed: 0,
    });
    expect(out).not.toContain("degraded pages");
  });
});
