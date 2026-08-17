import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Hook templates (Phase 5).
 *
 * SPEC §"Skills and hooks (phase 5)":
 *   "Git post-commit hook (template, opt-in install via core.hooksPath):
 *    runs `livewiki index --quiet`; if there is new debt, prints a summary
 *    to the terminal (does not block the commit)."
 *   "Claude Code Stop hook (template in `templates/`): same, JSON hook
 *    format."
 *
 * The test here covers:
 *   1. The 3 files exist and have the expected content (parseable,
 *      required blocks)
 *   2. The post-commit script is ACTUALLY executable (Unix: chmod +x;
 *      Git Bash/Windows: read via sh -c)
 *   3. Cross-platform simulation: running `livewiki index --quiet` in a
 *      subprocess produces exit 0 and prints nothing (quiet mode) — mirrors
 *      what the hook does
 *
 * The hook is NEVER actually run in this test (running git commit in a
 * tmpdir to test the hook is overkill and flaky). Instead, we validate the
 * content + test the command the hook runs.
 */

const here = nodePath.dirname(fileURLToPath(import.meta.url));
// src/cli/ → packages/cli/src/templates.test.ts
// templates/ → packages/cli/templates/
const templatesDir = nodePath.resolve(here, "..", "templates");
const skillsDir = nodePath.resolve(here, "..", "skills");

function frontmatterField(content: string, field: string): string | null {
  const match = new RegExp(`^${field}:\\s*(.+)$`, "m").exec(content);
  return match?.[1]?.trim() ?? null;
}

function extractDocsDebtReporter(yaml: string): string {
  const match = yaml.match(/node -e '\r?\n([\s\S]*?)\r?\n\s*'\s*$/);
  expect(match, "docs-debt workflow must contain an inline Node reporter").not.toBeNull();
  return match![1]!;
}

async function runDocsDebtReporter(
  yaml: string,
  status: unknown,
  verify: unknown,
  mode: "report" | "enforce",
): Promise<{ exitCode: number | null; stdout: string; stderr: string; summary: string }> {
  const tmp = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-docs-debt-reporter-"));
  const statusPath = nodePath.join(tmp, "status.json");
  const verifyPath = nodePath.join(tmp, "verify.json");
  const summaryPath = nodePath.join(tmp, "summary.md");
  try {
    await nodeFs.writeFile(statusPath, JSON.stringify(status));
    await nodeFs.writeFile(verifyPath, JSON.stringify(verify));
    const result = spawnSync(process.execPath, ["-e", extractDocsDebtReporter(yaml)], {
      encoding: "utf8",
      env: {
        ...process.env,
        STATUS_JSON: statusPath,
        VERIFY_JSON: verifyPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        LIVEWIKI_DEBT_MODE: mode,
      },
    });
    return {
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      summary: await nodeFs.readFile(summaryPath, "utf8"),
    };
  } finally {
    await nodeFs.rm(tmp, { recursive: true, force: true });
  }
}

describe("packaged skills", () => {
  let maintenance: string;
  let bootstrap: string;

  beforeAll(async () => {
    [maintenance, bootstrap] = await Promise.all([
      nodeFs.readFile(nodePath.join(skillsDir, "document-as-you-go", "SKILL.md"), "utf8"),
      nodeFs.readFile(nodePath.join(skillsDir, "bootstrap-wiki", "SKILL.md"), "utf8"),
    ]);
  });

  it("ships valid, distinct frontmatter triggers for maintenance and initial bootstrap", () => {
    for (const content of [maintenance, bootstrap]) {
      expect(content.startsWith("---\n")).toBe(true);
      expect(content.indexOf("\n---\n", 4)).toBeGreaterThan(4);
      expect(frontmatterField(content, "name")).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(frontmatterField(content, "description")).toBeTruthy();
    }
    expect(frontmatterField(maintenance, "name")).toBe("document-as-you-go");
    expect(frontmatterField(bootstrap, "name")).toBe("bootstrap-wiki");
    expect(frontmatterField(maintenance, "description")).toMatch(/termina uma tarefa|commit/i);
    expect(frontmatterField(bootstrap, "description")).toMatch(/initial|no wiki|bootstrap/i);
    expect(frontmatterField(bootstrap, "description")).not.toMatch(/commit|debt/i);
  });

  it("defines the MCP bootstrap loop and the resumable bounded-context guardrail", () => {
    expect(bootstrap).toMatch(/livewiki_next_task/);
    expect(bootstrap).toMatch(/source paths/i);
    expect(bootstrap).toMatch(/livewiki_write_doc/);
    expect(bootstrap).toMatch(/taskId/);
    expect(bootstrap).toMatch(/batch(?:es)?/i);
    expect(bootstrap).toMatch(/safe to stop|stopping .* safe/i);
    expect(bootstrap).toMatch(/resume(?:s|d)? the same run/i);
  });

  it("keeps the two skills separate and cross-referenced", () => {
    expect(maintenance).toContain("bootstrap-wiki");
    expect(bootstrap).toContain("document-as-you-go");
  });

  it("keeps credentials, unattended batch, and token estimates out of bootstrap guidance", () => {
    expect(bootstrap).not.toMatch(/API key|provider|model/i);
    expect(bootstrap).not.toContain("init --batch");
    expect(bootstrap).not.toMatch(/estimate(?:d|s)? tokens|token estimate/i);
  });

  it("corrects the two obsolete maintenance claims without rewriting its workflow", () => {
    expect(maintenance).not.toMatch(/init --batch.*resolva com LLM/i);
    expect(maintenance).not.toMatch(/MCP server usa a key do env var/i);
    expect(maintenance).toMatch(/undocumented[\s\S]*bootstrap-wiki/i);
    expect(maintenance).toMatch(/MCP[\s\S]*sem usar credencial/i);
  });
});

