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
  it("link relativo que escapa do namespace livewiki/ (../../etc/secrets.md) é reportado como broken (não bloqueia)", async () => {
    // SPEC §safe-io: escrita restrita. Mas verify é leitura — não bloqueia
    // links que apontam para fora. Apenas reporta como broken_internal_link.
    // Q — fix: agora a resolução usa path.posix (resolve ".." corretamente)
    // e o allowlist check (isInsideWiki) pega tentativas de escape.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki("livewiki/index.md", "# Home\n\nVeja [Nada](../../etc/secrets.md).");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.severity).toBe("warning");
    // detail mostra o wiki-path RESOLVIDO (sem ser livewiki/../etc/secrets.md)
    expect(broken[0]?.detail).toMatch(/fora de livewiki/);
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

  it("(Q) link relativo com '..' resolve corretamente para livewiki/ (overview → módulo)", async () => {
    // Cenário do achado Q (revisão Fase 4): overview em livewiki/architecture/
    // emite [page](../<modulo>.md) — antes do fix, verify normalizava como
    // "livewiki/../auth.md" e reportava broken_internal_link. Agora deve
    // resolver pra "livewiki/auth.md" e validar OK.
    await writeCode("src/auth/login.ts", "export function login() {}");
    await writeWiki(
      "livewiki/architecture/overview.md",
      `# Architecture overview

See [auth page](../auth.md) and [class diag](../diagrams/auth.classes.mmd).
`,
    );
    await writeWiki("livewiki/auth.md", "# auth\n");
    await writeWiki("livewiki/diagrams/auth.classes.mmd", "classDiagram\n  class auth\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken).toEqual([]);
  });

  it("(Q) link relativo com '..' para página inexistente reporta broken (não false negative)", async () => {
    // Garante que o fix não é "aceita qualquer '..'" — links relativos
    // devem ser validados corretamente mesmo após resolução.
    await writeCode("src/foo.ts", "export const x = 1");
    await writeWiki(
      "livewiki/architecture/overview.md",
      "# Architecture overview\n\nSee [Nada](../nope.md).",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const result = await runVerify(repoRoot);
    const broken = result.issues.filter((i) => i.code === "broken_internal_link");
    expect(broken.length).toBe(1);
    expect(broken[0]?.detail).toContain("livewiki/nope.md");
  });
});

describe("formatHuman", () => {
  it("formats OK result", () => {
    const out = formatHuman({ ok: true, pagesChecked: 3, issues: [] });
    expect(out).toContain("OK");
    expect(out).toContain("3 pages");
    expect(out).toContain("no issues");
  });

  it("formats result with errors and warnings", () => {
    const out = formatHuman({
      ok: false,
      pagesChecked: 2,
      issues: [
        { severity: "error", code: "broken_anchor", wikiPath: "livewiki/foo.md", detail: "broken" },
        { severity: "warning", code: "broken_internal_link", wikiPath: "livewiki/bar.md", detail: "link" },
      ],
    });
    expect(out).toContain("FAILED");
    expect(out).toContain("1 errors");
    expect(out).toContain("1 warnings");
    expect(out).toContain("ERROR");
    expect(out).toContain("WARN");
  });
});