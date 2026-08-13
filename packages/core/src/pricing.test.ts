import { describe, it, expect } from "vitest";
import {
  PRICING_TABLE,
  PRICING_REFERENCE_DATE,
  lookupPricing,
  calculateCostUsd,
  formatCost,
} from "./pricing.js";

describe("pricing — tabela embutida", () => {
  it("tem data de referência", () => {
    expect(PRICING_REFERENCE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("cobre modelos populares do MVP (Claude 4.5 + OpenAI-compat)", () => {
    expect(PRICING_TABLE["claude-opus-4-5"]).toBeDefined();
    expect(PRICING_TABLE["claude-sonnet-5"]).toBeDefined();
    expect(PRICING_TABLE["claude-haiku-4-5"]).toBeDefined();
    expect(PRICING_TABLE["gpt-4o"]).toBeDefined();
  });

  it("preços são USD/1M tokens (números positivos)", () => {
    for (const [model, price] of Object.entries(PRICING_TABLE)) {
      expect(price.input, `${model}.input`).toBeGreaterThan(0);
      expect(price.output, `${model}.output`).toBeGreaterThan(0);
    }
  });
});

describe("pricing.lookupPricing", () => {
  it("acha preço na tabela embutida", () => {
    const r = lookupPricing("claude-sonnet-5");
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      expect(r.inputUsd).toBe(2);
      expect(r.outputUsd).toBe(10);
      expect(r.refDate).toBe(PRICING_REFERENCE_DATE);
    }
  });

  it("override do config vence a tabela embutida", () => {
    const r = lookupPricing("claude-sonnet-5", { "claude-sonnet-5": { input: 1, output: 5 } });
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      expect(r.inputUsd).toBe(1);
      expect(r.outputUsd).toBe(5);
    }
  });

  it("modelo desconhecido → tokensOnly (reporte sem USD, não inventa)", () => {
    const r = lookupPricing("gpt-9000-ultimate");
    expect(r.tokensOnly).toBe(true);
  });

  it("override só se aplica a modelos listados — outros caem na tabela", () => {
    const r = lookupPricing("claude-haiku-4-5", { "claude-sonnet-5": { input: 1, output: 5 } });
    expect(r.tokensOnly).toBe(false);
    if (!r.tokensOnly) {
      // haiku está só na tabela embutida
      expect(r.inputUsd).toBe(PRICING_TABLE["claude-haiku-4-5"]!.input);
    }
  });
});

describe("pricing.calculateCostUsd", () => {
  it("calcula custo de uma chamada", () => {
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

  it("retorna null pra modelo sem preço (não inventa)", () => {
    expect(calculateCostUsd(100, 50, "unknown-model")).toBeNull();
  });

  it("override vence", () => {
    const c = calculateCostUsd(1_000_000, 0, "claude-sonnet-5", {
      "claude-sonnet-5": { input: 7, output: 30 },
    });
    expect(c?.input).toBeCloseTo(7.0, 4);
  });
});

describe("pricing.formatCost", () => {
  it("formata custo numérico em USD", () => {
    expect(formatCost({ total: 12.3456 }, "x")).toBe("$12.3456");
  });

  it("marca ausência de preço sem inventar", () => {
    expect(formatCost(null, "gpt-9999")).toBe("(no price for model gpt-9999)");
  });
});
