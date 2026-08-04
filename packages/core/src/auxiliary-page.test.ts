import { describe, it, expect } from "vitest";
import { generateAuxiliaryModulePage, type AuxiliarySymbolRow } from "./auxiliary-page.js";
import { normalizeStage4Artifact, validateStage4Artifact } from "./artifact.js";
import type { Module } from "./modules.js";

function module(overrides: Partial<Module> = {}): Module {
  return {
    id: "test-fixtures",
    paths: ["test/fixtures/example/value.ts"],
    symbolCount: 1,
    ...overrides,
  };
}

function assertValid(artifact: string, closedKeyList: string[], moduleId: string, moduleRole: "test" | "fixture" | "tooling" | "docs") {
  const normalized = normalizeStage4Artifact(artifact);
  expect(normalized.ok).toBe(true);
  const result = validateStage4Artifact(normalized.content, closedKeyList, {
    moduleId,
    moduleRole,
    pageKind: "module",
  });
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
}

describe("generateAuxiliaryModulePage", () => {
  it("produces a page that passes the full auxiliary artifact contract", () => {
    const symbols: AuxiliarySymbolRow[] = [
      { key: "test/fixtures/example/value.ts#fixtureValue", name: "fixtureValue", kind: "function", signature: "function fixtureValue(): number" },
      { key: "test/fixtures/example/value.ts#OTHER", name: "OTHER", kind: "const", signature: null },
    ];
    const closedKeyList = symbols.map((s) => s.key).sort();
    const artifact = generateAuxiliaryModulePage({
      module: module(),
      role: "fixture",
      symbols,
      closedKeyList,
    });
    assertValid(artifact, closedKeyList, "test-fixtures", "fixture");
  });

  it("handles zero symbols (empty closed key list)", () => {
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "empty-docs", paths: ["docs/readme-only"] }),
      role: "docs",
      symbols: [],
      closedKeyList: [],
    });
    assertValid(artifact, [], "empty-docs", "docs");
  });

  it("disambiguates H3 headings when two symbols share a name across files", () => {
    const symbols: AuxiliarySymbolRow[] = [
      { key: "tools/a.ts#run", name: "run", kind: "function", signature: "function run(): void" },
      { key: "tools/b.ts#run", name: "run", kind: "function", signature: "function run(): void" },
    ];
    const closedKeyList = symbols.map((s) => s.key).sort();
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "tooling-mod", paths: ["tools/a.ts", "tools/b.ts"] }),
      role: "tooling",
      symbols,
      closedKeyList,
    });
    expect(artifact).toContain("### run (a.ts)");
    expect(artifact).toContain("### run (b.ts)");
    assertValid(artifact, closedKeyList, "tooling-mod", "tooling");
  });

  it("strips backticks from signatures so the reference paragraph never breaks code-span balance", () => {
    const symbols: AuxiliarySymbolRow[] = [
      { key: "tools/c.ts#weird", name: "weird", kind: "function", signature: "function weird(x: `Tpl${string}`): void" },
    ];
    const closedKeyList = symbols.map((s) => s.key);
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "tooling-weird", paths: ["tools/c.ts"] }),
      role: "tooling",
      symbols,
      closedKeyList,
    });
    assertValid(artifact, closedKeyList, "tooling-weird", "tooling");
  });

  it("truncates an oversized reference paragraph to the 500-char single-paragraph limit", () => {
    const longSignature = "function longOne(" + "a: string, ".repeat(80) + "): void";
    const symbols: AuxiliarySymbolRow[] = [
      { key: "tools/d.ts#longOne", name: "longOne", kind: "function", signature: longSignature },
    ];
    const closedKeyList = symbols.map((s) => s.key);
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "tooling-long", paths: ["tools/d.ts"] }),
      role: "tooling",
      symbols,
      closedKeyList,
    });
    assertValid(artifact, closedKeyList, "tooling-long", "tooling");
  });

  it("falls back to a humanized title when no displayTitle was accepted", () => {
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "core-src-fixtures" }),
      role: "fixture",
      symbols: [],
      closedKeyList: [],
    });
    expect(artifact).toContain("# Core Src Fixtures");
  });

  it("uses the stage-2 displayTitle when present", () => {
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "core-src-fixtures", displayTitle: "Fixture helpers" }),
      role: "fixture",
      symbols: [],
      closedKeyList: [],
    });
    expect(artifact).toContain("# Fixture helpers");
    expect(artifact).toContain("title: Fixture helpers");
  });
});

describe("generateAuxiliaryModulePage — #24 test role", () => {
  it("renders the test role with its own label and passes the full contract", () => {
    const symbols: AuxiliarySymbolRow[] = [
      { key: "src/auth/login.test.ts#parseFlowPrompt", name: "parseFlowPrompt", kind: "function", signature: "function parseFlowPrompt(u: string): Ctx" },
      { key: "src/auth/login.test.ts#makeValidPage", name: "makeValidPage", kind: "function", signature: null },
    ];
    const closedKeyList = symbols.map((s) => s.key).sort();
    const artifact = generateAuxiliaryModulePage({
      module: module({ id: "auth-tests", paths: ["src/auth/login.test.ts"] }),
      role: "test",
      symbols,
      closedKeyList,
    });
    expect(artifact).toContain("automated tests");
    assertValid(artifact, closedKeyList, "auth-tests", "test");
  });
});
