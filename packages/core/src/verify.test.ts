import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, formatHuman } from "./verify.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(
      process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp",
      "livewiki-verify-",
    ),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

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

describe("verify — CRITÉRIO: âncora quebrada", () => {
  it("anchor para symbol inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#ghost   # symbol não existe
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    const broken = result.issues.filter((i) => i.code === "broken_anchor");
    expect(broken.length).toBeGreaterThanOrEqual(1);
    expect(broken[0]?.detail).toContain("src/foo.ts#ghost");
  });

  it("anchor para arquivo inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/nonexistent.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(false);
    const broken = result.issues.filter((i) => i.code === "broken_anchor");
    expect(broken.length).toBeGreaterThanOrEqual(1);
  });

  it("anchor válido: OK (sem broken_anchor)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
anchors:
  - src/foo.ts#bar
---
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.code === "broken_anchor")).toEqual([]);
  });
});

describe("verify — link interno aponta para página fora do allowlist", () => {
  it("link para ../../etc/passwd é aceito (verify não bloqueia; é só status)", async () => {
    // SPEC §safe-io: escrita restrita. Mas verify é leitura — não bloqueia
    // links que apontam para fora. Apenas reporta como broken_internal_link
    // se a página não existe no doc_pages.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](nonexistent.md).");
    await writeWiki("livewiki/foo.md", "# Foo");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
  });
});

describe("verify — manual block byte-a-byte (regra #6)", () => {
  it("bloco manual inalterado: OK", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
Texto manual sagrado.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "manual_block_altered")).toEqual([]);
  });

  it("bloco manual ALTERADO: detect (regra #6 — write rejeitado)", async () => {
    await writeCode("src/foo.ts", "export function bar() {}");
    await writeWiki("livewiki/foo.md", `---
title: Foo
---

## Section
<!-- lw:manual -->
Texto manual sagrado.
<!-- /lw:manual -->
`);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Altera o bloco (simulando bug do agente ou humano)
    const path = nodePath.join(repoRoot, "livewiki/foo.md");
    const original = await nodeFs.readFile(path, "utf8");
    await nodeFs.writeFile(
      path,
      original.replace("Texto manual sagrado.", "TEXTO MODIFICADO POR AGENTE"),
    );

    const result = await runVerify(repoRoot);
    const altered = result.issues.filter((i) => i.code === "manual_block_altered");
    expect(altered.length).toBe(1);
    expect(altered[0]?.severity).toBe("error");
  });
});

describe("verify — links internos", () => {
  it("link para página existente: OK", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Foo](foo.md).");
    await writeWiki("livewiki/foo.md", "# Foo\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    expect(result.issues.filter((i) => i.code === "broken_internal_link")).toEqual([]);
  });

  it("link para página inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](nope.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("nope.md");
  });

  it("link para #section inexistente: detect", async () => {
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Foo](foo.md#inexistente).");
    await writeWiki("livewiki/foo.md", "# Foo\n\n## Real\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("inexistente");
  });
});

describe("formatHuman", () => {
  it("formata resultado OK", () => {
    const out = formatHuman({ ok: true, pagesChecked: 3, issues: [] });
    expect(out).toContain("OK");
    expect(out).toContain("3 páginas");
    expect(out).toContain("nenhum problema");
  });

  it("formata resultado com errors e warnings", () => {
    const out = formatHuman({
      ok: false,
      pagesChecked: 2,
      issues: [
        { severity: "error", code: "broken_anchor", wikiPath: "livewiki/foo.md", detail: "broken" },
        { severity: "warning", code: "broken_internal_link", wikiPath: "livewiki/bar.md", detail: "link" },
      ],
    });
    expect(out).toContain("FALHOU");
    expect(out).toContain("1 erros");
    expect(out).toContain("1 avisos");
    expect(out).toContain("ERROR");
    expect(out).toContain("WARN");
  });
});