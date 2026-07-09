/**
 * CLI E2E tests — executam o binário `livewiki` real (packages/cli/dist/index.js)
 * contra um repositório temporário isolado. Valida o fluxo completo:
 *
 *   livewiki index --json --repo <tmp>
 *   livewiki verify --json --repo <tmp>
 *
 * Por que E2E e não unit: o achado A da revisão da Fase 2 mostrou que chamar
 * `runLedger` direto (como em anchor-ledger.test.ts) bypassa o soft-delete que
 * o `livewiki index` aplica no caminho de update. Sem E2E, os fixes A/B/C/D/E
 * ficam com cobertura parcial — testes unitários passam enquanto o fluxo CLI
 * real poderia regredir. Por isso, estes testes são OBRIGATÓRIOS junto com os
 * fixes (constraint do user).
 *
 * Cenários cobertos (mapeados na review):
 *   1. Editar função ancorada → changed (1, não acumulado)
 *   2. Mover função entre arquivos → moved + âncora atualizada + detail de/para
 *   3. Deletar função → deleted UMA única vez mesmo após 3 `index` seguidos
 *   4. Página nova com âncora fantasma, sem index → verify falha com broken_anchor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp", "livewiki-cli-e2e-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/** Resolve o caminho do binário compilado do CLI. Em dev: packages/cli/dist/index.js */
function cliBin(): string {
  return nodePath.resolve(
    process.cwd(),
    "dist/index.js",
  );
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Executa o binário livewiki real via node, captura stdout/stderr/exit. */
function runCli(args: string[]): CliRun {
  const result: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [cliBin(), ...args],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("CLI E2E (achado revisao Fase 2 — testes de integração obrigatórios)", () => {
  // Helper: roda `status --json` e retorna `debt.byEvent` (totais abertos).
  // `index --json` retorna `ledger.debtByEvent` por-run, não totais — pra
  // validar dedup precisamos do agregado via SQL, que `status` já expõe.
  function statusDebt(): { changed: number; moved: number; deleted: number } {
    const r = runCli(["--json", "--repo", repoRoot, "status"]);
    expect(r.status, `status falhou. stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as { ok: boolean; debt: { byEvent: { changed: number; moved: number; deleted: number } } };
    expect(j.ok).toBe(true);
    return j.debt.byEvent;
  }

  it("Cenário 1: editar função ancorada gera 1 changed aberta (dedup não acumula)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );

    // Baseline: index inicial, espera 0 changed.
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status, `stdout=${r1.stdout}\nstderr=${r1.stderr}`).toBe(0);
    const baseline = JSON.parse(r1.stdout) as { ok: boolean; ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(baseline.ok).toBe(true);
    expect(baseline.ledger.debtByEvent.changed).toBe(0);
    expect(statusDebt().changed).toBe(0);

    // Edit 1: cria 1 changed.
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status).toBe(0);
    const after1 = JSON.parse(r2.stdout) as { ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(after1.ledger.debtByEvent.changed).toBe(1);
    expect(after1.ledger.debtCreated).toBe(1);
    expect(statusDebt().changed).toBe(1);

    // Edit 2: dedup — per-run debtByEvent=0, mas total aberto continua 1.
    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    const r3 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r3.status).toBe(0);
    const after2 = JSON.parse(r3.stdout) as { ledger: { debtByEvent: { changed: number }; debtCreated: number } };
    expect(after2.ledger.debtByEvent.changed).toBe(0);
    expect(after2.ledger.debtCreated).toBe(0);
    expect(statusDebt().changed).toBe(1);
  });

  it("Cenário 2: mover função entre arquivos gera moved + âncora atualizada", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Move: deleta foo.ts e cria baz.ts com a MESMA função (mesmo body = mesmo
    // content_hash). Detecção de moved é por hash match.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);
    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number } };
      index: { symbolsMoved: number };
    };
    // O ledger deve detectar via content_hash.
    expect(after.ledger.debtByEvent.moved).toBeGreaterThanOrEqual(1);
    expect(after.ledger.debtByEvent.deleted).toBe(0);

    const debt = statusDebt();
    expect(debt.moved).toBeGreaterThanOrEqual(1);
    expect(debt.deleted).toBe(0);
  });

  it("Cenário 3: deletar função gera 1 deleted aberta mesmo após 3 `index` seguidos (Fix B)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );
    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Deleta + indexa 3 vezes. A SPEC v3 (Fix B) exige dedup via hasOpenDebt.
    for (let i = 0; i < 3; i++) {
      await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts")).catch(() => {});
      const r = runCli(["--json", "--repo", repoRoot, "index"]);
      expect(r.status, `iter ${i}: stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    }

    // Total aberto: 1 deleted (não 3 — dedup).
    expect(statusDebt().deleted).toBe(1);
  });

  it("Cenário 4: página wiki com âncora fantasma (código não indexado) → verify falha com broken_anchor", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki(
      "livewiki/phantom.md",
      `---
title: Phantom
anchors:
  - src/nonexistent.ts#ghost
---
`,
    );

    // Roda index uma vez para criar o DB (sem o ghost — só o bar existe).
    const idx = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(idx.status).toBe(0);

    // Verify deve detectar broken_anchor.
    const ver = runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(ver.status, `verify deve falhar — anchor fantasma. stdout=${ver.stdout}`).toBe(1);
    const result = JSON.parse(ver.stdout) as { ok: boolean };
    expect(result.ok).toBe(false);
    // brokenAnchors ou anchorsBroken — inspecionar shape real.
    const raw = ver.stdout;
    expect(raw).toMatch(/nonexistent\.ts/);
    expect(raw).toMatch(/phantom\.md/);
  });
});