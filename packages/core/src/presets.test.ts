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

describe("PRESET_TABLE — data", () => {
  it("has 17 presets per SPEC §Stack", () => {
    expect(Object.keys(PRESET_TABLE)).toHaveLength(17);
    expect(Object.keys(PRESET_TABLE).sort()).toEqual([
      "alibaba",
      "anthropic",
      "deepseek",
      "fireworks",
      "gemini",
      "gmi",
      "huggingface",
      "kimi",
      "lmstudio",
      "minimax",
      "novita",
      "nvidia",
      "ollama",
      "openai",
      "openrouter",
      "stepfun",
      "xai",
    ]);
  });

  it("AVAILABLE_PRESETS lists the 17 (same order as SPEC)", () => {
    expect(AVAILABLE_PRESETS).toHaveLength(17);
    expect(AVAILABLE_PRESETS).toContain("anthropic");
    expect(AVAILABLE_PRESETS).toContain("minimax");
    expect(AVAILABLE_PRESETS).toContain("ollama");
  });

  it("each preset has adapter, baseUrl, envVar, pricing, notes", () => {
    for (const [name, preset] of Object.entries(PRESET_TABLE)) {
      expect(preset.adapter, `${name}.adapter`).toMatch(/^(anthropic|openai-compat)$/);
      expect(preset.baseUrl, `${name}.baseUrl`).toBeTruthy();
      expect(preset.baseUrl, `${name}.baseUrl`).toMatch(/^https?:\/\//);
      expect(preset.envVar, `${name}.envVar`).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(preset.notes, `${name}.notes`).toBeTruthy();
      // pricing is an object (may be empty, but must exist)
      expect(preset.pricing, `${name}.pricing`).toBeTypeOf("object");
    }
  });

  it("NO preset includes an API key (Phase 3 rule — key only via env)", () => {
    for (const [name, preset] of Object.entries(PRESET_TABLE)) {
      const str = JSON.stringify(preset);
      // Sanity: no field value looks like an API key (starts with sk-, ghp_, etc.)
      expect(str, `${name} must not contain an inline key`).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(str, `${name} must not contain an inline key`).not.toMatch(/ghp_[a-zA-Z0-9]{20,}/);
      expect(str, `${name} must not contain an inline key`).not.toMatch(/gsk_[a-zA-Z0-9]{20,}/);
    }
  });
});

describe("preset.anthropic", () => {
  it("uses the anthropic adapter", () => {
    expect(PRESET_TABLE.anthropic.adapter).toBe("anthropic");
  });
  it("baseUrl is the official API", () => {
    expect(PRESET_TABLE.anthropic.baseUrl).toBe("https://api.anthropic.com");
  });
  it("envVar is ANTHROPIC_API_KEY", () => {
    expect(PRESET_TABLE.anthropic.envVar).toBe("ANTHROPIC_API_KEY");
  });
  it("pricing includes the current Claude models", () => {
    expect(PRESET_TABLE.anthropic.pricing["claude-opus-4-5"]).toBeDefined();
    expect(PRESET_TABLE.anthropic.pricing["claude-sonnet-5"]).toBeDefined();
    expect(PRESET_TABLE.anthropic.pricing["claude-haiku-4-5"]).toBeDefined();
  });
});

describe("preset.minimax (SPEC Anthropic-compat rule)", () => {
  it("USES the anthropic adapter (not openai-compat) — prompt caching enabled", () => {
    expect(PRESET_TABLE.minimax.adapter).toBe("anthropic");
  });
  it("envVar is MiniMax_API_KEY", () => {
    expect(PRESET_TABLE.minimax.envVar).toBe("MiniMax_API_KEY");
  });
  it("pricing includes MiniMax M-series + multimodal models", () => {
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M3"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M2.7"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["MiniMax-M2"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["speech-2.8"]).toBeDefined();
    expect(PRESET_TABLE.minimax.pricing["hailuo-2.3"]).toBeDefined();
  });
});

describe("preset.openai", () => {
  it("uses the openai-compat adapter", () => {
    expect(PRESET_TABLE.openai.adapter).toBe("openai-compat");
  });
  it("envVar is OPENAI_API_KEY", () => {
    expect(PRESET_TABLE.openai.envVar).toBe("OPENAI_API_KEY");
  });
  it("pricing matches the embedded table", () => {
    expect(PRESET_TABLE.openai.pricing["gpt-4o"]).toEqual({ input: 2.5, output: 10 });
    expect(PRESET_TABLE.openai.pricing["gpt-4o-mini"]).toEqual({ input: 0.15, output: 0.6 });
  });
});

describe("preset.openrouter / deepseek / kimi / gemini / nvidia", () => {
  it("all use the openai-compat adapter", () => {
    for (const name of ["openrouter", "deepseek", "kimi", "gemini", "nvidia"] as const) {
      expect(PRESET_TABLE[name].adapter, `${name}.adapter`).toBe("openai-compat");
    }
  });
  it("each has a unique envVar (no collision)", () => {
    const envVars = new Set<string>();
    for (const name of ["openrouter", "deepseek", "kimi", "gemini", "nvidia"] as const) {
      const v = PRESET_TABLE[name].envVar;
      expect(envVars.has(v), `duplicate envVar: ${v}`).toBe(false);
      envVars.add(v);
    }
  });
  it("all presets have a unique envVar and a filled baseUrl", () => {
    const envVars = new Set<string>();
    for (const name of AVAILABLE_PRESETS) {
      const preset = PRESET_TABLE[name];
      expect(preset.baseUrl.length, `${name}.baseUrl`).toBeGreaterThan(0);
      expect(envVars.has(preset.envVar), `duplicate envVar: ${preset.envVar}`).toBe(false);
      envVars.add(preset.envVar);
    }
  });

  it("presets added on 2026-08-16 (hermes-agent base, MIT)", () => {
    expect(PRESET_TABLE.fireworks.baseUrl).toBe("https://api.fireworks.ai/inference/v1");
    expect(PRESET_TABLE.novita.envVar).toBe("NOVITA_API_KEY");
    expect(PRESET_TABLE.gmi.envVar).toBe("GMI_API_KEY");
    expect(PRESET_TABLE.stepfun.baseUrl).toBe("https://api.stepfun.com/v1");
    expect(PRESET_TABLE.huggingface.envVar).toBe("HF_TOKEN");
    expect(PRESET_TABLE.xai.envVar).toBe("XAI_API_KEY");
    expect(PRESET_TABLE.alibaba.envVar).toBe("DASHSCOPE_API_KEY");
  });

  it("expected envVars", () => {
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

describe("preset.ollama / lmstudio (local)", () => {
  it("marks optional credentials as preset data, not name-based behavior", () => {
    expect(PRESET_TABLE.ollama.credentialOptional).toBe(true);
    expect(PRESET_TABLE.lmstudio.credentialOptional).toBe(true);
    expect(PRESET_TABLE.anthropic.credentialOptional).not.toBe(true);
  });

  it("use the openai-compat adapter", () => {
    expect(PRESET_TABLE.ollama.adapter).toBe("openai-compat");
    expect(PRESET_TABLE.lmstudio.adapter).toBe("openai-compat");
  });
  it("baseUrls point to localhost", () => {
    expect(PRESET_TABLE.ollama.baseUrl).toMatch(/^http:\/\/localhost:/);
    expect(PRESET_TABLE.lmstudio.baseUrl).toMatch(/^http:\/\/localhost:/);
  });
  it("pricing is 0,0 (no API cost)", () => {
    // Local does not charge — the model reports an explicit zero cost (not "no price")
    for (const name of ["ollama", "lmstudio"] as const) {
      for (const [, price] of Object.entries(PRESET_TABLE[name].pricing)) {
        expect(price.input, `${name} model input`).toBe(0);
        expect(price.output, `${name} model output`).toBe(0);
      }
    }
  });
});

describe("resolvePreset", () => {
  it("resolves a valid preset", () => {
    const p = resolvePreset("anthropic");
    expect(p.adapter).toBe("anthropic");
  });

  it("throws UnknownPresetError with the available list", () => {
    try {
      resolvePreset("magic-llm-9000");
      expect.fail("should have thrown");
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
  it("true for known presets", () => {
    for (const name of AVAILABLE_PRESETS) {
      expect(isKnownPreset(name)).toBe(true);
    }
  });
  it("false for invalid names", () => {
    expect(isKnownPreset("foo")).toBe(false);
    expect(isKnownPreset("")).toBe(false);
    expect(isKnownPreset("Anthropic")).toBe(false); // case-sensitive
  });
});

describe("resolveProviderConfig", () => {
  it("preset alone → uses the preset's adapter/baseUrl/envVar/pricing", () => {
    const r = resolveProviderConfig({ preset: "anthropic" });
    expect(r.presetName).toBe("anthropic");
    expect(r.adapter).toBe("anthropic");
    expect(r.baseUrl).toBe("https://api.anthropic.com");
    expect(r.envVar).toBe("ANTHROPIC_API_KEY");
    expect(r.pricing["claude-sonnet-5"]).toBeDefined();
  });

  it("preset.minimax → adapter=anthropic (NOT openai-compat)", () => {
    const r = resolveProviderConfig({ preset: "minimax" });
    expect(r.adapter).toBe("anthropic");
    expect(r.envVar).toBe("MiniMax_API_KEY");
  });

  it("propagates credentialOptional from preset data", () => {
    expect(resolveProviderConfig({ preset: "ollama" }).credentialOptional).toBe(true);
    expect(resolveProviderConfig({ preset: "anthropic" }).credentialOptional).toBe(false);
    expect(resolveProviderConfig({ provider: "openai-compat" }).credentialOptional).toBe(false);
  });

  it("config.baseUrl overrides preset.baseUrl", () => {
    const r = resolveProviderConfig({
      preset: "anthropic",
      baseUrl: "https://my-proxy.example.com",
    });
    expect(r.baseUrl).toBe("https://my-proxy.example.com");
  });

  it("config.pricing overrides preset.pricing PER MODEL (merge)", () => {
    const r = resolveProviderConfig({
      preset: "anthropic",
      pricing: {
        "claude-sonnet-5": { input: 999, output: 999 }, // override
      },
    });
    // Override applied
    expect(r.pricing["claude-sonnet-5"]).toEqual({ input: 999, output: 999 });
    // Preset default preserved for the other models
    expect(r.pricing["claude-opus-4-5"]).toEqual({ input: 5, output: 25 });
  });

  it("config.provider overrides the preset adapter (escape hatch)", () => {
    // Rare: user wants to use the preset for baseUrl/envVar but another adapter.
    const r = resolveProviderConfig({
      preset: "openai",
      provider: "openai-compat",
    });
    expect(r.adapter).toBe("openai-compat");
  });

  it("back-compat: only provider set (Phase 3)", () => {
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

  it("back-compat: invalid provider throws UnknownPresetError", () => {
    expect(() => resolveProviderConfig({ provider: "magic" })).toThrow(UnknownPresetError);
  });

  it("throws an error if neither preset nor provider (caller must validate first)", () => {
    expect(() => resolveProviderConfig({})).toThrow(/requires preset or provider/);
  });

  it("invalid preset propagates UnknownPresetError", () => {
    expect(() => resolveProviderConfig({ preset: "typo" })).toThrow(UnknownPresetError);
  });
});

describe("preset — type safety (PresetName)", () => {
  it("all names in AVAILABLE_PRESETS are valid PresetName", () => {
    // This is more of a type-system smoke test — checks at runtime that there is no drift
    for (const name of AVAILABLE_PRESETS) {
      const _check: PresetName = name;
      expect(_check).toBe(name);
    }
  });
});
