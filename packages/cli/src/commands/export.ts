import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki export <target>` — exportar wiki para formato de wiki de repo:
 * github-wiki, gitlab-wiki, generic (diretório de md achatado). --push opcional.
 * SPEC §"Comandos CLI" / Fase 6.
 */
export function registerExport(program: Command): void {
  program
    .command("export <target>")
    .description(
      "exportar wiki para formato de wiki de repositório (github-wiki/gitlab-wiki/generic). --push publica (Fase 6)",
    )
    .option("--push <remote>", "remote git para publicar")
    .action(makeStubAction({ name: "export", phase: 6, planned: "transformação de mão única: achata namespace, reescreve links, remove frontmatter de âncoras" }));
}