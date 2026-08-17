/**
 * CLI smoke tests — lock down the Phase 0 + Phase 5 scaffold.
 *
 * Phase 0 promises that every primary SPEC command is registered.
 * Phase 5 step 4 added `pointer` (opt-in). Total: 10 commands.
 * If someone removes one by accident, this test fails. The acceptance
 * criterion is `pnpm exec livewiki --help` working — this test validates
 * the structure underneath, without needing to run the binary.
 */

import { describe, it, expect } from "vitest";
import { createProgram } from "./cli.js";

describe("CLI scaffold (Phase 0 + Phase 5 pointer)", () => {
  it("program name is 'livewiki'", () => {
    const program = createProgram();
    expect(program.name()).toBe("livewiki");
  });

  it("registers the 13 commands, including the versioned baseline lifecycle", () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual([
      "init",
      "index",
      "status",
      "update",
      "verify",
      "serve",
      "batch",
      "export",
      "view",
      "pointer",
      "install",
      "config",
      "baseline",
    ]);
  });

  it("global flags --json and --repo are registered", () => {
    const program = createProgram();
    const optNames = program.options.map((o) => o.long);
    expect(optNames).toContain("--json");
    expect(optNames).toContain("--repo");
  });

  it("--help lists all commands", async () => {
    const program = createProgram();
    // commander writes help to stdout via writeOut. We capture it by
    // temporarily redirecting configureOutput.
    let captured = "";
    const original = program.configureOutput();
    program.configureOutput({
      writeOut: (s) => {
        captured += s;
      },
      writeErr: () => {},
    });
    try {
      await program.parseAsync(["--help"], { from: "user" });
    } catch {
      // --help makes commander call outputHelp and exit with helpDisplayed —
      // it may throw depending on the version. We capture the output first.
    }
    program.configureOutput(original);
    for (const name of [
      "init",
      "index",
      "status",
      "update",
      "verify",
      "serve",
      "batch",
      "export",
      "view",
      "pointer",
      "install",
      "config",
      "baseline",
    ]) {
      expect(captured).toContain(name);
    }
  });

  it("resolveRepoRoot accepts absolute, relative and undefined", async () => {
    const { resolveRepoRoot } = await import("./cli.js");
    const cwd = process.cwd();
    expect(resolveRepoRoot(undefined)).toBe(cwd);
    expect(resolveRepoRoot(".")).toBe(cwd);
    expect(resolveRepoRoot("/tmp/abc")).toMatch(/[\\/]tmp[\\/]abc$/);
  });

  it("program version matches package.json (regression: published package printed --version 0.0.0)", async () => {
    const nodeFs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const raw = await nodeFs.readFile(
      nodePath.resolve(process.cwd(), "package.json"),
      "utf8",
    );
    const pkg = JSON.parse(raw) as { version: string };
    const program = createProgram();
    expect(program.version()).toBe(pkg.version);
    expect(program.version()).not.toBe("0.0.0");
  });
});
