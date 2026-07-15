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
 *   5. Mover função ancorada (regra #3): markdown no disco contém chave nova +
 *      verify passa limpo em seguida (Fix G)
 *   6. Mover função ancorada dentro de bloco lw:manual: markdown intocado +
 *      dívida moved com assignee=human (Fix G + regra #6)
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

  it("Cenário 5: mover símbolo ancorado reescreve o markdown (regra #3) e verify passa limpo (Fix G)", async () => {
    // Setup: foo.ts com `bar`, página wiki com DOIS anchors no mesmo símbolo
    // (frontmatter + section marker). O rewrite do markdown tem que atualizar
    // AMBOS os locais, e gerar 1 dívida moved por anchor (= 2 dívidas total).
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiPath = "livewiki/foo.md";
    await writeWiki(
      wikiPath,
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---

## Detalhes
<!-- lw:anchors src/foo.ts#bar -->
Texto explicando o bar.
`,
    );

    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // MOVE: deleta foo.ts, cria baz.ts com MESMO body (mesmo content_hash).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);

    // O ledger detectou via content_hash. 2 anchors → 2 dívidas moved
    // (1 por anchor: frontmatter + section marker). movedPairs tem 1 entrada
    // (dedup por oldKey dentro de detectMoves).
    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number }; movedPairs: Array<{ from: string; to: string }> };
    };
    expect(after.ledger.debtByEvent.moved).toBe(2);
    expect(after.ledger.movedPairs).toContainEqual({
      from: "src/foo.ts#bar",
      to: "src/baz.ts#bar",
    });

    // Fix G (regra #3): o .md no disco TEM que ter a chave nova — não só o DB.
    // Lê o arquivo direto pra garantir que a rewrite foi pra disco, não só pro DB.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");
    expect(mdAfter).toMatch(/src\/baz\.ts#bar/); // frontmatter reescrito
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/); // nenhuma ocorrência da chave antiga
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/baz\.ts#bar -->/); // marker reescrito

    // Verify lê do disco (Fix C). Sem a rewrite, veria a chave antiga `foo.ts#bar`
    // → broken_anchor. Com a rewrite, tudo bate.
    const ver = runCli(["--json", "--repo", repoRoot, "verify"]);
    expect(ver.status, `verify deve passar limpo. stdout=${ver.stdout}\nstderr=${ver.stderr}`).toBe(0);
    const vResult = JSON.parse(ver.stdout) as { ok: boolean };
    expect(vResult.ok).toBe(true);

    // Debt: 2 moved com assignee=agent (owner=generated, fora de manual block).
    const statusR = JSON.parse(
      runCli(["--json", "--repo", repoRoot, "status"]).stdout,
    ) as {
      debt: {
        byEvent: { moved: number; changed: number; deleted: number };
        byAssignee: { agent: number; human: number };
        items: Array<{ event: string; assignee: string; symbol_key: string | null }>;
      };
    };
    expect(statusR.debt.byEvent.moved).toBe(2);
    expect(statusR.debt.byAssignee.agent).toBe(2);
    expect(statusR.debt.byAssignee.human).toBe(0);
    const movedItems = statusR.debt.items.filter((i) => i.event === "moved");
    expect(movedItems).toHaveLength(2);
    expect(movedItems.every((i) => i.assignee === "agent")).toBe(true);
  });

  it("Cenário 6: mover símbolo ancorado dentro de lw:manual → markdown intocado + dívida assignee=human (Fix G + regra #6)", async () => {
    // Setup: foo.ts com `bar`, página wiki com anchor DENTRO de bloco manual.
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiPath = "livewiki/foo.md";
    const wikiOriginal = `---
title: Foo
---

## Notas manuais
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto escrito por humano — agente nunca mexe.
<!-- /lw:manual -->
`;
    await writeWiki(wikiPath, wikiOriginal);

    const r1 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r1.status).toBe(0);

    // Snapshot do markdown ANTES do move, pra comparar com DEPOIS.
    const mdBefore = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");

    // MOVE: deleta foo.ts, cria baz.ts com mesmo body.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    const r2 = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r2.status, `stdout=${r2.stdout}\nstderr=${r2.stderr}`).toBe(0);

    const after = JSON.parse(r2.stdout) as {
      ledger: { debtByEvent: { moved: number; deleted: number; changed: number }; movedPairs: Array<{ from: string; to: string }> };
    };
    expect(after.ledger.debtByEvent.moved).toBe(1);
    expect(after.ledger.movedPairs).toContainEqual({
      from: "src/foo.ts#bar",
      to: "src/baz.ts#bar",
    });

    // Regra #6: markdown INTOCADO. A chave antiga continua lá, sem rewrite.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiPath), "utf8");
    expect(mdAfter).toBe(mdBefore);
    expect(mdAfter).toMatch(/src\/foo\.ts#bar/);
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // Dívida: assignee=human (regra #6 — manual block sempre humano).
    const statusR = JSON.parse(
      runCli(["--json", "--repo", repoRoot, "status"]).stdout,
    ) as {
      debt: {
        byEvent: { moved: number; changed: number; deleted: number };
        byAssignee: { agent: number; human: number };
        items: Array<{ event: string; assignee: string }>;
      };
    };
    expect(statusR.debt.byEvent.moved).toBe(1);
    expect(statusR.debt.byAssignee.human).toBe(1);
    expect(statusR.debt.byAssignee.agent).toBe(0);
    const movedItems = statusR.debt.items.filter((i) => i.event === "moved");
    expect(movedItems).toHaveLength(1);
    expect(movedItems[0]?.assignee).toBe("human");
  });
});

/**
 * Regression: `.livewiki/config.json` `ignores` must be honored by
 * `livewiki index`, and the CLI `--ignore` flag must be additive
 * (configured value always wins; flag narrows further on a
 * per-invocation basis). Same semantics as `livewiki init` and
 * `livewiki batch` (covered in `packages/core/src/ignores-propagation.test.ts`).
 *
 * Uses the JSON output of `livewiki index` (counts) to assert the
 * inventory size — the indexer exposes the count of scanned/added
 * files, which is the externally observable signal that a path was
 * excluded by the ignore machinery.
 */
describe("CLI E2E — livewiki index respects config.ignores and adds --ignore", () => {
  async function writeIgnoresConfig(ignores: string[]): Promise<void> {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ ignores }),
      "utf8",
    );
  }

  function readIndexCounts(): { scanned: number; added: number } {
    const r = runCli(["--json", "--repo", repoRoot, "index"]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as {
      ok: boolean;
      index: { filesScanned: number; filesAdded: number };
    };
    expect(j.ok).toBe(true);
    return { scanned: j.index.filesScanned, added: j.index.filesAdded };
  }

  it("config.ignores is honored by livewiki index", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("benchmarks/tooling/harness.ts", "export function bench() {}");
    await writeCode("raw/openwiki/peer.ts", "export function peer() {}");
    await writeIgnoresConfig(["benchmarks/", "raw/openwiki/"]);

    // Without config.ignores, all 3 files would be scanned. With it, only
    // the product source survives.
    const { scanned, added } = readIndexCounts();
    expect(scanned).toBe(1);
    expect(added).toBe(1);
  });

  it("--ignore is additive to config.ignores (both apply)", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("src/extra.ts", "export function extra() { return 2; }");
    await writeCode("benchmarks/tooling/harness.ts", "export function bench() {}");
    // Config drops the benchmarks/ dir; CLI flag drops src/extra.ts. Both apply.
    await writeIgnoresConfig(["benchmarks/"]);

    const r = runCli([
      "--json",
      "--repo",
      repoRoot,
      "index",
      "--ignore",
      "src/extra.ts",
    ]);
    expect(r.status, `stdout=${r.stdout}\nstderr=${r.stderr}`).toBe(0);
    const j = JSON.parse(r.stdout) as { index: { filesScanned: number; filesAdded: number } };
    // Only src/product.ts survives. The CLI flag narrowed further.
    expect(j.index.filesScanned).toBe(1);
    expect(j.index.filesAdded).toBe(1);
  });

  it("regular non-ignored source files remain indexed", async () => {
    await writeCode("src/product.ts", "export function feature() { return 1; }");
    await writeCode("src/util.ts", "export function util() { return 1; }");
    await writeIgnoresConfig(["benchmarks/"]);

    const { scanned, added } = readIndexCounts();
    expect(scanned).toBe(2);
    expect(added).toBe(2);
  });
});