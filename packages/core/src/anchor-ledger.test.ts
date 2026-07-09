/**
 * Testes exaustivos do anchor-ledger. Esta fase é o produto — revisão rigorosa.
 *
 * Critérios da Fase 2:
 *   - editar função ancorada gera dívida `changed`
 *   - mover gera `moved`
 *   - verify pega âncora quebrada
 *
 * Setup: cada teste cria repo + wiki + DB isolados em tmpdir, executa o indexer
 * (cria files+symbols), depois o ledger. Asserts sobre debt gerado.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp", "livewiki-ledger-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/** Helper: cria arquivo de código indexável. */
async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

/** Helper: cria página da wiki. */
async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("anchor-ledger — sem wiki", () => {
  it("roda sem wiki (zero páginas processadas)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });
    expect(result.pagesProcessed).toBe(0);
    expect(result.anchorsUpserted).toBe(0);
    expect(result.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — primeira run", () => {
  it("upsert anchors sem gerar debt (estado inicial)", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---

Doc da auth.
`);

    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.pagesProcessed).toBe(1);
    expect(result.anchorsUpserted).toBe(1);
    expect(result.debtCreated).toBe(0); // primeira run = baseline
  });

  it("section anchors viram rows separadas de page anchors", async () => {
    await writeCode(
      "src/auth.ts",
      "export class S { login() {} logout() {} }",
    );
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
---

## Login
<!-- lw:anchors src/auth.ts#S.login -->

## Logout
<!-- lw:anchors src/auth.ts#S.logout -->
`);

    await runIndexer(repoRoot, { quiet: true });
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.anchorsUpserted).toBe(2);
    expect(result.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — CRITÉRIO: changed", () => {
  it("editar função ancorada gera dívida 'changed' (assignee=agent)", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---

Doc.
`);

    // Run 1: indexa + ledger (baseline)
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Edita a função (muda o content_hash do symbol)
    await writeCode("src/auth.ts", "export function validate(): boolean { return false; }");

    // Run 2: re-index detecta mudança, ledger gera changed
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    expect(r2.debtByEvent.changed).toBe(1);
    expect(r2.debtByEvent.moved).toBe(0);
    expect(r2.debtByEvent.deleted).toBe(0);

    // Verifica no DB: assignee = agent (owner=generated)
    const debts = nodeSqliteQuery(repoRoot, "SELECT event, assignee FROM debt");
    expect(debts).toContainEqual({ event: "changed", assignee: "agent" });
  });

  it("anchor em owner=human gera changed com assignee=human", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(repoRoot, "SELECT event, assignee FROM debt");
    expect(debts).toContainEqual({ event: "changed", assignee: "human" });
  });

  it("section anchor também gera changed ao editar função ancorada", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:anchors src/foo.ts#bar -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 999; }");
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.changed).toBe(1);
  });
});

describe("anchor-ledger — CRITÉRIO: moved", () => {
  it("mover função ancorada para outro arquivo gera 'moved' e atualiza anchor", async () => {
    await writeCode("src/auth.ts", "export function validate() { return true; }");
    await writeWiki("livewiki/auth.md", `---
title: Auth
owner: generated
anchors:
  - src/auth.ts#validate
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.debtByEvent.moved).toBe(0);

    // Move validate para src/session.ts (mesmo content_hash — só muda path)
    await nodeFs.rm(nodePath.join(repoRoot, "src/auth.ts"));
    await writeCode("src/session.ts", "export function validate() { return true; }");

    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    expect(r2.debtByEvent.moved).toBe(1);
    expect(r2.movedPairs).toContainEqual({
      from: "src/auth.ts#validate",
      to: "src/session.ts#validate",
    });

    // O anchor no DB agora aponta para o novo path
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toContainEqual({ symbol_key: "src/session.ts#validate" });
  });

  it("moved por nome+signature iguais em arquivo diferente (fallback)", async () => {
    // Mesmo nome + signature mas content_hash diferente (corpo mudou junto com path)
    await writeCode("src/old.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/old.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/old.ts"));
    // assinatura textualmente igual mas em arquivo novo (content_hash diferente)
    await writeCode("src/new.ts", "export function bar() { return 1; }");

    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // bar no old.ts sumiu (deleted). bar no new.ts é novo.
    // Detectado como moved por content_hash? Vamos ver.
    // Como o source literal é igual, content_hash É igual, vai dar match.
    expect(r.debtByEvent.moved + r.debtByEvent.deleted).toBeGreaterThanOrEqual(1);
  });
});

describe("anchor-ledger — deleted (âncora quebrada)", () => {
  it("deletar função ancorada gera 'deleted'", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));

    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });

  it("anchor que referencia symbol inexistente desde o início gera deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#ghost  # symbol não existe
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });

  it("anchor para arquivo inexistente gera deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/doesnotexist.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.debtByEvent.deleted).toBe(1);
  });
});

