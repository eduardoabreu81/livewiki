import { describe, it, expect } from "vitest";
import {
  computeDynamicOutputTokenBudget,
  MODULE_OUTPUT_BUDGET_OPTIONS,
  TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS,
} from "./output-budget.js";

describe("computeDynamicOutputTokenBudget", () => {
  it("returns the floor when there are zero anchors", () => {
    expect(computeDynamicOutputTokenBudget({ anchorCount: 0 }, MODULE_OUTPUT_BUDGET_OPTIONS)).toBe(
      4096,
    );
  });

  it("scales up with anchor count, rounded to the nearest 256", () => {
    // base 2048 + 300*10 = 5048 -> ceil(5048/256)*256 = 5120
    expect(computeDynamicOutputTokenBudget({ anchorCount: 10 }, MODULE_OUTPUT_BUDGET_OPTIONS)).toBe(
      5120,
    );
  });

  it("clamps to the ceiling for a very large anchor count", () => {
    expect(
      computeDynamicOutputTokenBudget({ anchorCount: 200 }, MODULE_OUTPUT_BUDGET_OPTIONS),
    ).toBe(32_768);
  });

  it("adds anchorSourceChars as an additive term when supplied", () => {
    // base 2048 + 300*20 = 8048; + ceil(40000/40) = 1000 -> 9048 -> ceil(9048/256)*256 = 9216
    expect(
      computeDynamicOutputTokenBudget(
        { anchorCount: 20, anchorSourceChars: 40_000 },
        MODULE_OUTPUT_BUDGET_OPTIONS,
      ),
    ).toBe(9216);
  });

  it("ignores anchorSourceChars when omitted or zero (no term added)", () => {
    const withoutSignal = computeDynamicOutputTokenBudget(
      { anchorCount: 10 },
      MODULE_OUTPUT_BUDGET_OPTIONS,
    );
    const withZeroSignal = computeDynamicOutputTokenBudget(
      { anchorCount: 10, anchorSourceChars: 0 },
      MODULE_OUTPUT_BUDGET_OPTIONS,
    );
    expect(withZeroSignal).toBe(withoutSignal);
  });

  it("a small anchorSourceChars contribution can still be dominated by the floor", () => {
    // base 2048 + 300*5 = 3548; + ceil(4000/40) = 100 -> 3648 -> rounds to 3840, still below floor 4096
    expect(
      computeDynamicOutputTokenBudget(
        { anchorCount: 5, anchorSourceChars: 4_000 },
        MODULE_OUTPUT_BUDGET_OPTIONS,
      ),
    ).toBe(4096);
  });

  it("treats a negative anchorCount as zero (never subtracts from base)", () => {
    expect(computeDynamicOutputTokenBudget({ anchorCount: -5 }, MODULE_OUTPUT_BUDGET_OPTIONS)).toBe(
      computeDynamicOutputTokenBudget({ anchorCount: 0 }, MODULE_OUTPUT_BUDGET_OPTIONS),
    );
  });

  it("the topic-refine preset uses a smaller base/perAnchor than the module/flow/topic-prose preset", () => {
    const refine = computeDynamicOutputTokenBudget(
      { anchorCount: 100 },
      TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS,
    );
    const modulePreset = computeDynamicOutputTokenBudget(
      { anchorCount: 100 },
      MODULE_OUTPUT_BUDGET_OPTIONS,
    );
    expect(refine).toBeLessThan(modulePreset);
    // base 1024 + 40*100 = 5024 -> ceil(5024/256)*256 = 5120
    expect(refine).toBe(5120);
  });

  it("floor and ceiling are always respected regardless of preset", () => {
    const zero = computeDynamicOutputTokenBudget({ anchorCount: 0 }, TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS);
    expect(zero).toBeGreaterThanOrEqual(TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS.floor);
    const huge = computeDynamicOutputTokenBudget(
      { anchorCount: 10_000 },
      TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS,
    );
    expect(huge).toBeLessThanOrEqual(TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS.ceiling);
  });
});
