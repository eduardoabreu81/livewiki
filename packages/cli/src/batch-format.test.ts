/**
 * Human formatters for incomplete usage (no public package surface change
 * beyond testing the command module helpers).
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
    });
    expect(out).not.toContain(USAGE_INCOMPLETE_NOTE);
  });
});
