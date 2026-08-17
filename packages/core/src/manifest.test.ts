import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { sha256 } from "./hashes.js";
import {
  BASELINE_AUDIT_FILENAME,
  MANIFEST_REL_PATH,
  computeSnapshotHash,
  readManifest,
  writeManifestIfChanged,
  buildManifest,
  recordArtifactReceipt,
  refreshArtifactReceiptHashes,
  removeArtifactReceiptsForPaths,
  upsertArtifactReceipt,
  writeManifestState,
} from "./manifest.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

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
  it("returns a stable hash for the same content (deterministic)", async () => {
    await writeLivewikiFile("livewiki/auth.md", "auth doc");
    await writeLivewikiFile("livewiki/session.md", "session doc");

    const h1 = await computeSnapshotHash(repoRoot);
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when livewiki/ content changes", async () => {
    await writeLivewikiFile("livewiki/auth.md", "v1");
    const h1 = await computeSnapshotHash(repoRoot);
    await writeLivewikiFile("livewiki/auth.md", "v2");
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).not.toBe(h2);
  });

  it("EXCLUDES .manifest.json itself from the hash", async () => {
    await writeLivewikiFile("livewiki/auth.md", "auth");
    const h1 = await computeSnapshotHash(repoRoot);

    // Writes the manifest — must not change the hash
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

  it("excludes .baseline.json audit state from the rendered snapshot", async () => {
    await writeLivewikiFile("livewiki/auth.md", "auth");
    const h1 = await computeSnapshotHash(repoRoot);
    await writeLivewikiFile(`livewiki/${BASELINE_AUDIT_FILENAME}`, "baseline-v1");
    expect(await computeSnapshotHash(repoRoot)).toBe(h1);
  });

  it("walk order is deterministic (alphabetical sort)", async () => {
    // Creates in non-alphabetical order
    await writeLivewikiFile("livewiki/zzz.md", "z");
    await writeLivewikiFile("livewiki/aaa.md", "a");
    await writeLivewikiFile("livewiki/mmm.md", "m");

    const h1 = await computeSnapshotHash(repoRoot);
    // Recreates in the same order — same hash
    await nodeFs.rm(repoRoot, { recursive: true });
    await nodeFs.mkdir(repoRoot, { recursive: true });
    await writeLivewikiFile("livewiki/zzz.md", "z");
    await writeLivewikiFile("livewiki/aaa.md", "a");
    await writeLivewikiFile("livewiki/mmm.md", "m");
    const h2 = await computeSnapshotHash(repoRoot);
    expect(h1).toBe(h2);
  });

  it("handles an empty livewiki/ (no files)", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    const h = await computeSnapshotHash(repoRoot);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles a nonexistent livewiki/", async () => {
    // Without livewiki/ — must return the hash of empty without throwing
    const h = await computeSnapshotHash(repoRoot);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("manifest.readManifest", () => {
  it("returns null if the manifest does not exist", async () => {
    expect(await readManifest(repoRoot)).toBeNull();
  });

  it("reads a valid manifest", async () => {
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
    expect(m?.artifactReceipts).toEqual([]);
  });

  it("reads and canonically sorts manifest v2 receipts", async () => {
    await writeLivewikiFile(
      MANIFEST_REL_PATH,
      JSON.stringify({
        version: 2,
        lastDocumentedCommit: null,
        snapshotHash: "h",
        updatedAt: "2026-08-15T00:00:00Z",
        pendingBatch: null,
        artifactReceipts: [
          {
            taskId: "topic:z",
            evidenceHash: HASH_B,
            contract: "topic-v1",
            artifacts: [
              { path: "livewiki/topics/z.md", hash: HASH_B },
              { path: "livewiki/topics/a.md", hash: HASH_A },
            ],
          },
          {
            taskId: "folder:a",
            evidenceHash: HASH_A,
            contract: "folder-v1",
            artifacts: [{ path: "livewiki/a/index.md", hash: HASH_A }],
          },
        ],
      }),
    );
    const manifest = await readManifest(repoRoot);
    expect(manifest?.artifactReceipts.map((receipt) => receipt.taskId))
      .toEqual(["folder:a", "topic:z"]);
    expect(manifest?.artifactReceipts[1]?.artifacts.map((artifact) => artifact.path))
      .toEqual(["livewiki/topics/a.md", "livewiki/topics/z.md"]);
  });

  it("returns null for a corrupted manifest (tolerance)", async () => {
    await writeLivewikiFile(MANIFEST_REL_PATH, "{ broken json");
    expect(await readManifest(repoRoot)).toBeNull();
  });
});

describe("manifest.writeManifestIfChanged", () => {
  it("writes if the manifest does not exist", async () => {
    const m = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: "h1",
      pendingBatch: null,
    });
    const wrote = await writeManifestIfChanged(repoRoot, m);
    expect(wrote).toBe(true);
    expect(await readManifest(repoRoot)).toEqual(m);
  });

  it("does NOT rewrite if the content is byte-identical (CI anti-loop)", async () => {
    const m = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: "h1",
      pendingBatch: null,
    });
    await writeManifestIfChanged(repoRoot, m);
    // mtimes are irrelevant — what counts is the CONTENT
    const wrote = await writeManifestIfChanged(repoRoot, m);
    expect(wrote).toBe(false);
  });

  it("rewrites if snapshotHash changes", async () => {
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

  it("rewrites if pendingBatch changes", async () => {
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

  it("rewrites if lastDocumentedCommit changes", async () => {
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

  it("rewrites when artifact receipts change and ignores input ordering", async () => {
    const first = {
      taskId: "understanding:a",
      evidenceHash: HASH_A,
      contract: "understanding-v1",
      artifacts: [{ path: "livewiki/understanding.md", hash: HASH_A }],
    };
    await writeManifestIfChanged(
      repoRoot,
      buildManifest({
        lastDocumentedCommit: null,
        snapshotHash: "h",
        pendingBatch: null,
        artifactReceipts: [first],
      }),
    );
    const unchanged = await writeManifestIfChanged(
      repoRoot,
      buildManifest({
        lastDocumentedCommit: null,
        snapshotHash: "h",
        pendingBatch: null,
        artifactReceipts: [first],
      }),
    );
    expect(unchanged).toBe(false);

    const changed = await writeManifestIfChanged(
      repoRoot,
      buildManifest({
        lastDocumentedCommit: null,
        snapshotHash: "h",
        pendingBatch: null,
        artifactReceipts: [{ ...first, evidenceHash: HASH_B }],
      }),
    );
    expect(changed).toBe(true);
  });
});

describe("manifest artifact receipts", () => {
  it("upserts by taskId and keeps deterministic order", () => {
    const receipts = upsertArtifactReceipt(
      [{
        taskId: "topic:z",
        evidenceHash: HASH_A,
        contract: "topic-v1",
        artifacts: [{ path: "livewiki/topics/z.md", hash: HASH_A }],
      }],
      {
        taskId: "folder:a",
        evidenceHash: HASH_B,
        contract: "folder-v1",
        artifacts: [{ path: "livewiki/a/index.md", hash: HASH_B }],
      },
    );
    expect(receipts.map((receipt) => receipt.taskId)).toEqual(["folder:a", "topic:z"]);
  });

  it("replaces an existing task receipt instead of duplicating it", () => {
    const existing = [{
      taskId: "topic:z",
      evidenceHash: HASH_A,
      contract: "topic-v1",
      artifacts: [{ path: "livewiki/topics/z.md", hash: HASH_A }],
    }];
    const receipts = upsertArtifactReceipt(existing, {
      ...existing[0]!,
      evidenceHash: HASH_B,
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.evidenceHash).toBe(HASH_B);
  });

  it("preserves receipts while operational state changes", async () => {
    await writeLivewikiFile("livewiki/topics/a.md", "topic");
    await recordArtifactReceipt(repoRoot, {
      taskId: "topic:a",
      evidenceHash: HASH_A,
      contract: "topic-v1",
      artifacts: [{ path: "livewiki/topics/a.md", hash: HASH_A }],
    });

    await writeManifestState(repoRoot, {
      lastDocumentedCommit: "abc123",
      snapshotHash: await computeSnapshotHash(repoRoot),
      pendingBatch: { runId: 7, stage: 5, done: 1, total: 2 },
    });

    const manifest = await readManifest(repoRoot);
    expect(manifest?.lastDocumentedCommit).toBe("abc123");
    expect(manifest?.pendingBatch?.runId).toBe(7);
    expect(manifest?.artifactReceipts.map((receipt) => receipt.taskId)).toEqual(["topic:a"]);
  });

  it("merges concurrent receipt writers without losing either task", async () => {
    await writeLivewikiFile("livewiki/topics/a.md", "a");
    await writeLivewikiFile("livewiki/topics/b.md", "b");
    await Promise.all([
      recordArtifactReceipt(repoRoot, {
        taskId: "topic:a",
        evidenceHash: HASH_A,
        contract: "topic-v1",
        artifacts: [{ path: "livewiki/topics/a.md", hash: HASH_A }],
      }),
      recordArtifactReceipt(repoRoot, {
        taskId: "topic:b",
        evidenceHash: HASH_B,
        contract: "topic-v1",
        artifacts: [{ path: "livewiki/topics/b.md", hash: HASH_B }],
      }),
    ]);

    expect((await readManifest(repoRoot))?.artifactReceipts.map((receipt) => receipt.taskId))
      .toEqual(["topic:a", "topic:b"]);
  });

  it("retires every receipt that owns a removed output", async () => {
    await writeManifestIfChanged(repoRoot, buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: "h",
      pendingBatch: null,
      artifactReceipts: [
        {
          taskId: "flow:a",
          evidenceHash: HASH_A,
          contract: "flow-v1",
          artifacts: [
            { path: "livewiki/flows/a.md", hash: HASH_A },
            { path: "livewiki/diagrams/flow-a.mmd", hash: HASH_B },
          ],
        },
        {
          taskId: "topic:b",
          evidenceHash: HASH_B,
          contract: "topic-v1",
          artifacts: [{ path: "livewiki/topics/b.md", hash: HASH_B }],
        },
      ],
    }));

    expect(await removeArtifactReceiptsForPaths(
      repoRoot,
      ["livewiki/diagrams/flow-a.mmd"],
    )).toBe(true);
    expect((await readManifest(repoRoot))?.artifactReceipts.map((receipt) => receipt.taskId))
      .toEqual(["topic:b"]);
  });

  it("refreshes only receipts for trusted deterministic rewrites", async () => {
    await writeLivewikiFile("livewiki/folder/index.md", "before");
    await writeLivewikiFile("livewiki/topics/a.md", "topic");
    await writeManifestIfChanged(repoRoot, buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: await computeSnapshotHash(repoRoot),
      pendingBatch: null,
      artifactReceipts: [
        {
          taskId: "folder:a",
          evidenceHash: HASH_A,
          contract: "folder-page-v1",
          artifacts: [{ path: "livewiki/folder/index.md", hash: sha256("before") }],
        },
        {
          taskId: "topic:a",
          evidenceHash: HASH_B,
          contract: "topic-v1",
          artifacts: [{ path: "livewiki/topics/a.md", hash: sha256("topic") }],
        },
      ],
    }));
    await writeLivewikiFile("livewiki/folder/index.md", "after");

    expect(await refreshArtifactReceiptHashes(
      repoRoot,
      ["livewiki/folder/index.md"],
    )).toBe(true);
    const receipts = (await readManifest(repoRoot))!.artifactReceipts;
    expect(receipts.find((receipt) => receipt.taskId === "folder:a")?.artifacts[0]?.hash)
      .toBe(sha256("after"));
    expect(receipts.find((receipt) => receipt.taskId === "topic:a")?.artifacts[0]?.hash)
      .toBe(sha256("topic"));
  });
});

describe("manifest — end-to-end idempotence (fix #3)", () => {
  it("two inits in a row with no change = byte-identical manifest", async () => {
    // Setup: wiki with 3 pages + initial manifest
    await writeLivewikiFile("livewiki/auth.md", "auth doc");
    await writeLivewikiFile("livewiki/session.md", "session doc");
    await writeLivewikiFile("livewiki/quickstart.md", "qs");

    // 1st "init": computes hash + writes manifest
    const hash1 = await computeSnapshotHash(repoRoot);
    const m1 = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: hash1,
      pendingBatch: null,
    });
    await writeManifestIfChanged(repoRoot, m1);

    // 2nd "init" with no change: same hash → does NOT rewrite
    const hash2 = await computeSnapshotHash(repoRoot);
    const m2 = buildManifest({
      lastDocumentedCommit: null,
      snapshotHash: hash2,
      pendingBatch: null,
    });
    const wrote = await writeManifestIfChanged(repoRoot, m2);
    expect(wrote).toBe(false); // CI anti-loop working

    // Equal hashes (same livewiki/ content → same hash)
    expect(hash1).toBe(hash2);
  });

  it("content change → manifest rewrites", async () => {
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
