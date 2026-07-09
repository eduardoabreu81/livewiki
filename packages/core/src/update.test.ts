/**
 * update — testes do modo incremental (Fase 5).
 *
 * Cobre o coração do produto: loadWorkPackage emite pacote focado
 * (debt + snippets + validAnchors + tokens estimados). Tese: pacote
 * pequeno (~800 tokens) vs reler repo inteiro (~12.5k tokens).
 *
 * Critério de aceite (SPEC §Fase 5):
 *   "fluxo de ponta a ponta — agente altera código, hook detecta, agente
 *    paga a dívida via MCP, verify passa, manifest atualizado."
 *
 * Aqui cobrimos o "agente recebe pacote + paga dívida via write_doc":
 *   - loadWorkPackage retorna debt correta (changed/moved/deleted)
 *   - snippets têm source real do arquivo
 *   - validAnchors são symbols ativos
 *   - tokensEstimated > 0 e razoável
 *   - status --json expõe metrics com a eficiência (write/package)
 *   - recordDocWrittenBack atualiza efficiencyRatio
 *
 * Helpers: setup que inclui uma página wiki com anchor — sem isso,
 * o ledger não gera debt (regra: debt = anchor mudou; sem anchor,
 * nada para detectar).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadWorkPackage,
  recordDocWrittenBack,
  CHARS_PER_TOKEN,
} from "./update.js";
import {
  snapshotMetrics,
  clearMetricsForTests,
} from "./update-metrics.js";
import { runInit } from "./init.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runStatus } from "./status.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), "livewiki-update-"));
  await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  await clearMetricsForTests(repoRoot);
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = join(repoRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = join(repoRoot, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content);
}

/**
 * Setup que coloca uma página wiki com anchor pra foo.ts#bar — sem isso,
 * o anchor-ledger não detecta mudança (regra: debt = anchor mudou).
 */
async function setupWithAnchor(): Promise<void> {
  await writeCode("src/foo.ts", "export function bar() { return 1; }");
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
  await writeWiki(
    "livewiki/foo.md",
    `---
title: foo
owner: generated
anchors:
  - src/foo.ts#bar
---

# foo

Documentation.
`,
  );
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
}

describe("update.loadWorkPackage — Fase 5 (modo incremental)", () => {
  it("pacote inclui manifest quando livewiki foi inicializado", async () => {
    await setupWithAnchor();
    await runInit({ repoRoot, quiet: true });
    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.manifest).not.toBeNull();
    expect(pkg.bytes).toBeGreaterThan(0);
  });

  it("pacote sem manifest se repo nunca foi inicializado", async () => {
    // Sem setupWithAnchor e sem runInit — manifest nunca foi gravado
    await writeCode("src/foo.ts", "export function bar() {}");
    await runIndexer(repoRoot, { quiet: true });
    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.manifest).toBeNull();
    expect(pkg.bytes).toBeGreaterThan(0);
  });

  it("detecta changed quando source é modificado (anchor existente)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      "export function bar() { return 2; /* mudou */ }",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    const changed = pkg.debt.filter((d) => d.event === "changed");
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.some((d) => d.symbol_key === "src/foo.ts#bar")).toBe(true);
  });

  it("snippets têm source real do arquivo (janela em torno do symbol)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      [
        "// linha 0",
        "// linha 1",
        "// linha 2",
        "export function bar() { return 999; /* mudou */ }",
        "// linha 4",
        "// linha 5",
      ].join("\n"),
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    const snippet = pkg.snippets.find((s) => s.symbolKey === "src/foo.ts#bar");
    expect(snippet).toBeDefined();
    expect(snippet?.filePath).toBe("src/foo.ts");
    // Snippet inclui o source modificado (return 999)
    expect(snippet?.snippet).toMatch(/return 999/);
    // E linhas de contexto
    expect(snippet?.snippet).toMatch(/linha/);
  });

  it("tokensEstimated > 0 quando há dívida", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.tokensEstimated).toBeGreaterThan(0);
    expect(pkg.tokensEstimated).toBeLessThan(10000); // ~800 esperado, sanidade
  });

  it("validAnchors = symbols ativos do debt", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    expect(pkg.validAnchors).toContain("src/foo.ts#bar");
  });

  it("respeita maxSnippets (defesa contra dívida gigante)", async () => {
    // 5 arquivos com anchor cada
    for (let i = 0; i < 5; i++) {
      await writeCode(`src/file${i}.ts`, `export function fn${i}() { return 1; }`);
      await writeWiki(
        `livewiki/file${i}.md`,
        `---
title: file${i}
owner: generated
anchors:
  - src/file${i}.ts#fn${i}
---
`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    for (let i = 0; i < 5; i++) {
      await writeCode(`src/file${i}.ts`, `export function fn${i}() { return 2; }`);
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot, { maxSnippets: 2 });
    expect(pkg.snippets.length).toBeLessThanOrEqual(2);
  });

  it("respeita snippetWindow (custom)", async () => {
    await setupWithAnchor();
    await writeCode(
      "src/foo.ts",
      Array.from({ length: 50 }, (_, i) => `// linha ${i}`).join("\n") +
        "\nexport function bar() { return 2; }",
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot, { snippetWindow: 5 });
    const snippet = pkg.snippets.find((s) => s.symbolKey === "src/foo.ts#bar");
    expect(snippet).toBeDefined();
    // snippetWindow=5 + 3 linhas de contexto antes/depois = ~11 linhas
    const lines = snippet?.snippet.split("\n") ?? [];
    expect(lines.length).toBeLessThanOrEqual(15);
  });
});

