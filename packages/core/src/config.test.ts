import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  loadConfig,
  saveConfig,
  applyDefaults,
  validateConfigForBatch,
  resolveBaseUrl,
  MissingProviderConfigError,
  CONFIG_DEFAULTS,
} from "./config.js";
import { DEFAULT_FLOW_SIGNAL_PATTERNS } from "./modules.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-config-"));
  // .livewiki/ needs to exist for safe-io writes
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("config.loadConfig", () => {
  it("retorna {} se .livewiki/config.json não existe", async () => {
    const cfg = await loadConfig(repoRoot);
    expect(cfg).toEqual({});
  });

  it("carrega config válido", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        language: "pt-BR",
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-sonnet-5");
    expect(cfg.language).toBe("pt-BR");
  });

  it("falha em JSON malformado (não retorna config parcial)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      "{ broken json",
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/Failed to parse/);
  });

  it("rejeita provider desconhecido", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ provider: "magic-llm-9000" }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/invalid provider/);
  });

  it("carrega preset válido (Fase 5 step 5)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ preset: "minimax", model: "MiniMax-M3" }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.preset).toBe("minimax");
    expect(cfg.model).toBe("MiniMax-M3");
    expect(cfg.provider).toBeUndefined();
  });

  it("rejeita preset desconhecido", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ preset: "magic-llm-9000" }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/invalid preset/);
  });

  it("preset coexiste com provider (preset vence pra adapter)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        preset: "openai",
        provider: "anthropic", // legacy field presente
        model: "gpt-4o",
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.preset).toBe("openai");
    expect(cfg.provider).toBe("anthropic"); // preservado
  });

  it("ignora silenciosamente chaves desconhecidas (forward compat)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ provider: "anthropic", futureField: 42 }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.provider).toBe("anthropic");
    expect((cfg as Record<string, unknown>)["futureField"]).toBeUndefined();
  });

  it("loads configurable gitignore-style path-role patterns", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        pathRoles: {
          fixturePatterns: ["examples/fixtures/**"],
          toolingPatterns: [],
        },
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.pathRoles).toEqual({
      fixturePatterns: ["examples/fixtures/**"],
      toolingPatterns: [],
    });
  });

  it("rejects malformed path-role pattern categories", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ pathRoles: { fixturePatterns: "not-an-array" } }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/pathRoles\.fixturePatterns/);
  });
});

describe("config.saveConfig + loadConfig round-trip", () => {
  it("grava e lê de volta sem perda", async () => {
    const original = {
      provider: "openai-compat" as const,
      model: "gpt-4o-mini",
      baseUrl: "https://my-proxy.example.com/v1",
      pricing: { "gpt-4o-mini": { input: 0.1, output: 0.4 } },
    };
    await saveConfig(repoRoot, original);
    const loaded = await loadConfig(repoRoot);
    expect(loaded).toEqual(original);
  });
});

describe("config.applyDefaults", () => {
  it("aplica language default = en quando ausente", () => {
    const cfg = applyDefaults({});
    expect(cfg.language).toBe("en");
  });

  it("preserva language explícito do usuário", () => {
    const cfg = applyDefaults({ language: "pt-BR" });
    expect(cfg.language).toBe("pt-BR");
  });

  it("NÃO aplica default de provider ou model — sempre undefined se ausente", () => {
    const cfg = applyDefaults({});
    expect(cfg.provider).toBeUndefined();
    expect(cfg.model).toBeUndefined();
  });
});

