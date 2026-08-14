import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Templates de hooks (Fase 5).
 *
 * SPEC §"Skills e hooks (fase 5)":
 *   "Hook git post-commit (template, instalação opt-in via core.hooksPath):
 *    roda `livewiki index --quiet`; se dívida nova, imprime resumo no
 *    terminal (não bloqueia o commit)."
 *   "Hook Claude Code Stop (template em `templates/`): idem, formato JSON
 *    de hooks."
 *
 * O teste aqui cobre:
 *   1. Os 3 arquivos existem e têm o conteúdo esperado (parseável,
 *      blocos obrigatórios)
 *   2. O script post-commit é EXECUTÁVEL de verdade (Unix: chmod +x;
 *      Git Bash/Windows: lido via sh -c)
 *   3. Simulação cross-platform: rodar `livewiki index --quiet` em subprocesso
 *      produz exit 0 e não imprime nada (modo quiet) — espelha o que o hook faz
 *
 * O hook NUNCA é executado de verdade neste teste (rodar git commit num
 * tmpdir pra testar hook é overkill e flaky). Em vez disso, validamos o
 * conteúdo + testamos o comando que o hook executa.
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

  it("existe e tem shebang bash", () => {
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("documenta o comportamento no topo (Fase 5 + opt-in)", () => {
    // Comentário inicial deve citar Fase 5 e "opt-in" pra usuário saber
    // o que está instalando
    expect(content).toMatch(/Fase 5/);
    expect(content).toMatch(/opt-in/i);
    expect(content).toMatch(/nunca bloqueia|NUNCA bloqueia|never blocks/i);
  });

  it("roda `livewiki index --quiet`", () => {
    expect(content).toMatch(/livewiki\s+index\s+--quiet/);
  });

  it("checa dívida via `livewiki status --json`", () => {
    expect(content).toMatch(/livewiki\s+status\s+--json/);
  });

  it("NUNCA bloqueia — sempre exit 0 no final", () => {
    // Garantia explícita: `exit 0` no fim do script
    expect(content).toMatch(/^\s*exit\s+0\s*$/m);
  });

  it("usa set +e (não propaga erro do livewiki)", () => {
    // `set +e` no topo garante que falhas do livewiki não viram exit != 0
    expect(content).toMatch(/set\s+\+e/);
  });

  it("imprime resumo apenas se dívida > 0", () => {
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

  it("é JSON válido (parseável)", () => {
    expect(parsed).toBeTypeOf("object");
    expect(parsed).not.toBeNull();
  });

  it("tem bloco hooks.Stop com command que indexa", () => {
    const obj = parsed as Record<string, unknown>;
    const hooks = obj["hooks"] as Record<string, unknown>;
    expect(hooks).toBeDefined();
    const stop = hooks["Stop"] as Array<Record<string, unknown>>;
    expect(Array.isArray(stop)).toBe(true);
    expect(stop.length).toBeGreaterThan(0);
    const inner = (stop[0]!["hooks"] as Array<Record<string, unknown>>);
    expect(Array.isArray(inner)).toBe(true);
    const cmd = inner[0]!["command"] as string;
    // O command roda `$L index --quiet` (usa variável local pra livewiki path,
    // não a string literal). Validamos que index --quiet é invocado.
    expect(cmd).toMatch(/index\s+--quiet/);
    expect(cmd).toMatch(/exit\s+0/); // nunca bloqueia
  });
});

describe("templates/README.md", () => {
  it("existe e cobre instalação de ambos os hooks", async () => {
    const content = await nodeFs.readFile(
      nodePath.join(templatesDir, "README.md"),
      "utf8",
    );
    expect(content).toMatch(/core\.hooksPath/);
    expect(content).toMatch(/Claude Code|claude-code/i);
    expect(content).toMatch(/desinstalar|uninstall/i);
  });

  it("cobre o template GitHub Actions (instalação, modos, v2 não implementada)", async () => {
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

  it("dispara em push na branch default + workflow_dispatch", () => {
    expect(content).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(content).toMatch(/workflow_dispatch:/);
  });

  it("detecção determinística: index + status + verify, zero LLM", () => {
    expect(content).toMatch(/index\s+--quiet/);
    expect(content).toMatch(/status\s+--json/);
    expect(content).toMatch(/verify\s+--json/);
    expect(content).toMatch(/zero tokens/i);
    // O reporter executa exatamente três comandos CLI (index + status + verify) — qualquer
    // caminho pago (update --llm) só existe como texto informativo.
    const calls = content.match(/npx --yes @livewiki\/cli \S+/g) ?? [];
    expect(calls.sort()).toEqual([
      "npx --yes @livewiki/cli index",
      "npx --yes @livewiki/cli status",
      "npx --yes @livewiki/cli verify",
    ]);
  });

  it("permissões mínimas e fetch-depth 0 (risk/churn lê git log)", () => {
    expect(content).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(content).toMatch(/fetch-depth:\s*0/);
  });

  it("usa report por padrão e documenta o gate fail-closed de enforce", () => {
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE:\s*report/);
    expect(content).toMatch(/baseline === "unavailable"/);
    expect(content).toMatch(/issues\.length > 0/);
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE\s*!==\s*"report"/);
    expect(content).not.toMatch(/debt\.total > 0/);
    expect(content).not.toMatch(/undocumented\.total > 0/);
  });

  it("renderiza quatro seções honestas e aplica somente os gates decididos", async () => {
    const status = {
      debt: {
        baseline: "unavailable",
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        items: [],
      },
      undocumented: { total: 409, sample: [{ symbol_key: "src/a.ts#alpha" }] },
    };
    const cleanVerify = { ok: true, pagesChecked: 133, issues: [] };

    const report = await runDocsDebtReporter(content, status, cleanVerify, "report");
    expect(report.exitCode).toBe(0);
    expect(report.summary).toContain("### Baseline");
    expect(report.summary).toContain("**Unavailable.**");
    expect(report.summary).toContain("### Documentation debt");
    expect(report.summary).toContain("**Not measurable in this checkout.**");
    expect(report.summary).toContain("Detected anyway: 0 deleted item(s).");
    expect(report.summary).not.toContain("**0 open item(s).**");
    expect(report.summary).toContain("### Verify issues");
    expect(report.summary).toContain("**0 issue(s)** across 133 page(s).");
    expect(report.summary).toContain("### Undocumented symbols");
    expect(report.summary).toContain("**409 undocumented symbol(s).**");
    expect(report.summary).not.toContain("No documentation debt");

    const unavailableEnforce = await runDocsDebtReporter(
      content,
      status,
      cleanVerify,
      "enforce",
    );
    expect(unavailableEnforce.exitCode).toBe(1);
    expect(unavailableEnforce.stderr).toContain("content-debt baseline unavailable");

    const availableWithReportedTotals = {
      ...status,
      debt: {
        ...status.debt,
        baseline: "available",
        total: 7,
        byEvent: { changed: 7, moved: 0, deleted: 0 },
        items: [
          {
            event: "changed",
            assignee: "agent",
            wiki_path: "livewiki/core-db.md",
            symbol_key: "packages/core/src/db.ts#CURRENT_SCHEMA_VERSION",
          },
        ],
      },
    };
    const totalsOnly = await runDocsDebtReporter(
      content,
      availableWithReportedTotals,
      cleanVerify,
      "enforce",
    );
    expect(totalsOnly.exitCode).toBe(0);
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
      availableWithReportedTotals,
      brokenVerify,
      "enforce",
    );
    expect(verifyEnforce.exitCode).toBe(1);
    expect(verifyEnforce.stderr).toContain("1 verify issue(s)");
  });

  it("dogfood (.github/workflows/docs-debt.yml) espelha os passos-chave via build local", async () => {
    const dogfood = await nodeFs.readFile(
      nodePath.resolve(templatesDir, "..", "..", "..", ".github", "workflows", "docs-debt.yml"),
      "utf8",
    );
    // Pré-publish: o dogfood constrói o CLI do checkout em vez de npx.
    expect(dogfood).toMatch(/pnpm -r build/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js index --quiet/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js status --json/);
    expect(dogfood).toMatch(/node packages\/cli\/dist\/index\.js verify --json/);
    expect(dogfood).toMatch(/fetch-depth:\s*0/);
    // E roda em report mode na primeira janela (nunca falha).
    expect(dogfood).toMatch(/LIVEWIKI_DEBT_MODE:\s*report/);
    expect(extractDocsDebtReporter(dogfood)).toBe(extractDocsDebtReporter(content));
  });
});

describe("templates/ — comportamento simulado do hook", () => {
  // Simula o que o hook faz: roda `livewiki index --quiet` num repo temporário.
  // Garante que o comando que o hook chama FUNCIONA e tem o exit code esperado.
  // (O hook em si nunca é invocado de verdade — esse teste cobre a suposição.)

  let tmpRepo: string;
  let livewikiBin: string;
  beforeAll(async () => {
    tmpRepo = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-hook-sim-"));
    // Localiza o binário livewiki: usa o entry compilado em dist/
    livewikiBin = nodePath.resolve(here, "..", "dist", "index.js");
    expect(nodeFsSync.existsSync(livewikiBin), `livewiki dist não existe em ${livewikiBin}`).toBe(true);
  });

  afterAll(async () => {
    await nodeFs.rm(tmpRepo, { recursive: true, force: true });
  });

  it("`livewiki index --quiet` num repo vazio: exit 0 e zero stdout (modo quiet)", async () => {
    // Cria source file mínimo pra walker não falhar
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
    // Quiet mode: stdout deve ser vazio (ou quase — algumas notas vão pro stderr)
    expect(result.stdout.trim()).toBe("");
  }, 30_000);
});
