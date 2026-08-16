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
import { registerInstall } from "./commands/install.js";
import {
  registerConfig,
  isConfigured,
  runConfigFlow,
  decideBareInvocation,
  BARE_CONFIG_HINT,
} from "./commands/config.js";
import { registerBaseline } from "./commands/baseline.js";
import { resolveLivewikiHome } from "@livewiki/core/credentials";
import { emit } from "./output.js";

/**
 * Version read from @livewiki/cli's package.json. Synchronous — the file is
 * static at build time and the caller (`run`) is already async.
 * Path: src/cli.ts → ../package.json. Built: dist/cli.js → same relative
 * path (dist/ and src/ sit at the same depth inside the package).
 */
function readVersion(): string {
  const here = new URL(import.meta.url);
  const pkgUrl = new URL("../package.json", here);
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
  registerInstall(program);
  registerConfig(program);
  registerBaseline(program);

  // Bare `livewiki` (no subcommand) is the onboarding entry point. An
  // unconfigured repo runs the config wizard interactively — or, without a
  // TTY (or under --json), prints a one-line hint instead of hanging. A
  // configured repo falls back to the usual help screen.
  program.action(async (_options, command: Command) => {
    const options = command.optsWithGlobals<{ json?: boolean; repo?: string }>();
    const json = Boolean(options.json);
    const repoRoot = resolveRepoRoot(options.repo);
    const configured = await isConfigured(repoRoot);
    const decision = decideBareInvocation(configured, Boolean(process.stdin.isTTY), json);

    if (decision === "help") {
      program.help();
      return;
    }
    if (decision === "hint") {
      if (json) {
        emit(true, { ok: false, configured: false, hint: BARE_CONFIG_HINT }, "");
      } else {
        process.stdout.write(BARE_CONFIG_HINT + "\n");
      }
      return;
    }
    process.stdout.write(
      "This repository isn't configured for LLM-backed documentation yet. Let's set that up.\n\n",
    );
    await runConfigFlow({
      json,
      repoRoot,
      home: resolveLivewikiHome(process.env),
      errorLabel: "",
    });
  });

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
