/**
 * init fail-closed on malformed .livewiki/config.json (T0 review).
 * Must never silently apply maxModuleFiles/maxModuleSymbols defaults.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runInit } from "./init.js";

describe("init config fail-closed", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-init-cfg-"),
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/hello.ts"),
      "export function hello() { return 1; }\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("runInit({ plan: true }) rejects malformed config.json (no silent 12/80)", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      "{ this is not valid json [[[",
      "utf8",
    );

    await expect(
      runInit({ repoRoot, plan: true, quiet: true }),
    ).rejects.toThrow(/Failed to parse|\.livewiki\/config\.json|JSON/i);
  });

  it("runInit({ plan: true }) works with missing config (empty → applyDefaults)", async () => {
    // Missing config is OK; only malformed must fail closed.
    const result = await runInit({ repoRoot, plan: true, quiet: true });
    expect(result.plan).toBeDefined();
    expect(result.plan!.modules.length).toBeGreaterThan(0);
    expect(result.plan!.totalFiles).toBeGreaterThan(0);
  });
});
