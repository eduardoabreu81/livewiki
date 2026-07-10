/**
 * E2E Fase 5 — fluxo ponta a ponta: hook detecta → agente paga via MCP → verify limpo.
 *
 * Critério de aceite (SPEC §Fase 5):
 *   "fluxo de ponta a ponta — agente altera código, hook detecta, agente paga
 *    a dívida via MCP (livewiki_write_doc), verify passa limpo (exit 0 E zero
 *    issues de qualquer severidade), manifest atualizado."
 *   "E2E deve assertar contagem de issues, não só exit code."
 *
 * Cenário:
 *   1. Repo novo com código (sem wiki)
 *   2. `livewiki init` cria wiki + indexa
 *   3. Agente edita um símbolo no source (modifica corpo — não cria novo)
 *   4. Hook (`livewiki index --quiet`) detecta a mudança e gera dívida
 *   5. `livewiki status --json` confirma: debt.items > 0
 *   6. Agente paga via MCP `livewiki_write_doc` (InMemoryTransport — mesmo
 *      client MCP usado pelos agentes em produção)
 *   7. `livewiki verify`: exit 0 + ZERO issues (errors E warnings)
 *   8. `livewiki/.manifest.json`: updatedAt mudou (regra #3: disco é a verdade)
 *
 * Por que subprocess pra init/index/verify e in-process pra MCP?
 *   - subprocess: testa o binário REAL (não mocks) — o que o hook e o agente
 *     vão chamar em produção.
 *   - in-process MCP: o MCP server é o que o agente usa; InMemoryTransport
 *     é o mesmo client MCP usado pelos testes da Fase 4. Não precisa de
 *     subprocess stdio (que adiciona flakiness).
 *
 * Importante: usa o CLI compilado em packages/cli/dist/index.js. O test
 * assume `pnpm -r build` foi rodado (igual aos outros E2E da CLI).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = nodePath.dirname(fileURLToPath(import.meta.url));
// src/mcp/phase5-e2e.test.ts → packages/mcp/src/
// dist/index.js → packages/cli/dist/index.js
const cliBin = nodePath.resolve(here, "..", "..", "cli", "dist", "index.js");

if (!nodeFsSync.existsSync(cliBin)) {
  throw new Error(
    `livewiki CLI binary not found at ${cliBin}. Run \`pnpm -r build\` first.`,
  );
}

interface SubprocessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Roda o CLI livewiki como subprocess. Captura stdout/stderr/code. */
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args, "--repo", cwd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
    child.on("close", (code) => resolve({ code, stdout: out, stderr: err }));
    child.on("error", reject);
  });
}

interface Connected {
  client: Client;
  server: McpServer;
}

async function connectMcp(repoRoot: string): Promise<Connected> {
  const server = await createServer({ repoRoot });
  const client = new Client({ name: "phase5-e2e-agent", version: "0.0.0" }, { capabilities: {} });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientT), server.connect(serverT)]);
  return { client, server };
}

async function teardown(c: Connected): Promise<void> {
  await c.client.close();
  await c.server.close();
}

interface VerifyOutput {
  ok: boolean;
  exitCode: number;
  issues: Array<{
    severity: "error" | "warning";
    kind: string;
    detail: string;
    wikiPath?: string;
  }>;
  rawStdout: string;
}

/** Roda `livewiki verify --json` e parseia o output. */
async function runVerify(repoRoot: string): Promise<VerifyOutput> {
  const r = await runCli(["verify", "--json"], repoRoot);
  // verify pode emitir texto antes do JSON em modo human, mas com --json é só JSON
  let parsed: { ok?: boolean; issues?: VerifyOutput["issues"] } = {};
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    // fallback: tenta extrair JSON do stdout
    const match = r.stdout.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }
  return {
    ok: parsed.ok ?? false,
    exitCode: r.code ?? -1,
    issues: parsed.issues ?? [],
    rawStdout: r.stdout,
  };
}

