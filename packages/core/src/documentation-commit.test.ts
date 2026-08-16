import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.js";
import * as safeIo from "./safe-io.js";
import {
  canonicalJson,
  commitDocumentationTask,
  retireDocumentationArtifacts,
} from "./documentation-commit.js";
import { sha256 } from "./hashes.js";
import { readManifest } from "./manifest.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-doc-commit-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "src/work.ts"),
    "export function work() { return 1; }\n",
  );
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "livewiki/work.md"),
    "---\ntitle: Work\nowner: generated\nanchors:\n  - src/work.ts#work\n---\n\n# Work\n\nDocs.\n",
  );
  await writeBaseline(repoRoot, emptyBaseline());
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("documentation durable commit", () => {
  it("advances the symbol baseline and records anchor-free task proof", async () => {
    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/work.md"), "utf8");
    const result = await commitDocumentationTask({
      repoRoot,
      taskId: "folder:src",
      kind: "folder-page",
      page: "livewiki/work.md",
      symbolKeys: ["src/work.ts#work"],
      evidence: { z: 2, a: 1 },
      artifacts: { wikiPath: "livewiki/work.md", pageHash: sha256(page) },
    });

    expect(result.baselineWritten).toBe(true);
    expect(result.receiptWritten).toBe(true);
    expect(result.evidenceHash).toBe(sha256('{"a":1,"z":2}'));

    const baseline = await readBaseline(repoRoot);
    expect(baseline.state).toBe("available");
    if (baseline.state !== "available") throw new Error("expected available baseline");
    expect(baseline.baseline.entries).toEqual([
      expect.objectContaining({
        wikiPath: "livewiki/work.md",
        symbolKey: "src/work.ts#work",
        provenance: "accepted",
      }),
    ]);
    expect((await readManifest(repoRoot))?.artifactReceipts).toEqual([
      expect.objectContaining({
        taskId: "folder:src",
        evidenceHash: sha256(canonicalJson({ a: 1, z: 2 })),
        contract: "folder-page-v1",
        artifacts: [{ path: "livewiki/work.md", hash: sha256(page) }],
      }),
    ]);
  });

  it("refuses a changed artifact before advancing durable state", async () => {
    await expect(commitDocumentationTask({
      repoRoot,
      taskId: "folder:src",
      kind: "folder-page",
      page: "livewiki/work.md",
      symbolKeys: ["src/work.ts#work"],
      evidence: { source: "fixture" },
      artifacts: { wikiPath: "livewiki/work.md", pageHash: "0".repeat(64) },
    })).rejects.toThrow("artifact changed before durable commit");

    const baseline = await readBaseline(repoRoot);
    expect(baseline.state).toBe("available");
    if (baseline.state !== "available") throw new Error("expected available baseline");
    expect(baseline.baseline.entries).toEqual([]);
    expect(await readManifest(repoRoot)).toBeNull();
  });

  it("does not create receipts for file pages and retires page authority", async () => {
    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/work.md"), "utf8");
    await commitDocumentationTask({
      repoRoot,
      taskId: "file:src/work.ts",
      kind: "file-page",
      page: "livewiki/work.md",
      symbolKeys: ["src/work.ts#work"],
      evidence: { sourcePath: "src/work.ts" },
      artifacts: { wikiPath: "livewiki/work.md", pageHash: sha256(page) },
    });
    expect(await readManifest(repoRoot)).toBeNull();

    await retireDocumentationArtifacts(repoRoot, ["livewiki/work.md"]);
    const baseline = await readBaseline(repoRoot);
    expect(baseline.state).toBe("available");
    if (baseline.state !== "available") throw new Error("expected available baseline");
    expect(baseline.baseline.entries).toEqual([]);
  });

  it("surfaces persistent baseline conflicts without retiring receipts", { timeout: 20000 }, async () => {
    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/work.md"), "utf8");
    await commitDocumentationTask({
      repoRoot,
      taskId: "folder:src",
      kind: "folder-page",
      page: "livewiki/work.md",
      symbolKeys: ["src/work.ts#work"],
      evidence: { source: "fixture" },
      artifacts: { wikiPath: "livewiki/work.md", pageHash: sha256(page) },
    });

    const original = safeIo.writeTextAtomic;
    const spy = vi.spyOn(safeIo, "writeTextAtomic").mockImplementation(
      async (root, relPath, content, opts) => {
        if (relPath === "livewiki/.baseline.json") {
          throw new safeIo.CompareAndSwapConflictError(relPath);
        }
        return original(root, relPath, content, opts);
      },
    );
    try {
      await expect(retireDocumentationArtifacts(repoRoot, ["livewiki/work.md"]))
        .rejects.toThrow(safeIo.CompareAndSwapConflictError);
    } finally {
      spy.mockRestore();
    }

    // The failed baseline removal must stop retirement before manifest
    // receipts are dropped, or the durable state splits.
    const baseline = await readBaseline(repoRoot);
    expect(baseline.state).toBe("available");
    if (baseline.state !== "available") throw new Error("expected available baseline");
    expect(baseline.baseline.entries).toHaveLength(1);
    expect((await readManifest(repoRoot))?.artifactReceipts).toHaveLength(1);
  });
});
