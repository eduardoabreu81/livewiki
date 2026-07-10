import { describe, it, expect } from "vitest";
import {
  buildStage4Prompt,
  buildStage2RefinePrompt,
  buildQuickstartPrompt,
  buildOverviewPrompt,
  buildRepairPrompt,
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

// === U — prompt hardening (Phase-5 plan) ===
// Baseline finding 1: the system prompt contained `<!-- lw:anchors key1 key2 -->`
// as a copyable example. The LLM copied that verbatim into the page → phantom
// anchor. Here we guarantee that NO stage-4 or repair system prompt ships a
// copyable literal anchor.
describe("prompts U — hardening (no copyable fake anchors)", () => {
  it("stage 4 system prompt does NOT contain the string 'key1' or 'key2' as placeholders", () => {
    const r = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code");
    expect(r.system).not.toMatch(/\bkey1\b/);
    expect(r.system).not.toMatch(/\bkey2\b/);
  });

  it("stage 4 system prompt does NOT contain a literal lw:anchors marker with placeholder keys", () => {
    const r = buildStage4Prompt(sampleModule, ["src/auth.ts#login"], "sym", "code");
    // If it appears, it must be prose explaining the marker — NEVER a
    // copyable string.
    expect(r.system).not.toMatch(/lw:anchors\s+[a-z]+\s+[a-z]+/);
  });

  it("repair prompt does NOT contain 'key1' or 'key2' as placeholders", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["src/auth.ts#login"],
      "sym",
      "code",
      "prior candidate content",
      [{ code: "wrong_owner", message: "owner wrong", location: "frontmatter" }],
      "en",
    );
    expect(r.system).not.toMatch(/\bkey1\b/);
    expect(r.system).not.toMatch(/\bkey2\b/);
    expect(r.user).not.toMatch(/\bkey1\b/);
    expect(r.user).not.toMatch(/\bkey2\b/);
  });

  it("repair prompt receives the closed key list verbatim and the structured errors", () => {
    const closed = ["src/auth.ts#login", "src/auth.ts#logout"];
    const errors: import("./prompts.js").ArtifactValidationError[] = [
      { code: "wrong_owner", message: "owner must be generated", location: "frontmatter" },
      { code: "anchor_outside_closed_list", message: "fake key", location: "frontmatter", offending: "fake-key" },
    ];
    const r = buildRepairPrompt(sampleModule, closed, "sym", "code", "prior text", errors, "en");
    for (const k of closed) {
      expect(r.user).toContain(k);
    }
    expect(r.user).toContain("owner must be generated");
    expect(r.user).toContain("fake-key");
  });

  it("repair prompt receives the prior candidate (truncated) and instructs no reasoning prose", () => {
    const r = buildRepairPrompt(
      sampleModule,
      ["k"],
      "sym",
      "code",
      "PRIOR CANDIDATE TEXT",
      [{ code: "empty_body", message: "no body", location: "body" }],
      "en",
    );
    expect(r.user).toContain("PRIOR CANDIDATE TEXT");
    expect(r.system).toMatch(/Do NOT wrap your output in code fences/);
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