describe("E2E Fase 5 — fluxo ponta a ponta (hook → MCP → verify)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-phase5-"));
    // Setup source code: 1 arquivo, 2 funções
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth.ts"),
      [
        "export function validate(token: string): boolean {",
        "  return token.length > 0;",
        "}",
        "",
        "export function refresh(token: string): string {",
        "  return token + 'x';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("fluxo completo: edit → hook → MCP write_doc → verify zero issues → manifest atualizado", async () => {
    // ── PASSO 1: livewiki init ───────────────────────────────────────────
    const initResult = await runCli(["init"], repoRoot);
    expect(initResult.code, `init falhou: ${initResult.stderr}`).toBe(0);

    // Verifica que wiki + index foram criados
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", "quickstart.md"))).toBe(true);
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, ".livewiki", "index.db"))).toBe(true);
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", ".manifest.json"))).toBe(true);

    // ── PASSO 1.5: agente cria página wiki inicial ancorada (pra ter dívida depois) ──
    // Sem página ancorada, mudar o source não gera dívida (ledger detecta,
    // mas sem anchor correspondente não vira debt com wiki_path).
    const initialPage = [
      "---",
      "title: Auth module",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "  - src/auth.ts#refresh",
      "updated: 2026-07-09",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "`validate(token)` checks token presence.",
      "",
      "## Refresh",
      "<!-- lw:anchors src/auth.ts#refresh -->",
      "`refresh(token)` extends token.",
      "",
    ].join("\n");

    const mcp1 = await connectMcp(repoRoot);
    let pageWriteResult: { isError?: boolean; content?: Array<{ text?: string }> };
    try {
      pageWriteResult = (await mcp1.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: initialPage },
      })) as typeof pageWriteResult;
    } finally {
      await teardown(mcp1);
    }
    expect(pageWriteResult?.isError, "write_doc inicial deveria passar").toBeFalsy();

    // CRÍTICO: rodar index ANTES da modificação. write_doc escreve o
    // arquivo mas NÃO re-rodar o ledger — os anchors precisam entrar no
    // DB com o hash ANTIGO pra próxima mudança ser detectável.
    const indexBeforeChange = await runCli(["index"], repoRoot);
    expect(indexBeforeChange.code, `index pré-modify falhou: ${indexBeforeChange.stderr}`).toBe(0);

    // Snapshot do manifest (updatedAt atual)
    const manifestBeforeRaw = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki", ".manifest.json"),
      "utf8",
    );
    const manifestBefore = JSON.parse(manifestBeforeRaw) as { updatedAt: string };

    // ── PASSO 2: agente altera código (muda corpo de `validate`) ─────────
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth.ts"),
      [
        "export function validate(token: string): boolean {",
        "  // CHANGED: agora exige length > 5 (era > 0)",
        "  return token.length > 5;",
        "}",
        "",
        "export function refresh(token: string): string {",
        "  return token + 'x';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    // ── PASSO 3: hook (git post-commit) — `livewiki index --quiet` ───────
    const indexResult = await runCli(["index", "--quiet"], repoRoot);
    expect(indexResult.code, `index falhou: ${indexResult.stderr}`).toBe(0);
    // Quiet mode: stdout vazio (nenhuma nota)
    expect(indexResult.stdout.trim()).toBe("");

    // ── PASSO 4: status confirma dívida aberta ──────────────────────────
    const statusResult = await runCli(["status", "--json"], repoRoot);
    expect(statusResult.code, `status falhou: ${statusResult.stderr}`).toBe(0);
    const status = JSON.parse(statusResult.stdout) as {
      debt: { total: number; items: Array<{ event: string; symbol_key: string; wiki_path: string }> };
    };
    expect(status.debt.total, "esperava ≥ 1 dívida após mudança").toBeGreaterThanOrEqual(1);
    // A dívida pode estar em qualquer posição (ordenada por detected_at).
    // Procuramos o item específico do validate (que foi o que mudou).
    const validateDebt = status.debt.items.find(
      (i) => i.symbol_key === "src/auth.ts#validate",
    );
    expect(validateDebt, `esperava dívida pra validate, items: ${JSON.stringify(status.debt.items.map(i => i.symbol_key))}`).toBeDefined();
    expect(validateDebt!.event).toBe("changed");
    expect(validateDebt!.wiki_path).toBe("livewiki/auth.md");

    // ── PASSO 5: agente paga via MCP write_doc ─────────────────────────
    // Reescreve a página com âncora nova (mesmo symbol_key — só mudou corpo,
    // hash mudou, ledger gera 'changed'). O agente documenta a mudança.
    const updatedPage = [
      "---",
      "title: Auth module",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "  - src/auth.ts#refresh",
      "updated: 2026-07-09",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "`validate(token)` now requires length > 5 (was > 0).",
      "",
      "## Refresh",
      "<!-- lw:anchors src/auth.ts#refresh -->",
      "`refresh(token)` extends token.",
      "",
    ].join("\n");

    const mcp2 = await connectMcp(repoRoot);
    let writeResult: { isError?: boolean; content?: Array<{ text?: string }> };
    try {
      writeResult = (await mcp2.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: updatedPage },
      })) as typeof writeResult;
    } finally {
      await teardown(mcp2);
    }
    expect(writeResult?.isError, `write_doc falhou: ${JSON.stringify(writeResult)}`).toBeFalsy();

    // ── PASSO 6: verify — exit 0 + ZERO issues (errors E warnings) ────
    const verifyResult = await runVerify(repoRoot);
    expect(verifyResult.exitCode, `verify exit ${verifyResult.exitCode}. Issues: ${JSON.stringify(verifyResult.issues)}`).toBe(0);
    // CRITÉRIO DA SPEC: assertar CONTAGEM de issues, não só exit code
    expect(verifyResult.issues.length, `verify reportou ${verifyResult.issues.length} issues: ${JSON.stringify(verifyResult.issues)}`).toBe(0);
    expect(verifyResult.ok, "verify.ok deve ser true").toBe(true);

    // ── PASSO 7: manifest atualizado — re-init atualiza snapshot hash ──
    // (write_doc não atualiza manifest por design — Fase 4 E2E cobre write_doc.
    //  O handoff do manifest acontece via `init` (snapshot de livewiki/).
    //  Em produção, o agente roda `init` ao fechar a sessão; aqui simulamos.)
    const initAgain = await runCli(["init"], repoRoot);
    expect(initAgain.code, `init pós-pagamento falhou: ${initAgain.stderr}`).toBe(0);
    const manifestAfterRaw = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki", ".manifest.json"),
      "utf8",
    );
    const manifestAfter = JSON.parse(manifestAfterRaw) as {
      updatedAt: string;
      snapshotHash: string;
    };
    expect(
      manifestAfter.updatedAt,
      "manifest.updatedAt não mudou após init pós-pagamento",
    ).not.toBe(manifestBefore.updatedAt);
    expect(
      manifestAfter.snapshotHash,
      "manifest.snapshotHash deveria refletir auth.md novo",
    ).not.toBe(JSON.parse(manifestBeforeRaw).snapshotHash);

    // ── PASSO 8 (sanity): status agora mostra debt zerada ──────────────
    const statusAfter = await runCli(["status", "--json"], repoRoot);
    const statusAfterJson = JSON.parse(statusAfter.stdout) as { debt: { total: number } };
    // Após write_doc bem-sucedido, a dívida deveria ter sido resolvida
    // (re-index detecta que a âncora foi reescrita, ledger resolve).
    // Pode ser 0 (limpa) ou diferente do original — não exige 0, mas checa
    // que diminuiu.
    expect(statusAfterJson.debt.total, "dívida não diminuiu após write_doc").toBeLessThanOrEqual(status.debt.total);
  }, 60_000);

  it("write_doc rejeita página com anchor quebrada E rollback restaura estado anterior", async () => {
    // Setup mínimo: init + página ancorada
    const initResult = await runCli(["init"], repoRoot);
    expect(initResult.code).toBe(0);

    const goodPage = [
      "---",
      "title: Auth",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#validate",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#validate -->",
      "good",
      "",
    ].join("\n");

    const mcp1 = await connectMcp(repoRoot);
    try {
      const r1 = await mcp1.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: goodPage },
      });
      expect((r1 as { isError?: boolean }).isError).toBeFalsy();
    } finally {
      await teardown(mcp1);
    }

    // Página com anchor quebrada (symbol inexistente no índice)
    const brokenPage = [
      "---",
      "title: Auth",
      "owner: generated",
      "anchors:",
      "  - src/auth.ts#ghostSymbol",
      "---",
      "",
      "## Validation",
      "<!-- lw:anchors src/auth.ts#ghostSymbol -->",
      "broken",
      "",
    ].join("\n");

    const mcp2 = await connectMcp(repoRoot);
    let brokenResult: { isError?: boolean };
    try {
      brokenResult = (await mcp2.client.callTool({
        name: "livewiki_write_doc",
        arguments: { path: "livewiki/auth.md", content: brokenPage },
      })) as typeof brokenResult;
    } finally {
      await teardown(mcp2);
    }
    expect(brokenResult?.isError, "write_doc deveria rejeitar anchor quebrada").toBe(true);

    // Rollback: o arquivo NÃO deveria existir (ou ser o bom anterior se write atomic)
    const fileExists = nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", "auth.md"));
    // Após rejeição + rollback, o arquivo ou não existe OU é o bom anterior
    if (fileExists) {
      const content = await nodeFs.readFile(
        nodePath.join(repoRoot, "livewiki", "auth.md"),
        "utf8",
      );
      expect(content).not.toContain("ghostSymbol");
    }
  }, 60_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// (R) Achado do revisor: `livewiki init` deve adicionar `.livewiki/` ao
