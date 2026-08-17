import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { sha256 } from "./hashes.js";
import * as safeIo from "./safe-io.js";
import { evaluateBaseline, readBaseline, writeBaseline } from "./baseline.js";
import {
  acceptBaseline,
  bootstrapBaseline,
  migrateBaselineKey,
  relocateBaselineEntry,
  removeBaselineEntry,
  type GitReader,
} from "./baseline-operations.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-baseline-ops-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("bootstrapBaseline", () => {
  it("reconstructs historical symbol hashes as inferred evidence", async () => {
    await writePage("src/service.ts#run");
    const historical = "export function run() {\n  return 1;\n}\n";
    const git: GitReader = {
      lastCommitForPath: async () => "abc123",
      readFileAt: async () => historical,
    };

    const result = await bootstrapBaseline(repoRoot, { git });

    expect(result).toMatchObject({ written: true, entries: 1, inferred: 1, unbaselined: [] });
    expect(result.pageCommits).toEqual([{
      wikiPath: "livewiki/service.md",
      commit: "abc123",
    }]);
    const loaded = await readBaseline(repoRoot);
    expect(loaded.state).toBe("available");
    if (loaded.state !== "available") return;
    expect(loaded.baseline.entries[0]).toMatchObject({
      wikiPath: "livewiki/service.md",
      symbolKey: "src/service.ts#run",
      extraction: "ts-v1",
      provenance: "inferred",
    });
    expect(loaded.baseline.entries[0]?.hash).not.toBe(sha256(historical));
  });

  it("leaves failures unbaselined and never guesses", async () => {
    await writePage("src/missing.ts#run");
    const git: GitReader = {
      lastCommitForPath: async () => "abc123",
      readFileAt: async () => null,
    };
    const result = await bootstrapBaseline(repoRoot, { git });
    expect(result.entries).toBe(0);
    expect(result.unbaselined).toEqual([{
      wikiPath: "livewiki/service.md",
      symbolKey: "src/missing.ts#run",
      reason: "source_missing",
    }]);
  });

  it("refuses to regenerate an existing baseline", async () => {
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await expect(bootstrapBaseline(repoRoot, {
      git: { lastCommitForPath: async () => null, readFileAt: async () => null },
    })).rejects.toThrow("already exists");
  });
});