describe("update — contabilidade (SPEC §Contabilidade)", () => {
  it("recordDocWrittenBack atualiza efficiencyRatio", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    // Emite pacote
    await loadWorkPackage(repoRoot);
    const snap1 = await snapshotMetrics(repoRoot);
    expect(snap1?.packagesEmitted).toBeGreaterThanOrEqual(1);

    // Agente escreve doc (write de 100 tokens)
    await recordDocWrittenBack(repoRoot, {
      wikiPath: "livewiki/foo.md",
      bytes: 400,
      tokensEstimated: 100,
    });

    const snap2 = await snapshotMetrics(repoRoot);
    expect(snap2?.writesReceived).toBe(1);
    // efficiencyRatio = writes/packages. Pode ser < 1 ou > 1 dependendo
    // do tamanho do pacote — o teste só verifica que atualiza.
    expect(snap2?.efficiencyRatio).not.toBeNull();
  });

  it("snapshot é null-efficiency quando nunca houve update", async () => {
    await setupWithAnchor();
    const snap = await snapshotMetrics(repoRoot);
    expect(snap?.packagesEmitted).toBe(0);
    expect(snap?.writesReceived).toBe(0);
    expect(snap?.efficiencyRatio).toBeNull();
  });

  it("status --json inclui metrics (expostos via SPEC §Contabilidade)", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await loadWorkPackage(repoRoot);

    const status = await runStatus(repoRoot);
    expect(status.metrics).not.toBeNull();
    expect(status.metrics?.packagesEmitted).toBeGreaterThanOrEqual(1);
    expect(status.metrics?.totalPackageTokens).toBeGreaterThan(0);
  });
});

describe("update — economia (tese do produto)", () => {
  it("pacote é menor que 'reler repo inteiro' (~12.5k tokens)", async () => {
    // Cria 20 arquivos cada com anchor próprio
    for (let i = 0; i < 20; i++) {
      await writeCode(
        `src/file${i}.ts`,
        Array.from({ length: 50 }, (_, j) => `// linha ${j}`).join("\n") +
          `\nexport function fn${i}() { return ${i}; }`,
      );
      await writeWiki(
        `livewiki/file${i}.md`,
        `---
title: file${i}
anchors: [src/file${i}.ts#fn${i}]
---
`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    // Modifica todos (gera 20 changed)
    for (let i = 0; i < 20; i++) {
      await writeCode(
        `src/file${i}.ts`,
        Array.from({ length: 50 }, (_, j) => `// linha ${j}`).join("\n") +
          `\nexport function fn${i}() { return ${i + 100}; }`,
      );
    }
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const pkg = await loadWorkPackage(repoRoot);
    // Tese: pacote bem menor que os 12.5k estimados de "reler repo inteiro".
    expect(pkg.tokensEstimated).toBeLessThan(12500);
    expect(pkg.tokensEstimated).toBeGreaterThan(0);
  });
});

describe("update — CHARS_PER_TOKEN (heurística)", () => {
  it("constante é 4 (heurística padrão GPT/code)", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
  });
});

describe("update — files persistidos", () => {
  it("update_metrics.json é criado em .livewiki/", async () => {
    await setupWithAnchor();
    await writeCode("src/foo.ts", "export function bar() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await loadWorkPackage(repoRoot);

    const raw = await readFile(
      join(repoRoot, ".livewiki/update_metrics.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries.length).toBeGreaterThanOrEqual(1);
    expect(parsed.entries[0].kind).toBe("package_emitted");
  });
});