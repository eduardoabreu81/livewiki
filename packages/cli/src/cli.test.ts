/**
 * Smoke tests do CLI — travam o scaffold da Fase 0.
 *
 * A Fase 0 promete que TODOS os 9 comandos da SPEC estão registrados (stubs).
 * Se alguém remover um sem querer, este teste falha. O critério de aceite da
 * Fase 0 é `pnpm exec livewiki --help` funcionar — este teste valida a
 * estrutura por baixo, sem precisar executar o binário.
 */

import { describe, it, expect } from "vitest";
import { createProgram } from "./cli.js";

describe("CLI scaffold (Fase 0)", () => {
  it("nome do programa é 'livewiki'", () => {
    const program = createProgram();
    expect(program.name()).toBe("livewiki");
  });

  it("registra os 9 comandos da SPEC §'Comandos CLI'", () => {
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
    ]);
  });

  it("flags globais --json e --repo estão registradas", () => {
    const program = createProgram();
    const optNames = program.options.map((o) => o.long);
    expect(optNames).toContain("--json");
    expect(optNames).toContain("--repo");
  });

  it("--help lista todos os comandos", async () => {
    const program = createProgram();
    // commander escreve help em stdout via writeOut. Capturamos redirecionando
    // configureOutput temporariamente.
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
      // --help faz commander chamar outputHelp e sair com helpDisplayed — pode
      // lançar dependendo da versão. Capturamos a saída antes.
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
    ]) {
      expect(captured).toContain(name);
    }
  });

  it("resolveRepoRoot aceita absoluto, relativo e undefined", async () => {
    const { resolveRepoRoot } = await import("./cli.js");
    const cwd = process.cwd();
    expect(resolveRepoRoot(undefined)).toBe(cwd);
    expect(resolveRepoRoot(".")).toBe(cwd);
    expect(resolveRepoRoot("/tmp/abc")).toMatch(/[\\/]tmp[\\/]abc$/);
  });
});