import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki view` — generates a self-contained static site in `.livewiki/site/`
 * and opens it in the browser. --template <agent|docs>, --out <dir> to publish.
 * SPEC §"CLI commands" / Phase 7.
 */
export function registerView(program: Command): void {
  program
    .command("view")
    .description(
      "generate a self-contained static site (HTML+CSS+JS) with client-side search and Mermaid (Phase 7)",
    )
    .option("--template <name>", "visual template: 'agent' (dense, technical) or 'docs' (clean)", "agent")
    .option("--out <dir>", "output directory to publish (default: .livewiki/site/)")
    .action(makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" }));
}