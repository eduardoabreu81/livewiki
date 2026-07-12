#!/usr/bin/env node
/**
 * CLI entry point. When packaged as `livewiki` via `bin`, this is the
 * file that gets executed. Also what `npx .` resolves from the package root.
 *
 * All the logic is in `cli.ts` — this file only:
 *   1. parses argv via commander
 *   2. runs the chosen subcommand
 *   3. returns a consistent exit code
 */
import { run } from "./cli.js";

run(process.argv).catch((err: unknown) => {
  // commander handles usage errors (--help on missing subcommand, etc).
  // Any other error here is a bug or a runtime error not handled by the subcommand.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`livewiki: fatal error — ${message}\n`);
  // Let Node drain pending stderr I/O before exiting.
  process.exitCode = 1;
});