describe("config.validateConfigForBatch — sem modelo default hardcoded", () => {
  it("passa quando provider + model estão presentes", () => {
    expect(() =>
      validateConfigForBatch(repoRoot, { provider: "anthropic", model: "claude-sonnet-5" }),
    ).not.toThrow();
  });

  it("falha com MissingProviderConfigError se provider ausente", () => {
    expect(() => validateConfigForBatch(repoRoot, { model: "claude-sonnet-5" })).toThrow(
      MissingProviderConfigError,
    );
  });

  it("falha com MissingProviderConfigError se model ausente", () => {
    expect(() => validateConfigForBatch(repoRoot, { provider: "anthropic" })).toThrow(
      MissingProviderConfigError,
    );
  });

  it("falha com MissingProviderConfigError se ambos ausentes", () => {
    try {
      validateConfigForBatch(repoRoot, {});
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingProviderConfigError);
      const msg = (err as Error).message;
      // Mensagem cita exemplo (claude-sonnet-5), mas NÃO como fallback silencioso
      expect(msg).toMatch(/missing provider and model/);
      expect(msg).toContain("claude-sonnet-5"); // example
      expect(msg).toContain("example only"); // explícito que é exemplo
      expect(msg).toContain("ANTHROPIC_API_KEY"); // lembra do env var
    }
  });

  // Regression: a preset reference satisfies the provider requirement
  // (SPEC §"Stack": config.json references the preset by name). A preset-only
  // config was rejected before, making documented preset-only batches fail.
  it("passes with preset + model and no provider field", () => {
    expect(() =>
      validateConfigForBatch(repoRoot, { preset: "ollama", model: "granite4.1:3b" }),
    ).not.toThrow();
  });

  it("still fails when model is absent, even with a preset", () => {
    expect(() => validateConfigForBatch(repoRoot, { preset: "ollama" })).toThrow(
      MissingProviderConfigError,
    );
  });
});

describe("config.resolveBaseUrl", () => {
  it("usa baseUrl do config quando presente", () => {
    expect(
      resolveBaseUrl({ provider: "anthropic", baseUrl: "https://proxy.example.com" }),
    ).toBe("https://proxy.example.com");
  });

  it("cai no default por provider quando config.baseUrl ausente", () => {
    expect(resolveBaseUrl({ provider: "anthropic" })).toBe(CONFIG_DEFAULTS.baseUrls.anthropic);
    expect(resolveBaseUrl({ provider: "openai-compat" })).toBe(
      CONFIG_DEFAULTS.baseUrls["openai-compat"],
    );
  });
});

// === X — maxRepairAttempts (Phase-5 plan) ===
// Plan requires default 2, with override validated as a non-negative integer.
describe("config X — maxRepairAttempts", () => {
  it("applyDefaults fills default 2 when config omits the field", () => {
    expect(applyDefaults({}).maxRepairAttempts).toBe(2);
    expect(applyDefaults({ provider: "anthropic", model: "x" }).maxRepairAttempts).toBe(2);
  });

  it("applyDefaults does NOT overwrite an explicit config value", () => {
    expect(applyDefaults({ maxRepairAttempts: 5 }).maxRepairAttempts).toBe(5);
    expect(applyDefaults({ maxRepairAttempts: 0 }).maxRepairAttempts).toBe(0);
  });

  it("CONFIG_DEFAULTS.maxRepairAttempts === 2 (per plan)", () => {
    expect(CONFIG_DEFAULTS.maxRepairAttempts).toBe(2);
  });

  it("loadConfig accepts maxRepairAttempts: 0 (repair disabled)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: 0,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.maxRepairAttempts).toBe(0);
  });

  it("loadConfig accepts maxRepairAttempts: 5", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: 5,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.maxRepairAttempts).toBe(5);
  });

  it("loadConfig REJECTS float (does not silently fall back to default)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: 2.5,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/maxRepairAttempts/);
  });

  it("loadConfig REJECTS negative", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: -1,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/maxRepairAttempts/);
  });

  it("loadConfig REJECTS string", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: "2",
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/maxRepairAttempts/);
  });

  it("loadConfig REJECTS null", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxRepairAttempts: null,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/maxRepairAttempts/);
  });
});

describe("config — maxIncompleteRetries", () => {
  it("defaults to 2 and preserves an explicit zero", () => {
    expect(CONFIG_DEFAULTS.maxIncompleteRetries).toBe(2);
    expect(applyDefaults({}).maxIncompleteRetries).toBe(2);
    expect(applyDefaults({ maxIncompleteRetries: 0 }).maxIncompleteRetries).toBe(0);
  });

  it("loadConfig accepts a non-negative integer", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxIncompleteRetries: 4,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.maxIncompleteRetries).toBe(4);
  });

  it.each([
    ["a fractional value", 2.5],
    ["a negative value", -1],
    ["a string", "2"],
    ["null", null],
  ])("rejects %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxIncompleteRetries: value,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/maxIncompleteRetries/);
  });
});