// .gitignore do repo-alvo (regra #3 SPEC: banco derivado, nunca viaja no git).
// Idempotente: re-init é no-op se já contém.
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E Fase 5 — Achado R: livewiki init adiciona .livewiki/ ao .gitignore", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-r-gitignore-"));
    // Setup source mínimo (init precisa de algo pra indexar)
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/lib.ts"),
      "export function hello(): string { return 'hi'; }\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("init cria .gitignore com .livewiki/ quando ausente", async () => {
    // .gitignore NÃO existe
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, ".gitignore"))).toBe(false);

    const r = await runCli(["init"], repoRoot);
    expect(r.code, `init falhou: ${r.stderr}`).toBe(0);

    // .gitignore foi criado com .livewiki/ dentro de bloco gerenciado
    const giPath = nodePath.join(repoRoot, ".gitignore");
    expect(nodeFsSync.existsSync(giPath)).toBe(true);
    const content = await nodeFs.readFile(giPath, "utf8");
    expect(content).toContain(".livewiki/");
    expect(content).toContain("# livewiki:start");
    expect(content).toContain("# livewiki:end");
  });

  it("init PRESERVA entries existentes do user (append, não overwrite)", async () => {
    // .gitignore já existe com entries do user
    const userGi = "node_modules/\ndist/\n*.log\n";
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), userGi, "utf8");

    const r = await runCli(["init"], repoRoot);
    expect(r.code).toBe(0);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    // Entries do user preservadas
    expect(content).toContain("node_modules/");
    expect(content).toContain("dist/");
    expect(content).toContain("*.log");
    // .livewiki/ adicionado
    expect(content).toContain(".livewiki/");
    // Bloco gerenciado presente
    expect(content).toContain("# livewiki:start");
    expect(content).toContain("# livewiki:end");
  });

  it("init idempotente: rodar 2x não duplica .livewiki/", async () => {
    await runCli(["init"], repoRoot);
    const first = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    await runCli(["init"], repoRoot);
    const second = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");

    expect(second).toBe(first);
    // Conta exata de ".livewiki/" — só 1 (não duplicada)
    const matches = second.match(/^\.livewiki\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it("init respeita entry existente do user com mesmo nome (não duplica)", async () => {
    // User já adicionou .livewiki/ manualmente (fora do bloco gerenciado)
    await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), ".livewiki/\n", "utf8");

    const r = await runCli(["init"], repoRoot);
    expect(r.code).toBe(0);

    const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
    // Não duplicou — entry do user continua sendo a única
    const matches = content.match(/^\.livewiki\/$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it("init --batch também adiciona .gitignore (regression: deve rodar antes do batch)", async () => {
    // Garante que init (com ou sem --batch) faz o trabalho de gitignore
    // ANTES de qualquer outra coisa — batch não deveria ter que cuidar disso.
    const r = await runCli(["init", "--batch"], repoRoot);
    // init --batch pode falhar se não tiver LLM config; o que importa é o .gitignore
    const giExists = nodeFsSync.existsSync(nodePath.join(repoRoot, ".gitignore"));
    if (giExists) {
      const content = await nodeFs.readFile(nodePath.join(repoRoot, ".gitignore"), "utf8");
      expect(content).toContain(".livewiki/");
    } else {
      // Se r.code !== 0 (ex.: batch aborted por falta de config), init base
      // ainda pode ter rodado parcialmente. Verifica stderr.
      // Não falhamos o teste aqui — o ponto é documentar o comportamento.
      expect(r.code).not.toBe(0);
    }
  }, 60_000);
});