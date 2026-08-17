import { describe, it, expect } from "vitest";
import {
  PRICING_TABLE,
  PRICING_REFERENCE_DATE,
  lookupPricing,
  calculateCostUsd,
  formatCost,
} from "./pricing.js";

describe("pricing — built-in table", () => {
  it("has a reference date", () => {
    expect(PRICING_REFERENCE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers popular MVP models (Claude 4.5 + OpenAI-compat)", () => {
    expect(PRICING_TABLE["claude-opus-4-5"]).toBeDefined();
    expect(PRICING_TABLE["claude-sonnet-5"]).toBeDefined();
    expect(PRICING_TABLE["claude-haiku-4-5"]).toBeDefined();
    expect(PRICING_TABLE["gpt-4o"]).toBeDefined();
  });

  it("prices are USD/1M tokens (positive numbers)", () => {
    for (const [model, price] of Object.entries(PRICING_TABLE)) {
      expect(price.input, `${model}.input`).toBeGreaterThan(0);
      expect(price.output, `${model}.output`).toBeGreaterThan(0);
    }
  });
});

describe("pricing.lookupPricing", () => {
  it("finds a price in the built-in table", () => {
    const r = lookupPricing("claude-sonnet-5");
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      expect(r.inputUsd).toBe(2);
      expect(r.outputUsd).toBe(10);
      expect(r.refDate).toBe(PRICING_REFERENCE_DATE);
    }
  });

  it("config override beats the built-in table", () => {
    const r = lookupPricing("claude-sonnet-5", { "claude-sonnet-5": { input: 1, output: 5 } });
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      expect(r.inputUsd).toBe(1);
      expect(r.outputUsd).toBe(5);
    }
  });

  it("unknown model → tokensOnly (report without USD, does not invent)", () => {
    const r = lookupPricing("gpt-9000-ultimate");
    expect(r.tokensOnly).toBe(true);
  });

  it("override only applies to listed models — others fall back to the table", () => {
    const r = lookupPricing("claude-haiku-4-5", { "claude-sonnet-5": { input: 1, output: 5 } });
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      // haiku is only in the built-in table
      expect(r.inputUsd).toBe(PRICING_TABLE["claude-haiku-4-5"]!.input);
    }
  });
});

describe("pricing.calculateCostUsd", () => {
  it("calculates the cost of a call", () => {
    const c = calculateCostUsd(1_000_000, 500_000, "claude-sonnet-5");
    // 1M input * $2/1M = $2 + 500k * $10/1M = $5 → total $7
    expect(c).not.toBeNull();
    if (c) {
      expect(c.input).toBeCloseTo(2.0, 4);
      expect(c.output).toBeCloseTo(5.0, 4);
      expect(c.total).toBeCloseTo(7.0, 4);
      expect(c.refDate).toBe(PRICING_REFERENCE_DATE);
    }
  });

  it("returns null for a model without a price (does not invent)", () => {
    expect(calculateCostUsd(100, 50, "unknown-model")).toBeNull();
  });

  it("override wins", () => {
    const c = calculateCostUsd(1_000_000, 0, "claude-sonnet-5", {
      "claude-sonnet-5": { input: 7, output: 30 },
    });
    expect(c?.input).toBeCloseTo(7.0, 4);
  });
});

describe("pricing.formatCost", () => {
  it("formats numeric cost in USD", () => {
    expect(formatCost({ total: 12.3456 }, "x")).toBe("$12.3456");
  });

  it("marks absence of price without inventing one", () => {
    expect(formatCost(null, "gpt-9999")).toBe("(no price for model gpt-9999)");
  });
});
