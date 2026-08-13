import { describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";

describe("agent bootstrap dependency boundary", () => {
  it("reuses the prompt contract without importing an LLM or external executor", async () => {
    const source = await nodeFs.readFile(new URL("./agent-bootstrap.ts", import.meta.url), "utf8");

    expect(source).toContain("buildStage4Prompt(");
    expect(source).not.toContain("createLlmClient");
    expect(source).not.toMatch(/from\s+["']\.\/batch\.js["']/);
    expect(source).not.toMatch(/from\s+["']node:child_process["']/);
    expect(source).not.toMatch(/\bspawn(?:Sync)?\s*\(/);
    expect(source).not.toMatch(/\bexecFile(?:Sync)?\s*\(/);
  });
});
