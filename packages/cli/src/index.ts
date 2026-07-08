#!/usr/bin/env node
/**
 * Entry point do CLI. Quando empacotado como `livewiki` via `bin`, este é o
 * arquivo executado. Também é o que `npx .` resolve a partir do package root.
 *
 * Toda a lógica está em `cli.ts` — este arquivo só:
 *   1. faz o parse dos argv via commander
 *   2. executa o subcomando escolhido
 *   3. devolve exit code consistente
 */
import { run } from "./cli.js";

run(process.argv).catch((err: unknown) => {
  // commander trata erros de uso (--help em subcomando inexistente, etc).
  // Qualquer outro erro aqui é bug ou erro de runtime não tratado pelo subcomando.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`livewiki: erro fatal — ${message}\n`);
  process.exit(1);
});