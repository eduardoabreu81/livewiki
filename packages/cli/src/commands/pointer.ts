import type { Command } from "commander";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import {
  insertPointer,
  removePointer,
  readPointerStatus,
  POINTER_FILES,
  buildPointerBlock,
  type PointerFile,
} from "@livewiki/core/pointer";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface PointerOptions {
  json?: boolean;
  repo?: string;
  /** `--write-pointer`: opt-in explícito — pula confirmação interativa. */
  writePointer?: boolean;
  /** `--remove`: remove o bloco em vez de inserir. */
  remove?: boolean;
  /** `--file <name>`: força AGENTS.md ou CLAUDE.md (default: auto). */
  file?: string;
  /** `--yes`: pula confirmação interativa (alias do --write-pointer). */
  yes?: boolean;
  /**
   * `--block <texto>`: conteúdo customizado do bloco. Default: buildPointerBlock().
   * Útil pra projetos com instruções específicas no pointer.
   */
  block?: string;
}

/**
 * `livewiki pointer` — opt-in pointer in AGENTS.md / CLAUDE.md (Phase 5).
 *
 * SPEC §"Inviolable rules" #2:
 *   "Pointer in AGENTS.md/CLAUDE.md: only with an explicit flag
 *    (`--write-pointer`) or interactive confirmation. Never automatic."
 *
 * Behavior:
 *   - no flags: show current status (read-only)
 *   - --write-pointer: writes the block (explicit opt-in, no prompt)
 *   - no flag but TTY detected: interactive y/N prompt
 *   - --remove: removes the block
 *
 * **NEVER automatic** — no flag AND no TTY (e.g. agent via subprocess without
 * flag) → instructs the user to use --write-pointer. No silent writes.
 *
 * Output:
 *   - --json: structured status (parseable by agent)
 *   - human: clear instructions + block diff
 */
export function registerPointer(program: Command): void {
  program
    .command("pointer")
    .description(
      "manage the livewiki pointer in AGENTS.md/CLAUDE.md (opt-in, Phase 5). " +
        "Without flags shows status; --write-pointer writes; --remove removes. " +
        "Inviolable rule #2: never automatic — always requires flag or confirmation.",
    )
    .option(
      "--write-pointer",
      "write the block (explicit opt-in — skips confirmation)",
    )
    .option("--remove", "remove the block from the target file")
    .option(
      "--file <name>",
      `target file: AGENTS.md or CLAUDE.md (default: auto-detect). Values: ${POINTER_FILES.join(", ")}`,
    )
    .option(
      "--yes",
      "alias for --write-pointer — skips interactive confirmation",
    )
    .option(
      "--block <text>",
      "custom block content (default: buildPointerBlock() — 1 paragraph)",
    )
    .action(async (_options: PointerOptions, command: Command) => {
      const opts = command.optsWithGlobals<PointerOptions>();
      const json = Boolean(opts.json);
      const repoRoot = nodePath.resolve(process.cwd(), resolveRepoRoot(opts.repo));

      // Validate --file (if passed)
      let fileOpt: PointerFile | undefined;
      if (opts.file) {
        if (!POINTER_FILES.includes(opts.file as PointerFile)) {
          process.stderr.write(
            `livewiki pointer: --file must be one of ${POINTER_FILES.join(", ")} (received: ${opts.file})\n`,
          );
          process.exitCode = 1;
          return;
        }
        fileOpt = opts.file as PointerFile;
      }

      try {
        // Mode: --remove
        if (opts.remove) {
          // --remove without explicit flag AND non-TTY: ask for confirmation
          // (removal is destructive — more caution)
          if (!opts.writePointer && !opts.yes && process.stdin.isTTY) {
            const confirmed = await promptYesNo(
              `livewiki pointer: REMOVE the block from ${fileOpt ?? "AGENTS.md/CLAUDE.md"}? [y/N] `,
            );
            if (!confirmed) {
              emit(json, { ok: false, cancelled: true }, "cancelled");
              return;
            }
          } else if (!opts.writePointer && !opts.yes) {
            // No TTY and no flag: fail closed (rule #2: never automatic)
            process.stderr.write(
              "livewiki pointer --remove: requires --write-pointer (or --yes) in non-interactive mode.\n",
            );
            process.exitCode = 1;
            return;
          }
          const result = await removePointer(repoRoot, {
            ...(fileOpt ? { file: fileOpt } : {}),
          });
          emit(
            json,
            { ok: true, ...result, operation: "remove" },
            formatPointerResult(result, "removed"),
          );
          return;
        }

        // Mode: --write-pointer (or --yes)
        const wantsWrite = Boolean(opts.writePointer || opts.yes);

        if (!wantsWrite && process.stdin.isTTY) {
          // TTY: interactive prompt
          const status = await readPointerStatus(repoRoot, {
            ...(fileOpt ? { file: fileOpt } : {}),
          });
          if (status.present) {
            emit(
              json,
              { ok: true, present: true, file: status.file, inner: status.inner },
              formatStatusHuman(status),
            );
            return;
          }
          const confirmed = await promptYesNo(
            `livewiki pointer: ADD block to ${fileOpt ?? "AGENTS.md/CLAUDE.md"}?\n\n` +
              `Block to be added:\n\n${buildPointerBlock()}\n\n[y/N] `,
          );
          if (!confirmed) {
            emit(json, { ok: false, cancelled: true }, "cancelled");
            return;
          }
        } else if (!wantsWrite) {
          // No TTY, no flag: fail closed
          process.stderr.write(
            "livewiki pointer: requires --write-pointer (or --yes) in non-interactive mode.\n" +
              "Without explicit confirmation, livewiki NEVER writes outside livewiki/ — except AGENTS.md/CLAUDE.md with conscious opt-in.\n",
          );
          process.exitCode = 1;
          return;
        }

        // Execute write
        const block = opts.block;
        const result = await insertPointer(repoRoot, {
          ...(fileOpt ? { file: fileOpt } : {}),
          ...(block !== undefined ? { block } : {}),
        });
        emit(
          json,
          { ok: true, ...result, operation: "write" },
          formatPointerResult(result, "wrote"),
        );
      } catch (err) {
        process.stderr.write(`livewiki pointer: error — ${(err as Error).message}\n`);
        process.exitCode = 1;
        return;
      }
    });
}

async function promptYesNo(question: string): Promise<boolean> {
  process.stdout.write(question);
  // Reads 1 line from stdin
  return new Promise((resolve) => {
    let input = "";
    const onData = (chunk: Buffer | string) => {
      input += chunk.toString();
      if (input.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.pause();
        const answer = input.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    const onEnd = () => {
      process.stdin.off("data", onData);
      const answer = input.trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string {
  const verbPast =
    verb === "wrote"
      ? result.action === "inserted"
        ? "wrote"
        : result.action === "replaced"
          ? "updated"
          : "unchanged"
      : "removed";
  const lines: string[] = [];
  lines.push(`livewiki pointer: ${verbPast} ${result.file}`);
  if (result.bytesWritten !== 0) {
    lines.push(`  (${result.bytesWritten >= 0 ? "+" : ""}${result.bytesWritten} bytes)`);
  }
  return lines.join("\n");
}

function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string {
  if (!status.present) {
    return "livewiki pointer: not present (run with --write-pointer to add)";
  }
  return `livewiki pointer: present in ${status.file}\n  ---\n${status.inner}\n  ---`;
}

// Re-export internal for tests — not exposed to userspace
export const _internal = { nodeFs };