import { Command } from "commander";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import { registerInit } from "./commands/init.js";
import { registerIndex } from "./commands/index-cmd.js";
import { registerStatus } from "./commands/status.js";
import { registerUpdate } from "./commands/update.js";
import { registerVerify } from "./commands/verify.js";
import { registerServe } from "./commands/serve.js";
import { registerBatch } from "./commands/batch.js";
import { registerExport } from "./commands/export.js";
import { registerView } from "./commands/view.js";
import { registerPointer } from "./commands/pointer.js";

/**
 * Version read from @livewiki/cli's package.json. Synchronous — the file is
 * static at build time and the caller (`run`) is already async.
 * Path: src/cli.ts → ../../package.json. Built: dist/cli.js → same path.
 */
function readVersion(): string {
  const here = new URL(import.meta.url);
  const pkgUrl = new URL("../../package.json", here);
  try {
    const raw = nodeFs.readFileSync(pkgUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("livewiki")
    .description(
      "Living repository documentation, anchored to code and verifiable. " +
        "See VISION.md and SPEC.md for what each command does and what phase it belongs to.",
    )
    .version(readVersion());

  // ── Global flags ────────────────────────────────────────────────────────
  // --json: parseable output (all commands) — SPEC rule.
  // --repo: target repo directory (default: cwd).
  program
    .option("--json", "emit JSON output (parseable by agents)")
    .option("--repo <path>", "path to the target repo", ".");

  // ── Subcommands (Phase 0 stubs; implemented in later phases) ───────────
  // Spec §"CLI commands" lists the full surface. All registered here from the
  // scaffold so `--help` shows the complete picture.
  registerInit(program);
  registerIndex(program);
  registerStatus(program);
  registerUpdate(program);
  registerVerify(program);
  registerServe(program);
  registerBatch(program);
  registerExport(program);
  registerView(program);
  registerPointer(program);

  return program;
}

export async function run(argv: readonly string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv as string[]);
}

/**
 * Resolve repoRoot from --repo (relative to cwd). Used by commands to
 * construct the CommandContext.
 */
export function resolveRepoRoot(repoOpt: string | undefined): string {
  return nodePath.resolve(process.cwd(), repoOpt ?? ".");
}