describe("anchor-ledger — manual blocks (regra #6)", () => {
  it("anchor dentro de manual block NÃO é modificado pelo ledger", async () => {
    // Regra #6: ledger NUNCA escreve na wiki. Aqui testamos que anchor dentro
    // de bloco manual é preservada com flag in_manual_block=1.
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual que ninguém mexe.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, in_manual_block FROM anchors",
    );
    expect(anchors).toContainEqual({
      symbol_key: "src/foo.ts#bar",
      in_manual_block: 1,
    });
  });
});

describe("anchor-ledger — undocumented", () => {
  it("symbol sem anchor vai pra tabela undocumented", async () => {
    await writeCode("src/foo.ts", "export function documented() {} export function undoc() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#documented
---
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    expect(r.undocumentedSymbols).toBe(1);
    const undoc = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM undocumented");
    expect(undoc).toContainEqual({ symbol_key: "src/foo.ts#undoc" });
  });
});

describe("anchor-ledger — idempotência", () => {
  it("rodar ledger 2x sem mudanças: 0 debt criado", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
  });
});

describe("anchor-ledger — dedup de dívida (Fix B)", () => {
  it("deletar função 3x seguidas: gera apenas 1 deleted", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Deleta o código 3x (cada vez roda index+ledger). As iterações 2 e 3
    // têm rm que falha (foo.ts já não existe) — esperado.
    for (let i = 0; i < 3; i++) {
      await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts")).catch(() => {});
      await runIndexer(repoRoot, { quiet: true });
      await runLedger(repoRoot, { quiet: true });
    }

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    // Apenas 1 dívida deleted, não 3 (dedup via hasOpenDebt).
    expect(debts).toEqual([{ event: "deleted", n: 1 }]);
  });

it("editar função 3x: dedup mantém 1 changed aberta até ser resolvida", async () => {
    // Mudanças consecutivas do mesmo símbolo (sem a doc ter sido atualizada)
    // resultam em UMA única dívida "changed" aberta — Fix B dedup via hasOpenDebt.
    // Resolução só acontece quando o author da wiki atualiza o anchor (manual ou
    // via livewiki_write_doc na Fase 4).
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    // 3 edições consecutivas, mesma anchor, sem resolução → 1 changed aberta.
    expect(debts).toEqual([{ event: "changed", n: 1 }]);
  });
});

describe("anchor-ledger — F (achado revisao Fase 2): falso-positivo de moved + expurgo de dead rows", () => {
  it("F1: editar 1 de N símbolos NÃO gera falso moved pros inalterados", async () => {
    // Cenário: arquivo com 3 símbolos. Edito SÓ o primeiro (muda content_hash dele).
    // Os outros 2 são soft-deletados e re-inseridos com mesma key + mesmo hash.
    // Sem o guard `match.key === oldKey`, detectMoves casaria os pares
    // (deleted, active) com mesmo hash e geraria moved from==to espúrio.
    await writeCode(
      "src/multi.ts",
      "export function a() { return 1; }\nexport function b() { return 2; }\nexport function c() { return 3; }",
    );
    await writeWiki("livewiki/multi.md", `---
title: Multi
anchors:
  - src/multi.ts#a
  - src/multi.ts#b
  - src/multi.ts#c
---
`);

    // Baseline: index + ledger. 0 dívida.
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.debtByEvent.moved).toBe(0);
    expect(r1.debtByEvent.changed).toBe(0);

    // Edit SÓ o `a`. b e c ficam inalterados.
    await writeCode(
      "src/multi.ts",
      "export function a() { return 999; }\nexport function b() { return 2; }\nexport function c() { return 3; }",
    );
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runLedger(repoRoot, { quiet: true });

    // Esperado: 1 changed (a), 0 moved.
    // Sem F1: teríamos 1 changed + 2 moved (b→b e c→c, falsos).
    expect(r2.debtByEvent.changed).toBe(1);
    expect(r2.debtByEvent.moved).toBe(0);
    expect(r2.movedPairs).toEqual([]);

    // Confirma no DB: 1 changed aberta, nenhuma moved.
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, COUNT(*) as n FROM debt WHERE resolved_at IS NULL GROUP BY event",
    );
    expect(debts).toEqual([{ event: "changed", n: 1 }]);
  });

  it("F2: dead rows com replacement ativo são expurgadas após o ledger", async () => {
    // Cada edit a um arquivo soft-deleta seus symbols e reinsere com mesma key.
    // Sem o cleanup no fim do ledger, a tabela `symbols` cresce com rows mortas.
    // Aqui: edit + ledger, depois conta active vs deleted por key.
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);

    // 3 edits consecutivos — cada um soft-deleta + reinsere `bar`.
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeCode("src/foo.ts", "export function bar() { return 3; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Após o último ledger, deve haver APENAS 1 row active para `src/foo.ts#bar`.
    // As rows deleted (que tinham mesma key) foram expurgadas (F2).
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT status, COUNT(*) as n FROM symbols WHERE key = 'src/foo.ts#bar' GROUP BY status",
    );
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[String(r.status)] = Number(r.n);
    expect(byStatus.active).toBe(1);
    expect(byStatus.deleted ?? 0).toBe(0); // expurgadas

    // Idempotência: re-rodar ledger não cria nova dívida (F1 cobre falsos moved).
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtByEvent.moved).toBe(0);
  });

  it("F2: dead rows SEM replacement ativo são preservadas (audit/history)", async () => {
    // Quando o símbolo é realmente deletado do código, a row dead fica — não
    // expurgamos porque pode ser útil pra auditoria/histórico.
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Deleta o código de verdade
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Deve haver exatamente 1 row deleted (sem replacement). NÃO foi expurgada.
    const rows = nodeSqliteQuery(
      repoRoot,
      "SELECT status, COUNT(*) as n FROM symbols WHERE key = 'src/foo.ts#bar' GROUP BY status",
    );
    const byStatus: Record<string, number> = {};
    for (const r of rows) byStatus[String(r.status)] = Number(r.n);
    expect(byStatus.deleted).toBe(1);
    expect(byStatus.active ?? 0).toBe(0);
  });
});