describe("config — timeoutMs", () => {
  it("applyDefaults uses 300_000 when timeoutMs absent", async () => {
    const { applyDefaults, CONFIG_DEFAULTS } = await import("./config.js");
    expect(CONFIG_DEFAULTS.timeoutMs).toBe(300_000);
    const d = applyDefaults({});
    expect(d.timeoutMs).toBe(300_000);
  });

  it("loadConfig accepts configured timeoutMs including 0", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "openai-compat",
        model: "MiniMax-M3",
        timeoutMs: 0,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.timeoutMs).toBe(0);
  });

  it("loadConfig REJECTS negative timeoutMs", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "openai-compat",
        model: "x",
        timeoutMs: -1,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/timeoutMs/);
  });

  it("loadConfig REJECTS non-integer timeoutMs", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "openai-compat",
        model: "x",
        timeoutMs: 1.5,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/timeoutMs/);
  });
});

describe("config — stage-5 flow keys", () => {
  it("CONFIG_DEFAULTS carries the documented flow defaults", () => {
    expect(CONFIG_DEFAULTS.maxFlows).toBe(4);
    expect(CONFIG_DEFAULTS.flowMaxAnchors).toBe(25);
    expect(CONFIG_DEFAULTS.flowMaxOverlap).toBe(0.75);
    expect(CONFIG_DEFAULTS.flowMaxDiagramNodes).toBe(12);
    expect(CONFIG_DEFAULTS.flowMaxDiagramEdges).toBe(20);
  });

  it("applyDefaults fills the flow defaults and preserves explicit values", () => {
    const d = applyDefaults({});
    expect(d.maxFlows).toBe(4);
    expect(d.flowMaxAnchors).toBe(25);
    expect(d.flowMaxOverlap).toBe(0.75);
    expect(d.flowMaxDiagramNodes).toBe(12);
    expect(d.flowMaxDiagramEdges).toBe(20);
    // 0 disables flow synthesis and must survive applyDefaults.
    expect(applyDefaults({ maxFlows: 0 }).maxFlows).toBe(0);
    expect(applyDefaults({ flowMaxAnchors: 10 }).flowMaxAnchors).toBe(10);
    // 1 disables the overlap cap and must survive applyDefaults.
    expect(applyDefaults({ flowMaxOverlap: 1 }).flowMaxOverlap).toBe(1);
  });

  it("DEFAULT_FLOW_SIGNAL_PATTERNS carries the generic entry/persistence defaults", () => {
    expect(DEFAULT_FLOW_SIGNAL_PATTERNS).toEqual({
      entryPatterns: ["bin/**", "cmd/**", "**/cli.*", "**/main.*", "**/server.*", "**/app.*"],
      persistencePatterns: [
        "**/db.*",
        "**/database/**",
        "**/store/**",
        "**/state/**",
        "**/persistence/**",
        "**/repository/**",
      ],
      // Empty on purpose: no built-in package-name guessing.
      persistenceImportPatterns: [],
    });
  });

  it("loadConfig accepts valid flow values", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        maxFlows: 2,
        flowMaxAnchors: 10,
        flowMaxOverlap: 0.5,
        flowMaxDiagramNodes: 6,
        flowMaxDiagramEdges: 8,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.maxFlows).toBe(2);
    expect(cfg.flowMaxAnchors).toBe(10);
    expect(cfg.flowMaxOverlap).toBe(0.5);
    expect(cfg.flowMaxDiagramNodes).toBe(6);
    expect(cfg.flowMaxDiagramEdges).toBe(8);
  });

  it.each([
    ["maxFlows", -1],
    ["maxFlows", 1.5],
    ["maxFlows", "4"],
    ["flowMaxAnchors", 0],
    ["flowMaxOverlap", -0.1],
    ["flowMaxOverlap", 1.5],
    ["flowMaxOverlap", "0.5"],
    ["flowMaxDiagramNodes", 0],
    ["flowMaxDiagramEdges", -2],
    ["flowMaxDiagramEdges", 2.5],
  ])("loadConfig rejects invalid %s", async (key, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ provider: "anthropic", model: "claude-sonnet-5", [key]: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(new RegExp(`invalid ${key}`));
  });

  it("loads flowSignals pattern overrides (per-category replacement)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        flowSignals: {
          entryPatterns: ["src/bin/**"],
          persistencePatterns: [],
        },
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.flowSignals).toEqual({
      entryPatterns: ["src/bin/**"],
      persistencePatterns: [],
    });
  });

  it("loads flowSignals.persistenceImportPatterns (replaces, never merges)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        flowSignals: {
          persistenceImportPatterns: ["@acme/db", "!@acme/internal"],
        },
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    // Only the supplied category is set; the other two stay absent so the
    // detector applies their defaults (per-category replacement).
    expect(cfg.flowSignals).toEqual({
      persistenceImportPatterns: ["@acme/db", "!@acme/internal"],
    });
  });

  it.each([
    ["a non-object", 42],
    ["an array", ["bin/**"]],
    ["an unknown key", { outputPatterns: ["x"] }],
    ["a non-array category", { entryPatterns: "bin/**" }],
    ["a non-string item", { persistencePatterns: [1] }],
    ["a non-array import category", { persistenceImportPatterns: "@acme/db" }],
    ["a non-string import item", { persistenceImportPatterns: [42] }],
  ])("loadConfig rejects malformed flowSignals (%s)", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ flowSignals: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/flowSignals/);
  });
});

