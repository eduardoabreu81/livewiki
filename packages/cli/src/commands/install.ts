import type { Command } from "commander";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  AGENT_REGISTRY,
  detectAgents,
  planInstall,
  applyInstall,
  type AgentDetection,
  type AgentId,
  type InstallAction,
  type InstallSources,
} from "@livewiki/core/install";
import { loadConfig } from "@livewiki/core/config";
import { emit, emitHuman } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface InstallOptions {
  json?: boolean;
  repo?: string;
  /** `--agents <csv>`: explicit subset of agent ids. */
  agents?: string;
  /** `--yes`: skip interactive confirmation (scripting). */
  yes?: boolean;
  /** `--print`: full dry-run — shows the plan, writes nothing. */
  print?: boolean;
  /** `--write-pointer`: rule #2 opt-in for the AGENTS.md/CLAUDE.md pointer. */
  writePointer?: boolean;
}

/**
 * `livewiki install` — detects installed coding agents and offers to
 * configure the MCP server entry, the existing hook templates, the shared
 * skill, and the opt-in pointer (backlog #4).
 *
 * Safety: every target is shown BEFORE writing; `--print` is a full
 * dry-run (zero writes); without `--yes` a TTY confirmation is required
 * (non-TTY fails closed); the pointer additionally needs `--write-pointer`
 * or its own interactive confirmation (rule #2).
 *
 * Home resolution: `LIVEWIKI_HOME` env var overrides os.homedir() — a
 * documented seam so tests/smoke runs can point at a throwaway HOME.
 *
 * Exit codes: 0 ok (including "nothing to do"), 1 write refusal/error,
 * 2 invalid --agents value.
 */
