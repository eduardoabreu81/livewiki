import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  MANIFEST_REL_PATH,
  computeSnapshotHash,
  readManifest,
  writeManifestIfChanged,
  buildManifest,
} from "./manifest.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-manifest-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeLivewikiFile(relPath: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, relPath);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("manifest.computeSnapshotHash", () => {
  it("retorna hash estável pra mesmo conteúdo (determinístico)", async () => {
    await writeLivewikiFile("livewiki/auth.md", "auth doc");
    await writeLivewikiFile("livewiki/session.md", "session doc");

    const h1 = await computeSnapshotHash(repoRoot);
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("muda quando conteúdo de livewiki/ muda", async () => {
    await writeLivewikiFile("livewiki/auth.md", "v1");
    const h1 = await computeSnapshotHash(repoRoot);
    await writeLivewikiFile("livewiki/auth.md", "v2");
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).not.toBe(h2);
  });

  it("EXCLUI o próprio .manifest.json do hash", async () => {
    await writeLivewikiFile("livewiki/auth.md", "auth");
    const h1 = await computeSnapshotHash(repoRoot);

    // Grava manifest — não deve mudar o hash
    await writeLivewikiFile(
      MANIFEST_REL_PATH,
      JSON.stringify({
        version: 1,
        lastDocumentedCommit: null,
        snapshotHash: "fake",
        updatedAt: new Date().toISOString(),
        pendingBatch: null,
      }),
    );
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).toBe(h2);
  });

  it("ordem de walk é determinística (sort alfabético)", async () => {
    // Cria em ordem não-alfabética
    await writeLivewikiFile("livewiki/zzz.md", "z");
    await writeLivewikiFile("livewiki/aaa.md", "a");
    await writeLivewikiFile("livewiki/mmm.md", "m");

    const h1 = await computeSnapshotHash(repoRoot);
    // Recria na mesma ordem — mesmo hash
    await nodeFs.rm(repoRoot, { recursive: true });
    await nodeFs.mkdir(repoRoot, { recursive: true });
    await writeLivewikiFile("livewiki/zzz.md", "z");
    await writeLivewikiFile("livewiki/aaa.md", "a");
    await writeLivewikiFile("livewiki/mmm.md", "m");
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).toBe(h2);
  });

  it("lida com livewiki/ vazio (sem arquivos)", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    const h = await computeSnapshotHash(repoRoot);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("lida com livewiki/ inexistente", async () => {
    // Sem livewiki/ — deve retornar hash do vazio sem throw
    const h = await computeSnapshotHash(repoRoot);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("manifest.readManifest", () => {
  it("retorna null se manifest não existe", async () => {
    expect(await readManifest(repoRoot)).toBeNull();
  });

  it("lê manifest válido", async () => {
    await writeLivewikiFile(
      MANIFEST_REL_PATH,
      JSON.stringify({
        version: 1,
        lastDocumentedCommit: "abc123",
        snapshotHash: "h",
        updatedAt: "2026-07-09T10:00:00Z",
        pendingBatch: { runId: 1, stage: 4, done: 3, total: 10 },
      }),
    );
    const m = await readManifest(repoRoot);
    expect(m?.version).toBe(1);
    expect(m?.pendingBatch?.runId).toBe(1);
  });

  it("retorna null pra manifest corrompido (tolerância)", async () => {
    await writeLivewikiFile(MANIFEST_REL_PATH, "{ broken json");
    expect(await readManifest(repoRoot)).toBeNull();
  });
});

describe("manifest.writeManifestIfChanged", () => {
  it("grava se manifest não existe", async () => {
    const m = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: "h1",
      pendingBatch: null,
    });
    const wrote = await writeManifestIfChanged(repoRoot, m);
    expect(wrote).toBe(true);
    expect(await readManifest(repoRoot)).toEqual(m);
  });

  it("NÃO regrava se conteúdo é byte-idêntico (anti-loop CI)", async () => {
    const m = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: "h1",
      pendingBatch: null,
    });
    await writeManifestIfChanged(repoRoot, m);
    // mtimes é irrelevante — o que conta é o CONTEÚDO
    const wrote = await writeManifestIfChanged(repoRoot, m);
    expect(wrote).toBe(false);
  });

  it("regrava se snapshotHash muda", async () => {
    await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: null, snapshotHash: "h1", pendingBatch: null }),
    );
    const wrote = await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: null, snapshotHash: "h2", pendingBatch: null }),
    );
    expect(wrote).toBe(true);
  });

  it("regrava se pendingBatch muda", async () => {
    await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: null, snapshotHash: "h", pendingBatch: null }),
    );
    const wrote = await writeManifestIfChanged(
      repoRoot,
      buildManifest({
        lastDocumentedCommit: null,
        snapshotHash: "h",
        pendingBatch: { runId: 1, stage: 4, done: 3, total: 10 },
      }),
    );
    expect(wrote).toBe(true);
  });

  it("regrava se lastDocumentedCommit muda", async () => {
    await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: "abc", snapshotHash: "h", pendingBatch: null }),
    );
    const wrote = await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: "def", snapshotHash: "h", pendingBatch: null }),
    );
    expect(wrote).toBe(true);
  });
});

describe("manifest — idempotência end-to-end (correção #3)", () => {
  it("dois init seguidos sem mudança = manifest byte-idêntico", async () => {
    // Setup: wiki com 3 páginas + manifest inicial
    await writeLivewikiFile("livewiki/auth.md", "auth doc");
    await writeLivewikiFile("livewiki/session.md", "session doc");
    await writeLivewikiFile("livewiki/quickstart.md", "qs");

    // 1º "init": computa hash + grava manifest
    const hash1 = await computeSnapshotHash(repoRoot);
    const m1 = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: hash1,
      pendingBatch: null,
    });
    await writeManifestIfChanged(repoRoot, m1);

    // 2º "init" sem mudança: mesmo hash → NÃO regrava
    const hash2 = await computeSnapshotHash(repoRoot);
    const m2 = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: hash2,
      pendingBatch: null,
    });
    const wrote = await writeManifestIfChanged(repoRoot, m2);
    expect(wrote).toBe(false); // anti-loop CI funcionando

    // Hashes iguais (mesmo conteúdo de livewiki/ → mesmo hash)
    expect(hash1).toBe(hash2);
  });

  it("mudança no conteúdo → manifest regrava", async () => {
    await writeLivewikiFile("livewiki/auth.md", "v1");
    const hash1 = await computeSnapshotHash(repoRoot);
    await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: null, snapshotHash: hash1, pendingBatch: null }),
    );

    await writeLivewikiFile("livewiki/auth.md", "v2");
    const hash2 = await computeSnapshotHash(repoRoot);
    expect(hash2).not.toBe(hash1);

    const wrote = await writeManifestIfChanged(
      repoRoot,
      buildManifest({ lastDocumentedCommit: null, snapshotHash: hash2, pendingBatch: null }),
    );
    expect(wrote).toBe(true);
  });
});