describe("config — outputTokenStrategy", () => {
  it("defaults to dynamic", () => {
    expect(CONFIG_DEFAULTS.outputTokenStrategy).toBe("dynamic");
    expect(applyDefaults({}).outputTokenStrategy).toBe("dynamic");
  });

  it("loadConfig accepts an explicit 'fixed' override", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        outputTokenStrategy: "fixed",
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.outputTokenStrategy).toBe("fixed");
  });

  it.each([
    ["an unknown string", "auto"],
    ["a number", 1],
    ["null", null],
  ])("rejects %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ outputTokenStrategy: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/outputTokenStrategy/);
  });
});

describe("config — stage4MaxOutputTokens ceiling", () => {
  it("accepts the unified 256..32768 range", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        stage4MaxOutputTokens: 16_384,
      }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.stage4MaxOutputTokens).toBe(16_384);
  });

  it("rejects a value above the new 32768 ceiling (previously unbounded)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ stage4MaxOutputTokens: 100_000 }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/stage4MaxOutputTokens/);
  });

  it("still rejects a value below 256", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ stage4MaxOutputTokens: 100 }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/stage4MaxOutputTokens/);
  });
});

describe("config — Etapa 2c risk-prioritization keys", () => {
  it("applyDefaults fills riskAnalysis=true and riskChurnCommits=500 when absent", () => {
    const cfg = applyDefaults({});
    expect(cfg.riskAnalysis).toBe(true);
    expect(cfg.riskChurnCommits).toBe(500);
  });

  it("applyDefaults does NOT overwrite explicit values", () => {
    const cfg = applyDefaults({ riskAnalysis: false, riskChurnCommits: 0 });
    expect(cfg.riskAnalysis).toBe(false);
    expect(cfg.riskChurnCommits).toBe(0);
  });

  it("loadConfig accepts riskAnalysis boolean and riskChurnCommits bounds", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ riskAnalysis: false, riskChurnCommits: 0 }),
      "utf8",
    );
    let cfg = await loadConfig(repoRoot);
    expect(cfg.riskAnalysis).toBe(false);
    expect(cfg.riskChurnCommits).toBe(0);

    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ riskAnalysis: true, riskChurnCommits: 10_000 }),
      "utf8",
    );
    cfg = await loadConfig(repoRoot);
    expect(cfg.riskAnalysis).toBe(true);
    expect(cfg.riskChurnCommits).toBe(10_000);
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects riskAnalysis as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ riskAnalysis: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/riskAnalysis/);
  });

  it.each([
    ["a float", 1.5],
    ["a string", "500"],
    ["a negative", -1],
    ["above the range", 10_001],
  ])("rejects riskChurnCommits as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ riskChurnCommits: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/riskChurnCommits/);
  });
});

describe("config — recovery tier surgicalRepair key", () => {
  it("applyDefaults fills surgicalRepair=true when absent", () => {
    const cfg = applyDefaults({});
    expect(cfg.surgicalRepair).toBe(true);
  });

  it("applyDefaults does NOT overwrite an explicit value", () => {
    const cfg = applyDefaults({ surgicalRepair: false });
    expect(cfg.surgicalRepair).toBe(false);
  });

  it("loadConfig accepts a surgicalRepair boolean", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ surgicalRepair: false }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.surgicalRepair).toBe(false);
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects surgicalRepair as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ surgicalRepair: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/surgicalRepair/);
  });
});