export function registerInstall(program: Command): void {
  program
    .command("install")
    .description(
      "detect installed coding agents (claude-code, codex, cursor, kimi, gemini) and " +
        "configure the livewiki MCP entry, hook templates, shared skill, and opt-in pointer. " +
        "Every write outside the repo is shown before it happens; --print is a full dry-run.",
    )
    .option("--agents <csv>", `explicit agent subset (comma-separated). Values: ${AGENT_REGISTRY.map((a) => a.id).join(", ")}`)
    .option("--yes", "skip interactive confirmation (scripting)")
    .option("--print", "dry-run: print the detection table and the full plan, write nothing")
    .option("--write-pointer", "also write the AGENTS.md/CLAUDE.md pointer (rule #2 opt-in)")
    .action(async (_options: InstallOptions, command: Command) => {
      const opts = command.optsWithGlobals<InstallOptions>();
      const json = Boolean(opts.json);
      const repoRoot = nodePath.resolve(process.cwd(), resolveRepoRoot(opts.repo));
      const home = nodePath.resolve(process.env.LIVEWIKI_HOME ?? nodeOs.homedir());

      // ── --agents validation (exit 2 on invalid) ──────────────────────
      let selected: AgentId[] | null = null;
      if (opts.agents !== undefined) {
        const ids = opts.agents
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s !== "");
        const invalid = ids.filter((id) => !AGENT_REGISTRY.some((a) => a.id === id));
        if (ids.length === 0 || invalid.length > 0) {
          const msg =
            `livewiki install: invalid --agents value(s): ${invalid.join(", ") || "(empty)"}. ` +
            `Valid: ${AGENT_REGISTRY.map((a) => a.id).join(", ")}`;
          if (json) {
            emit(true, { ok: false, error: msg }, "");
          } else {
            process.stderr.write(msg + "\n");
          }
          process.exitCode = 2;
          return;
        }
        selected = ids as AgentId[];
      }

      try {
        const repoConfig = await loadConfig(repoRoot).catch(() => null);
        const needsExecutorConfig =
          repoConfig === null ||
          (!repoConfig.preset && !repoConfig.provider) ||
          !repoConfig.model;
        const configNextStep = needsExecutorConfig
          ? "No batch executor is configured. Run livewiki config before the first full-repository batch."
          : null;

        // ── Detection ────────────────────────────────────────────────────
        const detections = await detectAgents({
          home,
          pathEnv: process.env.PATH ?? "",
        });
        const toInstall: AgentId[] =
          selected ?? AGENT_REGISTRY.filter((a) => detections[a.id].detected).map((a) => a.id);

        // ── Sources (templates/skill live in the CLI package) ────────────
        const sources = await readSources();

        // Pointer opt-in: flag, or interactive confirmation below.
        let writePointer = Boolean(opts.writePointer);

        const buildPlan = () =>
          planInstall({ repoRoot, home, agents: toInstall, sources, writePointer });

        let plan = await buildPlan();

        // ── Dry-run: print and stop, zero writes ─────────────────────────
        if (opts.print) {
          emit(
            json,
            { ok: true, dryRun: true, home, detections, plan, nextStep: configNextStep },
            formatDetectionHuman(detections, home) +
              "\n\n" +
              formatPlanHuman(plan, toInstall) +
              (configNextStep ? `\n\nNext: ${configNextStep}` : ""),
          );
          return;
        }

        // ── Confirmation (non-TTY without --yes fails closed) ────────────
        const writable = plan.filter((a) => a.status === "write");
        const refusals = plan.filter((a) => a.status === "refuse");
        if (!opts.yes && writable.length > 0) {
          if (!process.stdin.isTTY) {
            process.stderr.write(
              "livewiki install: requires --yes in non-interactive mode. " +
                "Run with --print to review the plan first.\n",
            );
            process.exitCode = 1;
            return;
          }
          emitHuman(formatDetectionHuman(detections, home) + "\n\n" + formatPlanHuman(plan, toInstall));
          const pointerPending = plan.some((a) => a.kind === "pointer" && a.status === "requires-opt-in");
          if (pointerPending) {
            const okPointer = await promptYesNo(
              "\nAdd the livewiki pointer block to AGENTS.md/CLAUDE.md? [y/N] ",
            );
            if (okPointer) {
              writePointer = true;
              plan = await buildPlan();
            }
          }
          const confirmed = await promptYesNo(
            `\nProceed with ${plan.filter((a) => a.status === "write").length} write action(s)? [y/N] `,
          );
          if (!confirmed) {
            emit(json, { ok: false, cancelled: true }, "cancelled");
            return;
          }
        }

        // ── Apply ────────────────────────────────────────────────────────
        const results = await applyInstall(plan, repoRoot);
        const failed = results.filter(
          (r) => r.action.status === "refuse" || (r.action.status === "write" && !r.applied),
        );
        emit(
          json,
          {
            ok: failed.length === 0,
            home,
            detections,
            results: results.map(formatResultJson),
            nextStep: configNextStep,
          },
          formatResultsHuman(detections, home, plan, results) +
            (configNextStep ? `\n\nNext: ${configNextStep}` : ""),
        );
        if (refusals.length > 0 || failed.length > 0) {
          process.exitCode = 1;
        }
      } catch (err) {
        process.stderr.write(`livewiki install: error — ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/**
 * Reads the shipped templates/skill. They live in the CLI package root
 * (`templates/`, `skills/` — shipped via package.json "files"), which is
 * two levels up from both src/commands/ and dist/commands/.
 */
async function readSources(): Promise<InstallSources> {
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = nodePath.resolve(here, "..", "..");
  const [gitPostCommit, claudeCodeSettings, skillDocumentAsYouGo] = await Promise.all([
    nodeFs.readFile(nodePath.join(pkgRoot, "templates", "git", "post-commit"), "utf8"),
    nodeFs.readFile(nodePath.join(pkgRoot, "templates", "claude-code", "settings.local.json"), "utf8"),
    nodeFs.readFile(nodePath.join(pkgRoot, "skills", "document-as-you-go", "SKILL.md"), "utf8"),
  ]);
  return { gitPostCommit, claudeCodeSettings, skillDocumentAsYouGo };
}

async function promptYesNo(question: string): Promise<boolean> {
  process.stdout.write(question);
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

function formatDetectionHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
): string {
  const lines: string[] = [`Agent detection (home: ${home}):`];
  for (const agent of AGENT_REGISTRY) {
    const d = detections[agent.id];
    lines.push(`  ${agent.id} (${agent.displayName}): ${d.detected ? "detected" : "not detected"}`);
    for (const ev of d.evidence) {
      lines.push(`    - ${ev}`);
    }
  }
  return lines.join("\n");
}

function formatPlanHuman(plan: readonly InstallAction[], toInstall: readonly AgentId[]): string {
  const lines: string[] = [];
  if (toInstall.length === 0) {
    lines.push("Plan: no agents selected/detected — nothing to do.");
  } else {
    lines.push(`Plan for: ${toInstall.join(", ")}`);
  }
  const counts = { write: 0, skip: 0, refuse: 0, "requires-opt-in": 0 };
  for (const a of plan) counts[a.status]++;
  lines.push(
    `Actions: ${counts.write} write, ${counts.skip} skip, ${counts.refuse} refuse, ` +
      `${counts["requires-opt-in"]} requires-opt-in`,
  );
  for (const a of plan) {
    const where = a.agentId ? `${a.agentId} ` : "";
    lines.push(`  [${a.status}] ${a.kind} ${where}${a.targetPath}`);
    if (a.reason) {
      for (const line of a.reason.split("\n")) lines.push(`      ${line}`);
    }
    if (a.status === "write" && a.content !== null) {
      lines.push("      --- content ---");
      if (a.sensitive) lines.push("      (redacted)");
      else for (const line of a.content.split("\n")) lines.push(`      ${line}`);
      lines.push("      --- end ---");
    }
  }
  return lines.join("\n");
}

function formatResultJson(r: { action: InstallAction; applied: boolean; detail?: string }) {
  return {
    kind: r.action.kind,
    agentId: r.action.agentId ?? null,
    targetPath: r.action.targetPath,
    status: r.action.status,
    applied: r.applied,
    detail: r.detail ?? r.action.reason ?? null,
  };
}

function formatResultsHuman(
  detections: Record<AgentId, AgentDetection>,
  home: string,
  plan: readonly InstallAction[],
  results: readonly { action: InstallAction; applied: boolean; detail?: string }[],
): string {
  const lines: string[] = [formatDetectionHuman(detections, home), "", "Results:"];
  for (const r of results) {
    const a = r.action;
    const where = a.agentId ? `${a.agentId} ` : "";
    const outcome = a.status !== "write" ? a.status : r.applied ? "written" : "FAILED";
    lines.push(`  [${outcome}] ${a.kind} ${where}${a.targetPath}`);
    const detail = r.detail ?? a.reason;
    if (detail) {
      for (const line of detail.split("\n")) lines.push(`      ${line}`);
    }
  }
  if (plan.every((a) => a.status !== "write")) {
    lines.push("  (nothing to write — everything already up to date, skipped, or refused)");
  }
  return lines.join("\n");
}
