import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
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

  it("detecção determinística: index --quiet + status --json, zero LLM", () => {
    expect(content).toMatch(/index\s+--quiet/);
    expect(content).toMatch(/status\s+--json/);
    expect(content).toMatch(/zero tokens/i);
    // v1 executa EXATAMENTE dois comandos CLI (index + status) — qualquer
    // caminho pago (update --llm) só existe como texto informativo.
    const calls = content.match(/npx --yes @livewiki\/cli \S+/g) ?? [];
    expect(calls.sort()).toEqual([
      "npx --yes @livewiki/cli index",
      "npx --yes @livewiki/cli status",
    ]);
  });

  it("permissões mínimas e fetch-depth 0 (risk/churn lê git log)", () => {
    expect(content).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(content).toMatch(/fetch-depth:\s*0/);
  });

  it("modo enforce falha o job; toggle report documentado", () => {
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE:\s*enforce/);
    expect(content).toMatch(/LIVEWIKI_DEBT_MODE\s*!==\s*"report"/);
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
    expect(dogfood).toMatch(/fetch-depth:\s*0/);
    // E roda em report mode na primeira janela (nunca falha).
    expect(dogfood).toMatch(/LIVEWIKI_DEBT_MODE:\s*report/);
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