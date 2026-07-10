import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki export <target>` — export wiki to a repo-wiki format:
 * github-wiki, gitlab-wiki, generic (flattened md directory). --push optional.
 * SPEC §"CLI commands" / Phase 6.
 */
export function registerExport(program: Command): void {
  program
    .command("export <target>")
    .description(
      "export wiki to a repository-wiki format (github-wiki/gitlab-wiki/generic). --push publishes (Phase 6)",
    )
    .option("--push <remote>", "git remote to publish to")
    .action(makeStubAction({ name: "export", phase: 6, planned: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter" }));
}