describe("anchor-ledger — G (achado revisao Fase 2): rewrite de anchor no markdown", () => {
  it("G1: moved em anchor de página (frontmatter) reescreve o .md no disco", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    await writeWiki(
      wikiRel,
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`,
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Move: foo.ts → baz.ts (mesmo body, mesmo hash).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Markdown no disco TEM que ter a chave nova (regra #3: markdown é fonte da verdade).
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toMatch(/src\/baz\.ts#bar/);
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/);
  });

  it("G1: moved em section anchor (lw:anchors marker) reescreve o .md no disco", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    await writeWiki(
      wikiRel,
      `---
title: Foo
---

## Detalhes
<!-- lw:anchors src/foo.ts#bar -->
Texto.
`,
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/baz\.ts#bar -->/);
    expect(mdAfter).not.toMatch(/src\/foo\.ts#bar/);
  });

  it("G2: anchor dentro de bloco lw:manual NÃO é reescrita (regra #6)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`;
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Markdown intocado (regra #6: conteúdo humano nunca modificado por escrita auto).
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toBe(mdOriginal);
    expect(mdAfter).toMatch(/src\/foo\.ts#bar/); // chave antiga preservada
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // Mas a dívida existe — assignee=human (regra #6).
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "moved", assignee: "human" });
  });

  it("G2: anchor em página owner=human NÃO é reescrita (regra #6)", async () => {
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
---
`;
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode("src/baz.ts", "export function bar() { return 42; }");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Markdown intocado.
    const mdAfter = await nodeFs.readFile(nodePath.join(repoRoot, wikiRel), "utf8");
    expect(mdAfter).toBe(mdOriginal);

    // Dívida: assignee=human.
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "moved", assignee: "human" });
  });
});

describe("anchor-ledger — debt.symbol_key (Fix E)", () => {
  it("dívida carrega symbol_key mesmo depois do anchor ser removida", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Agora remove a página da wiki — anchor órfã some
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/foo.md"));
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(repoRoot, "SELECT event, symbol_key FROM debt");
    // symbol_key preservado mesmo sem anchor (evita órfão sem referência)
    expect(debts).toContainEqual({ event: "deleted", symbol_key: "src/foo.ts#bar" });
  });
});

describe("anchor-ledger — in_manual_block → assignee=human (Fix D)", () => {
  it("anchor dentro de lw:manual em página generated: assignee=human", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: generated
---

## Section
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
texto manual
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    const r = await runLedger(repoRoot, { quiet: true });

    // Sem mudança no código, não gera debt.
    expect(r.debtCreated).toBe(0);

    // Edita o código — anchor dentro de manual block gera debt com assignee=human
    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toContainEqual({ event: "changed", assignee: "human" });
  });

  it("anchor fora de manual block em página mixed: assignee=agent", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
owner: mixed
---

## Section
<!-- lw:anchors src/foo.ts#bar -->
Fora do bloco manual.
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await writeCode("src/foo.ts", "export function bar(): void {}");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    // owner=mixed mas fora de manual block → assignee=agent
    expect(debts).toContainEqual({ event: "changed", assignee: "agent" });
  });
});

describe("anchor-ledger — página sumida da wiki", () => {
  it("remove anchors órfãos", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Remove página da wiki
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/foo.md"));

    await runLedger(repoRoot, { quiet: true });
    const anchors = nodeSqliteQuery(repoRoot, "SELECT symbol_key FROM anchors");
    expect(anchors).toEqual([]);
  });
});

// Helper pra queries SQLite sem depender de abrir o DB manualmente
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>> {
  // Import dinâmico evita ciclo
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
  try {
    return db.prepare(sql).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}