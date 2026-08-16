import type { Command } from "commander";
import {
  acceptBaseline,
  bootstrapBaseline,
  migrateBaselineKey,
  relocateBaselineEntry,
  removeBaselineEntry,
} from "@livewiki/core/baseline-operations";
import { run as runStatus } from "@livewiki/core/status";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface GlobalOptions {
  json?: boolean;
  repo?: string;
}

interface AcceptOptions extends GlobalOptions {
  page: string;
  symbol?: string[];
  all?: boolean;
}

interface MoveOptions extends GlobalOptions {
  page: string;
  from: string;
  to: string;
}

interface RemoveOptions extends GlobalOptions {
  page: string;
  symbol: string;
}

interface RelocateOptions extends GlobalOptions {
  fromPage: string;
  toPage: string;
  symbol: string;
}

export function registerBaseline(program: Command): void {
  const baseline = program
    .command("baseline")
    .description("bootstrap, review, and explicitly advance versioned documentation evidence");

  baseline
    .command("status")
    .description("show repository-portable baseline health")
    .action(async (_options: GlobalOptions, command: Command) => {
      const opts = command.optsWithGlobals<GlobalOptions>();
      await handle("status", Boolean(opts.json), async () => {
        const report = await runStatus(resolveRepoRoot(opts.repo));
        const result = {
          state: report.debt.baseline,
          issues: report.debt.baselineIssues ?? [],
          repository: report.debt.repository ?? null,
        };
        return { result, human: formatStatus(result) };
      });
    });

  baseline
    .command("bootstrap")
    .description("create inferred baseline evidence once from Git history")
    .action(async (_options: GlobalOptions, command: Command) => {
      const opts = command.optsWithGlobals<GlobalOptions>();
      await handle("bootstrap", Boolean(opts.json), async () => {
        const result = await bootstrapBaseline(resolveRepoRoot(opts.repo));
        const human =
          `livewiki baseline bootstrap: ${result.entries} inferred, ` +
          `${result.unbaselined.length} unbaselined\n` +
          "  Review with `livewiki baseline status`, then accept page symbols explicitly.";
        return { result, human };
      });
    });

  baseline
    .command("accept")
    .description("accept the current code version for selected anchors")
    .requiredOption("--page <path>", "wiki page path under livewiki/")
    .option("--symbol <key...>", "one or more exact symbol keys")
    .option("--all", "accept every anchored symbol on the named page")
    .action(async (_options: AcceptOptions, command: Command) => {
      const opts = command.optsWithGlobals<AcceptOptions>();
      await handle("accept", Boolean(opts.json), async () => {
        const result = await acceptBaseline(resolveRepoRoot(opts.repo), {
          page: opts.page,
          ...(opts.symbol ? { symbols: opts.symbol } : {}),
          all: Boolean(opts.all),
        });
        return {
          result,
          human:
            `livewiki baseline accept: ${result.accepted.length} accepted on ${result.page}` +
            (result.written ? "" : " (unchanged)"),
        };
      });
    });

  baseline
    .command("move")
    .description("explicitly migrate one anchored symbol identity")
    .requiredOption("--page <path>", "wiki page path under livewiki/")
    .requiredOption("--from <key>", "old exact symbol key")
    .requiredOption("--to <key>", "new exact symbol key")
    .action(async (_options: MoveOptions, command: Command) => {
      const opts = command.optsWithGlobals<MoveOptions>();
      await handle("move", Boolean(opts.json), async () => {
        const result = await migrateBaselineKey(resolveRepoRoot(opts.repo), {
          page: opts.page,
          from: opts.from,
          to: opts.to,
        });
        return {
          result,
          human: `livewiki baseline move: ${result.from} -> ${result.to}`,
        };
      });
    });

  baseline
    .command("remove")
    .description("retire one baseline entry after removing its page anchor")
    .requiredOption("--page <path>", "former wiki page path under livewiki/")
    .requiredOption("--symbol <key>", "exact symbol key to retire")
    .action(async (_options: RemoveOptions, command: Command) => {
      const opts = command.optsWithGlobals<RemoveOptions>();
      await handle("remove", Boolean(opts.json), async () => {
        const result = await removeBaselineEntry(resolveRepoRoot(opts.repo), {
          page: opts.page,
          symbol: opts.symbol,
        });
        return {
          result,
          human: `livewiki baseline remove: ${result.symbol} from ${result.page}`,
        };
      });
    });

  baseline
    .command("relocate")
    .description("move one clean baseline entry between wiki pages")
    .requiredOption("--from-page <path>", "former wiki page path under livewiki/")
    .requiredOption("--to-page <path>", "new wiki page path under livewiki/")
    .requiredOption("--symbol <key>", "exact symbol key to relocate")
    .action(async (_options: RelocateOptions, command: Command) => {
      const opts = command.optsWithGlobals<RelocateOptions>();
      await handle("relocate", Boolean(opts.json), async () => {
        const result = await relocateBaselineEntry(resolveRepoRoot(opts.repo), {
          fromPage: opts.fromPage,
          toPage: opts.toPage,
          symbol: opts.symbol,
        });
        return {
          result,
          human:
            `livewiki baseline relocate: ${result.symbol} ` +
            `${result.fromPage} -> ${result.toPage}`,
        };
      });
    });
}

async function handle<T>(
  operation: string,
  json: boolean,
  work: () => Promise<{ result: T; human: string }>,
): Promise<void> {
  try {
    const { result, human } = await work();
    emit(json, { ok: true, ...result }, human);
  } catch (error) {
    const message = (error as Error).message;
    if (json) emit(true, { ok: false, error: message }, "");
    else process.stderr.write(`livewiki baseline ${operation}: error — ${message}\n`);
    process.exitCode = 1;
  }
}

function formatStatus(value: {
  state: string;
  issues: Array<{ code: string; detail: string }>;
  repository: { total: number; unbaselined: { total: number }; inferred: { total: number }; removedAnchors: { total: number } } | null;
}): string {
  const lines = [`livewiki baseline: ${value.state}`];
  if (value.repository) {
    lines.push(`  debt: ${value.repository.total}`);
    lines.push(`  unbaselined: ${value.repository.unbaselined.total}`);
    lines.push(`  inferred: ${value.repository.inferred.total}`);
    lines.push(`  removed anchors: ${value.repository.removedAnchors.total}`);
  }
  for (const issue of value.issues) lines.push(`  ${issue.code}: ${issue.detail}`);
  return lines.join("\n");
}
