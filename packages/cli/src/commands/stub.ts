/**
 * Helper para stubs de comandos da Fase 0.
 *
 * Cada comando registrado no cli.ts (init, index, status, ...) é um stub até
 * a fase correspondente da SPEC ser implementada. Este helper garante que
 * o stub:
 *   - aceita --json e --repo (já herdados do program pai)
 *   - emite saída estruturada (JSON ou human)
 *   - exit code 0 (comando executado — só não implementado)
 *
 * Quando a fase entrar, o caller substitui `stub("init", 3)` pela implementação
 * real, mantendo a mesma assinatura (cmd: Command) => Promise<void>.
 */

import type { Command } from "commander";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

export interface StubInfo {
  name: string;
  /** Fase da SPEC em que o comando será implementado (1-7). */
  phase: number;
  /** Frase curta do que o comando vai fazer quando implementado. */
  planned: string;
}

interface StubOptions {
  json?: boolean;
  repo?: string;
}

/**
 * Cria um action handler para um stub de comando.
 *
 * Commander 12 invoca actions com `(arg1, ..., options, command)` — ou seja,
 * para um comando sem args posicionais, a assinatura é `(options, command)`.
 * Usamos `optsWithGlobals()` no command para ler tanto opções locais quanto
 * globais (--json, --repo).
 */
export function makeStubAction(info: StubInfo) {
  return async (
    _options: Record<string, unknown>,
    command: Command,
  ): Promise<void> => {
    // optsWithGlobals() herda options do program pai (--json, --repo).
    const opts = command.optsWithGlobals<StubOptions>();
    const json = Boolean(opts.json);
    const repoRoot = resolveRepoRoot(opts.repo);
    emit(
      json,
      {
        ok: false,
        stub: info.name,
        phase: info.phase,
        repoRoot,
        message: `stub da Fase 0 — implementação prevista para Fase ${info.phase}`,
        planned: info.planned,
      },
      `livewiki ${info.name}: stub (Fase ${info.phase} da SPEC). Implementação prevista: ${info.planned}`,
    );
  };
}