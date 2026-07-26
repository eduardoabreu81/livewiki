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
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-ledger-"),
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

describe("anchor-ledger — dot-prefixed pages (tier-2 hidden-dir modules)", () => {
  it("parses anchors from livewiki/.github.md and raises debt when the symbol changes", async () => {
    // Etapa 3 E2E finding: tier-2 modules from hidden source dirs (e.g.
    // .github/) produce dot-prefixed pages; the wiki walker skipped them,
    // so their anchors were never registered or validated.
    await writeCode("src/foo.ts", "export function bar() { return 1; }");
    await writeWiki("livewiki/.github.md", `---
title: GH
owner: generated
anchors:
  - src/foo.ts#bar
---

Docs.
`);

    await runIndexer(repoRoot, { quiet: true });
    const first = await runLedger(repoRoot, { quiet: true });
    expect(first.pagesProcessed).toBe(1);
    expect(first.anchorsUpserted).toBe(1);

    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    const second = await runLedger(repoRoot, { quiet: true });
    expect(second.debtCreated).toBe(1);
    expect(second.debtByEvent.changed).toBe(1);
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

    // Repeat-run idempotency: another ledger pass with no code or
    // Markdown change must keep exactly one persisted identity for the
    // moved anchor and not create additional open moved debt. The
    // canonical newKey row survives (collision handling: the manual
    // block's oldKey is preserved in the Markdown, so on a repeat
    // run a fresh oldKey row is inserted but then deleted in favor of
    // the existing newKey row; moved-debt dedup is by the canonical
    // newKey id, so the prior open moved debt covers this run).
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchorsAfter = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors",
    );
    expect(anchorsAfter).toEqual([{ symbol_key: "src/baz.ts#bar" }]);
    const movedDebts = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM debt WHERE event = 'moved' AND resolved_at IS NULL",
    );
    expect(movedDebts).toEqual([{ n: 1 }]);
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

  it("G2-ext: stale generated row must not rewrite surviving manual occurrence", async () => {
    // Defect 1 regression: a stale generated anchor row at the old
    // key must not trigger a page-wide oldKey -> newKey rewrite before
    // being rejected by the pre-move identity check. If the only
    // surviving occurrence of the old key is inside a manual block,
    // the rewrite would otherwise silently overwrite that manual
    // marker, breaking the manual-content rule.
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 42; }\n" +
        "export function baz() { return 99; }\n",
    );
    // Initial page: frontmatter has bar (generated) and a manual
    // block also has bar. Two persisted rows for the same key.
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
anchors:
  - src/foo.ts#bar
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    const r0 = await runLedger(repoRoot, { quiet: true });
    expect(r0.debtCreated).toBe(0);
    expect(
      nodeSqliteQuery(repoRoot, "SELECT COUNT(*) AS n FROM anchors"),
    ).toEqual([{ n: 2 }]);

    // User removes the generated occurrence from Markdown WITHOUT
    // running the ledger. The persisted generated row is now stale.
    await writeWiki(
      "livewiki/foo.md",
      `---
title: Foo
---

## Manual
<!-- lw:manual -->
<!-- lw:anchors src/foo.ts#bar -->
Texto manual.
<!-- /lw:manual -->
`,
    );

    // Source move: bar -> baz.ts (same body).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/baz.ts",
      "export function bar() { return 42; }\n" +
        "export function baz() { return 99; }\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // The manual marker must still reference the old key.
    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/foo.md"),
      "utf8",
    );
    expect(mdAfter).toMatch(/<!-- lw:anchors src\/foo\.ts#bar -->/);
    expect(mdAfter).not.toMatch(/src\/baz\.ts#bar/);

    // The DB has exactly one anchor row for the manual block (the
    // stale generated row was removed by reconciliation), and the
    // manual row was updated to newKey as part of the standard move
    // handling. The Markdown still references oldKey (regra #6), so
    // there is exactly one open moved debt with assignee=human.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, section_slug, in_manual_block FROM anchors",
    );
    expect(anchors).toEqual([
      {
        symbol_key: "src/baz.ts#bar",
        section_slug: "manual",
        in_manual_block: 1,
      },
    ]);
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts).toEqual([{ event: "moved", assignee: "human" }]);
  });

  it("G2-ext: owner:human with two distinct moves keeps distinct canonical ids and is repeat-idempotent", async () => {
    // Defect 2 + 3 regression: with two distinct moves from one file
    // in a single owner:human frontmatter, the canonical moved-anchor
    // id map (keyed only by page+section) collapses both moves onto
    // the same anchor id, and the NULL-sensitive frontmatter
    // collision lookup misses the existing newKey rows. The result
    // is duplicate newKey rows and duplicate open moved debts.
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 1; }\n" +
        "export function baz() { return 2; }\n",
    );
    const wikiRel = "livewiki/foo.md";
    const mdOriginal = `---
title: Foo
owner: human
anchors:
  - src/foo.ts#bar
  - src/foo.ts#baz
---
`;
    await writeWiki(wikiRel, mdOriginal);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Move both symbols to new.ts (same bodies).
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/new.ts",
      "export function bar() { return 1; }\n" +
        "export function baz() { return 2; }\n",
    );
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });

    // Markdown is unchanged.
    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );
    expect(mdAfter).toBe(mdOriginal);

    // Exactly one canonical newKey row per moved symbol.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors ORDER BY symbol_key",
    );
    expect(anchors).toEqual([
      { symbol_key: "src/new.ts#bar" },
      { symbol_key: "src/new.ts#baz" },
    ]);

    // Two distinct open moved debts referencing distinct anchor ids
    // and the correct new symbol keys.
    const movedDebts = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, anchor_id FROM debt WHERE event = 'moved' AND resolved_at IS NULL ORDER BY symbol_key, anchor_id",
    );
    expect(movedDebts).toHaveLength(2);
    const symbolKeys = movedDebts.map((d) => d.symbol_key);
    expect(symbolKeys).toEqual(["src/new.ts#bar", "src/new.ts#baz"]);
    const anchorIds = new Set(movedDebts.map((d) => d.anchor_id));
    expect(anchorIds.size).toBe(2);

    // Repeat run is idempotent: zero additional debt, anchor ids and
    // symbol keys are preserved, the persisted row count stays at 2.
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchors2 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors ORDER BY symbol_key",
    );
    expect(anchors2).toEqual([
      { symbol_key: "src/new.ts#bar" },
      { symbol_key: "src/new.ts#baz" },
    ]);
    const movedDebts2 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, anchor_id FROM debt WHERE event = 'moved' AND resolved_at IS NULL ORDER BY symbol_key, anchor_id",
    );
    expect(movedDebts2).toEqual(movedDebts);
  });

  it("G2-ext: rewrite respects manual blocks, code spans, and the anchors list scope", async () => {
    // Defect 1 + 2 + 3 regression: the same oldKey appears in many
    // places on a single page, only some of which are allowed
    // rewrite targets:
    //   1. the real frontmatter `anchors:` list (allowed rewrite);
    //   2. a later unrelated frontmatter list under another field
    //      (`related:`, must stay byte-identical — stop at the
    //      next top-level frontmatter key);
    //   3. a generated `<!-- lw:anchors -->` section marker
    //      (allowed rewrite);
    //   4. an ordinary Markdown bullet listing the key as text
    //      (NOT an anchor — must remain byte-identical);
    //   5. an `<!-- lw:anchors -->` marker inside a fenced code
    //      example (must remain byte-identical — code spans are
    //      not a structural rewrite surface);
    //   6. an `<!-- lw:anchors -->` marker inside an
    //      `<!-- lw:manual -->` block (must remain byte-identical
    //      — manual content is human-owned and byte-preserved).
    //
    // The fixture also uses CRLF line endings, a new key with
    // a materially different length from the old key (so any
    // offset drift caused by editing the frontmatter before
    // computing body positions would corrupt a marker inside the
    // manual block — defect 1), the `anchors:` field carries a
    // trailing YAML comment (a real, parser-accepted form that
    // the rewrite helper must recognize — defect 2), and the
    // closing `---` delimiter has trailing spaces (also real, also
    // parser-accepted — defect 1 of the current helper).
    await writeCode("src/foo.ts", "export function bar() { return 42; }");
    const wikiRel = "livewiki/foo.md";
    // CRLF line endings throughout. The `anchors:` line carries a
    // trailing comment; the closing `---` line has trailing spaces.
    const mdOriginal = [
      "---",
      "title: Foo",
      "anchors: # canonical symbol keys",
      "  - src/foo.ts#bar",
      "related:",
      "  - src/foo.ts#bar",
      "---   ",
      "",
      "## Detalhes",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "Texto da seção.",
      "",
      "- src/foo.ts#bar  # nota em prosa",
      "",
      "## Exemplo",
      "```markdown",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "```",
      "",
      "## Manual",
      "<!-- lw:manual -->",
      "<!-- lw:anchors src/foo.ts#bar -->",
      "- src/foo.ts#bar  # linha manual",
      "<!-- /lw:manual -->",
      "",
    ].join("\r\n");
    await writeWiki(wikiRel, mdOriginal);

    await runIndexer(repoRoot, { quiet: true });
    const r0 = await runLedger(repoRoot, { quiet: true });
    expect(r0.debtCreated).toBe(0);
    expect(
      nodeSqliteQuery(repoRoot, "SELECT COUNT(*) AS n FROM anchors"),
    ).toEqual([{ n: 3 }]);

    // Move foo.ts -> longer-name.ts. Different length (+7 chars)
    // forces every body offset to shift, so any offset
    // pre-computation against the original source must be
    // carefully isolated from frontmatter edits.
    await nodeFs.rm(nodePath.join(repoRoot, "src/foo.ts"));
    await writeCode(
      "src/longer-name.ts",
      "export function bar() { return 42; }",
    );

    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });

    const mdAfter = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );

    // CRLF line endings are preserved end-to-end. The Markdown
    // must not contain any bare LF outside of an LF that is part
    // of a CRLF pair (sanity: a leading \n without a preceding \r
    // would mean the rewrite dropped or normalized line endings).
    expect(mdAfter).toMatch(/^---/m);
    expect(mdAfter).toMatch(/\r\n/);
    // The closing delimiter with trailing spaces must be
    // recognized as a valid frontmatter end; the frontmatter
    // region therefore has the same line count before and after.
    const fmEndRe = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
    const fmOriginal = mdOriginal.match(fmEndRe)?.[0] ?? "";
    const fmAfter = mdAfter.match(fmEndRe)?.[0] ?? "";
    expect(fmOriginal.split(/\r\n/).length).toBe(fmAfter.split(/\r\n/).length);
    expect(fmOriginal).toContain("\r\n");
    // The closing delimiter line still carries its trailing
    // spaces — the rewrite must not eat them.
    expect(fmAfter).toMatch(/\r\n---   \r?\n/);

    // Allowed rewrites happened:
    //   - the real frontmatter anchor entry: src/foo.ts#bar -> src/longer-name.ts#bar
    //     The `anchors:` line itself keeps its trailing comment.
    const anchorsRe =
      /^[ \t]*anchors:[^\r\n]*\r?\n([\s\S]*?)(?=^[ \t]*[A-Za-z_][\w-]*[ \t]*:|\r?\n---)/m;
    const fmAnchorsOriginal = fmOriginal.match(anchorsRe)?.[1] ?? "";
    const fmAnchorsAfter = fmAfter.match(anchorsRe)?.[1] ?? "";
    expect(fmAfter).toMatch(/^[ \t]*anchors:[ \t]*# canonical symbol keys\r?$/m);
    expect(fmAnchorsAfter).toMatch(/^[ \t]*-[ \t]+src\/longer-name\.ts#bar\r?$/m);
    expect(fmAnchorsAfter).not.toMatch(/src\/foo\.ts#bar/);
    //   - the real generated section marker
    expect(mdAfter).toMatch(
      /<!--\s*lw:anchors\s+src\/longer-name\.ts#bar\s*-->/,
    );

    // Preserved byte-identical:
    //   - the later unrelated frontmatter list (`related:`) keeps oldKey
    const relatedRe = /^[ \t]*related:[ \t]*\r?\n([\s\S]*?)(?=^[ \t]*[A-Za-z_][\w-]*[ \t]*:|\r?\n---)/m;
    const fmRelatedOriginal = fmOriginal.match(relatedRe)?.[1] ?? "";
    const fmRelatedAfter = fmAfter.match(relatedRe)?.[1] ?? "";
    expect(fmRelatedAfter).toBe(fmRelatedOriginal);
    expect(fmRelatedAfter).toMatch(/^[ \t]*-[ \t]+src\/foo\.ts#bar\r?$/m);
    expect(fmRelatedAfter).not.toMatch(/src\/longer-name\.ts#bar/);
    //   - the ordinary body bullet keeps oldKey
    expect(mdAfter).toMatch(/- src\/foo\.ts#bar  # nota em prosa\r\n/);
    //   - the fenced code example content is byte-identical
    const fenceRe = /```markdown\r?\n([\s\S]*?)\r?\n```/;
    const originalFence = mdOriginal.match(fenceRe)?.[0] ?? "";
    const afterFence = mdAfter.match(fenceRe)?.[0] ?? "";
    expect(afterFence).toBe(originalFence);
    expect(afterFence).toContain("src/foo.ts#bar");
    expect(afterFence).not.toContain("src/longer-name.ts#bar");
    //   - the complete manual block is byte-identical (no marker or
    //     body line inside the manual range changed)
    const manualRe = /<!--\s*lw:manual\s*-->([\s\S]*?)<!--\s*\/lw:manual\s*-->/;
    const originalManual = mdOriginal.match(manualRe)?.[0] ?? "";
    const afterManual = mdAfter.match(manualRe)?.[0] ?? "";
    expect(afterManual).toBe(originalManual);
    expect(afterManual).toContain("src/foo.ts#bar");
    expect(afterManual).not.toContain("src/longer-name.ts#bar");

    // The Markdown is not byte-identical overall (frontmatter and
    // section marker were rewritten), but every protected region
    // listed above is.
    expect(mdAfter).not.toBe(mdOriginal);

    // Canonical database identities: the manual block row is
    // in_manual_block=1 (rewrite skipped), but it was still updated
    // to the new symbol key in SQLite by the move handling. The
    // generated section marker row is in_manual_block=0. The
    // frontmatter row is in_manual_block=0 (page slot). The
    // Exemplo section has no row because its marker sits inside
    // a fenced code block and is masked by the parser.
    const anchors = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key, section_slug, in_manual_block FROM anchors ORDER BY section_slug NULLS FIRST, rowid",
    );
    expect(anchors).toEqual([
      { symbol_key: "src/longer-name.ts#bar", section_slug: null, in_manual_block: 0 },
      { symbol_key: "src/longer-name.ts#bar", section_slug: "detalhes", in_manual_block: 0 },
      { symbol_key: "src/longer-name.ts#bar", section_slug: "manual", in_manual_block: 1 },
    ]);

    // Moved debt: one per persisted row. Non-manual rows are
    // assignee=agent (rewritten in Markdown), manual row is
    // assignee=human (rule #6).
    const debts = nodeSqliteQuery(
      repoRoot,
      "SELECT event, assignee FROM debt WHERE resolved_at IS NULL ORDER BY id",
    );
    expect(debts).toEqual([
      { event: "moved", assignee: "agent" },
      { event: "moved", assignee: "agent" },
      { event: "moved", assignee: "human" },
    ]);

    // Repeat run is idempotent: zero new debt, anchor rows stable.
    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    const anchors2 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM anchors",
    );
    expect(anchors2).toEqual([{ n: 3 }]);
    const debts2 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM debt WHERE resolved_at IS NULL",
    );
    expect(debts2).toEqual([{ n: 3 }]);
    // The Markdown remains identical after the repeat run (no
    // second rewrite of the already-rewritten anchors entry).
    const mdAfter2 = await nodeFs.readFile(
      nodePath.join(repoRoot, wikiRel),
      "utf8",
    );
    expect(mdAfter2).toBe(mdAfter);

    // Manual-block persistence: the page has exactly one
    // `<!-- lw:manual -->...<!-- /lw:manual -->` block, so the
    // ledger must keep exactly one stored row for it across
    // repeat runs. Duplicate rows make verify compare a stored
    // multiset against itself and emit false
    // `manual_block_altered` errors.
    const manualBlockRows = nodeSqliteQuery(
      repoRoot,
      "SELECT id, doc_page_id, start_offset, end_offset, content_hash " +
        "FROM manual_blocks ORDER BY id",
    );
    expect(manualBlockRows).toHaveLength(1);

    // verify must not emit any `manual_block_altered` issues for
    // this page. We do not assert zero total issues because the
    // intentionally preserved oldKey (e.g. inside the manual
    // block) legitimately produces a `broken_anchor`.
    const { run: runVerify } = await import("./verify.js");
    const verifyReport = await runVerify(repoRoot);
    const alteredIssues = verifyReport.issues.filter(
      (i) => i.code === "manual_block_altered",
    );
    expect(alteredIssues).toEqual([]);
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

describe("anchor-ledger — reconciliation by stable identity", () => {
  // Review finding (2026-07-16): the (doc_page_id, section_slug, symbol_key)
  // map identity correctly supports multiple frontmatter anchors, but the
  // ledger did NOT reconcile persisted rows against the current Markdown.
  //   - Replacing A with B in a page slot inserted a new B row but left
  //     the stale A row behind. The SQLite index drifted from disk; a
  //     later edit could resurrect debt from an anchor that no longer
  //     exists in the wiki.
  //   - Moved-anchor processing updated DB rows + ca.symbolKey but left
  //     existingAnchors indexed under oldKey, so the immediate diff
  //     could not find the row under newKey.
  // This test exercises the full contract: idempotency under repeated
  // runs, deterministic removal of stale identities, and no spurious
  // debt when a documentation page deliberately drops an anchor.
  it("retains A, removes the replaced B, inserts C; B becomes undocumented; no spurious debt", async () => {
    // 1. Three active symbols in one file.
    await writeCode(
      "src/lib.ts",
      "export function a() { return 1; }\n" +
        "export function b() { return 2; }\n" +
        "export function c() { return 3; }\n",
    );
    // 2. One wiki page with A and B in the frontmatter + matching section
    //    markers (so both kinds of slots are exercised).
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
anchors:
  - src/lib.ts#a
  - src/lib.ts#b
---

## Overview

## Reference
<!-- lw:anchors src/lib.ts#a src/lib.ts#b -->
`,
    );

    // 3. Index + ledger twice — must be idempotent: 0 debt, exactly 4
    //    anchor rows (A and B in frontmatter + A and B in section).
    await runIndexer(repoRoot, { quiet: true });
    const r1 = await runLedger(repoRoot, { quiet: true });
    expect(r1.pagesProcessed).toBe(1);
    expect(r1.anchorsUpserted).toBe(4);
    expect(r1.debtCreated).toBe(0);

    const r2 = await runLedger(repoRoot, { quiet: true });
    expect(r2.debtCreated).toBe(0);
    expect(r2.anchorsUpserted).toBe(4);

    const identities = (rows: Array<Record<string, unknown>>) =>
      rows
        .map((r) => `${r.doc_page_id}|${r.section_slug ?? "null"}|${r.symbol_key}`)
        .sort();
    const rows1 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    // doc_page_id is 1 on a fresh DB (only one page in this test).
    expect(identities(rows1)).toEqual([
      "1|null|src/lib.ts#a",
      "1|null|src/lib.ts#b",
      "1|reference|src/lib.ts#a",
      "1|reference|src/lib.ts#b",
    ]);

    // 4. Rewrite the page: B is removed from the frontmatter, the section
    //    marker switches B→C, and A is untouched in both slots.
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
anchors:
  - src/lib.ts#a
---

## Overview

## Reference
<!-- lw:anchors src/lib.ts#a src/lib.ts#c -->
`,
    );

    // 5. Run the ledger again. No source-code change, so no real change
    //    debt should appear.
    const r3 = await runLedger(repoRoot, { quiet: true });
    expect(r3.debtCreated).toBe(0);
    expect(r3.debtByEvent.changed).toBe(0);
    expect(r3.debtByEvent.moved).toBe(0);
    expect(r3.debtByEvent.deleted).toBe(0);

    // 6. The persisted identities MUST exactly match the current Markdown.
    const rows3 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(identities(rows3)).toEqual([
      "1|null|src/lib.ts#a",
      "1|reference|src/lib.ts#a",
      "1|reference|src/lib.ts#c",
    ]);

    // 7. The stale B rows (frontmatter + section) are GONE — exactly
    //    zero rows reference src/lib.ts#b.
    const staleB = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM anchors WHERE symbol_key = 'src/lib.ts#b'",
    );
    expect(staleB).toEqual([]);

    // 8. C exists once per legitimate page/section identity (section
    //    "reference" only — it was never in the frontmatter).
    const cRows = nodeSqliteQuery(
      repoRoot,
      "SELECT section_slug FROM anchors WHERE symbol_key = 'src/lib.ts#c'",
    );
    expect(cRows).toEqual([{ section_slug: "reference" }]);

    // 9. B has no other anchor → it must become undocumented.
    const undoc = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM undocumented",
    );
    expect(undoc).toEqual([{ symbol_key: "src/lib.ts#b" }]);

    // 10. A still has 0 debt — the documentation did not stop anchoring
    //     it, and the source code did not change.
    const openDebt = nodeSqliteQuery(
      repoRoot,
      "SELECT event FROM debt WHERE resolved_at IS NULL",
    );
    expect(openDebt).toEqual([]);

    // 11. Repeat-run idempotency: a fourth ledger call must not change
    //     anything.
    const r4 = await runLedger(repoRoot, { quiet: true });
    expect(r4.debtCreated).toBe(0);
    const rows4 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(identities(rows4)).toEqual(identities(rows3));

    // 12. Remove the final anchor (A from frontmatter, A from section,
    //     and C from section): the page keeps no anchors at all. A
    //     previously-processed page with zero current anchors must still
    //     be reconciled against an empty expected set, so every
    //     persisted row for the page is removed.
    await writeWiki(
      "livewiki/lib.md",
      `---
title: Lib
owner: generated
---

## Overview
`,
    );
    const r5 = await runLedger(repoRoot, { quiet: true });
    expect(r5.debtCreated).toBe(0);
    expect(r5.debtByEvent.changed).toBe(0);
    expect(r5.debtByEvent.moved).toBe(0);
    expect(r5.debtByEvent.deleted).toBe(0);

    const rows5 = nodeSqliteQuery(
      repoRoot,
      "SELECT doc_page_id, section_slug, symbol_key FROM anchors",
    );
    expect(rows5).toEqual([]);

    // The doc_page row stays — only the anchors were removed.
    const docPageRows = nodeSqliteQuery(
      repoRoot,
      "SELECT wiki_path FROM doc_pages",
    );
    expect(docPageRows).toEqual([{ wiki_path: "livewiki/lib.md" }]);

    // All three symbols are now undocumented (no anchors anywhere).
    const undoc5 = nodeSqliteQuery(
      repoRoot,
      "SELECT symbol_key FROM undocumented ORDER BY symbol_key",
    );
    expect(undoc5).toEqual([
      { symbol_key: "src/lib.ts#a" },
      { symbol_key: "src/lib.ts#b" },
      { symbol_key: "src/lib.ts#c" },
    ]);

    // 13. Repeat-run idempotency: a sixth ledger call does not change
    //     anything (the empty-page state stays empty, no debt).
    const r6 = await runLedger(repoRoot, { quiet: true });
    expect(r6.debtCreated).toBe(0);
    const rows6 = nodeSqliteQuery(
      repoRoot,
      "SELECT COUNT(*) AS n FROM anchors",
    );
    expect(rows6).toEqual([{ n: 0 }]);
    const openDebt6 = nodeSqliteQuery(
      repoRoot,
      "SELECT event FROM debt WHERE resolved_at IS NULL",
    );
    expect(openDebt6).toEqual([]);
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