describe("config — D2 concernTopics key", () => {
  it("applyDefaults fills concernTopics=true when absent", () => {
    const cfg = applyDefaults({});
    expect(cfg.concernTopics).toBe(true);
  });

  it("applyDefaults does NOT overwrite an explicit value", () => {
    const cfg = applyDefaults({ concernTopics: false });
    expect(cfg.concernTopics).toBe(false);
  });

  it("loadConfig accepts a concernTopics boolean", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ concernTopics: false }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.concernTopics).toBe(false);
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects concernTopics as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ concernTopics: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/concernTopics/);
  });
});

describe("config — communityDetection key (roadmap item 9)", () => {
  it("applyDefaults fills communityDetection=true when absent", () => {
    const cfg = applyDefaults({});
    expect(cfg.communityDetection).toBe(true);
  });

  it("applyDefaults does NOT overwrite an explicit value", () => {
    const cfg = applyDefaults({ communityDetection: false });
    expect(cfg.communityDetection).toBe(false);
  });

  it("loadConfig accepts a communityDetection boolean", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ communityDetection: false }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.communityDetection).toBe(false);
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects communityDetection as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ communityDetection: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/communityDetection/);
  });
});

describe("config — recovery tier relaxedRound key", () => {
  it("applyDefaults fills relaxedRound=true when absent", () => {
    const cfg = applyDefaults({});
    expect(cfg.relaxedRound).toBe(true);
  });

  it("applyDefaults does NOT overwrite an explicit value", () => {
    const cfg = applyDefaults({ relaxedRound: false });
    expect(cfg.relaxedRound).toBe(false);
  });

  it("loadConfig accepts a relaxedRound boolean", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ relaxedRound: false }),
      "utf8",
    );
    const cfg = await loadConfig(repoRoot);
    expect(cfg.relaxedRound).toBe(false);
  });

  it.each([
    ["a string", "yes"],
    ["a number", 1],
    ["null", null],
  ])("rejects relaxedRound as %s", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ relaxedRound: value }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/relaxedRound/);
  });
});

// === Roadmap item 7 — batchConcurrency (stage-4 worker pool size) ===
describe("config — batchConcurrency", () => {
  it("CONFIG_DEFAULTS.batchConcurrency === 1 (sequential default)", () => {
    expect(CONFIG_DEFAULTS.batchConcurrency).toBe(1);
  });

  it("applyDefaults fills default 1 when config omits the field", () => {
    expect(applyDefaults({}).batchConcurrency).toBe(1);
    expect(applyDefaults({ provider: "anthropic", model: "x" }).batchConcurrency).toBe(1);
  });

  it("applyDefaults does NOT overwrite an explicit config value", () => {
    expect(applyDefaults({ batchConcurrency: 4 }).batchConcurrency).toBe(4);
    expect(applyDefaults({ batchConcurrency: 16 }).batchConcurrency).toBe(16);
  });

  it("loadConfig accepts valid integers 1 and 16 (bounds inclusive)", async () => {
    for (const value of [1, 8, 16]) {
      await nodeFs.writeFile(
        nodePath.join(repoRoot, ".livewiki/config.json"),
        JSON.stringify({
          provider: "anthropic",
          model: "claude-sonnet-5",
          batchConcurrency: value,
        }),
        "utf8",
      );
      const cfg = await loadConfig(repoRoot);
      expect(cfg.batchConcurrency).toBe(value);
    }
  });

  it.each([
    ["zero", 0],
    ["a float", 1.5],
    ["above the cap", 17],
    ["negative", -2],
    ["a string", "4"],
    ["null", null],
    ["a boolean", true],
  ])("loadConfig REJECTS %s (no silent fallback to the default)", async (_label, value) => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({
        provider: "anthropic",
        model: "claude-sonnet-5",
        batchConcurrency: value,
      }),
      "utf8",
    );
    await expect(loadConfig(repoRoot)).rejects.toThrow(/batchConcurrency/);
  });
});
