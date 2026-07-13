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