describe("acceptBaseline", () => {
  it("requires explicit selection and accepts the current anchored hash", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });

    await expect(acceptBaseline(repoRoot, {
      page: "livewiki/service.md",
    })).rejects.toThrow("choose either explicit symbols or --all");
    const result = await acceptBaseline(repoRoot, {
      page: "livewiki/service.md",
      all: true,
    });

    expect(result).toMatchObject({ written: true, accepted: ["src/service.ts#run"] });
    const loaded = await readBaseline(repoRoot);
    expect(loaded.state).toBe("available");
    if (loaded.state !== "available") return;
    expect(loaded.baseline.entries[0]).toMatchObject({
      symbolKey: "src/service.ts#run",
      provenance: "accepted",
      extraction: "ts-v1",
    });
  });

  it("rejects symbols not anchored by the named page", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await expect(acceptBaseline(repoRoot, {
      page: "livewiki/service.md",
      symbols: ["src/service.ts#other"],
    })).rejects.toThrow("does not anchor");
  });

  it("retries a single transient compare-and-swap conflict", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    const spy = vi.spyOn(safeIo, "writeTextAtomic").mockImplementationOnce(async () => {
      throw new safeIo.CompareAndSwapConflictError("livewiki/.baseline.json");
    });
    try {
      const result = await acceptBaseline(repoRoot, {
        page: "livewiki/service.md",
        all: true,
      });
      expect(result.written).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("migrateBaselineKey", () => {
  it("requires the edited anchor and atomically replaces the durable key", async () => {
    await writeSource("export function oldName() { return 1; }\n");
    await writePage("src/service.ts#oldName");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });

    await writeSource("export function newName() { return 1; }\n");
    await writePage("src/service.ts#newName");
    const result = await migrateBaselineKey(repoRoot, {
      page: "livewiki/service.md",
      from: "src/service.ts#oldName",
      to: "src/service.ts#newName",
    });

    expect(result).toMatchObject({
      written: true,
      from: "src/service.ts#oldName",
      to: "src/service.ts#newName",
    });
    const loaded = await readBaseline(repoRoot);
    expect(loaded.state).toBe("available");
    if (loaded.state !== "available") return;
    expect(loaded.baseline.entries.map((entry) => entry.symbolKey))
      .toEqual(["src/service.ts#newName"]);
    expect(loaded.baseline.entries[0]?.provenance).toBe("accepted");
  });

  it("refuses migration while the old anchor remains", async () => {
    await writeSource("export function oldName() { return 1; }\n");
    await writePage("src/service.ts#oldName");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });
    await writeSource(
      "export function oldName() { return 1; }\nexport function newName() { return 1; }\n",
    );
    await expect(migrateBaselineKey(repoRoot, {
      page: "livewiki/service.md",
      from: "src/service.ts#oldName",
      to: "src/service.ts#newName",
    })).rejects.toThrow("still anchors the old");
  });

  it("carries hash and provenance forward, so identical content stays clean", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });
    const accepted = await readBaseline(repoRoot);
    if (accepted.state !== "available") throw new Error("expected available baseline");
    const recordedHash = accepted.baseline.entries[0]!.hash;

    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src", "other.ts"),
      "export function run() { return 1; }\n",
    );
    await writePage("src/other.ts#run");
    const result = await migrateBaselineKey(repoRoot, {
      page: "livewiki/service.md",
      from: "src/service.ts#run",
      to: "src/other.ts#run",
    });

    expect(result.hash).toBe(recordedHash);
    const loaded = await readBaseline(repoRoot);
    if (loaded.state !== "available") throw new Error("expected available baseline");
    expect(loaded.baseline.entries[0]).toMatchObject({
      symbolKey: "src/other.ts#run",
      hash: recordedHash,
      provenance: "accepted",
    });
    const health = evaluateBaseline(
      loaded.baseline,
      [{ key: "src/other.ts#run", name: "run", content_hash: recordedHash }],
      {
        obligations: [{
          wikiPath: "livewiki/service.md",
          symbolKey: "src/other.ts#run",
          assignee: "agent",
        }],
        ownerByWikiPath: new Map(),
        malformedPages: [],
      },
    );
    expect(health.entries[0]?.state).toBe("clean");
  });

  it("surfaces drift after a rename as changed instead of silently accepting it", async () => {
    await writeSource("export function oldName() { return 1; }\n");
    await writePage("src/service.ts#oldName");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });
    const accepted = await readBaseline(repoRoot);
    if (accepted.state !== "available") throw new Error("expected available baseline");
    const recordedHash = accepted.baseline.entries[0]!.hash;

    await writeSource("export function newName() { return 2; }\n");
    await writePage("src/service.ts#newName");
    await migrateBaselineKey(repoRoot, {
      page: "livewiki/service.md",
      from: "src/service.ts#oldName",
      to: "src/service.ts#newName",
    });

    const loaded = await readBaseline(repoRoot);
    if (loaded.state !== "available") throw new Error("expected available baseline");
    const migrated = loaded.baseline.entries[0]!;
    expect(migrated.symbolKey).toBe("src/service.ts#newName");
    expect(migrated.hash).toBe(recordedHash);
    const health = evaluateBaseline(
      loaded.baseline,
      [{ key: "src/service.ts#newName", name: "newName", content_hash: "b".repeat(64) }],
      {
        obligations: [{
          wikiPath: "livewiki/service.md",
          symbolKey: "src/service.ts#newName",
          assignee: "agent",
        }],
        ownerByWikiPath: new Map(),
        malformedPages: [],
      },
    );
    expect(health.entries[0]?.state).toBe("changed");
  });

  it("keeps inferred provenance inferred", async () => {
    await writeSource("export function run() { return 1; }\n");
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src", "other.ts"),
      "export function run() { return 1; }\n",
    );
    await writePage("src/other.ts#run");
    await writeBaseline(repoRoot, {
      schemaVersion: 1,
      entries: [{
        wikiPath: "livewiki/service.md",
        symbolKey: "src/service.ts#run",
        hash: "a".repeat(64),
        extraction: "ts-v1",
        provenance: "inferred",
      }],
    });

    await migrateBaselineKey(repoRoot, {
      page: "livewiki/service.md",
      from: "src/service.ts#run",
      to: "src/other.ts#run",
    });

    const loaded = await readBaseline(repoRoot);
    if (loaded.state !== "available") throw new Error("expected available baseline");
    expect(loaded.baseline.entries[0]).toMatchObject({
      symbolKey: "src/other.ts#run",
      hash: "a".repeat(64),
      provenance: "inferred",
    });
  });
});

describe("explicit baseline retirement and page relocation", () => {
  it("retires one entry only after its anchor is removed", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });

    await expect(removeBaselineEntry(repoRoot, {
      page: "livewiki/service.md",
      symbol: "src/service.ts#run",
    })).rejects.toThrow("still anchors");
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/service.md"),
      "---\ntitle: Service\nowner: generated\n---\n\n# Service\n",
    );
    expect(await removeBaselineEntry(repoRoot, {
      page: "livewiki/service.md",
      symbol: "src/service.ts#run",
    })).toMatchObject({ written: true, symbol: "src/service.ts#run" });
    const loaded = await readBaseline(repoRoot);
    expect(loaded.state === "available" ? loaded.baseline.entries : null).toEqual([]);
  });

  it("moves a clean entry only after the anchor moves between pages", async () => {
    await writeSource("export function run() { return 1; }\n");
    await writePage("src/service.ts#run");
    await writeBaseline(repoRoot, { schemaVersion: 1, entries: [] });
    await acceptBaseline(repoRoot, { page: "livewiki/service.md", all: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/service.md"),
      "---\ntitle: Old\nowner: generated\n---\n\n# Old\n",
    );
    await writePage("src/service.ts#run", "livewiki/new-service.md");

    expect(await relocateBaselineEntry(repoRoot, {
      fromPage: "livewiki/service.md",
      toPage: "livewiki/new-service.md",
      symbol: "src/service.ts#run",
    })).toMatchObject({ written: true, fromPage: "livewiki/service.md" });
    const loaded = await readBaseline(repoRoot);
    expect(loaded.state === "available" ? loaded.baseline.entries[0]?.wikiPath : null)
      .toBe("livewiki/new-service.md");
  });
});

async function writeSource(content: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
  await nodeFs.writeFile(nodePath.join(repoRoot, "src", "service.ts"), content, "utf8");
}

async function writePage(
  symbolKey: string,
  pagePath = "livewiki/service.md",
): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ...pagePath.split("/")),
    "---\n" +
      "title: Service\n" +
      "owner: generated\n" +
      "anchors:\n" +
      `  - ${symbolKey}\n` +
      "---\n\n# Service\n",
    "utf8",
  );
}
