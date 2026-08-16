import { describe, it, expect } from "vitest";
import {
  PRESET_TABLE,
  AVAILABLE_PRESETS,
  resolvePreset,
  resolveProviderConfig,
  isKnownPreset,
  UnknownPresetError,
  type PresetName,
} from "./presets.js";

describe("PRESET_TABLE — dados", () => {
  it("tem 10 presets conforme SPEC §Stack", () => {
    expect(Object.keys(PRESET_TABLE)).toHaveLength(10);
    expect(Object.keys(PRESET_TABLE).sort()).toEqual([
      "anthropic",
      "deepseek",
      "gemini",
      "kimi",
      "lmstudio",
      "minimax",
      "nvidia",
      "ollama",
      "openai",
      "openrouter",
    ]);
  });

  it("AVAILABLE_PRESETS lista os 10 (mesma ordem que SPEC)", () => {
    expect(AVAILABLE_PRESETS).toHaveLength(10);
    expect(AVAILABLE_PRESETS).toContain("anthropic");
    expect(AVAILABLE_PRESETS).toContain("minimax");
    expect(AVAILABLE_PRESETS).toContain("ollama");
  });

  it("cada preset tem adapter, baseUrl, envVar, pricing, notes", () => {
    for (const [name, preset] of Object.entries(PRESET_TABLE)) {
      expect(preset.adapter, `${name}.adapter`).toMatch(/^(anthropic|openai-compat)$/);
      expect(preset.baseUrl, `${name}.baseUrl`).toBeTruthy();
      expect(preset.baseUrl, `${name}.baseUrl`).toMatch(/^https?:\/\//);
      expect(preset.envVar, `${name}.envVar`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(preset.notes, `${name}.notes`).toBeTruthy();
      // pricing é um objeto (pode estar vazio, mas tem que existir)
      expect(preset.pricing, `${name}.pricing`).toBeTypeOf("object");
    }
  });

  it("NENHUM preset inclui API key (regra Fase 3 — key só via env)", () => {
    for (const [name, preset] of Object.entries(PRESET_TABLE)) {
      const str = JSON.stringify(preset);
      // Sanity: nenhum valor de campo parece com API key (começa com sk-, ghp_, etc.)
      expect(str, `${name} não deve conter key inline`).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(str, `${name} não deve conter key inline`).not.toMatch(/ghp_[a-zA-Z0-9]{20,}/);
      expect(str, `${name} não deve conter key inline`).not.toMatch(/gsk_[a-zA-Z0-9]{20,}/);
    }
  });
});

describe("preset.anthropic", () => {
  it("usa adapter anthropic", () => {
    expect(PRESET_TABLE.anthropic.adapter).toBe("anthropic");
  });
  it("baseUrl é a API oficial", () => {
    expect(PRESET_TABLE.anthropic.baseUrl).toBe("https://api.anthropic.com");
  });
  it("envVar é ANTHROPIC_API_KEY", () => {
    expect(PRESET_TABLE.anthropic.envVar).toBe("ANTHROPIC_API_KEY");
  });
  it("pricing includes the current Claude models", () => {
    expect(PRESET_TABLE.anthropic.pricing["claude-opus-4-5"]).toBeDefined();
    expect(PRESET_TABLE.anthropic.pricing["claude-sonnet-5"]).toBeDefined();
    expect(PRESET_TABLE.anthropic.pricing["claude-haiku-4-5"]).toBeDefined();
  });
});

describe("preset.minimax (regra Anthropic-compat da SPEC)", () => {
  it("USA adapter anthropic (não openai-compat) — prompt caching ativado", () => {
    expect(PRESET_TABLE.minimax.adapter).toBe("anthropic");
  });
  it("envVar é MiniMax_API_KEY", () => {
    expect(PRESET_TABLE.minimax.envVar).toBe("MiniMax_API_KEY");
  });
  it("pricing inclui modelos MiniMax M-series + multimodais", () => {
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M3"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M2.7"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M2"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["speech-2.8"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["hailuo-2.3"]).toBeDefined();
  });
});

describe("preset.openai", () => {
  it("usa adapter openai-compat", () => {
    expect(PRESET_TABLE.openai.adapter).toBe("openai-compat");
  });
  it("envVar é OPENAI_API_KEY", () => {
    expect(PRESET_TABLE.openai.envVar).toBe("OPENAI_API_KEY");
  });
  it("pricing matches the embedded table", () => {
    expect(PRESET_TABLE.openai.pricing["gpt-4o"]).toEqual({ input: 2.5, output: 10 });
    expect(PRESET_TABLE.openai.pricing["gpt-4o-mini"]).toEqual({ input: 0.15, output: 0.6 });
  });
});

describe("preset.openrouter / deepseek / kimi / gemini / nvidia", () => {
  it("todos usam adapter openai-compat", () => {
    for (const name of ["openrouter", "deepseek", "kimi", "gemini", "nvidia"] as const) {
      expect(PRESET_TABLE[name].adapter, `${name}.adapter`).toBe("openai-compat");
    }
  });
  it("cada um tem envVar única (sem colisão)", () => {
    const envVars = new Set<string>();
    for (const name of ["openrouter", "deepseek", "kimi", "gemini", "nvidia"] as const) {
      const v = PRESET_TABLE[name].envVar;
      expect(envVars.has(v), `envVar duplicada: ${v}`).toBe(false);
      envVars.add(v);
    }
  });
  it("envVars esperadas", () => {
    expect(PRESET_TABLE.openrouter.envVar).toBe("OPENROUTER_API_KEY");
    expect(PRESET_TABLE.deepseek.envVar).toBe("DEEPSEEK_API_KEY");
    expect(PRESET_TABLE.kimi.envVar).toBe("MOONSHOT_API_KEY");
    expect(PRESET_TABLE.gemini.envVar).toBe("GEMINI_API_KEY");
    expect(PRESET_TABLE.nvidia.envVar).toBe("NVIDIA_API_KEY");
  });
  it("deepseek pins thinking disabled (v4 enables thinking when omitted)", () => {
    // Regression: 2026-08-16 dogfood — v4 default thinking silently burned
    // the whole output budget on reasoning and truncated every large page.
    expect(PRESET_TABLE.deepseek.thinkingDefault).toBe("disabled");
    expect(PRESET_TABLE.deepseek.pricing["deepseek-v4-flash"]).toBeDefined();
  });
});

describe("preset.ollama / lmstudio (locais)", () => {
  it("marks optional credentials as preset data, not name-based behavior", () => {
    expect(PRESET_TABLE.ollama.credentialOptional).toBe(true);
    expect(PRESET_TABLE.lmstudio.credentialOptional).toBe(true);
    expect(PRESET_TABLE.anthropic.credentialOptional).not.toBe(true);
  });

  it("usam adapter openai-compat", () => {
    expect(PRESET_TABLE.ollama.adapter).toBe("openai-compat");
    expect(PRESET_TABLE.lmstudio.adapter).toBe("openai-compat");
  });
  it("baseUrls apontam pra localhost", () => {
    expect(PRESET_TABLE.ollama.baseUrl).toMatch(/^http:\/\/localhost:/);
    expect(PRESET_TABLE.lmstudio.baseUrl).toMatch(/^http:\/\/localhost:/);
  });
  it("pricing é 0,0 (sem custo de API)", () => {
    // Local não cobra — modelo reporta custo zero explícito (não "sem preço")
    for (const name of ["ollama", "lmstudio"] as const) {
      for (const [, price] of Object.entries(PRESET_TABLE[name].pricing)) {
        expect(price.input, `${name} model input`).toBe(0);
        expect(price.output, `${name} model output`).toBe(0);
      }
    }
  });
});

describe("resolvePreset", () => {
  it("resolve preset válido", () => {
    const p = resolvePreset("anthropic");
    expect(p.adapter).toBe("anthropic");
  });

  it("lança UnknownPresetError com lista de available", () => {
    try {
      resolvePreset("magic-llm-9000");
      expect.fail("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownPresetError);
      const e = err as UnknownPresetError;
      expect(e.presetName).toBe("magic-llm-9000");
      expect(e.available).toEqual(AVAILABLE_PRESETS);
      expect(e.message).toContain("magic-llm-9000");
      expect(e.message).toContain("anthropic");
    }
  });
});

describe("isKnownPreset", () => {
  it("true pra presets conhecidos", () => {
    for (const name of AVAILABLE_PRESETS) {
      expect(isKnownPreset(name)).toBe(true);
    }
  });
  it("false pra nomes inválidos", () => {
    expect(isKnownPreset("foo")).toBe(false);
    expect(isKnownPreset("")).toBe(false);
    expect(isKnownPreset("Anthropic")).toBe(false); // case-sensitive
  });
});

describe("resolveProviderConfig", () => {
  it("preset sozinho → usa adapter/baseUrl/envVar/pricing do preset", () => {
    const r = resolveProviderConfig({ preset: "anthropic" });
    expect(r.presetName).toBe("anthropic");
    expect(r.adapter).toBe("anthropic");
    expect(r.baseUrl).toBe("https://api.anthropic.com");
    expect(r.envVar).toBe("ANTHROPIC_API_KEY");
    expect(r.pricing["claude-sonnet-5"]).toBeDefined();
  });

  it("preset.minimax → adapter=anthropic (NÃO openai-compat)", () => {
    const r = resolveProviderConfig({ preset: "minimax" });
    expect(r.adapter).toBe("anthropic");
    expect(r.envVar).toBe("MiniMax_API_KEY");
  });

  it("propagates credentialOptional from preset data", () => {
    expect(resolveProviderConfig({ preset: "ollama" }).credentialOptional).toBe(true);
    expect(resolveProviderConfig({ preset: "anthropic" }).credentialOptional).toBe(false);
    expect(resolveProviderConfig({ provider: "openai-compat" }).credentialOptional).toBe(false);
  });

  it("config.baseUrl sobrescreve preset.baseUrl", () => {
    const r = resolveProviderConfig({
      preset: "anthropic",
      baseUrl: "https://my-proxy.example.com",
    });
    expect(r.baseUrl).toBe("https://my-proxy.example.com");
  });

  it("config.pricing sobrescreve preset.pricing POR MODELO (merge)", () => {
    const r = resolveProviderConfig({
      preset: "anthropic",
      pricing: {
        "claude-sonnet-5": { input: 999, output: 999 }, // override
      },
    });
    // Override aplicado
    expect(r.pricing["claude-sonnet-5"]).toEqual({ input: 999, output: 999 });
    // Default do preset preservado pros outros modelos
    expect(r.pricing["claude-opus-4-5"]).toEqual({ input: 5, output: 25 });
  });

  it("config.provider sobrescreve adapter do preset (escape hatch)", () => {
    // Raro: usuário quer usar preset pra baseUrl/envVar mas outro adapter.
    const r = resolveProviderConfig({
      preset: "openai",
      provider: "openai-compat",
    });
    expect(r.adapter).toBe("openai-compat");
  });

  it("back-compat: só provider set (Fase 3)", () => {
    const r = resolveProviderConfig({ provider: "anthropic" });
    expect(r.presetName).toBeNull();
    expect(r.adapter).toBe("anthropic");
    expect(r.envVar).toBe("ANTHROPIC_API_KEY");
    expect(r.notes).toContain("legacy");
  });

  it("back-compat: openai-compat", () => {
    const r = resolveProviderConfig({ provider: "openai-compat" });
    expect(r.adapter).toBe("openai-compat");
    expect(r.envVar).toBe("OPENAI_API_KEY");
  });

  it("back-compat: provider inválido lança UnknownPresetError", () => {
    expect(() => resolveProviderConfig({ provider: "magic" })).toThrow(UnknownPresetError);
  });

  it("lança erro se nem preset nem provider (caller deve validar antes)", () => {
    expect(() => resolveProviderConfig({})).toThrow(/requires preset or provider/);
  });

  it("preset inválido propaga UnknownPresetError", () => {
    expect(() => resolveProviderConfig({ preset: "typo" })).toThrow(UnknownPresetError);
  });
});

describe("preset — type safety (PresetName)", () => {
  it("todos os nomes em AVAILABLE_PRESETS são PresetName válidos", () => {
    // Isso é mais um smoke test do type system — checa runtime que não há drift
    for (const name of AVAILABLE_PRESETS) {
      const _check: PresetName = name;
      expect(_check).toBe(name);
    }
  });
});