describe("templates/git/post-commit", () => {
  let content: string;
  beforeAll(async () => {
    content = await nodeFs.readFile(
      nodePath.join(templatesDir, "git", "post-commit"),
      "utf8",
    );
  });

  it("exists and has a bash shebang", () => {
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("documents the behavior at the top (Phase 5 + opt-in)", () => {
    // The opening comment must mention Phase 5 and "opt-in" so the user knows
    // what they are installing
    expect(content).toMatch(/Fase 5/);
    expect(content).toMatch(/opt-in/i);
    expect(content).toMatch(/nunca bloqueia|NUNCA bloqueia|never blocks/i);
  });

  it("runs `livewiki index --quiet`", () => {
    expect(content).toMatch(/livewiki\s+index\s+--quiet/);
  });

  it("checks debt via `livewiki status --json`", () => {
    expect(content).toMatch(/livewiki\s+status\s+--json/);
  });

  it("NEVER blocks — always exit 0 at the end", () => {
    // Explicit guarantee: `exit 0` at the end of the script
    expect(content).toMatch(/^\s*exit\s+0\s*$/m);
  });

  it("uses set +e (does not propagate livewiki errors)", () => {
    // `set +e` at the top ensures livewiki failures do not become exit != 0
    expect(content).toMatch(/set\s+\+e/);
  });

  it("prints a summary only if debt > 0", () => {
    expect(content).toMatch(/DEBT_TOTAL.*-gt\s+0|debt.*-gt\s+0/i);
  });
});

describe("templates/claude-code/settings.local.json", () => {
  let parsed: unknown;
  beforeAll(async () => {
    const raw = await nodeFs.readFile(
      nodePath.join(templatesDir, "claude-code", "settings.local.json"),
      "utf8",
    );
    parsed = JSON.parse(raw);
  });

  it("is valid JSON (parseable)", () => {
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
  });

  it("has a hooks.Stop block with an indexing command", () => {
    const obj = parsed as Record<string, unknown>;
    const hooks = obj["hooks"] as Record<string, unknown>;
    expect(hooks).toBeDefined();
    const stop = hooks["Stop"] as Array<Record<string, unknown>>;
    expect(Array.isArray(stop)).toBe(true);
    expect(stop.length).toBeGreaterThan(0);
    const inner = (stop[0]!["hooks"] as Array<Record<string, unknown>>);
    expect(Array.isArray(inner)).toBe(true);
    const cmd = inner[0]!["command"] as string;
    // The command runs `$L index --quiet` (uses a local variable for the
    // livewiki path, not the string literal). We validate that index --quiet
    // is invoked.
    expect(cmd).toMatch(/index\s+--quiet/);
    expect(cmd).toMatch(/exit\s+0/); // never blocks
  });
});

describe("templates/README.md", () => {
  it("exists and covers installing both hooks", async () => {
    const content = await nodeFs.readFile(
      nodePath.join(templatesDir, "README.md"),
      "utf8",
    );
    expect(content).toMatch(/core\.hooksPath/);
    expect(content).toMatch(/Claude Code|claude-code/i);
    expect(content).toMatch(/desinstalar|uninstall/i);
  });

  it("covers the GitHub Actions template (installation, modes, v2 not implemented)", async () => {
    const content = await nodeFs.readFile(
      nodePath.join(templatesDir, "README.md"),
      "utf8",
    );
    expect(content).toMatch(/github-actions\/docs-debt\.yml/);
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE/);
    expect(content).toMatch(/zero tokens/i);
    expect(content).toMatch(/update --llm/);
  });
});

describe("templates/github-actions/docs-debt.yml (item 6, v1 detect+report)", () => {
  let content: string;
  beforeAll(async () => {
    content = await nodeFs.readFile(
      nodePath.join(templatesDir, "github-actions", "docs-debt.yml"),
      "utf8",
    );
  });

  it("triggers on push to the default branch + workflow_dispatch", () => {
    expect(content).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(content).toMatch(/workflow_dispatch:/);
  });

  it("deterministic detection: index + status + verify, zero LLM", () => {
    expect(content).toMatch(/index\s+--quiet/);
    expect(content).toMatch(/status\s+--json/);
    expect(content).toMatch(/verify\s+--json/);
    expect(content).toMatch(/zero tokens/i);
    // The reporter runs exactly three CLI commands (index + status + verify) —
    // any paid path (update --llm) exists only as informational text.
    const calls = content.match(/npx --yes @livewiki\/cli \S+/g) ?? [];
    expect(calls.sort()).toEqual([
      "npx --yes @livewiki/cli index",
      "npx --yes @livewiki/cli status",
      "npx --yes @livewiki/cli verify",
    ]);
  });

  it("minimal permissions and fetch-depth 0 (risk/churn reads git log)", () => {
    expect(content).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(content).toMatch(/fetch-depth:\s*0/);
  });

  it("uses report by default and documents the enforce fail-closed gate", () => {
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE:\s*enforce/);
    expect(content).toMatch(/baseline !== "available"/);
    expect(content).toMatch(/issues\.length > 0/);
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE\s*!==\s*"report"/);
    expect(content).toMatch(/repository\?\.total \?\? 0\) > 0/);
    expect(content).not.toMatch(/undocumented\.total > 0/);
  });

  it("renders four honest sections and applies only the decided gates", async () => {
    const status = {
      debt: {
        baseline: "unavailable",
        repository: null,
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        items: [],
      },
      undocumented: {
        total: 413,
        sample: [
          { symbol_key: "packages/cli/src/templates.test.ts#runDocsDebtReporter" },
          { symbol_key: "src/a.ts#alpha" },
        ],
        byRole: {
          product: { total: 68, sample: [{ symbol_key: "src/a.ts#alpha" }] },
          test: {
            total: 345,
            sample: [{ symbol_key: "packages/cli/src/templates.test.ts#runDocsDebtReporter" }],
          },
        },
      },
    };
    const cleanVerify = { ok: true, pagesChecked: 133, issues: [] };

    const report = await runDocsDebtReporter(content, status, cleanVerify, "report");
    expect(report.exitCode).toBe(0);
    expect(report.summary).toContain("### Baseline");
    expect(report.summary).toContain("**unavailable.**");
    expect(report.summary).toContain("### Documentation debt");
    expect(report.summary).toContain("**Not measurable.**");
    expect(report.summary).not.toContain("**0 open item(s).**");
    expect(report.summary).toContain("### Verify issues");
    expect(report.summary).toContain("**0 issue(s)** across 133 page(s).");
    expect(report.summary).toContain("### Undocumented product symbols");
    expect(report.summary).toContain("**68 product symbol(s) without documentation.**");
    expect(report.summary).toContain(
      "345 test symbol(s) are tracked separately and are not documentation work.",
    );
    expect(report.summary).toContain("`src/a.ts#alpha`");
    expect(report.summary).not.toContain("`packages/cli/src/templates.test.ts#runDocsDebtReporter`");
    expect(report.summary).not.toContain("**413 undocumented symbol(s).**");
    expect(report.summary).not.toContain("No documentation debt");

    const unavailableEnforce = await runDocsDebtReporter(
      content,
      status,
      cleanVerify,
      "enforce",
    );
    expect(unavailableEnforce.exitCode).toBe(1);
    expect(unavailableEnforce.stderr).toContain("documentation baseline unavailable");

    const availableWithReportedTotals = {
      ...status,
      debt: {
        ...status.debt,
        baseline: "available",
        repository: {
          total: 7,
          byEvent: { changed: 7, moved: 0, deleted: 0 },
          unbaselined: { total: 0, items: [] },
          inferred: { total: 0, items: [] },
          removedAnchors: { total: 0, items: [] },
          items: [
            {
              event: "changed",
              assignee: "agent",
              wiki_path: "livewiki/core-db.md",
              symbol_key: "packages/core/src/db.ts#CURRENT_SCHEMA_VERSION",
            },
          ],
        },
      },
    };
    const totalsOnly = await runDocsDebtReporter(
      content,
      availableWithReportedTotals,
      cleanVerify,
      "enforce",
    );
    expect(totalsOnly.exitCode).toBe(1);
    expect(totalsOnly.stderr).toContain("7 repository debt item(s)");
    expect(totalsOnly.summary).toContain("| risk | event | assignee | page | anchor |");
    expect(totalsOnly.summary).toContain("`livewiki/core-db.md`");

    const brokenVerify = {
      ok: false,
      pagesChecked: 133,
      issues: [
        {
          severity: "error",
          code: "broken_anchor",
          wikiPath: "livewiki/a.md",
          detail: "src/a.ts#missing does not exist",
        },
      ],
    };
    const verifyEnforce = await runDocsDebtReporter(
      content,
      {
        ...availableWithReportedTotals,
        debt: {
          ...availableWithReportedTotals.debt,
          repository: {
            ...availableWithReportedTotals.debt.repository,
            total: 0,
            byEvent: { changed: 0, moved: 0, deleted: 0 },
            items: [],
          },
        },
      },
      brokenVerify,
      "enforce",
    );
    expect(verifyEnforce.exitCode).toBe(1);
    expect(verifyEnforce.stderr).toContain("1 verify issue(s)");
  });

  it("dogfood (.github/workflows/docs-debt.yml) mirrors the key steps via local build", async () => {
    const dogfood = await nodeFs.readFile(
      nodePath.resolve(templatesDir, "..", "..", "..", ".github", "workflows", "docs-debt.yml"),
      "utf8",
    );
    // Pre-publish: the dogfood builds the CLI from the checkout instead of npx.
    expect(dogfood).toMatch(/pnpm -r build/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js index --quiet/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js status --json/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js verify --json/);
    expect(dogfood).toMatch(/fetch-depth:\s*0/);
    // Baseline dogfood committed: the gate runs in enforce (stays red
    // while the 35 inferred entries remain unpaid).
    expect(dogfood).toMatch(/LIVEWIKI_DEBT_MODE:\s*enforce/);
    expect(extractDocsDebtReporter(dogfood)).toBe(extractDocsDebtReporter(content));
  });
});

