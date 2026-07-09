import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runStatus } from "./status.js";

let repoRoot: string;
let sampleRepo: string;

beforeEach(async () => {
  // Resolve do CWD do test runner (packages/core/) — robusto.
  sampleRepo = nodePath.resolve(process.cwd(), "test/fixtures/sample-ts-repo");
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(process.env.TMPDIR ?? "C:\\Users\\Eduardo\\AppData\\Local\\Temp", "livewiki-indexer-"),
  );
  // Copia só os arquivos esperados (sem .livewiki da fixture contaminada).
  // node:fs.cp com recursive traria .livewiki junto se existir na fixture.
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "lib"), { recursive: true });
  await nodeFs.copyFile(
    nodePath.join(sampleRepo, "src", "auth.ts"),
    nodePath.join(repoRoot, "src", "auth.ts"),
  );
  await nodeFs.copyFile(
    nodePath.join(sampleRepo, "lib", "calc.py"),
    nodePath.join(repoRoot, "lib", "calc.py"),
  );
  await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), "node_modules/\n");
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("indexer end-to-end", () => {
  it("primeiro run: cria .livewiki/ + indexa 2 arquivos + extrai 6 symbols", async () => {
    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesScanned).toBe(2);
    expect(result.filesAdded).toBe(2);
    expect(result.filesUpdated).toBe(0);
    expect(result.filesUnchanged).toBe(0);
    expect(result.symbolsAdded).toBe(6);

    // .livewiki/index.db deve existir
    const dbPath = nodePath.join(repoRoot, ".livewiki", "index.db");
    expect(await nodeFs.stat(dbPath)).toBeTruthy();
  });

  it("segundo run sem mudanças: tudo inalterado (idempotente)", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runIndexer(repoRoot, { quiet: true });
    expect(r2.filesScanned).toBe(2);
    expect(r2.filesAdded).toBe(0);
    expect(r2.filesUpdated).toBe(0);
    expect(r2.filesUnchanged).toBe(2);
    expect(r2.symbolsAdded).toBe(0);
  });

  it("arquivo modificado: marca como updated e re-extrai símbolos", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const authPath = nodePath.join(repoRoot, "src", "auth.ts");
    const before = await nodeFs.readFile(authPath, "utf8");
    await nodeFs.writeFile(authPath, before + "\nexport function newOne() { return 99; }\n");

    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(1);
    expect(r.filesUnchanged).toBe(1);
    expect(r.symbolsAdded).toBe(7); // 6 antigos + 1 nova função
  });

  it("arquivo deletado: marca como removido e symbols como deleted", async () => {
    await runIndexer(repoRoot, { quiet: true });
    await nodeFs.rm(nodePath.join(repoRoot, "src", "auth.ts"));

    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesDeleted).toBe(1);
    expect(r.symbolsDeleted).toBe(6); // 6 símbolos do auth.ts marcados deleted
  });

  it("auto-cria .livewiki/ sem aviso", async () => {
    // Garante que .livewiki não existe antes
    await nodeFs.rm(nodePath.join(repoRoot, ".livewiki"), { recursive: true, force: true });

    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesAdded).toBe(2);
    expect(
      await nodeFs.stat(nodePath.join(repoRoot, ".livewiki", "index.db")),
    ).toBeTruthy();
  });

  it("status reflete o que foi indexado", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);
    expect(report.files.total).toBe(2);
    expect(report.files.byLang.typescript).toBe(1);
    expect(report.files.byLang.python).toBe(1);
    expect(report.symbols.total).toBe(6);
    expect(report.symbols.byKind.class).toBe(1);
    expect(report.symbols.byKind.method).toBe(2);
    expect(report.symbols.byKind.function).toBe(2);
    expect(report.symbols.byKind.export).toBe(1);
    expect(report.meta.schemaVersion).toBe(4);
  });
});