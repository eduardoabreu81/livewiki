/**
 * Unit tests for stage-4 module context builders (fair source truncation).
 * Not a benchmark proof — product regression only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { buildFairTruncatedSource } from "./batch.js";

describe("buildFairTruncatedSource", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-fair-src-"));
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it("includes a slice of every path when sequential full content exceeds budget", async () => {
    // Early file is huge; late file would be starved by first-fit truncation.
    const big = "A".repeat(40_000);
    const late = "export function lateSym() { return 1; }\n";
    await nodeFs.writeFile(nodePath.join(root, "early.ts"), big, "utf8");
    await nodeFs.writeFile(nodePath.join(root, "late.ts"), late, "utf8");

    const out = await buildFairTruncatedSource(root, ["early.ts", "late.ts"], 8_000);

    expect(out).toContain("// === early.ts ===");
    expect(out).toContain("// === late.ts ===");
    // Late file body must appear (not only the header).
    expect(out).toContain("lateSym");
    // Early file is truncated, not fully embedded.
    expect(out).toContain("// ... (truncated by budget)");
    expect(out.length).toBeLessThanOrEqual(8_000 + 80);
  });

  it("returns full content when everything fits the budget", async () => {
    await nodeFs.writeFile(nodePath.join(root, "a.ts"), "export const a = 1;\n", "utf8");
    await nodeFs.writeFile(nodePath.join(root, "b.ts"), "export const b = 2;\n", "utf8");
    const out = await buildFairTruncatedSource(root, ["a.ts", "b.ts"], 60_000);
    expect(out).toContain("export const a = 1;");
    expect(out).toContain("export const b = 2;");
    expect(out).not.toContain("// ... (truncated by budget)");
  });
});
