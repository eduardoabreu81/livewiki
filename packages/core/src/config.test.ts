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