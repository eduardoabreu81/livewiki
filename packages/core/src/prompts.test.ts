import { describe, it, expect } from "vitest";
import {
  buildStage4Prompt,
  buildStage2RefinePrompt,
  buildQuickstartPrompt,
  buildOverviewPrompt,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_BUDGET,
} from "./prompts.js";
import type { Module } from "./modules.js";

const sampleModule: Module = {
  id: "auth",
  paths: ["src/auth/login.ts", "src/auth/session.ts"],
  symbolCount: 5,
};

describe("prompts — todos em inglês (templates)", () => {
  it("stage 4 system prompt é em inglês (não muda com language)", () => {
    const en = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "en");
    const pt = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code", "pt-BR");
    // System prompt é o mesmo — language aparece como instrução mas texto base é inglês
    expect(en.system).toBe(pt.system);
    expect(en.system).toMatch(/technical documentation generator/);
  });

  it("language aparece no user prompt como instrução explícita", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code", "es");
    expect(r.user).toMatch(/es/);
  });

  it("language default é 'en'", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code");
    expect(r.user).toMatch(/en/);
  });

  it("lista fechada de chaves canônicas aparece verbatim no user prompt", () => {
    const closedKeys = ["src/auth.ts#login", "src/auth.ts#session", "src/auth.ts#logout"];
    const r = buildStage4Prompt(sampleModule, closedKeys, "sym", "code");
    for (const k of closedKeys) {
      expect(r.user).toContain(k);
    }
  });

  it("regra 'NEVER invent' presente no system prompt", () => {
    const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code");
    expect(r.system).toMatch(/NEVER invent/);
  });
});

describe("prompts — stage 2 refine", () => {
  it("output JSON only (sem markdown fence)", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/JSON only/);
    expect(r.system).toMatch(/No markdown fences/);
  });

  it("schema documentado no system prompt", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/"id"/);
    expect(r.system).toMatch(/"paths"/);
  });

  it("regra 'every original path appears in EXACTLY one module'", () => {
    const r = buildStage2RefinePrompt([sampleModule]);
    expect(r.system).toMatch(/EXACTLY one module/);
  });

  it("lista heurística de módulos aparece no user prompt", () => {
    const mods: Module[] = [
      { id: "auth", paths: ["src/auth/a.ts"], symbolCount: 3 },
      { id: "utils", paths: ["src/utils/x.ts"], symbolCount: 1 },
    ];
    const r = buildStage2RefinePrompt(mods);
    expect(r.user).toContain("auth");
    expect(r.user).toContain("utils");
  });
});

describe("prompts — quickstart + overview", () => {
  it("quickstart limita tamanho (max 200 lines)", () => {
    const r = buildQuickstartPrompt([sampleModule], "syms");
    expect(r.system).toMatch(/200 lines/);
  });

  it("quickstart NÃO pede frontmatter (é entry point, não code doc)", () => {
    const r = buildQuickstartPrompt([sampleModule], "syms");
    expect(r.system).toMatch(/NO frontmatter/);
  });

  it("overview pede frontmatter owner: generated", () => {
    const r = buildOverviewPrompt([sampleModule], "summary");
    expect(r.system).toMatch(/owner: generated/);
  });

  it("overview tem language instruction explícita", () => {
    const r = buildOverviewPrompt([sampleModule], "summary", "pt-BR");
    expect(r.user).toMatch(/pt-BR/);
  });
});

describe("prompts — constants", () => {
  it("tem budgets default razoáveis", () => {
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_OUTPUT_TOKEN_BUDGET).toBeGreaterThan(0);
    expect(DEFAULT_CONTEXT_TOKEN_BUDGET).toBeGreaterThan(DEFAULT_OUTPUT_TOKEN_BUDGET);
  });
});

describe("prompts — cobertura language", () => {
  it("aceita language em vários formatos BCP-47", () => {
    for (const lang of ["en", "pt-BR", "es", "fr", "ja", "zh-CN"]) {
      const r = buildStage4Prompt(sampleModule, ["k"], "sym", "code", lang);
      expect(r.user).toContain(lang);
    }
  });
});