describe("templates/ — simulated hook behavior", () => {
  // Simulates what the hook does: runs `livewiki index --quiet` in a temp repo.
  // Ensures the command the hook calls WORKS and has the expected exit code.
  // (The hook itself is never actually invoked — this test covers the assumption.)

  let tmpRepo: string;
  let livewikiBin: string;
  beforeAll(async () => {
    tmpRepo = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-hook-sim-"));
    // Locates the livewiki binary: uses the compiled entry in dist/
    livewikiBin = nodePath.resolve(here, "..", "dist", "index.js");
    expect(nodeFsSync.existsSync(livewikiBin), `livewiki dist does not exist at ${livewikiBin}`).toBe(true);
  });

  afterAll(async () => {
    await nodeFs.rm(tmpRepo, { recursive: true, force: true });
  });

  it("`livewiki index --quiet` in an empty repo: exit 0 and zero stdout (quiet mode)", async () => {
    // Creates a minimal source file so the walker does not fail
    await nodeFs.writeFile(
      nodePath.join(tmpRepo, "hello.ts"),
      "export function greet(): string { return 'hi'; }\n",
      "utf8",
    );

    const { spawn } = await import("node:child_process");
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [livewikiBin, "index", "--quiet", "--repo", tmpRepo],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "";
        let err = "";
        child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
        child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
        child.on("close", (code) => resolve({ code, stdout: out, stderr: err }));
        child.on("error", reject);
      },
    );

    expect(result.code).toBe(0);
    // Quiet mode: stdout must be empty (or nearly — some notes go to stderr)
    expect(result.stdout.trim()).toBe("");
  }, 30_000);
});
